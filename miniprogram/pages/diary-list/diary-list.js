Page({
  data: { list: [], loading: false },
  onShow() { this.loadList() },
  loadList() {
    this.setData({ loading: true })
    wx.cloud.callFunction({ name: 'generateDiary', data: { action: 'diaries.list' } }).then(res => {
      const result = res.result || {}
      const list = (result.list || []).map(item => Object.assign({}, item, { excerpt: String(item.content || '').slice(0, 72) }))
      this.setData({ list, loading: false })
    }).catch(() => { this.setData({ loading: false }); wx.showToast({ title: '日记加载失败', icon: 'none' }) })
  },
  openDiary(e) { wx.navigateTo({ url: '/pages/diary-detail/diary-detail?date=' + e.currentTarget.dataset.date }) }
})
