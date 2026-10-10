const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV, timeout: 60000 })
const db = cloud.database()
const MAX_DAILY_UPDATES = 5

function today() {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000)
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0')
}
function escapeHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }
function isRateLimitError(error) {
  const status = error && (error.statusCode || error.status || (error.response && error.response.status))
  const text = String((error && (error.message || error.errMsg)) || error || '')
  return status === 429 || text.includes('429') || text.toLowerCase().includes('too many requests')
}
async function safeGenerateText(model, payload) {
  let lastError
  for (let i = 0; i < 3; i++) {
    try { return await model.generateText(payload) } catch (error) {
      lastError = error
      if (!isRateLimitError(error) || i === 2) throw error
      await sleep(600 * Math.pow(2, i))
    }
  }
  throw lastError
}
async function getDailyData(openid, date) {
  const txRes = await db.collection('transactions').where({ _openid: openid, date }).limit(500).get()
  const moodRes = await db.collection('moods').where({ _openid: openid, date }).get()
  const txList = txRes.data
  const moodList = moodRes.data
  const expense = Math.round(txList.filter(x => x.amount < 0).reduce((s, x) => s + Math.abs(x.amount), 0) * 100) / 100
  const income = Math.round(txList.filter(x => x.amount > 0).reduce((s, x) => s + x.amount, 0) * 100) / 100
  const signature = JSON.stringify({ tx: txList.map(x => [x.amount, x.category, x.merchant || '', x.itemName || '', x.remark || '', x.rawText || '']), moods: moodList.map(x => [x.period, x.mood, x.customTag || '']) })
  return { txList, moodList, expense, income, signature }
}
function shortSummary(data) {
  const moodText = data.moodList.map(x => x.mood).filter(Boolean).join('、') || '未记录心情'
  const details = data.txList.slice(0, 20).map(x => (x.merchant || x.itemName || x.remark || x.category) + ' ¥' + Math.abs(x.amount)).join('；')
  return '支出 ' + data.expense + ' 元、收入 ' + data.income + ' 元，心情：' + moodText + (details ? '。' + details : '')
}
async function getDiary(openid, date) {
  const res = await db.collection('diaries').where({ _openid: openid, date }).get()
  return res.data[0] || null
}
async function saveDiary(openid, date, content, data, extra) {
  const existing = await getDiary(openid, date)
  const contentHtml = (extra && extra.contentHtml) || escapeHtml(content)
  const payload = Object.assign({ title: (existing && existing.title) || date, highlight: (extra && extra.highlight !== undefined) ? extra.highlight : ((existing && existing.highlight) || ''), content, contentHtml, moodSummary: data.moodList.map(x => x.mood).join('/'), expenseSummary: '支出 ' + data.expense + ' 元，收入 ' + data.income + ' 元', dataSignature: data.signature, lastGeneratedAt: db.serverDate(), updatedAt: db.serverDate() }, extra || {})
  if (existing) {
    await db.collection('diaries').doc(existing._id).update({ data: payload })
    return Object.assign({}, existing, payload)
  }
  const created = await db.collection('diaries').add({ data: Object.assign({}, payload, { date, _openid: openid, createdAt: db.serverDate() }) })
  return Object.assign({ _id: created._id, date }, payload)
}
async function generateFor(openid, date, options) {
  const data = await getDailyData(openid, date)
  const existing = await getDiary(openid, date)
  if (!data.txList.length && !data.moodList.length && !options.final) return { ok: true, empty: true, date, diary: null }
  if (existing && existing.dataSignature === data.signature && !options.force) return { ok: true, unchanged: true, diary: existing }
  if (existing && !options.final && Number(existing.updateCount || 0) >= MAX_DAILY_UPDATES) return { ok: true, pendingFinal: true, diary: existing }
  const ai = cloud.ai(); const model = ai.createModel('cloudbase')
  const summary = { date, expense: data.expense, income: data.income, highlight: (existing && existing.highlight) || '',
    transactions: data.txList.map(x => ({ amount: x.amount, category: x.category, merchant: x.merchant || '', itemName: x.itemName || '', remark: x.remark || '', rawText: x.rawText || '', tags: x.tags || [] })), moods: data.moodList.map(x => ({ period: x.period, mood: x.mood, customTag: x.customTag || '' })) }
  let content
  try {
    const prior = existing && existing.manualEdited ? '已有内容（必须保留，不要删除或覆盖）：' + (existing.content || '') + '\n' : ''
    const res = await safeGenerateText(model, { model: 'hy3', messages: [{ role: 'system', content: '你是 AI 财务管家。根据用户当天的账目和心情，写或扩展一篇温暖简洁的日记式总结（120字以内，第一人称"你"）。只陈述一手信息，不臆测心理、不做因果判断、不追问隐私。' }, { role: 'user', content: prior + '当天数据：' + JSON.stringify(summary) + '\n请写日记。' }] })
    content = res.text || shortSummary(data)
  } catch (error) {
    console.error('generateDiary AI failed', error.message || error)
    content = existing && existing.content && existing.manualEdited ? existing.content + '\n' + shortSummary(data) : shortSummary(data)
  }
  if (!data.txList.length && !data.moodList.length && options.final) content = '今天没有记账或心情记录，给自己留一段安静的时间吧。'
  const saved = await saveDiary(openid, date, content, data, { updateCount: Number((existing && existing.updateCount) || 0) + 1, manualEdited: !!(existing && existing.manualEdited), finalized: !!options.final, generatedBy: options.final ? 'scheduler' : 'entry' })
  return { ok: true, diary: saved, empty: !data.txList.length && !data.moodList.length }
}
exports.main = async (event) => {
  const action = event.action || 'generate'
  const { OPENID } = cloud.getWXContext()
  const date = event.date || today()
  if (action === 'diaries.peek') {
    const existing = await getDiary(OPENID, date)
    return { ok: true, diary: existing }
  }
  if (action === 'diaries.highlight') {
    const highlight = String(event.highlight || '').trim()
    const existing = await getDiary(OPENID, date)
    if (existing) {
      await db.collection('diaries').doc(existing._id).update({ data: { highlight, manualEdited: true, updatedAt: db.serverDate() } })
    } else {
      const data = await getDailyData(OPENID, date)
      await saveDiary(OPENID, date, '', data, { highlight, manualEdited: true, updateCount: 0, finalized: false, generatedBy: 'user-highlight' })
    }
    return { ok: true, highlight }
  }
  if (action === 'diaries.list') {
    const res = await db.collection('diaries').where({ _openid: OPENID }).limit(500).get()
    return { ok: true, list: res.data.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))) }
  }
  if (action === 'diaries.get') {
    const existing = await getDiary(OPENID, date)
    if (existing) {
      const data = await getDailyData(OPENID, date)
      if (existing.dataSignature === data.signature || Number(existing.updateCount || 0) >= MAX_DAILY_UPDATES) return { ok: true, diary: existing, unchanged: true, pendingFinal: Number(existing.updateCount || 0) >= MAX_DAILY_UPDATES }
    }
    return generateFor(OPENID, date, { reason: 'entry' })
  }
  if (action === 'diaries.generate') return generateFor(OPENID, date, { force: !!event.force, reason: event.reason || 'entry' })
  if (action === 'diaries.polish') {
    const content = String(event.content || '').trim()
    if (!content) return { ok: false, error: '正文为空，无法润色' }
    try {
      const model = cloud.ai().createModel('cloudbase')
      const result = await safeGenerateText(model, { model: 'hy3', messages: [{ role: 'system', content: '你是日记润色助手。保留原文事实、日期、金额、人物和心情，不添加新事实，不进行心理判断；只让文字更通顺自然。只输出润色后的正文。' }, { role: 'user', content }] })
      return { ok: true, content: (result.text || content).trim() }
    } catch (e) { return { ok: false, error: 'AI 润色失败：' + (e.message || '请稍后重试') } }
  }
  if (action === 'diaries.update') {
    const existing = await getDiary(OPENID, date)
    if (!existing) return { ok: false, error: '日记不存在' }
    await db.collection('diaries').doc(existing._id).update({ data: { title: event.title !== undefined ? event.title : existing.title, highlight: event.highlight !== undefined ? event.highlight : existing.highlight, content: event.content !== undefined ? event.content : existing.content, contentHtml: event.contentHtml !== undefined ? event.contentHtml : (existing.contentHtml || escapeHtml(event.content || existing.content)), manualEdited: true, updatedAt: db.serverDate() } })
    return { ok: true }
  }
  if (action === 'diaries.delete') {
    const existing = await getDiary(OPENID, date)
    if (!existing) return { ok: false, error: '日记不存在' }
    await db.collection('diaries').doc(existing._id).remove()
    return { ok: true }
  }
  return generateFor(OPENID, date, { reason: 'entry' })
}
