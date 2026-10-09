const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV, timeout: 60000 })
const db = cloud.database()
const _ = db.command

const CHAT_AGENT_BUILD = '2026-10-10-timezone-title-v6'
const CATEGORIES = ['餐饮', '交通', '购物', '娱乐', '居住', '医疗', '教育', '其他']

function today() {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000)
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0')
}
function shiftDate(days) {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000)
  d.setUTCDate(d.getUTCDate() + days)
  return fmt(d)
}
function weekRange(offset) {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000)
  const day = now.getUTCDay() || 7
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day + 1 + offset * 7))
  const sunday = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() + 6))
  return { start: fmt(monday), end: fmt(sunday) }
}
function fmt(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
function parseDate(value) {
  if (value === undefined || value === null || value === '') return null
  const raw = String(value).trim()
  let m = raw.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/)
  if (!m) m = raw.match(/^(\d{1,2})[-/.月](\d{1,2})日?$/)
  if (m) {
    const year = m.length === 4 ? Number(m[1]) : new Date().getFullYear()
    const month = Number(m.length === 4 ? m[2] : m[1])
    const day = Number(m.length === 4 ? m[3] : m[2])
    const d = new Date(year, month - 1, day)
    if (d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day) return d
    return null
  }
  const d = new Date(raw)
  return isNaN(d.getTime()) ? null : d
}
function addCycle(dateValue, cycle) {
  const base = parseDate(dateValue) || new Date()
  const originalDay = base.getDate()
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate())
  if (cycle === 'yearly') {
    d.setDate(1)
    d.setFullYear(d.getFullYear() + 1)
    d.setDate(Math.min(originalDay, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()))
  } else if (cycle === 'weekly') {
    d.setDate(d.getDate() + 7)
  } else {
    d.setDate(1)
    d.setMonth(d.getMonth() + 1)
    d.setDate(Math.min(originalDay, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()))
  }
  return fmt(d)
}
function computeNextDate(cycle, startDate, explicitNextDate) {
  const c = cycle === 'yearly' || cycle === 'weekly' ? cycle : 'monthly'
  const explicit = parseDate(explicitNextDate)
  if (explicit) {
    let next = fmt(explicit)
    while (next <= today()) next = addCycle(next, c)
    return next
  }
  const start = parseDate(startDate)
  if (start) {
    const startStr = fmt(start)
    if (startStr > today()) return startStr
    let next = addCycle(startStr, c)
    while (next <= today()) next = addCycle(next, c)
    return next
  }
  return addCycle(today(), c)
}
function normalizeName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '')
}
function subscriptionKey(value) {
  return normalizeName(value).replace(/(vip|svip|超级会员|会员|年度|年卡|月卡|包月|包年|套餐)/g, '')
}
function subscriptionTime(value) {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (value.$date) return new Date(value.$date).getTime()
  const t = new Date(value).getTime()
  return isNaN(t) ? 0 : t
}
function normalizeText(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s，。,.、！!？?]/g, '')
}
function inDateRange(dateValue, range) {
  if (!range || (!range.start && !range.end)) return true
  const value = String(dateValue || '')
  if (range.start && value < range.start) return false
  if (range.end && value > range.end) return false
  return true
}
function recordLabel(kind, item) {
  if (kind === 'transaction') return (item.date || '') + ' ' + (item.remark || item.category || '一笔记录') + ' ¥' + Math.abs(item.amount || 0)
  if (kind === 'subscription') return item.name + ' ¥' + item.amount + ' / ' + (item.cycle || 'monthly')
  if (kind === 'budget') return item.category + '预算 ¥' + item.amount
  if (kind === 'ledger') return item.name || '共同账本'
  return item._id
}
function mergeHistory(a, b) {
  const left = (Array.isArray(a) ? a : []).filter(x => x && x.content).map(x => ({ role: x.role === 'assistant' || x.role === 'ai' ? 'assistant' : 'user', content: String(x.content).slice(0, 1000), createdAt: x.createdAt || '' }))
  const right = (Array.isArray(b) ? b : []).filter(x => x && x.content).map(x => ({ role: x.role === 'assistant' || x.role === 'ai' ? 'assistant' : 'user', content: String(x.content).slice(0, 1000), createdAt: x.createdAt || '' }))
  const same = (x, y) => x.role === y.role && x.content === y.content
  const max = Math.min(left.length, right.length)
  for (let size = max; size > 0; size--) {
    if (left.slice(left.length - size).every((item, i) => same(item, right[i]))) {
      return left.concat(right.slice(size)).slice(-30)
    }
  }
  if (left.length >= right.length && right.every((item, i) => same(item, left[i]))) return left.slice(-30)
  if (right.length >= left.length && left.every((item, i) => same(item, right[i]))) return right.slice(-30)
  return left.concat(right).slice(-30)
}
function mergeRecentActions(a, b) {
  const result = []
  for (const item of [].concat(Array.isArray(a) ? a : [], Array.isArray(b) ? b : [])) {
    if (!item || !item.kind || !item.recordId) continue
    if (result.some(x => x.kind === item.kind && x.recordId === item.recordId)) continue
    result.push(item)
  }
  return result.slice(0, 5)
}
function mergeContext(persisted, incoming) {
  const base = Object.assign({}, persisted || {}, incoming || {})
  base.recentActions = mergeRecentActions((persisted && persisted.recentActions) || [], (incoming && incoming.recentActions) || [])
  base.pendingAction = (incoming && incoming.pendingAction) || (persisted && persisted.pendingAction) || null
  if (!base.pendingAction) delete base.pendingAction
  return base
}
function isUpdateTargetCompatible(message, lastAction) {
  const text = normalizeText(message)
  if (!lastAction || !lastAction.kind) return true
  const data = lastAction.data || {}
  if (lastAction.kind === 'subscription') {
    const name = normalizeText(data.name)
    const subscriptionRef = (name && text.includes(name)) || /订阅|会员|续费|扣费|月费|年费|套餐/.test(text)
    const otherRef = /午餐|早餐|晚餐|奶茶|咖啡|打车|公交|购物|买菜|聚餐|房租|水电|工资|报销|预算/.test(text)
    if (otherRef && !subscriptionRef) return false
  }
  if (lastAction.kind === 'transaction') {
    if (/订阅|会员|续费|扣费|月费|年费/.test(text) && !/交易|消费|花|买|餐|奶茶|打车|购物/.test(text)) return false
  }
  if (lastAction.kind === 'budget') {
    if (/订阅|会员|续费|扣费|午餐|奶茶|打车|购物/.test(text) && !/预算|额度/.test(text)) return false
  }
  if (lastAction.kind === 'ledger') {
    if (/午餐|奶茶|打车|购物|预算/.test(text) && !/账本|邀请码/.test(text)) return false
  }
  return true
}

async function getUserLedger(openid) {
  try {
    const res = await db.collection('ledgers').where({ members: openid }).limit(1).get()
    return res.data && res.data[0] ? res.data[0] : null
  } catch (e) { return null }
}
function relationshipSharedKeywords(relationship, text) {
  const rel = normalizeText(relationship)
  const groups = {
    '家庭': ['买菜', '日用品', '房租', '水电', '孩子', '父母', '家里'],
    '情侣': ['约会', '女朋友', '男朋友', '情侣', '纪念日'],
    '夫妻': ['家庭', '买菜', '日用品', '房租', '孩子', '父母'],
    '朋友': ['聚餐', '聚会', '朋友', 'AA'],
    '室友': ['房租', '水电', '买菜', '日用品', '共同']
  }
  const words = groups[rel] || []
  return words.some(word => text.includes(normalizeText(word)))
}

async function loadContext(openid) {
  try {
    const res = await db.collection('users').where({ _openid: openid }).limit(1).get()
    return (res.data[0] && res.data[0].assistantContext) || {}
  } catch (e) {
    return {}
  }
}
async function saveContext(openid, context) {
  try {
    const res = await db.collection('users').where({ _openid: openid }).limit(1).get()
    if (res.data.length) {
      await db.collection('users').doc(res.data[0]._id).update({ data: { assistantContext: context, updatedAt: db.serverDate() } })
    } else {
      await db.collection('users').add({ data: { _openid: openid, assistantContext: context, createdAt: db.serverDate(), updatedAt: db.serverDate() } })
    }
  } catch (e) {
    console.error('save assistant context failed', e.message)
  }
}
function dateRange(period) {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000)
  if (period === 'today') return { start: today(), end: today() }
  if (period === 'dayBeforeYesterday') return { start: shiftDate(-2), end: shiftDate(-2) }
  if (period === 'yesterday') return { start: shiftDate(-1), end: shiftDate(-1) }
  if (period === 'week') return weekRange(0)
  if (period === 'lastWeek') return weekRange(-1)
  if (period === 'month') return { start: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), end: fmt(new Date(now.getFullYear(), now.getMonth() + 1, 0)) }
  if (period === 'lastMonth') return { start: fmt(new Date(now.getFullYear(), now.getMonth() - 1, 1)), end: fmt(new Date(now.getFullYear(), now.getMonth(), 0)) }
  if (period === 'year') return { start: fmt(new Date(now.getFullYear(), 0, 1)), end: fmt(new Date(now.getFullYear(), 11, 31)) }
  return null
}
function periodText(period) {
  const map = { today: '今天', yesterday: '昨天', dayBeforeYesterday: '前天', week: '本周', lastWeek: '上周', month: '本月', lastMonth: '上个月', year: '今年', all: '全部时间' }
  return map[period] || '所选时间'
}
function genCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
function isRateLimitError(error) {
  const status = error && (error.statusCode || error.status || (error.response && error.response.status))
  const text = String((error && (error.message || error.errMsg)) || error || '')
  return status === 429 || text.includes('429') || text.toLowerCase().includes('too many requests')
}
async function safeGenerateText(model, payload, attempts) {
  const max = attempts || 3
  let lastError
  for (let i = 0; i < max; i++) {
    try {
      return await model.generateText(payload)
    } catch (error) {
      lastError = error
      if (!isRateLimitError(error) || i === max - 1) throw error
      await sleep(600 * Math.pow(2, i))
    }
  }
  throw lastError
}
function extractAmount(text) {
  const m = text.match(/(\d+(?:\.\d+)?)\s*(?:元|块|块钱)?/)
  return m ? Number(m[1]) : 0
}
function inferDateFromText(text) {
  if (/今天|今日|今晚/.test(text)) return today()
  if (/昨天|昨晚|昨日/.test(text)) return shiftDate(-1)
  if (/前天/.test(text)) return shiftDate(-2)
  const m = text.match(/(\d{1,2})月(\d{1,2})[日号]/)
  if (m) {
    const y = new Date().getFullYear()
    const d = new Date(y, Number(m[1]) - 1, Number(m[2]))
    if (!isNaN(d.getTime())) return fmt(d)
  }
  return ''
}
function inferCategory(text) {
  if (/餐|饭|午餐|晚餐|早餐|吃|喝|奶茶|咖啡|汉堡|外卖|买菜/.test(text)) return '餐饮'
  if (/打车|公交|地铁|加油|停车|车费|高铁|机票/.test(text)) return '交通'
  if (/买|购物|衣服|鞋|日用品|超市/.test(text)) return '购物'
  if (/电影|游戏|娱乐|唱歌|KTV/.test(text)) return '娱乐'
  if (/房租|水费|电费|燃气|物业/.test(text)) return '居住'
  if (/医院|药|看病/.test(text)) return '医疗'
  if (/书|学费|课程|培训/.test(text)) return '教育'
  return '其他'
}
function inferSocialContext(text) {
  const relationMap = [
    ['女朋友', '女朋友'], ['女友', '女朋友'], ['男朋友', '男朋友'], ['男友', '男朋友'],
    ['老婆', '老婆'], ['老公', '老公'], ['父母', '父母'], ['妈妈', '妈妈'], ['爸爸', '爸爸']
  ]
  let relationship = ''
  const people = []
  for (const pair of relationMap) {
    if (text.includes(pair[0])) {
      relationship = pair[1]
      people.push(pair[1])
      break
    }
  }
  if (!relationship) {
    const social = ['朋友', '同事', '同学'].find(word => text.includes(word))
    if (social) { relationship = social; people.push(social) }
  }
  let socialAction = ''
  if (/我请|请客|请.*吃饭|请.*喝/.test(text)) socialAction = '请客'
  else if (/aa/i.test(text)) socialAction = 'AA'
  else if (/聚餐|聚会/.test(text)) socialAction = '聚餐'
  else if (/约会/.test(text)) socialAction = '约会'
  else if (/(和|跟).*(一起|吃饭|喝)/.test(text)) socialAction = '共同用餐'
  let occasion = ''
  if (/生日/.test(text)) occasion = '生日'
  else if (/纪念日/.test(text)) occasion = '纪念日'
  const tags = []
  if (socialAction) tags.push(socialAction)
  if (relationship) tags.push(relationship)
  if (occasion) tags.push(occasion)
  return { relationship, people, socialAction, occasion, tags }
}
function inferMerchant(text) {
  const generic = /^(饭|吃饭|午餐|晚餐|早餐|聚餐|喝酒|饮料|奶茶|咖啡|外卖|打车)$/
  let m = text.match(/(?:在|去)([^花买消费付吃]+?)(?:吃|买|花|消费|付)/)
  if (m && !generic.test(m[1])) return m[1]
  m = text.match(/吃([^花买消费付]+?)(?:花|消费|付|$)/)
  if (m && !generic.test(m[1])) return m[1]
  m = text.match(/买([^花消费付]+?)(?:花|消费|付|$)/)
  if (m && !generic.test(m[1])) return m[1]
  return ''
}
function inferItemName(text, merchant) {
  if (merchant) return merchant
  if (/波波奶茶|奶茶/.test(text)) return '奶茶'
  if (/咖啡/.test(text)) return '咖啡'
  if (/吃饭|午餐|晚餐|早餐/.test(text)) return '吃饭'
  if (/聚餐/.test(text)) return '聚餐'
  if (/打车/.test(text)) return '打车'
  if (/买菜/.test(text)) return '买菜'
  return ''
}
function inferTags(text) {
  return inferSocialContext(text).tags
}
function buildTransactionIntent(message) {
  const text = normalizeText(message)
  const amount = extractAmount(text)
  const isIncome = /收入|收到|工资|报销|退款|赚了/.test(text)
  const isExpense = /花|消费|买|付|支出|吃|喝|打车|加油/.test(text)
  if (!amount || (!isIncome && !isExpense)) return null
  if (/多少|有没有|记录到吗|查询|查看|看看|列出|明细|账单/.test(text)) return null
  const merchant = inferMerchant(text)
  const itemName = inferItemName(text, merchant)
  const social = inferSocialContext(text)
  const date = inferDateFromText(text)
  return {
    type: 'addTransaction',
    slots: {
      amount,
      direction: isIncome ? 'income' : 'expense',
      merchant,
      itemName,
      title: summarizeTransactionTitle(message, merchant, itemName, social),
      remark: message,
      rawText: message,
      tags: social.tags,
      people: social.people,
      relationship: social.relationship,
      socialAction: social.socialAction,
      occasion: social.occasion,
      memo: '',
      category: inferCategory(text),
      date: date || null,
      time: /中午/.test(text) ? '12:00' : /晚上|今晚/.test(text) ? '19:00' : /早上/.test(text) ? '08:00' : null
    },
    fallback: true
  }
}
function detectRuleLearning(message) {
  const text = normalizeText(message)
  const wantsLearn = /(以后|将来|默认|都记|都是|记住|规则|习惯|个人账本|个人账单)/.test(text)
  if (!wantsLearn) return null
  const value = /共同账本|共同账单|共同账户/.test(text) ? 'shared' : (/个人账本|个人账单|自己的账本|自己账本/.test(text) ? 'personal' : null)
  if (!value) return null
  const matchKeywords = []
  const excludeKeywords = []
  if (/女朋友|女友/.test(text)) matchKeywords.push('女朋友')
  if (/男朋友|男友/.test(text)) matchKeywords.push('男朋友')
  if (/吃饭|聚餐/.test(text)) matchKeywords.push('吃饭')
  if (/我请/.test(text)) {
    if (value === 'personal') matchKeywords.unshift('我请')
    else excludeKeywords.push('我请')
  }
  if (!matchKeywords.length) return null
  return {
    type: 'learnRule',
    slots: { field: 'ledger', value, matchKeywords, excludeKeywords, sourceText: message },
    fallback: true
  }
}
function detectCategoryLearning(message) {
  const text = normalizeText(message)
  if (!/(以后|默认|都|一律|记住|规则|习惯)/.test(text)) return null
  const m = text.match(/(?:以后|默认|都|一律)?(.+?)(?:都|一律|默认)?(?:算|记作|归为|分类为|属于)(餐饮|交通|购物|娱乐|居住|医疗|教育|其他)/)
  if (!m) return null
  const keyword = m[1].replace(/^(以后|默认|都|一律)/, '')
  if (!keyword || keyword.length > 12) return null
  return { type: 'learnRule', slots: { field: 'category', value: m[2], matchKeywords: [keyword], excludeKeywords: [] }, fallback: true }
}
function preferenceMatch(text, rule) {
  if (!rule || rule.enabled === false || !Array.isArray(rule.matchKeywords) || !rule.matchKeywords.length) return false
  if (rule.excludeKeywords && rule.excludeKeywords.some(word => text.includes(word))) return false
  return rule.matchKeywords.every(word => text.includes(word))
}
function resolveLearnedPreferences(message, slots, context, sharedLedger) {
  const text = normalizeText(message)
  const explicitShared = /共同账本|共同账单|共同账户/.test(text)
  const explicitPersonal = /个人账本|个人账单|自己账本/.test(text)
  const rules = (context && context.preferenceRules) || []
  const best = { ledger: null, category: null, merchant: null }
  const scores = { ledger: -1, category: -1, merchant: -1 }
  for (const rule of rules) {
    if (!preferenceMatch(text, rule)) continue
    const field = rule.field || 'ledger'
    if (!(field in best)) continue
    const score = (rule.matchKeywords || []).length * 10 + (rule.excludeKeywords || []).length + (rule.value === 'personal' ? 1 : 0)
    if (score > scores[field]) { best[field] = rule.value || null; scores[field] = score }
  }
  if (explicitShared) best.ledger = 'shared'
  else if (explicitPersonal) best.ledger = 'personal'
  else if (!best.ledger && sharedLedger && relationshipSharedKeywords(sharedLedger.relationship, text) && !/我请/.test(text)) best.ledger = 'shared'
  return best
}
async function doLearnRule(openid, message, slots, context) {
  const rule = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    field: slots.field || 'ledger',
    value: slots.value,
    matchKeywords: (slots.matchKeywords || []).map(normalizeText).filter(Boolean),
    excludeKeywords: ((slots.excludeKeywords || []).concat(slots.value === 'shared' ? ['我请'] : [])).map(normalizeText).filter(Boolean),
    category: slots.category || '',
    merchant: slots.merchant || '',
    sourceText: message,
    createdAt: new Date().toISOString(),
    enabled: true
  }
  const rules = (context.preferenceRules || []).filter(item => {
    return !(item.field === rule.field && item.value === rule.value && JSON.stringify(item.matchKeywords) === JSON.stringify(rule.matchKeywords))
  })
  rules.push(rule)
  return { ok: true, type: 'learnRule', rule, rules: rules.slice(-20) }
}
function ruleParseIntent(message, context) {
  const text = normalizeText(message)
  const learned = detectRuleLearning(message) || detectCategoryLearning(message)
  if (learned) return learned
  if (!text) return null
  const pending = context && context.pendingAction
  const amountOnly = text.match(/^(\d+(?:\.\d+)?)(?:元|块|块钱)?$/)
  if (pending && amountOnly) {
    const slots = Object.assign({}, pending.slots || {}, { amount: Number(amountOnly[1]) })
    return { type: pending.type, slots, fallback: true }
  }
  if (pending && pending.duplicateCandidates && pending.type === 'addSubscription') {
    if (/更新|同一个|记错|改一下|不是新增/.test(text)) return { type: 'addSubscription', slots: Object.assign({}, pending.slots, { confirmMode: 'update' }), fallback: true }
    if (/新增|新建|另一个|不是同一个|不同/.test(text)) return { type: 'addSubscription', slots: Object.assign({}, pending.slots, { confirmMode: 'create' }), fallback: true }
  }
  if (/共同账本/.test(text) && context && context.lastAction && context.lastAction.kind === 'transaction') {
    return { type: 'moveToSharedLedger', slots: {}, fallback: true }
  }
  const detailRequest = /详细|明细|列出|列表|每笔|具体|消费时间|备注/.test(text)
  const queryWords = /(消费|支出|花|账单|看看|查看|查询|查|有记录|记录到吗|花了多少|明细|列出)/
  const questionLike = /多少|有没有|记录到吗|查询|查看|看看|列出|明细|账单|有记录/.test(text)
  if (queryWords.test(text) && questionLike) {
    let period = null
    if (/前天/.test(text)) period = 'dayBeforeYesterday'
    else if (/昨天|昨日/.test(text)) period = 'yesterday'
    else if (/今天|今日/.test(text)) period = 'today'
    else if (/上周/.test(text)) period = 'lastWeek'
    else if (/本周|这周/.test(text)) period = 'week'
    else if (/上个月|上月/.test(text)) period = 'lastMonth'
    else if (/这个月|本月/.test(text)) period = 'month'
    else if (/今年/.test(text)) period = 'year'
    const inherited = (!period && detailRequest && context && context.lastQuery && context.lastQuery.type === 'queryBill') ? context.lastQuery.slots : null
    if (detailRequest && !period && !inherited) period = 'month'
    if (period || inherited) {
      const slots = Object.assign({}, inherited || {}, period ? { period } : {})
      const keywordMap = ['午餐', '早餐', '晚餐', '奶茶', '咖啡', '打车', '公交', '地铁', '买菜', '购物']
      const keyword = keywordMap.find(word => text.includes(word))
      if (keyword) {
        slots.keyword = keyword
        if (['午餐', '早餐', '晚餐', '奶茶', '咖啡'].includes(keyword)) slots.category = '餐饮'
        if (['打车', '公交', '地铁'].includes(keyword)) slots.category = '交通'
        if (keyword === '买菜') slots.category = '餐饮'
        if (keyword === '购物') slots.category = '购物'
      }
      if (detailRequest) slots.detail = true
      return { type: 'queryBill', slots, fallback: true }
    }
  }
  const transaction = buildTransactionIntent(message)
  if (transaction) return transaction
  if (/共同账本/.test(text)) return { type: 'ledgerAdd', slots: { rawText: message, remark: message }, fallback: true }
  if (/查看.*订阅|看看.*订阅|我的订阅|订阅列表/.test(text)) return { type: 'querySubscription', slots: {}, fallback: true }
  if (/查看.*预算|看看.*预算|我的预算/.test(text)) return { type: 'queryBudget', slots: {}, fallback: true }
  if (/创建共同账本/.test(text)) return { type: 'createLedger', slots: {}, fallback: true }
  if (/查看共同账本|共同账本.*(花|消费|支出)/.test(text)) return { type: 'ledgerQuery', slots: { period: 'month' }, fallback: true }
  return null
}
function fallbackReply(exec) {
  exec = exec || {}
  if (!exec.ok && exec.msg) return exec.msg
  const nameOf = function (item) { const vals = [item.merchant, item.itemName, item.remark, item.rawText, item.category, item.socialAction, item.relationship, item.occasion].concat(item.people || []).filter(Boolean); return vals.filter((v, i) => vals.indexOf(v) === i).join(' · ') }
  if (exec.type === 'query') {
    const label = exec.periodLabel || '所选时间'
    const scope = exec.category && exec.category !== '全部' ? exec.category : ''
    const keyword = exec.keyword || ''
    if (keyword && exec.count === 0 && exec.categoryCount > 0) return label + '没有找到备注含“' + keyword + '”的记录；' + label + scope + '共有 ' + exec.categoryCount + ' 笔，支出合计 ¥' + (exec.categoryTotal || 0) + '。'
    if (keyword && exec.count === 0) return label + '没有找到备注含“' + keyword + '”的记录。'
    if (exec.count === 0) return label + '没有找到支出记录。'
    const categories = Object.keys(exec.byCat || {}).map(k => k + ' ¥' + exec.byCat[k]).join('、')
    if (exec.detail) {
      const lines = (exec.list || []).map((item, i) => (i + 1) + '. ' + item.date + '｜' + item.category + '｜' + nameOf(item) + '｜¥' + Math.abs(item.amount || 0)).join('\n')
      const more = exec.count > (exec.list || []).length ? '\n仅展示前 ' + (exec.list || []).length + ' 笔。' : ''
      const title = keyword ? label + '找到 ' + exec.count + ' 笔与“' + keyword + '”相关的记录，合计 ¥' + (exec.total || 0) + '：' : label + scope + '共支出 ¥' + (exec.total || 0) + '，共 ' + exec.count + ' 笔：'
      return title + '\n' + lines + more
    }
    const prefix = keyword ? label + '找到 ' + exec.count + ' 笔与“' + keyword + '”相关的记录' : label + scope + '共支出 ¥' + (exec.total || 0) + '，共 ' + exec.count + ' 笔'
    return prefix + (keyword ? '，合计 ¥' + (exec.total || 0) : '') + (categories ? '；分类：' + categories : '') + '。'
  }
  if (exec.type === 'add') return '已记录：' + (nameOf(exec) || exec.category || '一笔交易') + ' ¥' + Math.abs(exec.amount || 0) + '，分类：' + (exec.category || '其他') + '。'
  if (exec.type === 'querySub') return '当前有 ' + (exec.count || 0) + ' 个有效订阅，合计每月约 ¥' + (exec.totalMonthly || 0) + '。'
  if (exec.type === 'queryBudget') {
    const total = exec.total ? '总预算月 ¥' + exec.total.monthlyAmount + '，日 ¥' + exec.total.dailyAmount + '，已用 ¥' + exec.total.spent : '未设置总预算'
    const categories = (exec.categories || []).map(x => x.category + '月 ¥' + x.monthlyAmount + '，日 ¥' + x.dailyAmount).join('；')
    return total + (categories ? '；分类预算：' + categories : '')
  }
  if (exec.type === 'setBudget') return '已设置' + (exec.category && exec.category !== '全部' ? exec.category + '分类' : '总') + '预算：月 ¥' + exec.monthlyAmount + '，日 ¥' + exec.dailyAmount + '（按' + exec.month + '共' + exec.daysInMonth + '天推算）。'
  if (exec.type === 'addSub') return '已记录订阅「' + exec.name + '」，金额 ¥' + exec.amount + '，下次扣费 ' + exec.nextDate + '。'
  if (exec.type === 'cancelSub') return '已取消订阅「' + exec.name + '」。'
  if (exec.type === 'aaSplit') return '已记共同消费 ¥' + exec.amount + '，' + exec.people + ' 人每人约 ¥' + exec.per + '。'
  if (exec.type === 'createLedger') return '共同账本已创建' + (exec.inviteCode ? '，邀请码：' + exec.inviteCode : '') + '。'
  if (exec.type === 'joinLedger') return exec.msg || '已加入共同账本。'
  if (exec.type === 'ledgerAdd') return '已记到共同账本：' + ([exec.merchant, exec.itemName, exec.remark].filter(Boolean).join(' · ') || '一笔交易') + ' ¥' + Math.abs(exec.amount || 0) + '。'
  if (exec.type === 'ledgerQuery') return '共同账本共支出 ¥' + (exec.total || 0) + '，共 ' + (exec.count || 0) + ' 笔。'
  if (exec.type === 'moveToSharedLedger') return '已把上一笔交易移到共同账本，邀请码：' + exec.inviteCode + '。'
  if (exec.type === 'learnRule') return '已记住这个规则：符合条件的记录会默认记到' + (exec.rule && exec.rule.value === 'shared' ? '共同账本' : '个人账本') + '。'
  if (exec.type === 'updateLast' || exec.type === 'updateRecord' || exec.type === 'findAndUpdate') return '已更新记录。'
  return '操作已完成。'
}
// 意图识别
async function parseIntent(model, message, history, context) {
  const sys = '你是财务管家的意图解析器。把用户的话解析成 JSON，只输出 JSON，不要任何解释或多余文字。今天是 ' + today() + '（Asia/Shanghai）。\n' +
    '日期一律输出 YYYY-MM-DD。用户说“X月X日订阅的/从X月X日开始”时，这是 startDate，不是 nextDate；nextDate 留 null，由系统按周期推算。用户说“下次扣费/续费是X月X日”时才写 nextDate。只有在消息明确指代 context.lastAction 的同一对象时才能用 updateLast；例如最近是腾讯视频订阅，用户说“午餐35元”与订阅无关，不能更新订阅，应识别为 addTransaction；如果最近是订阅而用户说“刚才那顿午餐改成35元”，且是在纠正历史交易，应使用 findAndUpdate(kind=transaction)。\n' +
    'type 只能是：addTransaction（记一笔账）、queryBill（查账/统计）、addSubscription（记录订阅）、querySubscription（查看订阅）、cancelSubscription（取消订阅）、setBudget（设置预算）、queryBudget（查看预算）、aaSplit（AA分账）、createLedger（创建共同账本）、joinLedger（加入共同账本）、ledgerAdd（记到共同账本）、ledgerQuery（查看共同账本）、updateLast（纠正最近一次已执行操作）、updateRecord（按 recordId 纠正候选或近期操作）、findAndUpdate（按名称、备注和时间描述搜索并纠正任意历史记录）、moveToSharedLedger（把上一笔交易移到共同账本）、learnRule（学习默认记账规则）、chat（闲聊/无法判断）。\n' +
    'slots 字段：\n' +
    '- addTransaction：{"amount":数字,"direction":"expense"或"income","title":"概括标题 或 null","merchant":"商户 或 null","itemName":"具体商品/消费内容 或 null","remark":"简短备注 或 null","rawText":"用户原话 或 null","tags":["回忆标签"]或[],"people":["同行人"]或[],"relationship":"关系 或 null","socialAction":"请客/聚餐/AA/约会 或 null","occasion":"生日/纪念日 或 null","memo":"长备注 或 null","category":"分类 或 null","date":"日期 或 null","time":"HH:mm 或 null"}\n' +
    '- queryBill：{"category":"分类 或 null","keyword":"午餐/奶茶等备注关键词 或 null","period":"today"或"yesterday"或"dayBeforeYesterday"或"week"或"lastWeek"或"month"或"lastMonth"或"year"或"all"或"none","dateRange":{"start":"YYYY-MM-DD","end":"YYYY-MM-DD"}或null,"detail":true或false}\n' +
    '- addSubscription：{"name":"订阅名","amount":数字,"cycle":"monthly"或"yearly"或"weekly","startDate":"开始/订阅日期 YYYY-MM-DD 或 null","nextDate":"明确的下次扣费日期 YYYY-MM-DD 或 null"}\n' +
    '- querySubscription：{}\n' +
    '- cancelSubscription：{"name":"订阅名"}\n' +
    '- setBudget：{"type":"total"或"category","category":"分类/null","amount":数字,"period":"day"或"month","month":"YYYY-MM/null"}\n' +
    '- queryBudget：{"month":"YYYY-MM 或 null","category":"分类 或 null"}\n' +
    '- aaSplit：{"amount":数字,"remark":"内容","people":人数,"category":"分类 或 null"}\n' +
    '- createLedger：{}\n' +
    '- joinLedger：{"inviteCode":"邀请码"}\n' +
    '- ledgerAdd：{"amount":数字,"remark":"内容","category":"分类 或 null"}\n' +
    '- ledgerQuery：{"period":"month"或"lastMonth"或"year"或"all"}\n' +
    '- updateLast：{"patch":{"amount":数字或null,"direction":"expense"或"income"或null,"merchant":"商户或null","itemName":"具体内容或null","remark":"内容或null","rawText":"原话或null","tags":["标签"]或null,"people":["同行人"]或null,"relationship":"关系或null","socialAction":"请客/聚餐/AA或null","occasion":"场合或null","memo":"长备注或null","category":"分类或null","date":"日期或null","time":"时间或null","name":"订阅名或null","cycle":"monthly"或"yearly"或"weekly"或null,"startDate":"日期或null","nextDate":"日期或null","period":"monthly"或"yearly"或null,"aaPeople":人数或null}}\n' +
    '- updateRecord：{"recordId":"context.recentActions 或 pendingAction.candidates 中的 recordId","patch":{"amount":数字或null,"direction":"expense"或"income"或null,"merchant":"商户或null","itemName":"具体内容或null","remark":"内容或null","rawText":"原话或null","tags":["标签"]或null,"people":["同行人"]或null,"relationship":"关系或null","socialAction":"请客/聚餐/AA或null","occasion":"场合或null","memo":"长备注或null","category":"分类或null","date":"日期或null","time":"时间或null","name":"订阅名或null","cycle":"monthly"或"yearly"或"weekly"或null,"startDate":"日期或null","nextDate":"日期或null","period":"monthly"或"yearly"或null,"aaPeople":人数或null}}\n' +
    '- findAndUpdate：{"kind":"transaction"或"subscription"或"budget"或"ledger","target":{"keyword":"备注或名称关键词或null","merchant":"商户或null","itemName":"商品或null","category":"分类或null","dateRange":{"start":"YYYY-MM-DD","end":"YYYY-MM-DD"}或null},"patch":{"amount":数字或null,"direction":"expense"或"income"或null,"merchant":"商户或null","itemName":"具体内容或null","remark":"内容或null","rawText":"原话或null","tags":["标签"]或null,"memo":"长备注或null","category":"分类或null","date":"日期或null","time":"时间或null","name":"订阅名或null","cycle":"monthly"或"yearly"或"weekly"或null,"startDate":"日期或null","nextDate":"日期或null","period":"monthly"或"yearly"或null,"aaPeople":人数或null}}\n' +
    '- chat：{}\n' +
    '示例：\n' +
    '用户"中午喝了晨光酸奶，花了5块" -> {"type":"addTransaction","slots":{"amount":5,"direction":"expense","merchant":null,"itemName":"晨光酸奶","remark":"晨光酸奶","rawText":"中午喝了晨光酸奶，花了5块","tags":[],"memo":null,"category":null,"date":null,"time":null}}\n' +
    '用户"今天在喜茶买波波奶茶花了28" -> {"type":"addTransaction","slots":{"amount":28,"direction":"expense","merchant":"喜茶","itemName":"波波奶茶","remark":"波波奶茶","rawText":"今天在喜茶买波波奶茶花了28","tags":[],"memo":null,"category":"餐饮","date":null,"time":null}}\n' +
    '用户"昨天的午餐有记录到吗" -> {"type":"queryBill","slots":{"category":"餐饮","keyword":"午餐","period":"yesterday","dateRange":null}}\n' +
    '用户"昨天的消费给我看看" -> {"type":"queryBill","slots":{"category":null,"keyword":null,"period":"yesterday","dateRange":null}}\n' +
    '用户"上周奶茶花了多少" -> {"type":"queryBill","slots":{"category":null,"keyword":"奶茶","period":"lastWeek","dateRange":null,"detail":false}}\n' +
    '用户"帮我详细列出来这个月的消费" -> {"type":"queryBill","slots":{"category":null,"keyword":null,"period":"month","dateRange":null,"detail":true}}\n' +
    '用户"消费时间、备注、消费的什么，这些详细的呢" -> {"type":"queryBill","slots":{"category":null,"keyword":null,"period":"month","dateRange":null,"detail":true}}\n' +
    '用户"昨晚聚餐花了300，3个人AA" -> {"type":"aaSplit","slots":{"amount":300,"remark":"聚餐","people":3,"category":null}}\n' +
    '用户"创建共同账本" -> {"type":"createLedger","slots":{}}\n' +
    '用户"加入共同账本 ABC123" -> {"type":"joinLedger","slots":{"inviteCode":"ABC123"}}\n' +
    '用户"记到共同账本，买菜花了50" -> {"type":"ledgerAdd","slots":{"amount":50,"remark":"买菜","category":null}}\n' +
    '用户"共同账本这个月花了多少" -> {"type":"ledgerQuery","slots":{"period":"month"}}\n' +
    '用户"设置日预算100元" -> {"type":"setBudget","slots":{"type":"total","category":null,"amount":100,"period":"day","month":null}}\n' +
    '用户"设置本月月预算3000元" -> {"type":"setBudget","slots":{"type":"total","category":null,"amount":3000,"period":"month","month":null}}\n' +
    '用户"设置餐饮月预算800元" -> {"type":"setBudget","slots":{"type":"category","category":"餐饮","amount":800,"period":"month","month":null}}\n' +
    '用户"查看本月预算" -> {"type":"queryBudget","slots":{"month":null,"category":null}}\n' +
    '用户"腾讯视频月费25，10月1号订阅的" -> {"type":"addSubscription","slots":{"name":"腾讯视频","amount":25,"cycle":"monthly","startDate":"2026-10-01","nextDate":null}}\n' +
    '用户"腾讯视频下次扣费改成11月1号" -> {"type":"updateLast","slots":{"patch":{"nextDate":"2026-11-01"}}}\n' +
    '用户"不是5块，是6块" -> {"type":"updateLast","slots":{"patch":{"amount":6}}}\n' +
    '用户"刚刚那顿午餐是35元" -> {"type":"addTransaction","slots":{"amount":35,"direction":"expense","remark":"午餐","category":"餐饮","date":null}}\n' +
    '用户"最近是腾讯视频订阅，刚刚那顿午餐是35元" -> {"type":"addTransaction","slots":{"amount":35,"direction":"expense","remark":"午餐","category":"餐饮","date":null}}\n' +
    '用户"补充一下，是餐饮" -> {"type":"updateLast","slots":{"patch":{"category":"餐饮"}}}\n' +
    '用户"上周那杯奶茶改成12元" -> {"type":"findAndUpdate","slots":{"kind":"transaction","target":{"keyword":"奶茶","dateRange":{"start":"2026-09-28","end":"2026-10-04"}},"patch":{"amount":12}}}\n' +
    '用户"把昨天午饭的备注改成和同事吃饭" -> {"type":"findAndUpdate","slots":{"kind":"transaction","target":{"keyword":"午饭","dateRange":{"start":"2026-10-07","end":"2026-10-07"}},"patch":{"remark":"和同事吃饭"}}}\n' +
    '用户"把腾讯视频订阅金额改成30" -> {"type":"findAndUpdate","slots":{"kind":"subscription","target":{"keyword":"腾讯视频"},"patch":{"amount":30}}}\n' +
    '用户"记账，兄弟，记在共同账本里" -> {"type":"moveToSharedLedger","slots":{}}\n' +
    '用户"跟女朋友吃饭都是记录在共同账单处" -> {"type":"learnRule","slots":{"field":"ledger","value":"shared","matchKeywords":["女朋友","吃饭"],"excludeKeywords":[]}}\n' +
    '用户"我请我女朋友吃饭是我个人账单" -> {"type":"learnRule","slots":{"field":"ledger","value":"personal","matchKeywords":["我请","女朋友"],"excludeKeywords":[]}}\n' +
    '当前上下文：' + JSON.stringify(context || {}) + '\n' +
    '如果 context.pendingAction 存在：缺少槽位时输出 pendingAction.type 对应的完整操作；如果 pendingAction.type 是 findAndUpdate 且用户回答“第一个/第二条/3”等，输出 updateRecord，recordId 使用 pendingAction.candidates 对应项，patch 使用 pendingAction.slots.patch。若用户纠正最近一次操作，输出 updateLast；若用户按描述纠正任意历史记录，输出 findAndUpdate；若用户明确指代 recentActions 或 candidates 中某条记录，输出 updateRecord。'

  const ruleIntent = ruleParseIntent(message, context)
  if (ruleIntent && (!context.pendingAction || ruleIntent.type !== context.pendingAction.type)) return ruleIntent
  try {
    const res = await safeGenerateText(model, {
      model: 'hy3',
      messages: [{ role: 'system', content: sys }, ...history, { role: 'user', content: message }]
    })
    const text = (res.text || '').trim()
    const m = text.match(/\{[\s\S]*\}/)
    if (m) { try { return JSON.parse(m[0]) } catch (e) {} }
    return ruleIntent || { type: 'chat', slots: {} }
  } catch (error) {
    console.error('parseIntent AI failed', error.message || error)
    if (ruleIntent) return ruleIntent
    return { type: 'chat', slots: {}, aiUnavailable: true }
  }
}

async function aiCategorize(model, remark) {
  try {
    const res = await safeGenerateText(model, {
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

function summarizeTransactionTitle(message, merchant, itemName, social) {
  if (social && social.socialAction === '请客' && social.relationship) return '请' + social.relationship + (itemName || '吃饭')
  let text = String(message || '')
  text = text.replace(/^(我|今天|今日|今晚|昨晚|昨天|前天|中午|早上|晚上|上午|下午)/g, '')
  text = text.replace(/花(了)?\s*\d+(?:\.\d+)?\s*(元|块|块钱)?/g, '')
  text = text.replace(/(花|消费|支付|付|用)(了)?\s*\d+(?:\.\d+)?\s*(元|块|块钱)?/g, '')
  text = text.replace(/^(点了|买了|吃了|喝了|用了|支付了|付了)/g, '')
  text = text.replace(/的/g, '')
  text = text.replace(/[，。,.!！？?]/g, '')
  if (merchant && itemName && itemName.includes(merchant)) text = itemName
  else if (itemName) text = itemName
  else if (merchant) text = merchant
  return text.slice(0, 16) || itemName || merchant || '一笔记录'
}

function enrichTransactionSlots(slots) {
  const raw = slots.rawText || slots.remark || ''
  const text = normalizeText(raw)
  const social = inferSocialContext(text)
  const merchant = slots.merchant || inferMerchant(text)
  const itemName = slots.itemName || inferItemName(text, merchant)
  return Object.assign({}, slots, {
    merchant,
    itemName,
    title: slots.title || summarizeTransactionTitle(raw, merchant, itemName, social),
    remark: slots.remark || raw,
    rawText: slots.rawText || raw,
    tags: Array.from(new Set((Array.isArray(slots.tags) ? slots.tags : []).concat(social.tags).map(x => String(x || '').trim()).filter(Boolean))).slice(0, 8),
    people: Array.isArray(slots.people) ? slots.people : social.people,
    relationship: slots.relationship || social.relationship,
    socialAction: slots.socialAction || social.socialAction,
    occasion: slots.occasion || social.occasion
  })
}

async function doAdd(openid, slots, model) {
  slots = enrichTransactionSlots(slots)
  const amount = Math.abs(Number(slots.amount))
  if (!amount) return { ok: false, needsInfo: true, msg: '还差金额，请告诉我这笔花/收了多少钱', pendingAction: { type: 'addTransaction', slots } }
  const signed = slots.direction === 'income' ? amount : -amount
  let category = slots.category
  if (!category && slots.remark) category = await aiCategorize(model, slots.remark)
  category = category || '其他'
  const date = slots.date || today()
  const res = await db.collection('transactions').add({
    data: { amount: signed, category, title: slots.title || '', merchant: slots.merchant || '', itemName: slots.itemName || '', remark: slots.remark || '', rawText: slots.rawText || '', tags: Array.isArray(slots.tags) ? slots.tags : [], people: Array.isArray(slots.people) ? slots.people : [], relationship: slots.relationship || '', socialAction: slots.socialAction || '', occasion: slots.occasion || '', memo: slots.memo || '', date, time: slots.time || '', source: 'chat', accountId: '', timezone: 'Asia/Shanghai', _openid: openid, createdAt: db.serverDate(), updatedAt: db.serverDate() }
  })
  return { ok: true, type: 'add', _id: res._id, category, amount: signed, title: slots.title || '', merchant: slots.merchant || '', itemName: slots.itemName || '', remark: slots.remark || '', rawText: slots.rawText || '', tags: slots.tags || [], people: slots.people || [], relationship: slots.relationship || '', socialAction: slots.socialAction || '', occasion: slots.occasion || '', date, lastAction: { kind: 'transaction', recordId: res._id, data: { amount: signed, category, title: slots.title || '', merchant: slots.merchant || '', itemName: slots.itemName || '', remark: slots.remark || '', rawText: slots.rawText || '', tags: slots.tags || [], people: slots.people || [], relationship: slots.relationship || '', socialAction: slots.socialAction || '', occasion: slots.occasion || '', date } } }
}

async function doQuery(openid, slots) {
  const cond = { _openid: openid, amount: _.lt(0) }
  let range = null
  if (slots.dateRange) {
    const start = parseDate(slots.dateRange.start)
    const end = parseDate(slots.dateRange.end)
    if (start && end) range = { start: fmt(start), end: fmt(end) }
  } else {
    range = dateRange(slots.period || 'month')
  }
  if (range) cond.date = _.gte(range.start).and(_.lte(range.end))
  if (slots.category) cond.category = slots.category
  const res = await db.collection('transactions').where(cond).limit(1000).get()
  const source = res.data
  const keyword = normalizeText(slots.keyword)
  const matched = keyword ? source.filter(item => {
    const text = normalizeText([item.merchant, item.itemName, item.remark, item.rawText, item.category, item.relationship, item.socialAction, item.occasion].concat(item.tags || []).concat(item.people || []).join(' '))
    return text.includes(keyword)
  }) : source
  const total = matched.reduce((s, x) => s + Math.abs(x.amount), 0)
  const categoryTotal = source.reduce((s, x) => s + Math.abs(x.amount), 0)
  const byCat = {}
  matched.forEach(x => { byCat[x.category] = (byCat[x.category] || 0) + Math.abs(x.amount) })
  const top = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 5)
  return {
    ok: true,
    type: 'query',
    total: Math.round(total * 100) / 100,
    count: matched.length,
    categoryCount: source.length,
    categoryTotal: Math.round(categoryTotal * 100) / 100,
    period: slots.period || 'custom',
    periodLabel: slots.dateRange ? '所选时间' : periodText(slots.period || 'month'),
    category: slots.category || '全部',
    keyword: slots.keyword || '',
    list: matched.slice(0, 10).map(item => ({ date: item.date || '', time: item.time || '', merchant: item.merchant || '', itemName: item.itemName || '', remark: item.remark || item.rawText || item.category || '', people: item.people || [], relationship: item.relationship || '', socialAction: item.socialAction || '', occasion: item.occasion || '', tags: item.tags || [], amount: item.amount, category: item.category || '其他' })),
    byCat: Object.fromEntries(top)
  }
}

async function doAddSub(openid, slots) {
  let name = (slots.name || '').trim()
  const amountInput = Number(slots.amount)
  const allRes = await db.collection('subscriptions').where({ _openid: openid }).get()
  const all = allRes.data.slice().sort((a, b) => subscriptionTime(b.createdAt) - subscriptionTime(a.createdAt))
  const active = all.filter(x => x.status !== 'cancelled')
  const similar = name ? active.filter(x => subscriptionKey(x.name) === subscriptionKey(name)) : []
  if (name && similar.length && !slots.confirmMode) {
    return {
      ok: false,
      needsInfo: true,
      msg: '我好像已经记录过一个相似的订阅「' + similar[0].name + '」，你是要更新原来的订阅，还是新增一个不同的订阅？',
      pendingAction: { type: 'addSubscription', slots: Object.assign({}, slots, { name }), duplicateCandidates: similar.map(x => ({ recordId: x._id, name: x.name, amount: x.amount, cycle: x.cycle, nextDate: x.nextDate })) }
    }
  }
  let candidates = name ? all.filter(x => normalizeName(x.name) === normalizeName(name)) : []
  if (slots.confirmMode === 'update') candidates = similar.length ? similar : candidates
  if (slots.confirmMode === 'create') candidates = []
  if (!name && all.length === 1) {
    name = all[0].name
    candidates = all
  }
  if (!name && !candidates.length) return { ok: false, needsInfo: true, msg: '请告诉我要记录或纠正哪个订阅', pendingAction: { type: 'addSubscription', slots } }
  const current = candidates[0] || null
  const amount = amountInput || Number(current && current.amount)
  if (!amount) return { ok: false, needsInfo: true, msg: '还差订阅金额，请告诉我每月或每年多少钱', pendingAction: { type: 'addSubscription', slots: Object.assign({}, slots, { name }) } }
  const cycle = slots.cycle || (current && current.cycle) || 'monthly'
  const rawStartDate = slots.startDate || slots.subscribedAt || slots.date
  const parsedStart = parseDate(rawStartDate)
  const startDate = parsedStart ? fmt(parsedStart) : (current && current.startDate) || today()
  const nextDate = computeNextDate(cycle, startDate, slots.nextDate)
  const data = { name, merchant: slots.merchant || name, amount, cycle, startDate, nextDate, status: 'active', autoRenew: true, notes: slots.notes || '', tags: Array.isArray(slots.tags) ? slots.tags : [], rawText: slots.rawText || '', source: 'chat', timezone: 'Asia/Shanghai', updatedAt: db.serverDate() }
  let recordId = current && current._id
  if (current) {
    await db.collection('subscriptions').doc(current._id).update({ data })
  } else {
    const created = await db.collection('subscriptions').add({ data: Object.assign({}, data, { _openid: openid, createdAt: db.serverDate() }) })
    recordId = created._id
  }
  for (const duplicate of candidates.slice(1)) {
    await db.collection('subscriptions').doc(duplicate._id).update({ data: { status: 'cancelled', autoRenew: false, duplicateOf: current._id, updatedAt: db.serverDate() } })
  }
  return { ok: true, type: 'addSub', _id: recordId, name, merchant: data.merchant, amount, cycle, startDate, nextDate, updated: !!current, mergedCount: Math.max(0, candidates.length - 1), lastAction: { kind: 'subscription', recordId, data: { name, merchant: data.merchant, amount, cycle, startDate, nextDate } } }
}

function monthlyAmount(x) {
  if (x.cycle === 'yearly') return Math.round(x.amount / 12 * 100) / 100
  if (x.cycle === 'weekly') return Math.round(x.amount * 4.33 * 100) / 100
  return x.amount
}
async function doQuerySub(openid) {
  const res = await db.collection('subscriptions').where({ _openid: openid, status: 'active' }).get()
  const sorted = res.data.slice().sort((a, b) => subscriptionTime(b.createdAt) - subscriptionTime(a.createdAt))
  const kept = new Map()
  const duplicates = []
  for (const item of sorted) {
    const key = subscriptionKey(item.name)
    if (kept.has(key)) duplicates.push({ item, canonical: kept.get(key) })
    else kept.set(key, item)
  }
  const list = Array.from(kept.values())
  const totalMonthly = Math.round(list.reduce((s, x) => s + monthlyAmount(x), 0) * 100) / 100
  return {
    ok: true,
    type: 'querySub',
    list: list.map(x => ({ name: x.name, merchant: x.merchant || x.name, amount: x.amount, cycle: x.cycle, startDate: x.startDate || '', nextDate: x.nextDate, notes: x.notes || '' })),
    count: list.length,
    totalMonthly,
    mergedCount: duplicates.length
  }
}

async function doCancelSub(openid, name) {
  const n = (name || '').trim()
  if (!n) return { ok: false, needsInfo: true, msg: '请告诉我要取消哪个订阅', pendingAction: { type: 'cancelSubscription', slots: { name: '' } } }
  const res = await db.collection('subscriptions').where({ _openid: openid, name: n, status: 'active' }).update({ data: { status: 'cancelled', autoRenew: false } })
  if (!res.stats.updated) return { ok: false, msg: '没找到名为「' + n + '」的有效订阅' }
  return { ok: true, type: 'cancelSub', name: n }
}

function monthDays(month) {
  const parts = String(month || '').split('-')
  const y = Number(parts[0]) || new Date().getFullYear()
  const m = Number(parts[1]) || new Date().getMonth() + 1
  return new Date(y, m, 0).getDate()
}
function buildBudgetAmounts(amount, period, month) {
  const days = monthDays(month)
  const value = Number(amount)
  if (period === 'day') return { amount: value, dailyAmount: value, monthlyAmount: Math.round(value * days * 100) / 100, daysInMonth: days }
  return { amount: value, monthlyAmount: value, dailyAmount: Math.round(value / days * 100) / 100, daysInMonth: days }
}
async function doSetBudget(openid, slots) {
  const month = slots.month || today().slice(0, 7)
  const period = slots.period === 'day' ? 'day' : 'month'
  const category = (slots.category || '').trim()
  const type = slots.type === 'category' || (category && category !== '全部') ? 'category' : 'total'
  if (type === 'category' && !category) return { ok: false, needsInfo: true, msg: '请告诉我要设置哪个分类的预算', pendingAction: { type: 'setBudget', slots } }
  const amount = Number(slots.amount)
  if (!amount || amount <= 0) return { ok: false, needsInfo: true, msg: '请告诉我要设置的预算金额', pendingAction: { type: 'setBudget', slots } }
  const amounts = buildBudgetAmounts(amount, period, month)
  const finalCategory = type === 'category' ? category : '全部'
  const exist = await db.collection('budgets').where({ _openid: openid, month, type, category: finalCategory }).get()
  const data = Object.assign({ month, type, category: finalCategory, period, source: 'chat', updatedAt: db.serverDate() }, amounts)
  let recordId = ''
  if (exist.data.length) {
    recordId = exist.data[0]._id
    await db.collection('budgets').doc(recordId).update({ data })
  } else {
    const created = await db.collection('budgets').add({ data: Object.assign({}, data, { _openid: openid, createdAt: db.serverDate() }) })
    recordId = created._id
  }
  return { ok: true, type: 'setBudget', _id: recordId, month, type, category: finalCategory, period, amount, monthlyAmount: amounts.monthlyAmount, dailyAmount: amounts.dailyAmount, daysInMonth: amounts.daysInMonth, lastAction: { kind: 'budget', recordId, data: { month, type, category: finalCategory, period, amount, monthlyAmount: amounts.monthlyAmount, dailyAmount: amounts.dailyAmount } } }
}
async function doQueryBudget(openid, slots) {
  const month = slots.month || today().slice(0, 7)
  const bRes = await db.collection('budgets').where({ _openid: openid }).get()
  const budgets = bRes.data.filter(b => !b.month || b.month === month)
  const range = { start: month + '-01', end: String(month) + '-' + String(monthDays(month)).padStart(2, '0') }
  const txRes = await db.collection('transactions').where({ _openid: openid, amount: _.lt(0), date: _.gte(range.start).and(_.lte(range.end)) }).limit(1000).get()
  const txList = txRes.data
  const totalBudget = budgets.find(b => b.type === 'total' || (!b.type && (!b.category || b.category === '全部'))) || null
  const categories = budgets.filter(b => b.type === 'category').map(b => {
    const spent = txList.filter(x => x.category === b.category).reduce((s, x) => s + Math.abs(x.amount), 0)
    const monthlyAmount = Number(b.monthlyAmount || b.amount || 0)
    return { category: b.category, monthlyAmount, dailyAmount: Number(b.dailyAmount || 0), spent: Math.round(spent * 100) / 100, remaining: Math.round((monthlyAmount - spent) * 100) / 100, ratio: monthlyAmount ? Math.round(spent / monthlyAmount * 100) : 0 }
  })
  const totalSpent = txList.reduce((s, x) => s + Math.abs(x.amount), 0)
  const total = totalBudget ? { monthlyAmount: Number(totalBudget.monthlyAmount || totalBudget.amount || 0), dailyAmount: Number(totalBudget.dailyAmount || 0), spent: Math.round(totalSpent * 100) / 100, ratio: Number(totalBudget.monthlyAmount || totalBudget.amount) ? Math.round(totalSpent / Number(totalBudget.monthlyAmount || totalBudget.amount) * 100) : 0 } : null
  return { ok: true, type: 'queryBudget', month, total, categories, list: categories }
}

async function doAASplit(openid, slots, model) {
  const amount = Math.abs(Number(slots.amount))
  const people = Number(slots.people) || 2
  if (!amount) return { ok: false, needsInfo: true, msg: '还差AA金额，请告诉我总金额', pendingAction: { type: 'aaSplit', slots } }
  let category = slots.category
  if (!category && slots.remark) category = await aiCategorize(model, slots.remark)
  category = category || '其他'
  const per = Math.round(amount / people * 100) / 100
  const res = await db.collection('transactions').add({
    data: { amount: -amount, category, merchant: slots.merchant || '', itemName: slots.itemName || (slots.remark || ''), remark: (slots.remark || '') + '（' + people + '人AA）', rawText: slots.rawText || '', tags: Array.isArray(slots.tags) ? slots.tags : [], aaPeople: people, memo: slots.memo || '', date: today(), time: slots.time || '', source: 'chat', accountId: '', timezone: 'Asia/Shanghai', _openid: openid, createdAt: db.serverDate(), updatedAt: db.serverDate() }
  })
  return { ok: true, type: 'aaSplit', _id: res._id, amount, people, per, category, remark: slots.remark || '', lastAction: { kind: 'transaction', recordId: res._id, data: { amount: -amount, category, remark: (slots.remark || '') + '（' + people + '人AA）', date: today(), aaPeople: people } } }
}

// 双人共同账本
async function doCreateLedger(openid) {
  const exist = await db.collection('ledgers').where({ members: openid }).get()
  if (exist.data.length) return { ok: true, type: 'createLedger', _id: exist.data[0]._id, inviteCode: exist.data[0].inviteCode, existed: true, lastAction: { kind: 'ledger', recordId: exist.data[0]._id, data: { name: exist.data[0].name || '共同账本', inviteCode: exist.data[0].inviteCode } } }
  const inviteCode = genCode()
  const created = await db.collection('ledgers').add({ data: { inviteCode, name: '共同账本', members: [openid], _openid: openid, createdAt: db.serverDate() } })
  return { ok: true, type: 'createLedger', _id: created._id, inviteCode, lastAction: { kind: 'ledger', recordId: created._id, data: { name: '共同账本', inviteCode } } }
}

async function doJoinLedger(openid, code) {
  const c = (code || '').trim().toUpperCase()
  if (!c) return { ok: false, needsInfo: true, msg: '请告诉我要加入的邀请码', pendingAction: { type: 'joinLedger', slots: { inviteCode: '' } } }
  const exist = await db.collection('ledgers').where({ inviteCode: c }).get()
  if (!exist.data.length) return { ok: false, msg: '邀请码不存在' }
  const ledger = exist.data[0]
  if (ledger.members.includes(openid)) return { ok: true, type: 'joinLedger', msg: '你已在该账本中' }
  if (ledger.members.length >= 2) return { ok: false, msg: '该账本已有 2 人' }
  await db.collection('ledgers').doc(ledger._id).update({ data: { members: ledger.members.concat([openid]), updatedAt: db.serverDate() } })
  return { ok: true, type: 'joinLedger', _id: ledger._id, msg: '已加入共同账本', lastAction: { kind: 'ledger', recordId: ledger._id, data: { name: ledger.name || '共同账本', inviteCode: ledger.inviteCode } } }
}

async function doLedgerAdd(openid, slots, model) {
  const amount = Math.abs(Number(slots.amount))
  if (!amount) return { ok: false, needsInfo: true, msg: '还差金额，请告诉我这笔共同账本花了多少钱', pendingAction: { type: 'ledgerAdd', slots } }
  const ledgers = await db.collection('ledgers').where({ members: openid }).get()
  if (!ledgers.data.length) return { ok: false, msg: '你还没有共同账本，先说"创建共同账本"' }
  const ledgerId = ledgers.data[0]._id
  let category = slots.category
  if (!category && slots.remark) category = await aiCategorize(model, slots.remark)
  category = category || '其他'
  const res = await db.collection('transactions').add({
    data: { amount: -amount, category, merchant: slots.merchant || '', itemName: slots.itemName || '', remark: slots.remark || '', rawText: slots.rawText || '', tags: Array.isArray(slots.tags) ? slots.tags : [], memo: slots.memo || '', date: slots.date || today(), time: slots.time || '', source: 'chat', accountId: '', timezone: 'Asia/Shanghai', ledgerId, _openid: openid, createdAt: db.serverDate(), updatedAt: db.serverDate() }
  })
  return { ok: true, type: 'ledgerAdd', _id: res._id, amount, category, remark: slots.remark || '', lastAction: { kind: 'transaction', recordId: res._id, data: { amount: -amount, category, remark: slots.remark || '', date: today(), ledgerId } } }
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

function matchTransaction(item, target) {
  const keyword = target && target.keyword ? target.keyword : target && target.remark
  const key = normalizeText(keyword)
  if (key) {
    const text = normalizeText([item.merchant, item.itemName, item.remark, item.rawText, item.relationship, item.socialAction, item.occasion].concat(item.tags || []).concat(item.people || []).join(' '))
    if (!text || (!text.includes(key) && !key.includes(text))) return false
  }
  if (target && target.merchant && normalizeText(item.merchant) !== normalizeText(target.merchant)) return false
  if (target && target.itemName && !normalizeText(item.itemName).includes(normalizeText(target.itemName))) return false
  if (target && target.category && item.category !== target.category) return false
  if (target && target.amount !== undefined && target.amount !== null && Math.abs(Math.abs(Number(item.amount)) - Math.abs(Number(target.amount))) > 0.01) return false
  if (!inDateRange(item.date, target && target.dateRange)) return false
  return true
}

async function doFindAndUpdate(openid, slots, context) {
  const kind = slots.kind || 'transaction'
  const target = slots.target || {}
  const patch = slots.patch || {}
  if (!Object.keys(patch).filter(k => patch[k] !== undefined && patch[k] !== null).length) {
    return { ok: false, needsInfo: true, msg: '请告诉我要把记录改成什么内容', pendingAction: { type: 'findAndUpdate', slots: { kind, target, patch } } }
  }

  let source = []
  if (kind === 'transaction') {
    const res = await db.collection('transactions').where({ _openid: openid }).limit(1000).get()
    source = res.data.filter(item => matchTransaction(item, target))
    source.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || subscriptionTime(b.createdAt) - subscriptionTime(a.createdAt))
  } else if (kind === 'subscription') {
    const key = normalizeText(target.name || target.keyword)
    if (!key) return { ok: false, needsInfo: true, msg: '请告诉我要修改哪个订阅', pendingAction: { type: 'findAndUpdate', slots: { kind, target, patch } } }
    const res = await db.collection('subscriptions').where({ _openid: openid }).get()
    source = res.data.filter(item => item.status !== 'cancelled' && (normalizeText(item.name).includes(key) || key.includes(normalizeText(item.name))))
    source.sort((a, b) => subscriptionTime(b.createdAt) - subscriptionTime(a.createdAt))
  } else if (kind === 'budget') {
    const key = normalizeText(target.category || target.keyword)
    if (!key) return { ok: false, needsInfo: true, msg: '请告诉我要修改哪类预算', pendingAction: { type: 'findAndUpdate', slots: { kind, target, patch } } }
    const res = await db.collection('budgets').where({ _openid: openid }).get()
    source = res.data.filter(item => normalizeText(item.category).includes(key) || key.includes(normalizeText(item.category)))
  } else if (kind === 'ledger') {
    const key = normalizeText(target.name || target.keyword)
    const res = await db.collection('ledgers').where({ members: openid }).get()
    source = key ? res.data.filter(item => normalizeText(item.name || '共同账本').includes(key)) : res.data
  } else {
    return { ok: false, msg: '暂不支持搜索这类记录' }
  }

  if (!source.length) return { ok: false, needsInfo: true, msg: '没有找到符合条件的记录，请再补充一点描述', pendingAction: { type: 'findAndUpdate', slots: { kind, target, patch } } }
  if (source.length === 1) return doUpdateLast(openid, { patch }, { lastAction: { kind, recordId: source[0]._id } })

  const candidates = source.slice(0, 5).map(item => ({ kind, recordId: item._id, label: recordLabel(kind, item) }))
  return {
    ok: false,
    needsInfo: true,
    msg: '找到多条符合条件的记录，请告诉我选第几条：' + candidates.map((x, i) => (i + 1) + '. ' + x.label).join('；'),
    pendingAction: { type: 'findAndUpdate', slots: { kind, target, patch }, candidates }
  }
}

async function getOwnedRecord(collectionName, recordId, openid) {
  if (!recordId) return null
  try {
    const res = await db.collection(collectionName).doc(recordId).get()
    if (!res.data || res.data._openid !== openid) return null
    return res.data
  } catch (e) {
    return null
  }
}

async function doUpdateLast(openid, slots, context) {
  const last = context && context.lastAction
  if (!last || !last.kind || !last.recordId) return { ok: false, needsInfo: true, msg: '我没有找到可以修改的最近一笔操作，请把要修改的内容重新说一遍' }
  const patch = (slots && slots.patch) || slots || {}
  const keys = Object.keys(patch).filter(k => patch[k] !== undefined && patch[k] !== null)
  if (!keys.length) return { ok: false, needsInfo: true, msg: '请告诉我要修改哪一项内容', pendingAction: { type: 'updateLast', slots: { patch } } }

  if (last.kind === 'transaction') {
    const current = await getOwnedRecord('transactions', last.recordId, openid)
    if (!current) return { ok: false, msg: '这笔记录不存在或不属于当前用户' }
    const data = {}
    if (patch.amount !== undefined && patch.amount !== null) {
      const amount = Math.abs(Number(patch.amount))
      if (!amount) return { ok: false, needsInfo: true, msg: '金额格式不对，请重新告诉我', pendingAction: { type: 'updateLast', slots: { patch } } }
      const direction = patch.direction || (current.amount > 0 ? 'income' : 'expense')
      data.amount = direction === 'income' ? amount : -amount
    } else if (patch.direction) {
      const amount = Math.abs(Number(current.amount))
      data.amount = patch.direction === 'income' ? amount : -amount
    }
    if (patch.title !== undefined && patch.title !== null) data.title = patch.title
    if (patch.remark !== undefined && patch.remark !== null) data.remark = patch.remark
    if (patch.merchant !== undefined && patch.merchant !== null) data.merchant = patch.merchant
    if (patch.itemName !== undefined && patch.itemName !== null) data.itemName = patch.itemName
    if (patch.rawText !== undefined && patch.rawText !== null) data.rawText = patch.rawText
    if (patch.tags !== undefined && patch.tags !== null) data.tags = Array.isArray(patch.tags) ? patch.tags : String(patch.tags).split(/[，,]/).filter(Boolean)
    if (patch.people !== undefined && patch.people !== null) data.people = Array.isArray(patch.people) ? patch.people : String(patch.people).split(/[，,]/).filter(Boolean)
    if (patch.relationship !== undefined && patch.relationship !== null) data.relationship = patch.relationship
    if (patch.socialAction !== undefined && patch.socialAction !== null) data.socialAction = patch.socialAction
    if (patch.occasion !== undefined && patch.occasion !== null) data.occasion = patch.occasion
    if (patch.memo !== undefined && patch.memo !== null) data.memo = patch.memo
    if (patch.time !== undefined && patch.time !== null) data.time = patch.time
    if (patch.category !== undefined && patch.category !== null) data.category = patch.category
    if (patch.date !== undefined && patch.date !== null) {
      const d = parseDate(patch.date)
      if (d) data.date = fmt(d)
    }
    if (patch.aaPeople !== undefined && patch.aaPeople !== null) {
      const people = Number(patch.aaPeople)
      if (people > 0 && current.amount < 0) {
        const total = Math.abs(data.amount !== undefined ? data.amount : current.amount)
        const baseRemark = (current.remark || '').replace(/（\d+人AA）$/, '')
        data.remark = baseRemark + '（' + people + '人AA）'
        data.amount = -total
      }
    }
    if (!Object.keys(data).length) return { ok: false, needsInfo: true, msg: '请具体告诉我要修改金额、备注、分类还是日期', pendingAction: { type: 'updateLast', slots: { patch } } }
    data.updatedAt = db.serverDate()
    await db.collection('transactions').doc(last.recordId).update({ data })
    const merged = Object.assign({}, current, data)
    return { ok: true, type: 'updateLast', kind: 'transaction', _id: last.recordId, data: { amount: merged.amount, category: merged.category, merchant: merged.merchant || '', itemName: merged.itemName || '', remark: merged.remark, rawText: merged.rawText || '', tags: merged.tags || [], people: merged.people || [], relationship: merged.relationship || '', socialAction: merged.socialAction || '', occasion: merged.occasion || '', date: merged.date }, lastAction: { kind: 'transaction', recordId: last.recordId, data: { amount: merged.amount, category: merged.category, merchant: merged.merchant || '', itemName: merged.itemName || '', remark: merged.remark, rawText: merged.rawText || '', tags: merged.tags || [], people: merged.people || [], relationship: merged.relationship || '', socialAction: merged.socialAction || '', occasion: merged.occasion || '', date: merged.date } } }
  }

  if (last.kind === 'subscription') {
    const current = await getOwnedRecord('subscriptions', last.recordId, openid)
    if (!current) return { ok: false, msg: '这个订阅不存在或不属于当前用户' }
    const name = patch.name !== undefined && patch.name !== null ? patch.name : current.name
    const amount = patch.amount !== undefined && patch.amount !== null ? Number(patch.amount) : current.amount
    if (!name || !amount) return { ok: false, needsInfo: true, msg: '订阅名称和金额不能为空', pendingAction: { type: 'updateLast', slots: { patch } } }
    const cycle = patch.cycle || current.cycle || 'monthly'
    let startDate = current.startDate || ''
    if (patch.startDate !== undefined && patch.startDate !== null) {
      const parsed = parseDate(patch.startDate)
      if (parsed) startDate = fmt(parsed)
    }
    let nextDate = current.nextDate
    if (patch.cycle !== undefined || patch.startDate !== undefined || patch.nextDate !== undefined) {
      nextDate = computeNextDate(cycle, startDate, patch.nextDate)
    }
    const data = { name, merchant: patch.merchant !== undefined ? patch.merchant : (current.merchant || name), amount, cycle, startDate, nextDate, notes: patch.notes !== undefined ? patch.notes : (current.notes || ''), tags: patch.tags !== undefined ? (Array.isArray(patch.tags) ? patch.tags : String(patch.tags).split(/[，,]/).filter(Boolean)) : (current.tags || []), rawText: patch.rawText !== undefined ? patch.rawText : (current.rawText || ''), updatedAt: db.serverDate() }
    await db.collection('subscriptions').doc(last.recordId).update({ data })
    return { ok: true, type: 'updateLast', kind: 'subscription', _id: last.recordId, data: { name, amount, cycle, startDate, nextDate }, lastAction: { kind: 'subscription', recordId: last.recordId, data: { name, merchant: data.merchant, amount, cycle, startDate, nextDate } } }
  }

  if (last.kind === 'budget') {
    const current = await getOwnedRecord('budgets', last.recordId, openid)
    if (!current) return { ok: false, msg: '这条预算不存在或不属于当前用户' }
    const month = patch.month || current.month || today().slice(0, 7)
    const type = patch.type || current.type || ((patch.category || current.category) && (patch.category || current.category) !== '全部' ? 'category' : 'total')
    const category = type === 'category' ? ((patch.category !== undefined && patch.category !== null ? patch.category : current.category) || '') : '全部'
    const amount = patch.amount !== undefined && patch.amount !== null ? Number(patch.amount) : Number(current.amount)
    const period = patch.period || current.period || 'month'
    if ((type === 'category' && !category) || !amount) return { ok: false, needsInfo: true, msg: '预算分类和金额不能为空', pendingAction: { type: 'updateLast', slots: { patch } } }
    const amounts = buildBudgetAmounts(amount, period, month)
    const data = Object.assign({ month, type, category, period, updatedAt: db.serverDate() }, amounts)
    await db.collection('budgets').doc(last.recordId).update({ data })
    return { ok: true, type: 'updateLast', kind: 'budget', _id: last.recordId, data: { month, type, category, period, amount, monthlyAmount: amounts.monthlyAmount, dailyAmount: amounts.dailyAmount }, lastAction: { kind: 'budget', recordId: last.recordId, data: { month, type, category, period, amount, monthlyAmount: amounts.monthlyAmount, dailyAmount: amounts.dailyAmount } } }
  }

  if (last.kind === 'ledger') {
    const current = await getOwnedRecord('ledgers', last.recordId, openid)
    if (!current) return { ok: false, msg: '这个共同账本不存在或不属于当前用户' }
    const name = patch.name !== undefined && patch.name !== null ? patch.name : current.name
    const data = { name, updatedAt: db.serverDate() }
    await db.collection('ledgers').doc(last.recordId).update({ data })
    return { ok: true, type: 'updateLast', kind: 'ledger', _id: last.recordId, data: { name, inviteCode: current.inviteCode }, lastAction: { kind: 'ledger', recordId: last.recordId, data: { name, inviteCode: current.inviteCode } } }
  }

  return { ok: false, msg: '暂不支持修改这类记录' }
}

async function doUpdateRecord(openid, slots, context) {
  const targetId = slots && slots.recordId
  const recent = (context && context.recentActions) || []
  const candidates = (context && context.pendingAction && context.pendingAction.candidates) || []
  const target = recent.find(item => item && item.recordId === targetId) || candidates.find(item => item && item.recordId === targetId)
  if (!target) return { ok: false, needsInfo: true, msg: '没有找到要修改的那条操作，请说明是哪一笔' }
  return doUpdateLast(openid, slots, { lastAction: target })
}

async function doMoveToSharedLedger(openid, context) {
  const last = context && context.lastAction
  if (!last || last.kind !== 'transaction') return { ok: false, needsInfo: true, msg: '我没有找到上一笔可移动的交易，请先完成一笔记账。' }
  const current = await getOwnedRecord('transactions', last.recordId, openid)
  if (!current) return { ok: false, msg: '上一笔交易不存在或无权修改' }
  const ledgerResult = await doCreateLedger(openid)
  if (!ledgerResult.ok) return ledgerResult
  await db.collection('transactions').doc(last.recordId).update({ data: { ledgerId: ledgerResult._id, source: current.source || 'chat', updatedAt: db.serverDate() } })
  const keywords = []
  if (current.relationship) keywords.push(normalizeText(current.relationship))
  if (current.socialAction) keywords.push(normalizeText(current.socialAction))
  else if (Array.isArray(current.tags) && current.tags.length) keywords.push(normalizeText(current.tags[0]))
  const learnedRule = keywords.length ? { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), field: 'ledger', value: 'shared', matchKeywords: Array.from(new Set(keywords)), excludeKeywords: [], category: '', merchant: '', sourceText: current.rawText || current.remark || '', createdAt: new Date().toISOString(), enabled: true } : null
  return {
    ok: true,
    type: 'moveToSharedLedger',
    _id: last.recordId,
    ledgerId: ledgerResult._id,
    inviteCode: ledgerResult.inviteCode,
    learnedRule,
    lastAction: { kind: 'transaction', recordId: last.recordId, data: Object.assign({}, last.data || {}, { ledgerId: ledgerResult._id }) }
  }
}

async function genReply(model, message, exec) {
  if (exec && exec.type !== 'chat') return fallbackReply(exec)
  const sys = '你是 AI 财务管家，语气友好简洁，像贴心助手。基于给定的执行结果回复用户，不要编造数据。若执行失败或信息不足，就友好地请用户补充。'
  try {
    const res = await safeGenerateText(model, {
      model: 'hy3',
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: '用户说：' + message + '\n执行结果：' + JSON.stringify(exec) + '\n请给出自然回复。' }
      ]
    })
    return res.text || fallbackReply(exec)
  } catch (error) {
    console.error('genReply AI failed', error.message || error)
    return fallbackReply(exec)
  }
}

exports.main = async (event) => {
  if (event.action === 'history.list') {
    const { OPENID } = cloud.getWXContext()
    const saved = await loadContext(OPENID)
    return { ok: true, history: saved.history || [], context: saved, build: CHAT_AGENT_BUILD }
  }
  const { message, history = [], context: incomingContext = {} } = event
  const incoming = incomingContext && typeof incomingContext === 'object' ? incomingContext : {}
  if (!message) return { success: false, error: '缺少 message' }
  const { OPENID } = cloud.getWXContext()
  console.log('chatAgent build', CHAT_AGENT_BUILD)
  const persistedContext = await loadContext(OPENID)
  const context = mergeContext(persistedContext, incoming)
  const sharedLedger = await getUserLedger(OPENID)
  const effectiveHistory = mergeHistory(context.history || [], history)
  const ai = cloud.ai()
  const model = ai.createModel('cloudbase')

  const intent = await parseIntent(model, message, effectiveHistory, context)
  const slots = intent.slots || {}
  let exec
  if (intent.type === 'addTransaction') {
    const pref = resolveLearnedPreferences(message, slots, context, sharedLedger)
    if (pref.category && !slots.category) slots.category = pref.category
    if (pref.merchant && !slots.merchant) slots.merchant = pref.merchant
    if (pref.ledger === 'shared') intent.type = 'ledgerAdd'
  }
  if (intent.type === 'addTransaction') exec = await doAdd(OPENID, slots, model)
  else if (intent.type === 'queryBill') exec = await doQuery(OPENID, slots)
  else if (intent.type === 'addSubscription') exec = await doAddSub(OPENID, slots)
  else if (intent.type === 'querySubscription') exec = await doQuerySub(OPENID)
  else if (intent.type === 'cancelSubscription') exec = await doCancelSub(OPENID, slots.name)
  else if (intent.type === 'setBudget') exec = await doSetBudget(OPENID, slots)
  else if (intent.type === 'queryBudget') exec = await doQueryBudget(OPENID, slots)
  else if (intent.type === 'aaSplit') exec = await doAASplit(OPENID, slots, model)
  else if (intent.type === 'createLedger') exec = await doCreateLedger(OPENID)
  else if (intent.type === 'joinLedger') exec = await doJoinLedger(OPENID, slots.inviteCode)
  else if (intent.type === 'ledgerAdd') exec = await doLedgerAdd(OPENID, slots, model)
  else if (intent.type === 'ledgerQuery') exec = await doLedgerQuery(OPENID, slots)
  else if (intent.type === 'updateLast') {
    if (!isUpdateTargetCompatible(message, context.lastAction)) exec = { ok: false, needsInfo: true, msg: '你像是在说另一笔记录，我不会修改最近的「' + ((context.lastAction && context.lastAction.data && context.lastAction.data.name) || '记录') + '」。如果是新记账，请直接说“记一笔午餐35元”；如果要改历史记录，请说“把刚才那顿午餐改成35元”。' }
    else exec = await doUpdateLast(OPENID, slots, context)
  }
  else if (intent.type === 'updateRecord') exec = await doUpdateRecord(OPENID, slots, context)
  else if (intent.type === 'findAndUpdate') exec = await doFindAndUpdate(OPENID, slots, context)
  else if (intent.type === 'moveToSharedLedger') exec = await doMoveToSharedLedger(OPENID, context)
  else if (intent.type === 'learnRule') exec = await doLearnRule(OPENID, message, slots, context)
  else exec = intent.aiUnavailable ? { ok: false, msg: 'AI 服务暂时繁忙，请稍后再试。查询今天、本月消费和查看订阅等常用操作仍可直接使用。' } : { ok: true, type: 'chat' }

  const reply = (!exec.ok && exec.msg) ? exec.msg : await genReply(model, message, exec)
  const nextContext = Object.assign({}, context || {})
  if (exec.ok && exec.lastAction) {
    nextContext.lastAction = exec.lastAction
    const previous = Array.isArray(context.recentActions) ? context.recentActions : []
    nextContext.recentActions = [exec.lastAction]
      .concat(previous.filter(item => !(item && item.kind === exec.lastAction.kind && item.recordId === exec.lastAction.recordId)))
      .slice(0, 5)
  }
  if (!exec.ok && exec.pendingAction) nextContext.pendingAction = exec.pendingAction
  if (exec.ok) delete nextContext.pendingAction
  if (exec.ok && intent.type === 'queryBill') nextContext.lastQuery = { type: 'queryBill', slots }
  if (exec.ok && Array.isArray(exec.rules)) nextContext.preferenceRules = exec.rules
  if (exec.ok && exec.learnedRule) {
    const rules = (context.preferenceRules || []).filter(item => !(item.field === exec.learnedRule.field && item.value === exec.learnedRule.value && JSON.stringify(item.matchKeywords) === JSON.stringify(exec.learnedRule.matchKeywords)))
    rules.push(exec.learnedRule)
    nextContext.preferenceRules = rules.slice(-20)
  }
  nextContext.history = mergeHistory(effectiveHistory, [{ role: 'user', content: message, createdAt: new Date().toISOString() }, { role: 'assistant', content: reply, createdAt: new Date().toISOString() }])
  await saveContext(OPENID, nextContext)
  return { success: true, executionOk: exec.ok !== false, reply, intent: intent.type, data: exec, context: nextContext, build: CHAT_AGENT_BUILD }
}
