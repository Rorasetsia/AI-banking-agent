const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV, timeout: 60000 })
const db = cloud.database()

function fmt(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
function today() {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000)
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0')
}
async function collectOpenids(date) {
  const ids = new Set()
  const txRes = await db.collection('transactions').where({ date }).limit(1000).get()
  const moodRes = await db.collection('moods').where({ date }).limit(1000).get()
  txRes.data.forEach(x => x._openid && ids.add(x._openid))
  moodRes.data.forEach(x => x._openid && ids.add(x._openid))
  const userRes = await db.collection('users').limit(1000).get()
  userRes.data.forEach(x => x._openid && ids.add(x._openid))
  return { ids: Array.from(ids), txRes: txRes.data, moodRes: moodRes.data }
}
exports.main = async (event) => {
  const date = (event && event.date) || today()
  const collected = await collectOpenids(date)
  const txAll = collected.txRes
  const moodAll = collected.moodRes
  let updated = 0
  for (const openid of collected.ids) {
    const tx = txAll.filter(x => x._openid === openid)
    const moods = moodAll.filter(x => x._openid === openid)
    const content = buildContent(tx, moods)
    const existingRes = await db.collection('diaries').where({ _openid: openid, date }).get()
    const existing = existingRes.data[0]
    if (!tx.length && !moods.length && existing) continue
    const payload = {
      title: (existing && existing.title) || date,
      highlight: (existing && existing.highlight) || '',
      content: existing && existing.manualEdited && existing.content ? existing.content + '\n\n今日补充：\n' + content : content,
      moodSummary: moods.map(x => x.mood).join('/'),
      expenseSummary: '支出 ' + (tx.filter(x => x.amount < 0).reduce((s, x) => s + Math.abs(x.amount), 0)) + ' 元',
      dataSignature: signature(tx, moods),
      finalized: true,
      generatedBy: 'scheduler',
      lastGeneratedAt: db.serverDate(),
      updatedAt: db.serverDate()
    }
    if (existing) await db.collection('diaries').doc(existing._id).update({ data: payload })
    else await db.collection('diaries').add({ data: Object.assign({}, payload, { date, _openid: openid, updateCount: 0, manualEdited: false, createdAt: db.serverDate() }) })
    updated++
  }
  return { success: true, date, updated }
}
