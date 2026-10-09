Page({
  data: { list: [], historyCount: 0,
    historyText: '', count: 0, totalMonthly: '0.00', loading: false },
  onShow() {
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null
    if (tabBar && tabBar.data.selected !== 3) tabBar.setData({ selected: 3 })
    this.loadList()
  },
  callService(action, data) {
    return wx.cloud.callFunction({ name: 'ledgerService', data: Object.assign({ action }, data || {}) }).then(res => res.result || {})
  },
  loadList() {
    this.setData({ loading: true })
    this.callService('subscriptions.list').then(res => {
      this.setData({ loading: false })
      if (!res.ok) return wx.showToast({ title: res.error || '订阅加载失败', icon: 'none' })
      const all = (res.list || []).map(item => Object.assign({}, item, { statusText: item.status === 'cancelled' ? '已取消' : '生效中', sourceText: item.source === 'chat' ? 'AI' : '手动' }))
      const active = all.filter(item => item.status !== 'cancelled')
      const history = all.filter(item => item.status === 'cancelled')
      this.setData({ list: active, historyCount: history.length, historyText: history.length ? '查看历史订阅（' + history.length + '）' : '', count: res.count || 0, totalMonthly: Number(res.totalMonthly || 0).toFixed(2) })
    }).catch(() => { this.setData({ loading: false }); wx.showToast({ title: '订阅加载失败', icon: 'none' }) })
  },
  addSubscription() { wx.navigateTo({ url: '/pages/subscription-edit/subscription-edit?mode=create' }) },
  openItem(e) { wx.navigateTo({ url: '/pages/subscription-edit/subscription-edit?mode=edit&id=' + e.currentTarget.dataset.id }) },
  cancelItem(e) {
    const id = e.currentTarget.dataset.id
    const name = e.currentTarget.dataset.name || '该订阅'
    wx.showModal({
      title: '取消订阅',
      content: '确认取消「' + name + '」吗？',
      confirmColor: '#D9534F',
      success: res => {
        if (!res.confirm) return
        this.callService('subscriptions.cancel', { recordId: id }).then(result => {
          if (!result.ok) return wx.showToast({ title: result.error || '取消失败', icon: 'none' })
          wx.showToast({ title: '已取消', icon: 'success' })
          this.loadList()
        })
      }
    })
  },
  openHistory() { wx.navigateTo({ url: '/pages/subscription-history/subscription-history' }) },
  renewItem(e) {
    const id = e.currentTarget.dataset.id
    const name = e.currentTarget.dataset.name || '该订阅'
    wx.showModal({ title: '确认续费', content: '确认「' + name + '」已经续费？续费后保留初次订阅时间，只更新下次扣费日期。', success: res => {
      if (!res.confirm) return
      this.callService('subscriptions.renew', { recordId: id }).then(result => {
        if (!result.ok) return wx.showToast({ title: result.error || '续费失败', icon: 'none' })
        wx.showToast({ title: '续费日期已更新', icon: 'success' })
        this.loadList()
      })
    } })
  },
  scan() { wx.showToast({ title: '自动识别扣费开发中', icon: 'none' }) }
})
