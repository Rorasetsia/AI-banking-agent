const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV, timeout: 60000 })
const db = cloud.database()
const _ = db.command

const TRANSACTION_FIELDS = ['amount','direction','category','title','merchant','itemName','remark','rawText','tags','people','relationship','socialAction','occasion','aaPeople','memo','date','time','source','accountId','ledgerId','timezone']
const SUBSCRIPTION_FIELDS = ['name','merchant','amount','cycle','startDate','nextDate','status','autoRenew','notes','tags','rawText','source']

function fmt(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
function today() {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000)
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0')
}
function weekRange(offset) {
  const now = new Date()
  const day = now.getDay() || 7
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1 + offset * 7)
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)
  return { start: fmt(monday), end: fmt(sunday) }
}
function periodRange(period) {
  const now = new Date()
  if (period === 'today') return { start: today(), end: today() }
  if (period === 'yesterday') return { start: shiftDate(-1), end: shiftDate(-1) }
  if (period === 'week') return weekRange(0)
  if (period === 'lastWeek') return weekRange(-1)
  if (period === 'month') return { start: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), end: fmt(new Date(now.getFullYear(), now.getMonth() + 1, 0)) }
  if (period === 'lastMonth') return { start: fmt(new Date(now.getFullYear(), now.getMonth() - 1, 1)), end: fmt(new Date(now.getFullYear(), now.getMonth(), 0)) }
  if (period === 'year') return { start: fmt(new Date(now.getFullYear(), 0, 1)), end: fmt(new Date(now.getFullYear(), 11, 31)) }
  return null
}
function normalize(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '')
}
function cleanText(value) {
  return String(value || '').trim()
}
function pickFields(event, fields) {
  const source = event.data || event
  const out = {}
  fields.forEach(key => {
    if (source[key] !== undefined && source[key] !== null) out[key] = source[key]
  })
  return out
}
function signedAmount(event) {
  const raw = Math.abs(Number((event.data || event).amount))
  if (!raw) return 0
  const direction = (event.data || event).direction || (Number((event.data || event).amount) < 0 ? 'expense' : 'expense')
  return direction === 'income' ? raw : -raw
}
async function getOpenid() {
  const { OPENID } = cloud.getWXContext()
  return OPENID
}
async function ledgerById(id) {
  if (!id) return null
  try {
    const res = await db.collection('ledgers').doc(id).get()
    return res.data || null
  } catch (e) {
    return null
  }
}
async function checkLedgerMember(openid, ledgerId) {
  if (!ledgerId) return true
  const ledger = await ledgerById(ledgerId)
  return !!(ledger && Array.isArray(ledger.members) && ledger.members.includes(openid))
}
function transactionVisible(item, openid, ledgerId) {
  if (ledgerId) return item.ledgerId === ledgerId
  return item._openid === openid && !item.ledgerId
}
function transactionView(item) {
  return {
    _id: item._id,
    amount: Number(item.amount) || 0,
    direction: Number(item.amount) > 0 ? 'income' : 'expense',
    category: item.category || '其他',
    title: item.title || '',
    merchant: item.merchant || '',
    itemName: item.itemName || '',
    remark: item.remark || '',
    rawText: item.rawText || item.remark || '',
    tags: Array.from(new Set((item.tags || []).map(x => String(x || '').trim()).filter(Boolean))).slice(0, 8),
    people: Array.from(new Set((item.people || []).map(x => String(x || '').trim()).filter(Boolean))),
    relationship: item.relationship || '',
    socialAction: item.socialAction || '',
    occasion: item.occasion || '',
    aaPeople: Number(item.aaPeople) || 0,
    memo: item.memo || '',
    date: item.date || '',
    time: item.time || '',
    source: item.source || 'manual',
    accountId: item.accountId || '',
    ledgerId: item.ledgerId || '',
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null
  }
}
async function listTransactions(event, openid) {
  const current = event.data || event
  const ledgerId = current.ledgerId || ''
  if (!(await checkLedgerMember(openid, ledgerId))) return { ok: false, error: '无权访问该共同账本' }
  const where = ledgerId ? { ledgerId } : { _openid: openid }
  const res = await db.collection('transactions').where(where).limit(1000).get()
  let list = res.data.filter(item => transactionVisible(item, openid, ledgerId))
  const range = current.startDate && current.endDate ? { start: current.startDate, end: current.endDate } : periodRange(current.period || 'month')
  if (range) list = list.filter(item => item.date >= range.start && item.date <= range.end)
  if (current.category) list = list.filter(item => item.category === current.category)
  const keyword = normalize(current.keyword)
  if (keyword) {
    list = list.filter(item => normalize([item.title, item.merchant, item.itemName, item.remark, item.rawText, item.category, item.relationship, item.socialAction, item.occasion].concat(item.tags || []).concat(item.people || []).join(' ')).includes(keyword))
  }
  list.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.time || '').localeCompare(String(a.time || '')))
  const expense = list.filter(x => Number(x.amount) < 0).reduce((s, x) => s + Math.abs(Number(x.amount) || 0), 0)
  const income = list.filter(x => Number(x.amount) > 0).reduce((s, x) => s + Number(x.amount || 0), 0)
  return {
    ok: true,
    list: list.slice(0, Number(current.limit) || 200).map(transactionView),
    total: list.length,
    expense: Math.round(expense * 100) / 100,
    income: Math.round(income * 100) / 100,
    range,
    ledgerId
  }
}
async function getTransaction(event, openid) {
  const id = (event.data || event).recordId || (event.data || event)._id
  if (!id) return { ok: false, error: '缺少记录 ID' }
  try {
    const res = await db.collection('transactions').doc(id).get()
    const item = res.data
    if (!transactionVisible(item, openid, item.ledgerId)) return { ok: false, error: '记录不存在或无权访问' }
    return { ok: true, data: transactionView(item) }
  } catch (e) {
    return { ok: false, error: '记录不存在' }
  }
}
async function createTransaction(event, openid) {
  const payload = pickFields(event, TRANSACTION_FIELDS)
  if (payload.tags !== undefined) payload.tags = normalizeTags(payload.tags)
  const amount = signedAmount(event)
  if (!amount) return { ok: false, error: '请输入有效金额' }
  if (!(await checkLedgerMember(openid, payload.ledgerId))) return { ok: false, error: '无权访问该共同账本' }
  const data = Object.assign({
    category: '其他',
    title: '',
    merchant: '',
    itemName: '',
    remark: '',
    rawText: '',
    tags: [],
    people: [],
    relationship: '',
    socialAction: '',
    occasion: '',
    aaPeople: 0,
    memo: '',
    time: '',
    source: 'manual',
    accountId: '',
    timezone: 'Asia/Shanghai'
  }, payload)
  data.amount = amount
  data.date = data.date || today()
  data._openid = openid
  data.createdBy = openid
  data.createdAt = db.serverDate()
  data.updatedAt = db.serverDate()
  const res = await db.collection('transactions').add({ data })
  return { ok: true, _id: res._id }
}
async function updateTransaction(event, openid) {
  const current = event.data || event
  const id = current.recordId || current._id
  if (!id) return { ok: false, error: '缺少记录 ID' }
  let doc
  try { doc = (await db.collection('transactions').doc(id).get()).data } catch (e) { return { ok: false, error: '记录不存在' } }
  if (!transactionVisible(doc, openid, doc.ledgerId)) return { ok: false, error: '记录不存在或无权访问' }
  const payload = pickFields(event, TRANSACTION_FIELDS)
  if (payload.tags !== undefined) payload.tags = normalizeTags(payload.tags)
  if (payload.ledgerId !== undefined && !(await checkLedgerMember(openid, payload.ledgerId))) return { ok: false, error: '无权访问该共同账本' }
  if (current.amount !== undefined || current.direction !== undefined) {
    const amount = Math.abs(Number(current.amount !== undefined ? current.amount : doc.amount))
    const direction = current.direction || (Number(doc.amount) > 0 ? 'income' : 'expense')
    payload.amount = direction === 'income' ? amount : -amount
  }
  payload.updatedAt = db.serverDate()
  await db.collection('transactions').doc(id).update({ data: payload })
  return { ok: true, _id: id }
}
async function deleteTransaction(event, openid) {
  const current = event.data || event
  const id = current.recordId || current._id
  if (!id) return { ok: false, error: '缺少记录 ID' }
  let doc
  try { doc = (await db.collection('transactions').doc(id).get()).data } catch (e) { return { ok: false, error: '记录不存在' } }
  if (!transactionVisible(doc, openid, doc.ledgerId)) return { ok: false, error: '记录不存在或无权访问' }
  await db.collection('transactions').doc(id).remove()
  return { ok: true }
}
function normalizeTags(tags) {
  const order = ['请客', '女朋友', '男朋友', '朋友', '同事', '同学', '家庭', '聚餐', 'AA', '约会', '生日', '纪念日']
  const synonyms = {
    '我请': '请客', '我请客': '请客', '请吃饭': '请客',
    '女友': '女朋友', '和女朋友': '女朋友', '跟女朋友': '女朋友',
    '男友': '男朋友', '和男朋友': '男朋友', '跟男朋友': '男朋友',
    '和朋友': '朋友', '跟朋友': '朋友', '和同事': '同事', '跟同事': '同事'
  }
  const list = Array.isArray(tags) ? tags : String(tags || '').split(/[，,]/)
  const normalized = list.map(cleanText).filter(Boolean).map(x => synonyms[x] || x).filter((x, i, arr) => arr.indexOf(x) === i)
  return normalized.sort((a, b) => {
    const ai = order.indexOf(a), bi = order.indexOf(b)
    if (ai === -1 && bi === -1) return a.localeCompare(b)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  }).slice(0, 8)
}
function monthDays(month) {
  const parts = String(month || '').split('-')
  const year = Number(parts[0]) || new Date().getFullYear()
  const m = Number(parts[1]) || new Date().getMonth() + 1
  return new Date(year, m, 0).getDate()
}
function normalizeBudgetAmounts(amount, period, month) {
  const days = monthDays(month)
  const value = Number(amount)
  if (period === 'day') return { amount: value, dailyAmount: value, monthlyAmount: Math.round(value * days * 100) / 100, daysInMonth: days }
  return { amount: value, monthlyAmount: value, dailyAmount: Math.round(value / days * 100) / 100, daysInMonth: days }
}
async function setBudget(event, openid) {
  const current = event.data || event
  const period = current.period === 'day' ? 'day' : 'month'
  const month = current.month || today().slice(0, 7)
  const type = current.type === 'category' ? 'category' : 'total'
  const category = type === 'category' ? cleanText(current.category) : '全部'
  if (type === 'category' && !category) return { ok: false, error: '请选择预算分类' }
  const amount = Number(current.amount)
  if (!amount || amount <= 0) return { ok: false, error: '预算金额必须大于 0' }
  const amounts = normalizeBudgetAmounts(amount, period, month)
  const exist = await db.collection('budgets').where({ _openid: openid, month, type, category }).get()
  const data = Object.assign({ month, type, category, period, source: current.source || 'manual', updatedAt: db.serverDate() }, amounts)
  let id = ''
  if (exist.data.length) {
    id = exist.data[0]._id
    await db.collection('budgets').doc(id).update({ data })
  } else {
    const created = await db.collection('budgets').add({ data: Object.assign({}, data, { _openid: openid, createdAt: db.serverDate() }) })
    id = created._id
  }
  return { ok: true, _id: id, month, type, category, period, amount, monthlyAmount: amounts.monthlyAmount, dailyAmount: amounts.dailyAmount, daysInMonth: amounts.daysInMonth }
}
async function listBudgets(event, openid) {
  const month = (event.data || event).month || today().slice(0, 7)
  const res = await db.collection('budgets').where({ _openid: openid }).get()
  const list = res.data.filter(item => !item.month || item.month === month)
  const total = list.find(item => item.type === 'total' || (!item.type && (!item.category || item.category === '全部'))) || null
  const categories = list.filter(item => item.type === 'category').map(item => Object.assign({}, item, {
    dailyAmount: item.dailyAmount !== undefined ? item.dailyAmount : Math.round(Number(item.amount || 0) / monthDays(item.month || month) * 100) / 100,
    monthlyAmount: item.monthlyAmount !== undefined ? item.monthlyAmount : Number(item.amount || 0),
    daysInMonth: item.daysInMonth || monthDays(item.month || month)
  }))
  return { ok: true, month, total, categories }
}
async function deleteBudget(event, openid) {
  const id = (event.data || event).recordId || (event.data || event)._id
  if (!id) return { ok: false, error: '缺少预算 ID' }
  let doc
  try { doc = (await db.collection('budgets').doc(id).get()).data } catch (e) { return { ok: false, error: '预算不存在' } }
  if (doc._openid !== openid) return { ok: false, error: '无权删除该预算' }
  await db.collection('budgets').doc(id).remove()
  return { ok: true }
}

async function listGoals(event, openid) {
  const res = await db.collection('goals').where({ _openid: openid }).get()
  return { ok: true, list: res.data }
}
async function createGoal(event, openid) {
  const current = event.data || event
  const name = cleanText(current.name)
  const targetAmount = Number(current.targetAmount)
  if (!name || !targetAmount) return { ok: false, error: '请填写目标名称和目标金额' }
  const data = {
    name,
    targetAmount,
    savedAmount: Number(current.savedAmount) || 0,
    deadline: current.deadline || '',
    status: current.status || 'active',
    _openid: openid,
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  }
  const created = await db.collection('goals').add({ data })
  return { ok: true, _id: created._id }
}
async function updateGoal(event, openid) {
  const current = event.data || event
  const id = current.recordId || current._id
  if (!id) return { ok: false, error: '缺少目标 ID' }
  let doc
  try { doc = (await db.collection('goals').doc(id).get()).data } catch (e) { return { ok: false, error: '目标不存在' } }
  if (doc._openid !== openid) return { ok: false, error: '无权修改该目标' }
  const data = {}
  if (current.name !== undefined) data.name = cleanText(current.name)
  if (current.targetAmount !== undefined) data.targetAmount = Number(current.targetAmount)
  if (current.savedAmount !== undefined) data.savedAmount = Number(current.savedAmount)
  if (current.deadline !== undefined) data.deadline = current.deadline
  if (current.status !== undefined) data.status = current.status
  data.updatedAt = db.serverDate()
  await db.collection('goals').doc(id).update({ data })
  return { ok: true, _id: id }
}
async function deleteGoal(event, openid) {
  const id = (event.data || event).recordId || (event.data || event)._id
  if (!id) return { ok: false, error: '缺少目标 ID' }
  let doc
  try { doc = (await db.collection('goals').doc(id).get()).data } catch (e) { return { ok: false, error: '目标不存在' } }
  if (doc._openid !== openid) return { ok: false, error: '无权删除该目标' }
  await db.collection('goals').doc(id).remove()
  return { ok: true }
}

async function listSubscriptions(event, openid) {
  const status = (event.data || event).status
  const where = { _openid: openid }
  if (status) where.status = status
  const res = await db.collection('subscriptions').where(where).get()
  const list = res.data.slice().sort((a, b) => String(a.nextDate || '').localeCompare(String(b.nextDate || '')))
  const active = list.filter(x => x.status !== 'cancelled')
  const totalMonthly = active.reduce((s, x) => {
    if (x.cycle === 'yearly') return s + Number(x.amount || 0) / 12
    if (x.cycle === 'weekly') return s + Number(x.amount || 0) * 4.33
    return s + Number(x.amount || 0)
  }, 0)
  return { ok: true, list: list.map(x => Object.assign({ _id: x._id }, x)), count: active.length, totalMonthly: Math.round(totalMonthly * 100) / 100 }
}
function computeNextDate(cycle, startDate, explicitNextDate) {
  const baseText = explicitNextDate || startDate || today()
  const base = new Date(baseText + 'T00:00:00')
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate())
  if (explicitNextDate && explicitNextDate > today()) return explicitNextDate
  if (cycle === 'yearly') d.setFullYear(d.getFullYear() + 1)
  else if (cycle === 'weekly') d.setDate(d.getDate() + 7)
  else d.setMonth(d.getMonth() + 1)
  let next = fmt(d)
  while (next <= today()) {
    if (cycle === 'yearly') d.setFullYear(d.getFullYear() + 1)
    else if (cycle === 'weekly') d.setDate(d.getDate() + 7)
    else d.setMonth(d.getMonth() + 1)
    next = fmt(d)
  }
  return next
}
async function createSubscription(event, openid) {
  const payload = pickFields(event, SUBSCRIPTION_FIELDS)
  if (!cleanText(payload.name)) return { ok: false, error: '请填写订阅名称' }
  if (!Number(payload.amount)) return { ok: false, error: '请填写有效金额' }
  const data = Object.assign({ merchant: '', cycle: 'monthly', startDate: today(), status: 'active', autoRenew: true, notes: '', tags: [], rawText: '', source: 'manual', timezone: 'Asia/Shanghai' }, payload)
  data.amount = Number(data.amount)
  data.startDate = data.startDate || today()
  data.nextDate = computeNextDate(data.cycle, data.startDate, data.nextDate)
  data._openid = openid
  data.createdAt = db.serverDate()
  data.updatedAt = db.serverDate()
  const res = await db.collection('subscriptions').add({ data })
  return { ok: true, _id: res._id }
}
async function updateSubscription(event, openid) {
  const current = event.data || event
  const id = current.recordId || current._id
  if (!id) return { ok: false, error: '缺少订阅 ID' }
  let doc
  try { doc = (await db.collection('subscriptions').doc(id).get()).data } catch (e) { return { ok: false, error: '订阅不存在' } }
  if (doc._openid !== openid) return { ok: false, error: '无权修改该订阅' }
  const payload = pickFields(event, SUBSCRIPTION_FIELDS)
  if (payload.nextDate === '') delete payload.nextDate
  if (payload.amount !== undefined) payload.amount = Number(payload.amount)
  if (payload.cycle === undefined) payload.cycle = doc.cycle
  if (payload.startDate === undefined) payload.startDate = doc.startDate
  if (payload.nextDate === undefined || payload.cycle !== doc.cycle || payload.startDate !== doc.startDate) {
    payload.nextDate = computeNextDate(payload.cycle, payload.startDate, payload.nextDate)
  }
  payload.updatedAt = db.serverDate()
  await db.collection('subscriptions').doc(id).update({ data: payload })
  return { ok: true, _id: id }
}
function advanceCycle(dateText, cycle) {
  const d = new Date((dateText || today()) + 'T00:00:00')
  if (cycle === 'yearly') d.setFullYear(d.getFullYear() + 1)
  else if (cycle === 'weekly') d.setDate(d.getDate() + 7)
  else d.setMonth(d.getMonth() + 1)
  return fmt(d)
}
async function renewSubscription(event, openid) {
  const id = (event.data || event).recordId || (event.data || event)._id
  if (!id) return { ok: false, error: '缺少订阅 ID' }
  let doc
  try { doc = (await db.collection('subscriptions').doc(id).get()).data } catch (e) { return { ok: false, error: '订阅不存在' } }
  if (doc._openid !== openid) return { ok: false, error: '无权续费该订阅' }
  let nextDate = advanceCycle(doc.nextDate || doc.startDate || today(), doc.cycle || 'monthly')
  while (nextDate <= today()) nextDate = advanceCycle(nextDate, doc.cycle || 'monthly')
  await db.collection('subscriptions').doc(id).update({ data: { status: 'active', autoRenew: true, nextDate, renewCount: Number(doc.renewCount || 0) + 1, updatedAt: db.serverDate() } })
  return { ok: true, nextDate, startDate: doc.startDate, renewCount: Number(doc.renewCount || 0) + 1 }
}

async function cancelSubscription(event, openid) {
  const id = (event.data || event).recordId || (event.data || event)._id
  if (!id) return { ok: false, error: '缺少订阅 ID' }
  let doc
  try { doc = (await db.collection('subscriptions').doc(id).get()).data } catch (e) { return { ok: false, error: '订阅不存在' } }
  if (doc._openid !== openid) return { ok: false, error: '无权取消该订阅' }
  await db.collection('subscriptions').doc(id).update({ data: { status: 'cancelled', autoRenew: false, updatedAt: db.serverDate() } })
  return { ok: true }
}
async function updateLedger(event, openid) {
  const current = event.data || event
  const id = current.ledgerId || current._id
  if (!id) return { ok: false, error: '缺少账本 ID' }
  let ledger
  try { ledger = (await db.collection('ledgers').doc(id).get()).data } catch (e) { return { ok: false, error: '共同账本不存在' } }
  if (!Array.isArray(ledger.members) || !ledger.members.includes(openid)) return { ok: false, error: '无权修改该共同账本' }
  const payload = {}
  if (current.relationship !== undefined) payload.relationship = cleanText(current.relationship)
  if (current.name !== undefined) payload.name = cleanText(current.name)
  payload.updatedAt = db.serverDate()
  await db.collection('ledgers').doc(id).update({ data: payload })
  return { ok: true, ledger: Object.assign({}, ledger, payload) }
}
async function leaveLedger(event, openid) {
  const id = (event.data || event).ledgerId || (event.data || event)._id
  if (!id) return { ok: false, error: '缺少账本 ID' }
  let ledger
  try { ledger = (await db.collection('ledgers').doc(id).get()).data } catch (e) { return { ok: false, error: '共同账本不存在' } }
  if (!Array.isArray(ledger.members) || !ledger.members.includes(openid)) return { ok: false, error: '你不在该共同账本中' }
  const members = ledger.members.filter(x => x !== openid)
  await db.collection('ledgers').doc(id).update({ data: { members, updatedAt: db.serverDate() } })
  return { ok: true, ledgerId: id }
}
async function listLedgers(event, openid) {
  const res = await db.collection('ledgers').where({ members: openid }).get()
  return { ok: true, list: res.data, count: res.data.length }
}
function genCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}
async function createLedger(event, openid) {
  const res = await db.collection('ledgers').where({ members: openid }).get()
  if (res.data.length) return { ok: true, ledger: res.data[0], existed: true }
  const inviteCode = genCode()
  const created = await db.collection('ledgers').add({ data: { inviteCode, name: '共同账本', members: [openid], _openid: openid, createdAt: db.serverDate(), updatedAt: db.serverDate() } })
  return { ok: true, ledger: { _id: created._id, inviteCode, name: '共同账本', members: [openid] } }
}
async function joinLedger(event, openid) {
  const code = cleanText((event.data || event).inviteCode).toUpperCase()
  if (!code) return { ok: false, error: '请输入邀请码' }
  const res = await db.collection('ledgers').where({ inviteCode: code }).get()
  if (!res.data.length) return { ok: false, error: '邀请码不存在' }
  const ledger = res.data[0]
  if (ledger.members.includes(openid)) return { ok: true, ledger }
  if (ledger.members.length >= 2) return { ok: false, error: '该共同账本已有 2 人' }
  await db.collection('ledgers').doc(ledger._id).update({ data: { members: ledger.members.concat([openid]), updatedAt: db.serverDate() } })
  return { ok: true, ledger: Object.assign({}, ledger, { members: ledger.members.concat([openid]) }) }
}

exports.main = async (event) => {
  const openid = await getOpenid()
  const action = event.action || (event.data && event.data.action)
  try {
    if (action === 'transactions.list') return await listTransactions(event, openid)
    if (action === 'transactions.get') return await getTransaction(event, openid)
    if (action === 'transactions.create') return await createTransaction(event, openid)
    if (action === 'transactions.update') return await updateTransaction(event, openid)
    if (action === 'transactions.delete') return await deleteTransaction(event, openid)
    if (action === 'subscriptions.list') return await listSubscriptions(event, openid)
    if (action === 'subscriptions.create') return await createSubscription(event, openid)
    if (action === 'subscriptions.update') return await updateSubscription(event, openid)
    if (action === 'subscriptions.cancel') return await cancelSubscription(event, openid)
    if (action === 'subscriptions.renew') return await renewSubscription(event, openid)
    if (action === 'ledgers.list') return await listLedgers(event, openid)
    if (action === 'ledgers.create') return await createLedger(event, openid)
    if (action === 'ledgers.join') return await joinLedger(event, openid)
    if (action === 'ledgers.update') return await updateLedger(event, openid)
    if (action === 'ledgers.leave') return await leaveLedger(event, openid)
    if (action === 'budgets.set') return await setBudget(event, openid)
    if (action === 'budgets.list') return await listBudgets(event, openid)
    if (action === 'budgets.delete') return await deleteBudget(event, openid)
    if (action === 'goals.list') return await listGoals(event, openid)
    if (action === 'goals.create') return await createGoal(event, openid)
    if (action === 'goals.update') return await updateGoal(event, openid)
    if (action === 'goals.delete') return await deleteGoal(event, openid)
    return { ok: false, error: '未知操作: ' + action }
  } catch (e) {
    console.error('ledgerService failed', action, e)
    return { ok: false, error: e.message || '服务执行失败' }
  }
}
