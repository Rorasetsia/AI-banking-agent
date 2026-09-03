const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV, timeout: 60000 })
const db = cloud.database()
const _ = db.command

const CATEGORIES = ['餐饮', '交通', '购物', '娱乐', '居住', '医疗', '教育', '其他']

function today() {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
function fmt(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
function dateRange(period) {
  const now = new Date()
  if (period === 'month') return { start: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), end: fmt(new Date(now.getFullYear(), now.getMonth() + 1, 0)) }
  if (period === 'lastMonth') return { start: fmt(new Date(now.getFullYear(), now.getMonth() - 1, 1)), end: fmt(new Date(now.getFullYear(), now.getMonth(), 0)) }
  if (period === 'year') return { start: fmt(new Date(now.getFullYear(), 0, 1)), end: fmt(new Date(now.getFullYear(), 11, 31)) }
  return null
}
function nextCycleDate(cycle) {
  const d = new Date()
  if (cycle === 'yearly') d.setFullYear(d.getFullYear() + 1)
  else if (cycle === 'weekly') d.setDate(d.getDate() + 7)
  else d.setMonth(d.getMonth() + 1)
  return fmt(d)
}
function genCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

// 意图识别
async function parseIntent(model, message, history) {
  const sys = '你是财务管家的意图解析器。把用户的话解析成 JSON，只输出 JSON，不要任何解释或多余文字。\n' +
    'type 只能是：addTransaction（记一笔账）、queryBill（查账/统计）、addSubscription（记录订阅）、querySubscription（查看订阅）、cancelSubscription（取消订阅）、setBudget（设置预算）、queryBudget（查看预算）、aaSplit（AA分账）、createLedger（创建共同账本）、joinLedger（加入共同账本）、ledgerAdd（记到共同账本）、ledgerQuery（查看共同账本）、chat（闲聊/无法判断）。\n' +
    'slots 字段：\n' +
    '- addTransaction：{"amount":数字,"direction":"expense"或"income","remark":"内容","category":"分类 或 null","date":"日期 或 null"}\n' +
    '- queryBill：{"category":"分类 或 null","period":"month"或"lastMonth"或"year"或"all"}\n' +
    '- addSubscription：{"name":"订阅名","amount":数字,"cycle":"monthly"或"yearly"或"weekly","nextDate":"日期 或 null"}\n' +
    '- querySubscription：{}\n' +
    '- cancelSubscription：{"name":"订阅名"}\n' +
    '- setBudget：{"category":"分类","amount":数字,"period":"monthly"或"yearly"}\n' +
    '- queryBudget：{"category":"分类 或 null"}\n' +
    '- aaSplit：{"amount":数字,"remark":"内容","people":人数,"category":"分类 或 null"}\n' +
    '- createLedger：{}\n' +
    '- joinLedger：{"inviteCode":"邀请码"}\n' +
    '- ledgerAdd：{"amount":数字,"remark":"内容","category":"分类 或 null"}\n' +
    '- ledgerQuery：{"period":"month"或"lastMonth"或"year"或"all"}\n' +
    '- chat：{}\n' +
    '示例：\n' +
    '用户"中午喝了晨光酸奶，花了5块" -> {"type":"addTransaction","slots":{"amount":5,"direction":"expense","remark":"晨光酸奶","category":null,"date":null}}\n' +
    '用户"昨晚聚餐花了300，3个人AA" -> {"type":"aaSplit","slots":{"amount":300,"remark":"聚餐","people":3,"category":null}}\n' +
    '用户"创建共同账本" -> {"type":"createLedger","slots":{}}\n' +
    '用户"加入共同账本 ABC123" -> {"type":"joinLedger","slots":{"inviteCode":"ABC123"}}\n' +
    '用户"记到共同账本，买菜花了50" -> {"type":"ledgerAdd","slots":{"amount":50,"remark":"买菜","category":null}}\n' +
    '用户"共同账本这个月花了多少" -> {"type":"ledgerQuery","slots":{"period":"month"}}'

  const res = await model.generateText({
    model: 'hy3',
    messages: [{ role: 'system', content: sys }, ...history, { role: 'user', content: message }]
  })
  const text = (res.text || '').trim()
  const m = text.match(/\{[\s\S]*\}/)
  if (m) { try { return JSON.parse(m[0]) } catch (e) {} }
  return { type: 'chat', slots: {} }
}

async function aiCategorize(model, remark) {
  try {
    const res = await model.generateText({
      model: 'hy3',
      messages: [
        { role: 'system', content: '你是记账分类助手。把消费备注归到以下分类之一：' + CATEGORIES.join('、') + '。只输出分类名。' },
        { role: 'user', content: remark }
      ]
    })
    const c = (res.text || '').trim().replace(/[，。、\s]/g, '')
    return CATEGORIES.includes(c) ? c : '其他'
  } catch (e) { return '其他' }
}

async function doAdd(openid, slots, model) {
  const amount = Math.abs(Number(slots.amount))
  if (!amount) return { ok: false, msg: '没听清金额，请再说一次' }
  const signed = slots.direction === 'income' ? amount : -amount
  let category = slots.category
  if (!category && slots.remark) category = await aiCategorize(model, slots.remark)
  category = category || '其他'
  const date = slots.date || today()
  await db.collection('transactions').add({
    data: { amount: signed, category, remark: slots.remark || '', date, time: '', source: 'chat', accountId: '', merchant: '', _openid: openid, createdAt: db.serverDate() }
  })
  return { ok: true, type: 'add', category, amount: signed, remark: slots.remark || '', date }
}

async function doQuery(openid, slots) {
  const cond = { _openid: openid, amount: _.lt(0) }
  const range = dateRange(slots.period || 'month')
  if (range) cond.date = _.gte(range.start).and(_.lte(range.end))
  if (slots.category) cond.category = slots.category
  const res = await db.collection('transactions').where(cond).limit(1000).get()
  const list = res.data
  const total = list.reduce((s, x) => s + Math.abs(x.amount), 0)
  const byCat = {}
  list.forEach(x => { byCat[x.category] = (byCat[x.category] || 0) + Math.abs(x.amount) })
  const top = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 5)
  return { ok: true, type: 'query', total: Math.round(total * 100) / 100, count: list.length, period: slots.period || 'month', category: slots.category || '全部', byCat: Object.fromEntries(top) }
}

async function doAddSub(openid, slots) {
  const name = (slots.name || '').trim()
  const amount = Number(slots.amount)
  if (!name || !amount) return { ok: false, msg: '没听清订阅名或金额，请再说一次' }
  const cycle = slots.cycle || 'monthly'
  const nextDate = slots.nextDate || nextCycleDate(cycle)
  await db.collection('subscriptions').add({
    data: { name, amount, cycle, nextDate, status: 'active', autoRenew: true, _openid: openid, createdAt: db.serverDate() }
  })
  return { ok: true, type: 'addSub', name, amount, cycle, nextDate }
}

function monthlyAmount(x) {
  if (x.cycle === 'yearly') return Math.round(x.amount / 12 * 100) / 100
  if (x.cycle === 'weekly') return Math.round(x.amount * 4.33 * 100) / 100
  return x.amount
}
async function doQuerySub(openid) {
  const res = await db.collection('subscriptions').where({ _openid: openid, status: 'active' }).get()
  const list = res.data
  const totalMonthly = Math.round(list.reduce((s, x) => s + monthlyAmount(x), 0) * 100) / 100
  return { ok: true, type: 'querySub', list: list.map(x => ({ name: x.name, amount: x.amount, cycle: x.cycle, nextDate: x.nextDate })), count: list.length, totalMonthly }
}

async function doCancelSub(openid, name) {
  const n = (name || '').trim()
  if (!n) return { ok: false, msg: '请告诉我要取消哪个订阅' }
  const res = await db.collection('subscriptions').where({ _openid: openid, name: n, status: 'active' }).update({ data: { status: 'cancelled', autoRenew: false } })
  if (!res.stats.updated) return { ok: false, msg: '没找到名为「' + n + '」的有效订阅' }
  return { ok: true, type: 'cancelSub', name: n }
}

async function doSetBudget(openid, slots) {
  const category = slots.category
  const amount = Number(slots.amount)
  if (!category || !amount) return { ok: false, msg: '没听清预算分类或金额，请再说一次' }
  const period = slots.period || 'monthly'
  const exist = await db.collection('budgets').where({ _openid: openid, category, period }).get()
  if (exist.data.length) {
    await db.collection('budgets').doc(exist.data[0]._id).update({ data: { amount } })
    return { ok: true, type: 'setBudget', category, amount, period, updated: true }
  }
  await db.collection('budgets').add({ data: { category, amount, period, _openid: openid, createdAt: db.serverDate() } })
  return { ok: true, type: 'setBudget', category, amount, period }
}

async function doQueryBudget(openid, slots) {
  const cond = { _openid: openid }
  if (slots.category) cond.category = slots.category
  const bRes = await db.collection('budgets').where(cond).get()
  const budgets = bRes.data
  if (!budgets.length) return { ok: true, type: 'queryBudget', list: [], msg: '还没有设置预算' }
  const range = dateRange('month')
  const txRes = await db.collection('transactions').where({ _openid: openid, amount: _.lt(0), date: _.gte(range.start).and(_.lte(range.end)) }).limit(1000).get()
  const txList = txRes.data
  const list = budgets.map(b => {
    const spent = txList.filter(x => x.category === b.category).reduce((s, x) => s + Math.abs(x.amount), 0)
    const remaining = Math.round((b.amount - spent) * 100) / 100
    const ratio = b.amount > 0 ? Math.round(spent / b.amount * 100) : 0
    return { category: b.category, amount: b.amount, spent: Math.round(spent * 100) / 100, remaining, ratio, over: ratio >= 100 }
  })
  return { ok: true, type: 'queryBudget', list }
}

async function doAASplit(openid, slots, model) {
  const amount = Math.abs(Number(slots.amount))
  const people = Number(slots.people) || 2
  if (!amount) return { ok: false, msg: '没听清金额，请再说一次' }
  let category = slots.category
  if (!category && slots.remark) category = await aiCategorize(model, slots.remark)
  category = category || '其他'
  const per = Math.round(amount / people * 100) / 100
  await db.collection('transactions').add({
    data: { amount: -amount, category, remark: (slots.remark || '') + '（' + people + '人AA）', date: today(), time: '', source: 'chat', accountId: '', merchant: '', _openid: openid, createdAt: db.serverDate() }
  })
  return { ok: true, type: 'aaSplit', amount, people, per, category, remark: slots.remark || '' }
}

// 双人共同账本
async function doCreateLedger(openid) {
  const exist = await db.collection('ledgers').where({ members: openid }).get()
  if (exist.data.length) return { ok: true, type: 'createLedger', inviteCode: exist.data[0].inviteCode, existed: true }
  const inviteCode = genCode()
  await db.collection('ledgers').add({ data: { inviteCode, name: '共同账本', members: [openid], _openid: openid, createdAt: db.serverDate() } })
  return { ok: true, type: 'createLedger', inviteCode }
}

async function doJoinLedger(openid, code) {
  const c = (code || '').trim().toUpperCase()
  if (!c) return { ok: false, msg: '请告诉我要加入的邀请码' }
  const exist = await db.collection('ledgers').where({ inviteCode: c }).get()
  if (!exist.data.length) return { ok: false, msg: '邀请码不存在' }
  const ledger = exist.data[0]
  if (ledger.members.includes(openid)) return { ok: true, type: 'joinLedger', msg: '你已在该账本中' }
  if (ledger.members.length >= 2) return { ok: false, msg: '该账本已有 2 人' }
  await db.collection('ledgers').doc(ledger._id).update({ data: { members: ledger.members.concat([openid]) } })
  return { ok: true, type: 'joinLedger', msg: '已加入共同账本' }
}

async function doLedgerAdd(openid, slots, model) {
  const amount = Math.abs(Number(slots.amount))
  if (!amount) return { ok: false, msg: '没听清金额' }
  const ledgers = await db.collection('ledgers').where({ members: openid }).get()
  if (!ledgers.data.length) return { ok: false, msg: '你还没有共同账本，先说"创建共同账本"' }
  const ledgerId = ledgers.data[0]._id
  let category = slots.category
  if (!category && slots.remark) category = await aiCategorize(model, slots.remark)
  category = category || '其他'
  await db.collection('transactions').add({
    data: { amount: -amount, category, remark: slots.remark || '', date: today(), time: '', source: 'chat', accountId: '', merchant: '', ledgerId, _openid: openid, createdAt: db.serverDate() }
  })
  return { ok: true, type: 'ledgerAdd', amount, category, remark: slots.remark || '' }
}

async function doLedgerQuery(openid, slots) {
  const ledgers = await db.collection('ledgers').where({ members: openid }).get()
  if (!ledgers.data.length) return { ok: true, type: 'ledgerQuery', list: [], total: 0, msg: '还没有共同账本' }
  const ledgerId = ledgers.data[0]._id
  const range = dateRange(slots.period || 'month')
  const cond = { ledgerId, amount: _.lt(0) }
  if (range) cond.date = _.gte(range.start).and(_.lte(range.end))
  const txRes = await db.collection('transactions').where(cond).limit(1000).get()
  const list = txRes.data
  const total = Math.round(list.reduce((s, x) => s + Math.abs(x.amount), 0) * 100) / 100
  const byCat = {}
  list.forEach(x => { byCat[x.category] = (byCat[x.category] || 0) + Math.abs(x.amount) })
  return { ok: true, type: 'ledgerQuery', total, count: list.length, byCat }
}

async function genReply(model, message, exec) {
  const sys = '你是 AI 财务管家，语气友好简洁，像贴心助手。基于给定的执行结果回复用户，不要编造数据。若执行失败或信息不足，就友好地请用户补充。'
  const res = await model.generateText({
    model: 'hy3',
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: '用户说：' + message + '\n执行结果：' + JSON.stringify(exec) + '\n请给出自然回复。' }
    ]
  })
  return res.text || '收到！'
}

exports.main = async (event) => {
  const { message, history = [] } = event
  if (!message) return { success: false, error: '缺少 message' }
  const { OPENID } = cloud.getWXContext()
  const ai = cloud.ai()
  const model = ai.createModel('cloudbase')

  const intent = await parseIntent(model, message, history)
  let exec
  if (intent.type === 'addTransaction') exec = await doAdd(OPENID, intent.slots, model)
  else if (intent.type === 'queryBill') exec = await doQuery(OPENID, intent.slots)
  else if (intent.type === 'addSubscription') exec = await doAddSub(OPENID, intent.slots)
  else if (intent.type === 'querySubscription') exec = await doQuerySub(OPENID)
  else if (intent.type === 'cancelSubscription') exec = await doCancelSub(OPENID, intent.slots.name)
  else if (intent.type === 'setBudget') exec = await doSetBudget(OPENID, intent.slots)
  else if (intent.type === 'queryBudget') exec = await doQueryBudget(OPENID, intent.slots)
  else if (intent.type === 'aaSplit') exec = await doAASplit(OPENID, intent.slots, model)
  else if (intent.type === 'createLedger') exec = await doCreateLedger(OPENID)
  else if (intent.type === 'joinLedger') exec = await doJoinLedger(OPENID, intent.slots.inviteCode)
  else if (intent.type === 'ledgerAdd') exec = await doLedgerAdd(OPENID, intent.slots, model)
  else if (intent.type === 'ledgerQuery') exec = await doLedgerQuery(OPENID, intent.slots)
  else exec = { ok: true, type: 'chat' }

  const reply = await genReply(model, message, exec)
  return { success: true, reply, intent: intent.type, data: exec }
}
