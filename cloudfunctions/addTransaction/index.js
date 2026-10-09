const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV, timeout: 60000 })

function chinaToday() {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000)
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0')
}
const CATEGORIES = ['餐饮', '交通', '购物', '娱乐', '居住', '医疗', '教育', '其他']

exports.main = async (event) => {
  const { amount, category, accountId, title, merchant, itemName, remark, rawText, tags, people, relationship, socialAction, occasion, memo, date, time, source } = event
  const { OPENID } = cloud.getWXContext()

  // 1. 校验必填
  if (amount === undefined || amount === null || isNaN(Number(amount))) {
    return { success: false, error: '缺少或非法金额 amount' }
  }

  // 2. 自动分类：未传 category 且有备注时，调混元 AI 分类
  let finalCategory = category
  if (!finalCategory && remark) {
    try {
      const ai = cloud.ai()
      const model = ai.createModel('cloudbase')
      const result = await model.generateText({
        model: 'hy3',
        messages: [
          {
            role: 'system',
            content: '你是记账分类助手。把用户的消费备注归到以下分类之一：' + CATEGORIES.join('、') + '。只输出分类名，不要任何解释或标点。'
          },
          { role: 'user', content: remark }
        ]
      })
      const c = (result.text || '').trim().replace(/[，。、\s]/g, '')
      finalCategory = CATEGORIES.includes(c) ? c : '其他'
    } catch (e) {
      console.error('AI 分类失败，回退默认', e.message)
      finalCategory = '其他'
    }
  }
  finalCategory = finalCategory || '其他'

  // 3. 写入数据库（云函数端需手动带 _openid，保证"仅创建者可读写"生效）
  const db = cloud.database()
  const data = {
    amount: Number(amount),
    category: finalCategory,
    title: title || '',
    accountId: accountId || '',
    merchant: merchant || '',
    itemName: itemName || '',
    remark: remark || '',
    rawText: rawText || remark || '',
    tags: Array.isArray(tags) ? tags : [],
    people: Array.isArray(people) ? people : [],
    relationship: relationship || '',
    socialAction: socialAction || '',
    occasion: occasion || '',
    memo: memo || '',
    date: date || chinaToday(),
    time: time || '',
    source: source || 'chat',
    _openid: OPENID,
    timezone: 'Asia/Shanghai',
    createdAt: db.serverDate()
  }
  const res = await db.collection('transactions').add({ data })

  return { success: true, _id: res._id, category: finalCategory, amount: Number(amount) }
}
