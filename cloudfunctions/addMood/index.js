const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function today() {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

exports.main = async (event) => {
  const { date, period, mood, customTag } = event
  if (!mood) return { success: false, error: '缺少心情 mood' }
  const { OPENID } = cloud.getWXContext()
  const d = date || today()
  const p = period || 'night'

  // 同一天同一时段：更新而非重复插入
  const exist = await db.collection('moods').where({ _openid: OPENID, date: d, period: p }).get()
  if (exist.data.length) {
    await db.collection('moods').doc(exist.data[0]._id).update({ data: { mood, customTag: customTag || '' } })
    return { success: true, updated: true }
  }
  const res = await db.collection('moods').add({
    data: { date: d, period: p, mood, customTag: customTag || '', _openid: OPENID, createdAt: db.serverDate() }
  })
  return { success: true, _id: res._id }
}
