const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV, timeout: 60000 })
const db = cloud.database()

function today() {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

exports.main = async (event) => {
  const { date } = event
  const { OPENID } = cloud.getWXContext()
  const d = date || today()

  // 1. 拉当天账目
  const txRes = await db.collection('transactions').where({ _openid: OPENID, date: d }).limit(500).get()
  const txList = txRes.data
  const expense = Math.round(txList.filter(x => x.amount < 0).reduce((s, x) => s + Math.abs(x.amount), 0) * 100) / 100
  const income = Math.round(txList.filter(x => x.amount > 0).reduce((s, x) => s + x.amount, 0) * 100) / 100

  // 2. 拉当天心情
  const mdRes = await db.collection('moods').where({ _openid: OPENID, date: d }).get()
  const moodList = mdRes.data

  // 3. 没数据则返回空提示
  if (!txList.length && !moodList.length) {
    return { success: true, diary: '今天还没有记录哦，去记一笔或选个心情吧～', empty: true, expense: 0, income: 0 }
  }

  // 4. 调混元生成日记（助手型：只陈述一手信息，不臆测不下判断）
  const ai = cloud.ai()
  const model = ai.createModel('cloudbase')
  const summary = {
    date: d,
    expense, income,
    transactions: txList.map(x => ({ amount: x.amount, category: x.category, remark: x.remark })),
    moods: moodList.map(x => ({ period: x.period, mood: x.mood, customTag: x.customTag }))
  }
  const res = await model.generateText({
    model: 'hy3',
    messages: [
      {
        role: 'system',
        content: '你是 AI 财务管家。根据用户当天的账目和心情，写一篇温暖简洁的日记式总结（120字以内，第一人称"你"）。规则：只陈述用户提供的账目与心情信息；不臆测心理、不做因果判断、不追问私人问题；金额与分类如实列出。语气像贴心朋友。'
      },
      { role: 'user', content: '当天数据：' + JSON.stringify(summary) + '\n请写日记。' }
    ]
  })
  const diary = res.text || '今天过得如何？已经帮你记好啦。'

  // 5. 存 diaries（同一天覆盖更新）
  const moodSummary = moodList.map(x => x.mood).join('/')
  const expenseSummary = '支出 ' + expense + ' 元，收入 ' + income + ' 元'
  const exist = await db.collection('diaries').where({ _openid: OPENID, date: d }).get()
  if (exist.data.length) {
    await db.collection('diaries').doc(exist.data[0]._id).update({ data: { content: diary, moodSummary, expenseSummary } })
  } else {
    await db.collection('diaries').add({ data: { date: d, content: diary, moodSummary, expenseSummary, _openid: OPENID, createdAt: db.serverDate() } })
  }

  return { success: true, diary, expense, income, moods: moodList, empty: false }
}
