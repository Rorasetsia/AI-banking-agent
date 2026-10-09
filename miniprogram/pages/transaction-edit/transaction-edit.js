const CATEGORIES = ['餐饮', '交通', '购物', '娱乐', '居住', '医疗', '教育', '其他']
Page({
  data: {
    mode: 'create',
    recordId: '',
    ledgerId: '',
    categories: CATEGORIES,
    form: {
      direction: 'expense',
      amount: '',
      category: '餐饮',
      title: '',
      merchant: '',
      itemName: '',
      remark: '',
      rawText: '',
      tagsText: '',
      peopleText: '',
      relationship: '',
      socialAction: '',
      occasion: '',
      memo: '',
      date: '',
      time: ''
    }
  },
  onLoad(options) {
    const mode = options.mode === 'edit' ? 'edit' : 'create'
    this.setData({ mode, recordId: options.id || '', ledgerId: options.ledgerId || '' })
    if (mode === 'edit' && options.id) this.loadRecord(options.id)
    else this.setData({ 'form.date': this.today() })
  },
  today() {
    const d = new Date()
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  },
  callService(action, data) {
    return wx.cloud.callFunction({ name: 'ledgerService', data: Object.assign({ action }, data || {}) }).then(res => res.result || {})
  },
  loadRecord(id) {
    wx.showLoading({ title: '加载中' })
    this.callService('transactions.get', { recordId: id }).then(res => {
      wx.hideLoading()
      if (!res.ok) return wx.showToast({ title: res.error || '加载失败', icon: 'none' })
      const item = res.data
      this.setData({
        ledgerId: item.ledgerId || this.data.ledgerId,
        form: {
          direction: item.direction || (item.amount > 0 ? 'income' : 'expense'),
          amount: String(Math.abs(Number(item.amount) || 0)),
          category: item.category || '其他',
          title: item.title || '',
          merchant: item.merchant || '',
          itemName: item.itemName || '',
          remark: item.remark || '',
          rawText: item.rawText || '',
          tagsText: Array.isArray(item.tags) ? item.tags.join('，') : '',
          peopleText: Array.isArray(item.people) ? item.people.join('，') : '',
          relationship: item.relationship || '',
          socialAction: item.socialAction || '',
          occasion: item.occasion || '',
          memo: item.memo || '',
          date: item.date || this.today(),
          time: item.time || ''
        }
      })
    }).catch(() => { wx.hideLoading(); wx.showToast({ title: '加载失败', icon: 'none' }) })
  },
  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ ['form.' + field]: e.detail.value })
  },
  pickDirection(e) { this.setData({ 'form.direction': e.currentTarget.dataset.value }) },
  pickCategory(e) { this.setData({ 'form.category': this.data.categories[Number(e.detail.value)] }) },
  pickDate(e) { this.setData({ 'form.date': e.detail.value }) },
  pickTime(e) { this.setData({ 'form.time': e.detail.value }) },
  save() {
    const form = this.data.form
    const amount = Math.abs(Number(form.amount))
    if (!amount) return wx.showToast({ title: '请输入金额', icon: 'none' })
    const tags = Array.from(new Set(String(form.tagsText || '').split(/[，,]/).map(x => x.trim()).filter(Boolean))).slice(0, 8)
    const people = String(form.peopleText || '').split(/[，,]/).map(x => x.trim()).filter(Boolean)
    const payload = {
      direction: form.direction,
      amount,
      category: form.category,
      title: form.title,
      merchant: form.merchant,
      itemName: form.itemName,
      remark: form.remark,
      rawText: form.rawText || form.remark,
      tags,
      people,
      relationship: form.relationship,
      socialAction: form.socialAction,
      occasion: form.occasion,
      memo: form.memo,
      date: form.date,
      time: form.time,
      ledgerId: this.data.ledgerId
    }
    if (this.data.mode === 'edit') payload.recordId = this.data.recordId
    const action = this.data.mode === 'edit' ? 'transactions.update' : 'transactions.create'
    wx.showLoading({ title: '保存中' })
    this.callService(action, payload).then(res => {
      wx.hideLoading()
      if (!res.ok) return wx.showToast({ title: res.error || '保存失败', icon: 'none' })
      wx.showToast({ title: '已保存', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 500)
    }).catch(() => { wx.hideLoading(); wx.showToast({ title: '保存失败', icon: 'none' }) })
  },
  remove() {
    if (this.data.mode !== 'edit') return
    wx.showModal({
      title: '删除记录',
      content: '删除后无法恢复，确认删除吗？',
      confirmColor: '#D9534F',
      success: res => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中' })
        this.callService('transactions.delete', { recordId: this.data.recordId }).then(result => {
          wx.hideLoading()
          if (!result.ok) return wx.showToast({ title: result.error || '删除失败', icon: 'none' })
          wx.showToast({ title: '已删除', icon: 'success' })
          setTimeout(() => wx.navigateBack(), 500)
        }).catch(() => { wx.hideLoading(); wx.showToast({ title: '删除失败', icon: 'none' }) })
      }
    })
  }
})
