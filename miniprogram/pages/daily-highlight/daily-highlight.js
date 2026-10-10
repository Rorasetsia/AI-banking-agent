Page({
  data: {
    date: '',
    displayDate: '',
    highlight: '',
    originalHighlight: '',
    count: 0,
    maxLength: 120,
    saving: false,
    loading: true
  },
  onLoad(options) {
    const date = options.date || this.today()
    this.setData({ date, displayDate: this.formatDate(date) })
    this.loadHighlight(date)
  },
  today() {
    const d = new Date(Date.now() + 8 * 60 * 60 * 1000)
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0')
  },
  formatDate(date) {
    const parts = String(date || '').split('-')
    if (parts.length !== 3) return date
    return parts[0] + '年' + Number(parts[1]) + '月' + Number(parts[2]) + '日'
  },
  loadHighlight(date) {
    wx.showLoading({ title: '加载中' })
    wx.cloud.callFunction({ name: 'generateDiary', data: { action: 'diaries.peek', date } }).then(res => {
      wx.hideLoading()
      const diary = (res.result || {}).diary || {}
      const highlight = String(diary.highlight || '')
      this.setData({ highlight, originalHighlight: highlight, count: highlight.length, loading: false })
    }).catch(() => {
      wx.hideLoading()
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    })
  },
  onInput(e) {
    const highlight = String(e.detail.value || '').slice(0, this.data.maxLength)
    this.setData({ highlight, count: highlight.length })
  },
  save() {
    const highlight = this.data.highlight.trim()
    if (!highlight) return wx.showToast({ title: '先写下一句话吧', icon: 'none' })
    if (highlight === this.data.originalHighlight) return wx.showToast({ title: '暂时没有修改', icon: 'none' })
    this.persist(highlight, '已保存')
  },
  clearHighlight() {
    if (!this.data.originalHighlight) return
    wx.showModal({
      title: '清空今日大事记',
      content: '清空后，这条记录会从今天的大事记中移除。确认继续吗？',
      confirmColor: '#D9534F',
      success: res => {
        if (!res.confirm) return
        this.persist('', '已清空')
      }
    })
  },
  persist(highlight, successTitle) {
    if (this.data.saving) return
    this.setData({ saving: true })
    wx.cloud.callFunction({ name: 'generateDiary', data: { action: 'diaries.highlight', date: this.data.date, highlight } }).then(res => {
      const result = res.result || {}
      if (!result.ok) throw new Error(result.error || '保存失败')
      this.setData({ saving: false, highlight, originalHighlight: highlight, count: highlight.length })
      wx.showToast({ title: successTitle, icon: 'success' })
      setTimeout(() => wx.navigateBack(), 450)
    }).catch(() => {
      this.setData({ saving: false })
      wx.showToast({ title: '保存失败，请稍后重试', icon: 'none' })
    })
  },
  goBack() {
    if (this.data.saving) return
    wx.navigateBack()
  }
})
