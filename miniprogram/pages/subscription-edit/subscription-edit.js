Page({
  data: {
    mode: 'create',
    recordId: '',
    cycles: ['monthly', 'yearly', 'weekly'],
    cycleLabels: ['每月', '每年', '每周'],
    cycleIndex: 0,
    form: {
      name: '',
      merchant: '',
      amount: '',
      cycle: 'monthly',
      startDate: '',
      nextDate: '',
      status: 'active',
      autoRenew: true,
      notes: '',
      tagsText: ''
    }
  },
  onLoad(options) {
    const mode = options.mode === 'edit' ? 'edit' : 'create'
    this.setData({ mode, recordId: options.id || '' })
    if (mode === 'edit' && options.id) this.loadRecord(options.id)
    else this.setData({ 'form.startDate': this.today() })
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
    this.callService('subscriptions.list').then(res => {
      wx.hideLoading()
      const item = res.ok && (res.list || []).find(x => x._id === id)
      if (!item) return wx.showToast({ title: '订阅不存在', icon: 'none' })
      const cycleIndex = Math.max(0, this.data.cycles.indexOf(item.cycle || 'monthly'))
      this.setData({
        cycleIndex,
        form: {
          name: item.name || '',
          merchant: item.merchant || '',
          amount: String(item.amount || ''),
          cycle: item.cycle || 'monthly',
          startDate: item.startDate || '',
          nextDate: item.nextDate || '',
          status: item.status || 'active',
          autoRenew: item.autoRenew !== false,
          notes: item.notes || '',
          tagsText: Array.isArray(item.tags) ? item.tags.join('，') : ''
        }
      })
    }).catch(() => { wx.hideLoading(); wx.showToast({ title: '加载失败', icon: 'none' }) })
  },
  onInput(e) { this.setData({ ['form.' + e.currentTarget.dataset.field]: e.detail.value }) },
  onCycleChange(e) { const i = Number(e.detail.value); this.setData({ cycleIndex: i, 'form.cycle': this.data.cycles[i] }) },
  onStatusChange(e) { this.setData({ 'form.status': e.detail.value ? 'active' : 'cancelled' }) },
  onAutoRenewChange(e) { this.setData({ 'form.autoRenew': e.detail.value }) },
  pickStartDate(e) { this.setData({ 'form.startDate': e.detail.value }) },
  pickNextDate(e) { this.setData({ 'form.nextDate': e.detail.value }) },
  save() {
    const form = this.data.form
    if (!form.name.trim()) return wx.showToast({ title: '请输入订阅名称', icon: 'none' })
    if (!Number(form.amount)) return wx.showToast({ title: '请输入有效金额', icon: 'none' })
    const payload = {
      name: form.name.trim(),
      merchant: form.merchant,
      amount: Number(form.amount),
      cycle: form.cycle,
      startDate: form.startDate,
      nextDate: form.nextDate,
      status: form.status,
      autoRenew: form.autoRenew,
      notes: form.notes,
      tags: String(form.tagsText || '').split(/[，,]/).map(x => x.trim()).filter(Boolean)
    }
    if (this.data.mode === 'edit') payload.recordId = this.data.recordId
    const action = this.data.mode === 'edit' ? 'subscriptions.update' : 'subscriptions.create'
    wx.showLoading({ title: '保存中' })
    this.callService(action, payload).then(res => {
      wx.hideLoading()
      if (!res.ok) return wx.showToast({ title: res.error || '保存失败', icon: 'none' })
      wx.showToast({ title: '已保存', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 500)
    }).catch(() => { wx.hideLoading(); wx.showToast({ title: '保存失败', icon: 'none' }) })
  },
  cancel() {
    if (this.data.mode !== 'edit') return
    wx.showModal({
      title: '取消订阅',
      content: '确认取消这个订阅吗？',
      confirmColor: '#D9534F',
      success: res => {
        if (!res.confirm) return
        this.callService('subscriptions.cancel', { recordId: this.data.recordId }).then(result => {
          if (!result.ok) return wx.showToast({ title: result.error || '取消失败', icon: 'none' })
          wx.showToast({ title: '已取消', icon: 'success' })
          setTimeout(() => wx.navigateBack(), 500)
        })
      }
    })
  }
})
