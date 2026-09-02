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

// 时间范围：month=本月 lastMonth=上月 year=今年，all=全部
function dateRange(period) {
  const now = new Date()
  if (period === 'month') {
    return { start: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), end: fmt(new Date(now.getFullYear(), now.getMonth() + 1, 0)) }
  }
  if (period === 'lastMonth') {
    return { start: fmt(new Date(now.getFullYear(), now.getMonth() - 1, 1)), end: fmt(new Date(now.getFullYear(), now.getMonth(), 0)) }
  }
  if (period === 'year') {
    return { start: fmt(new Date(now.getFullYear(), 0, 1)), end: fmt(new Date(now.getFullYear(), 11, 31)) }
  }
  return null
}

// 1. 意图识别 + 槽位抽取（要求输出严格 JSON）
async function parseIntent(model, message, history) {
  const sys = '你是财务管家的意图解析器。把用户的话解析成 JSON，只输出 JSON，不要任何解释或多余文字。\n' +
    'type 只能是：addTransaction（记一笔账）、queryBill（查账/问账/统计）、chat（打招呼/闲聊/无法判断）。\n' +
    'slots 字段：\n' +
    '- addTransaction：{"amount":数字(正数),"direction":"expense"或"income","remark":"消费内容","category":"餐饮/交通/购物/娱乐/居住/医疗/教育/其他 或 null","date":"YYYY-MM-DD 或 null"}\n' +
    '- queryBill：{"category":"分类 或 null(全部)","period":"month"或"lastMonth"或"year"或"all"}\n' +
    '- chat：{}\n' +
    '示例：\n' +
    '用户"中午喝了晨光酸奶，花了5块" -> {"type":"addTransaction","slots":{"amount":5,"direction":"expense","remark":"晨光酸奶","category":null,"date":null}}\n' +
    '用户"这月吃饭花了多少" -> {"type":"queryBill","slots":{"category":"餐饮","period":"month"}}\n' +
    '用户"你好" -> {"type":"chat","slots":{}}'

  const res = await model.generateText({
    model: 'hy3',
    messages: [{ role: 'system', content: sys }, ...history, { role: 'user', content: message }]
  })
  const text = (res.text || '').trim()
  const m = text.match(/\{[\s\S]*\}/)
  if (m) {
    try { return JSON.parse(m[0]) } catch (e) {}
  }
  return { type: 'chat', slots: {} }
}

// 2. AI 分类（remark -> 分类）
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
  } catch (e) {
    return '其他'
  }
}

// 3. 执行：记账
async function doAdd(openid, slots, model) {
  const amount = Math.abs(Number(slots.amount))
  if (!amount) return { ok: false, msg: '没听清金额，请再说一次' }
  const signed = slots.direction === 'income' ? amount : -amount
  let category = slots.category
  if (!category && slots.remark) category = await aiCategorize(model, slots.remark)
  category = category || '其他'
  const date = slots.date || today()
  const res = await db.collection('transactions').add({
    data: { amount: signed, category, remark: slots.remark || '', date, time: '', source: 'chat', accountId: '', merchant: '', _openid: openid, createdAt: db.serverDate() }
  })
  return { ok: true, type: 'add', category, amount: signed, remark: slots.remark || '', date }
}

// 4. 执行：查账
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

// 5. 生成自然语言回复
async function genReply(model, message, execResult) {
  const sys = '你是 AI 财务管家，语气友好简洁，像贴心助手。基于给定的执行结果回复用户，不要编造数据。若执行失败或信息不足，就友好地请用户补充。'
  const res = await model.generateText({
    model: 'hy3',
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: '用户说：' + message + '\n执行结果：' + JSON.stringify(execResult) + '\n请给出自然回复。' }
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
  if (intent.type === 'addTransaction') {
    exec = await doAdd(OPENID, intent.slots, model)
  } else if (intent.type === 'queryBill') {
    exec = await doQuery(OPENID, intent.slots)
  } else {
    exec = { ok: true, type: 'chat' }
  }

  const reply = await genReply(model, message, exec)
  return { success: true, reply, intent: intent.type, data: exec }
}
