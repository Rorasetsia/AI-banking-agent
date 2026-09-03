const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV, timeout: 60000 })
const db = cloud.database()
const _ = db.command

function fmt(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
function today() { return fmt(new Date()) }
function addDays(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return fmt(d)
}
function monthRange() {
  const now = new Date()
  return { start: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), end: fmt(new Date(now.getFullYear(), now.getMonth() + 1, 0)) }
}

exports.main = async () => {
  const results = []

  // 1. 订阅到期提醒（3 天内即将续费）
  const soon = addDays(3)
  const subRes = await db.collection('subscriptions').where({ status: 'active', nextDate: _.lte(soon) }).get()
  for (const s of subRes.data) {
    const content = '订阅「' + s.name + '」将于 ' + s.nextDate + ' 续费 ' + s.amount + ' 元'
    await db.collection('reminders').add({
      data: { _openid: s._openid, type: 'subscription', content, read: false, date: today(), createdAt: db.serverDate() }
    })
    results.push(content)
  }

  // 2. 预算超支提醒（已用 >= 80%）
  const range = monthRange()
  const bRes = await db.collection('budgets').get()
  for (const b of bRes.data) {
    const txRes = await db.collection('transactions').where({
      _openid: b._openid, category: b.category, amount: _.lt(0),
      date: _.gte(range.start).and(_.lte(range.end))
    }).get()
    const spent = txRes.data.reduce((s, x) => s + Math.abs(x.amount), 0)
    if (b.amount > 0 && spent / b.amount >= 0.8) {
      const pct = Math.round(spent / b.amount * 100)
      const content = '预算「' + b.category + '」已用 ' + pct + '%（' + Math.round(spent * 100) / 100 + '/' + b.amount + ' 元）'
      await db.collection('reminders').add({
        data: { _openid: b._openid, type: 'budget', content, read: false, date: today(), createdAt: db.serverDate() }
      })
      results.push(content)
    }
  }

  return { success: true, count: results.length, results }
}
