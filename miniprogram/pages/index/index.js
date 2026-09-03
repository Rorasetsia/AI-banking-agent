Page({
  data: {
    todayExpense: '0.00',
    todayIncome: '0.00',
    moods: ['很开心', '开心', '平静', '心情一般', '难过'],
    morning: '', noon: '', night: ''
  },
  onLoad() {
    // TODO: 拉取今日账目概览 + 今日已选心情
  },
  today() {
    const d = new Date()
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  },
  pickMood(e) {
    const { period, mood } = e.currentTarget.dataset
    this.setData({ [period]: mood })
    wx.cloud.callFunction({ name: 'addMood', data: { period, mood, date: this.today() } })
      .then(() => wx.showToast({ title: '心情已记录', icon: 'success' }))
      .catch(() => wx.showToast({ title: '保存失败', icon: 'none' }))
  },
  goChat() { wx.switchTab({ url: '/pages/chat/chat' }) },
  goDiary() {
    wx.showLoading({ title: '生成日记中' })
    wx.cloud.callFunction({ name: 'generateDiary', data: {} })
      .then(res => {
        wx.hideLoading()
        const r = res.result || {}
        wx.showModal({ title: '今日日记', content: r.diary || '暂无', showCancel: false, confirmText: '好的' })
      })
      .catch(() => { wx.hideLoading(); wx.showToast({ title: '生成失败', icon: 'none' }) })
  }
})