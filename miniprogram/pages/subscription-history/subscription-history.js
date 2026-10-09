Page({
  data: { list: [], loading: false },
  onLoad() { this.loadList() },
  onShow() { this.loadList() },
  loadList() {
    this.setData({ loading: true })
    wx.cloud.callFunction({ name: 'ledgerService', data: { action: 'subscriptions.list' } }).then(res => {
      const result = res.result || {}
      const list = (result.list || []).filter(item => item.status === 'cancelled').map(item => Object.assign({}, item, { sourceText: item.source === 'chat' ? 'AI' : '手动' }))
      this.setData({ list, loading: false })
    }).catch(() => { this.setData({ loading: false }); wx.showToast({ title: '历史订阅加载失败', icon: 'none' }) })
  }
})
