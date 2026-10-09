const DOCS = {
  privacy: {
    title: '隐私政策',
    sections: [
      { title: '1. 收集的信息', text: '我们会在用户主动使用服务时收集微信 OpenID、账户信息、交易记录、订阅记录、预算、心情、日记以及用户主动上传的内容。' },
      { title: '2. 使用目的', text: '上述信息用于提供记账、账单查询、预算管理、订阅提醒、情绪记录、日记生成和 AI 助手服务。' },
      { title: '3. AI 处理', text: '用户主动发送的文字和相关账目数据可能发送到云开发 AI 模型，用于意图识别、分类、摘要和日记润色。我们不会基于这些数据自行进行心理判断。' },
      { title: '4. 存储与安全', text: '数据保存在微信云开发环境中，并通过用户 OpenID 和权限规则进行隔离。请妥善保管设备和微信账号。' },
      { title: '5. 共享与披露', text: '除法律要求或为用户提供服务所必需外，我们不会向无关第三方出售或公开用户的个人财务数据。' },
      { title: '6. 用户权利', text: '用户可以在账单、订阅、日记和设置页面查看、修改或删除自己的记录，也可以停止使用服务。' },
      { title: '7. 联系我们', text: '如对隐私或数据处理有疑问，请通过项目协作者提供的联系方式联系开发团队。' }
    ]
  },
  agreement: {
    title: '用户协议',
    sections: [
      { title: '1. 服务内容', text: '本产品提供记账、预算、订阅整理、情绪记录、日记生成和 AI 财务助手服务。' },
      { title: '2. 非金融建议', text: '本产品提供的是信息整理和朋友式提示，不构成投资、信贷、保险或法律建议。' },
      { title: '3. 用户责任', text: '用户应确保录入信息真实、合法，并自行判断是否采用 AI 生成的建议或文字。' },
      { title: '4. 数据与内容', text: '用户保留其输入内容的所有权。系统仅为了提供和优化服务处理相关数据。' },
      { title: '5. 服务变更', text: '开发团队可能根据比赛、审核或技术需要更新功能和协议，重大变化会通过页面提示。' },
      { title: '6. 联系我们', text: '使用过程中如有问题，请通过项目协作者提供的联系方式联系开发团队。' }
    ]
  }
}
Page({
  data: { type: 'accounts', docType: 'privacy', title: '', description: '', sections: [] },
  onLoad(options) {
    const type = options.type || 'accounts'
    const map = { accounts: ['账户与支付方式', '在这里管理常用支付方式和账户，后续会与账单归属联动。'], preferences: ['分类偏好', '可以在这里维护常用分类和 AI 分类纠正规则。'], privacy: ['隐私与协议', '请阅读以下数据处理说明和用户使用规则。'] }
    const item = map[type] || map.accounts
    this.setData({ type, title: item[0], description: item[1] })
    if (type === 'privacy') this.applyDoc('privacy')
    wx.setNavigationBarTitle({ title: item[0] })
  },
  applyDoc(docType) { const doc = DOCS[docType]; this.setData({ docType, sections: doc.sections }) },
  switchDoc(e) { this.applyDoc(e.currentTarget.dataset.doc) }
})
