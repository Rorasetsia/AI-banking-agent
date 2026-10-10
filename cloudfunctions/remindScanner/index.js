const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV, timeout: 60000 })
const db = cloud.database()
const _ = db.command

const SHANGHAI_OFFSET = 8 * 60 * 60 * 1000

function fmtUTC(d) {
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0')
}
function nowShanghai() { return new Date(Date.now() + SHANGHAI_OFFSET) }
function today() { return fmtUTC(nowShanghai()) }
function addDays(n) {
  const d = nowShanghai()
  d.setUTCDate(d.getUTCDate() + n)
  return fmtUTC(d)
}
function monthRange() {
  const now = nowShanghai()
  const year = now.getUTCFullYear()
  const monthIndex = now.getUTCMonth()
  const endDate = new Date(Date.UTC(year, monthIndex + 1, 0))
  return {
    start: year + '-' + String(monthIndex + 1).padStart(2, '0') + '-01',
    end: fmtUTC(endDate),
    month: year + '-' + String(monthIndex + 1).padStart(2, '0')
  }
}
function cleanCategory(value) { return String(value || '').trim() || '全部' }
function normalizeKey(value) { return cleanCategory(value).toLowerCase() }
function budgetType(item) { return item.type === 'category' || (item.category && item.category !== '全部') ? 'category' : 'total' }
function budgetCategory(item) { return budgetType(item) === 'total' ? '全部' : cleanCategory(item.category) }
function budgetOwnerKey(item) { return item.ledgerId ? 'shared:' + item.ledgerId : 'personal:' + item._openid }
function budgetLogicalKey(item, month) { return budgetOwnerKey(item) + '|' + month + '|' + budgetType(item) + '|' + budgetCategory(item) }
function budgetKey(recipient, month, type, category, ledgerId) {
  const owner = ledgerId ? 'shared:' + ledgerId + ':' + recipient : recipient
  return ['budget', month, type, normalizeKey(type === 'total' ? '全部' : category), owner].join(':')
}
function recordTime(item) {
  const value = item && (item.updatedAt || item.createdAt)
  const time = value ? new Date(value).getTime() : 0
  return Number.isFinite(time) ? time : 0
}
function reminderCategory(item) {
  if (item.budgetCategory) return cleanCategory(item.budgetCategory)
  const match = String(item.content || '').match(/预算「([^」]+)」/)
  return cleanCategory(match && match[1])
}
function reminderType(item) {
  if (item.budgetType) return item.budgetType === 'category' ? 'category' : 'total'
  return reminderCategory(item) === '全部' ? 'total' : 'category'
}
function reminderMonth(item) { return item.budgetMonth || String(item.date || '').slice(0, 7) }
function reminderLedgerId(item) { return item.budgetLedgerId || '' }
function reminderDedupeKey(item) {
  if (item.dedupeKey) return item.dedupeKey
  return budgetKey(item._openid, reminderMonth(item), reminderType(item), reminderCategory(item), reminderLedgerId(item))
}
function displayName(type, category) { return type === 'total' ? '总预算' : '预算「' + category + '」' }
async function fetchAllTransactions(where) {
  const pageSize = 1000
  const list = []
  let offset = 0
  while (offset < 10000) {
    const res = await db.collection('transactions').where(where).skip(offset).limit(pageSize).get()
    list.push(...res.data)
    if (res.data.length < pageSize) break
    offset += pageSize
  }
  return list
}
async function getLedgerMap(ids) {
  const map = {}
  const list = Array.from(new Set(ids.filter(Boolean)))
  if (!list.length) return map
  const res = await db.collection('ledgers').where({ _id: _.in(list) }).limit(1000).get()
  for (const ledger of res.data) map[ledger._id] = ledger
  return map
}
async function syncBudgetReminders(openid, desired, oldReminders) {
  const oldByKey = {}
  for (const item of oldReminders) {
    const key = reminderDedupeKey(item)
    oldByKey[key] = oldByKey[key] || []
    oldByKey[key].push(item)
  }
  for (const key of Object.keys(desired)) {
    const payload = desired[key]
    const matches = (oldByKey[key] || []).slice().sort((a, b) => recordTime(b) - recordTime(a))
    if (!matches.length) {
      await db.collection('reminders').add({ data: Object.assign({}, payload, { _openid: openid, createdAt: db.serverDate(), updatedAt: db.serverDate() }) })
    } else {
      const keep = matches.shift()
      await db.collection('reminders').doc(keep._id).update({ data: Object.assign({}, payload, { read: false, updatedAt: db.serverDate() }) })
      for (const duplicate of matches) await db.collection('reminders').doc(duplicate._id).remove()
    }
    delete oldByKey[key]
  }
  for (const key of Object.keys(oldByKey)) {
    for (const item of oldByKey[key]) await db.collection('reminders').doc(item._id).remove()
  }
}

exports.main = async () => {
  const results = []
  const soon = addDays(3)
  const subRes = await db.collection('subscriptions').where({ status: 'active', nextDate: _.lte(soon) }).get()
  for (const s of subRes.data) {
    const content = '订阅「' + s.name + '」将于 ' + s.nextDate + ' 续费 ' + s.amount + ' 元'
    await db.collection('reminders').add({ data: { _openid: s._openid, type: 'subscription', content, read: false, date: today(), createdAt: db.serverDate() } })
    results.push(content)
  }

  const range = monthRange()
  const bRes = await db.collection('budgets').limit(1000).get()
  const logicalBudgets = {}
  for (const budget of bRes.data) {
    const month = budget.month || range.month
    if (month !== range.month) continue
    const key = budgetLogicalKey(budget, month)
    if (!logicalBudgets[key] || recordTime(budget) > recordTime(logicalBudgets[key])) logicalBudgets[key] = budget
  }

  const txList = await fetchAllTransactions({ amount: _.lt(0), date: _.gte(range.start).and(_.lte(range.end)) })
  const spentByUser = {}
  const spentByUserCategory = {}
  const spentByLedger = {}
  const spentByLedgerCategory = {}
  for (const tx of txList) {
    const amount = Math.abs(Number(tx.amount) || 0)
    if (!amount) continue
    if (tx.ledgerId) {
      spentByLedger[tx.ledgerId] = (spentByLedger[tx.ledgerId] || 0) + amount
      const key = tx.ledgerId + '|' + normalizeKey(tx.category)
      spentByLedgerCategory[key] = (spentByLedgerCategory[key] || 0) + amount
    } else if (tx._openid) {
      spentByUser[tx._openid] = (spentByUser[tx._openid] || 0) + amount
      const key = tx._openid + '|' + normalizeKey(tx.category)
      spentByUserCategory[key] = (spentByUserCategory[key] || 0) + amount
    }
  }

  const ledgerMap = await getLedgerMap(Object.values(logicalBudgets).map(item => item.ledgerId))
  const oldRes = await db.collection('reminders').where({ type: 'budget', read: false }).limit(1000).get()
  const desiredByOwner = {}
  const addDesired = (openid, key, payload) => {
    if (!openid) return
    desiredByOwner[openid] = desiredByOwner[openid] || {}
    desiredByOwner[openid][key] = payload
  }

  for (const budget of Object.values(logicalBudgets)) {
    const ledgerId = budget.ledgerId || ''
    const ledger = ledgerId ? ledgerMap[ledgerId] : null
    if (ledgerId && !ledger) continue
    const recipients = ledgerId ? (ledger.members || []) : [budget._openid]
    const type = budgetType(budget)
    const category = budgetCategory(budget)
    const monthlyAmount = Number(budget.monthlyAmount || budget.amount || 0)
    const threshold = Math.min(100, Math.max(1, Number(budget.reminderThreshold || 80)))
    const spent = ledgerId
      ? Number(type === 'total' ? spentByLedger[ledgerId] : spentByLedgerCategory[ledgerId + '|' + normalizeKey(category)] || 0)
      : Number(type === 'total' ? spentByUser[budget._openid] : spentByUserCategory[budget._openid + '|' + normalizeKey(category)] || 0)
    if (!monthlyAmount || spent / monthlyAmount * 100 < threshold) continue
    const ratio = Math.round(spent / monthlyAmount * 100)
    const scopeLabel = ledgerId ? '共同账本' + (ledger.name ? '「' + ledger.name + '」' : '') : '个人账本'
    const content = scopeLabel + '本月' + displayName(type, category) + '已用 ' + ratio + '%（' + Math.round(spent * 100) / 100 + '/' + monthlyAmount + ' 元，阈值 ' + threshold + '%）'
    for (const recipient of recipients) {
      const key = budgetKey(recipient, range.month, type, category, ledgerId)
      addDesired(recipient, key, {
        type: 'budget',
        dedupeKey: key,
        budgetMonth: range.month,
        budgetScope: ledgerId ? 'shared' : 'personal',
        budgetLedgerId: ledgerId,
        ledgerName: ledger ? (ledger.name || '共同账本') : '',
        budgetType: type,
        budgetCategory: category,
        budgetAmount: monthlyAmount,
        reminderThreshold: threshold,
        spent: Math.round(spent * 100) / 100,
        ratio,
        content,
        read: false,
        date: today()
      })
    }
    results.push(content)
  }

  const ownerIds = new Set(Object.keys(desiredByOwner))
  for (const item of oldRes.data) if (item._openid) ownerIds.add(item._openid)
  for (const openid of ownerIds) {
    await syncBudgetReminders(openid, desiredByOwner[openid] || {}, oldRes.data.filter(item => item._openid === openid))
  }
  return { success: true, count: results.length, results }
}
