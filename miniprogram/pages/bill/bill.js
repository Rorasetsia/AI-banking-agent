const CATEGORIES = ['全部分类', '餐饮', '交通', '购物', '娱乐', '居住', '医疗', '教育', '其他']
Page({
  data: {
    tab: 'personal',
    viewDate: '',
    viewDateLabel: '',
    today: '',
    monthExpense: '0.00',
    monthCount: 0,
    budgetMonth: '',
    budgetDay: '',
    categoryBudgets: [],
    categories: CATEGORIES,
    categoryIndex: 0,
    category: '',
    keyword: '',
    loading: false,
    list: [],
    expense: '0.00',
    income: '0.00',
    total: 0,
    sharedLedger: null,
    hasShared: false,
    inviteInput: '',
    memberText: '',
    relationshipText: ''
  },
  onLoad(options) {
    const date = options.date || this.today()
    this.setData({ viewDate: date, viewDateLabel: this.formatDate(date), today: this.today() })
    if (options.inviteCode) this.joinLedger(options.inviteCode)
  },
  onShow() {
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null
    if (tabBar && tabBar.data.selected !== 1) tabBar.setData({ selected: 1 })
    const refreshDate = wx.getStorageSync('billRefreshDate')
    const refreshLedgerId = wx.getStorageSync('billRefreshLedgerId')
    const savedDate = wx.getStorageSync('billHistoryDate')
    if (refreshDate) {
      wx.removeStorageSync('billRefreshDate')
      this.setData({ viewDate: refreshDate, viewDateLabel: this.formatDate(refreshDate) })
    } else if (savedDate) {
      wx.removeStorageSync('billHistoryDate')
      this.setData({ viewDate: savedDate, viewDateLabel: this.formatDate(savedDate) })
    }
    if (refreshLedgerId) {
      wx.removeStorageSync('billRefreshLedgerId')
      this.setData({ tab: 'shared' }, () => this.loadData())
    } else {
      wx.removeStorageSync('billRefreshLedgerId')
      this.setData({ tab: 'personal' }, () => this.loadData())
    }
  },
  today() {
    const d = new Date()
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  },
  formatDate(date) {
    const parts = String(date || '').split('-')
    return parts.length === 3 ? parts[0] + '年' + Number(parts[1]) + '月' + Number(parts[2]) + '日' : '今天'
  },
  formatMonth(month) {
    const parts = String(month || '').split('-')
    return parts.length >= 2 ? parts[0] + '年' + Number(parts[1]) + '月' : '本月'
  },
  callService(action, data) {
    return wx.cloud.callFunction({ name: 'ledgerService', data: Object.assign({ action }, data || {}) }).then(res => res.result || {})
  },
  loadData() {
    if (this.data.tab === 'shared') this.loadSharedLedger()
    else this.loadTransactions()
  },
  loadSharedLedger() {
    this.callService('ledgers.list').then(res => {
      const ledger = res.ok && res.list && res.list[0] ? res.list[0] : null
      this.setData({ sharedLedger: ledger, hasShared: !!ledger, memberText: ledger ? '成员 ' + ((ledger.members || []).length) + ' 人' : '', relationshipText: ledger && ledger.relationship ? ledger.relationship : '未设置关系' })
      if (ledger) this.loadTransactions(ledger._id)
      else this.setData({ list: [], total: 0, expense: '0.00', income: '0.00' })
    }).catch(() => wx.showToast({ title: '共同账本加载失败', icon: 'none' }))
  },
  loadTransactions(ledgerId) {
    const startDate = this.data.viewDate
    const endDate = this.data.viewDate
    this.setData({ loading: true })
    this.callService('transactions.list', {
      ledgerId: ledgerId || '',
      startDate,
      endDate,
      category: this.data.category,
      keyword: this.data.keyword,
      limit: 500
    }).then(res => {
      this.setData({ loading: false })
      if (!res.ok) return wx.showToast({ title: res.error || '账单加载失败', icon: 'none' })
      const list = (res.list || []).map(item => Object.assign({}, item, {
        amountText: item.amount > 0 ? '+' + item.amount.toFixed(2) : '-' + Math.abs(item.amount).toFixed(2),
        sourceText: item.source === 'chat' ? 'AI' : '手动',
        contextText: [item.socialAction, item.relationship, (item.people || []).join('，')].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(' · ')
      }))
      this.setData({ list, total: res.total || 0, expense: Number(res.expense || 0).toFixed(2), income: Number(res.income || 0).toFixed(2) })
      this.loadMonthSummary(ledgerId || '')
      this.loadBudgets()
    }).catch(() => { this.setData({ loading: false }); wx.showToast({ title: '账单加载失败', icon: 'none' }) })
  },
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ tab })
    this.loadData()
  },
  loadMonthSummary(ledgerId) {
    const month = this.data.viewDate.slice(0, 7)
    const end = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)
    const endDate = end.getFullYear() + '-' + String(end.getMonth() + 1).padStart(2, '0') + '-' + String(end.getDate()).padStart(2, '0')
    this.callService('transactions.list', { ledgerId: ledgerId || '', startDate: month + '-01', endDate, limit: 1000 }).then(res => {
      if (res.ok) this.setData({ monthExpense: Number(res.expense || 0).toFixed(2), monthCount: res.total || 0 })
    })
  },
  loadBudgets() {
    this.callService('budgets.list').then(res => {
      if (!res.ok) return
      const total = res.total || null
      const categories = (res.categories || []).map(item => Object.assign({}, item, {
        monthlyText: Number(item.monthlyAmount || item.amount || 0).toFixed(2),
        dailyText: Number(item.dailyAmount || 0).toFixed(2)
      }))
      this.setData({
        budgetMonth: total ? Number(total.monthlyAmount || total.amount || 0).toFixed(2) : '',
        budgetDay: total ? Number(total.dailyAmount || 0).toFixed(2) : '',
        categoryBudgets: categories
      })
    })
  },
  editBudget(e) {
    const period = e.currentTarget.dataset.period
    const current = period === 'day' ? this.data.budgetDay : this.data.budgetMonth
    wx.showModal({ title: period === 'day' ? '设置日预算' : '设置月预算', editable: true, placeholderText: '请输入预算金额', content: current || '', confirmText: '保存', success: res => {
      if (!res.confirm) return
      const amount = Number(res.content)
      if (!amount || amount <= 0) return wx.showToast({ title: '请输入有效金额', icon: 'none' })
      this.callService('budgets.set', { month: this.data.viewDate.slice(0, 7), type: 'total', period, amount }).then(result => {
        if (!result.ok) return wx.showToast({ title: result.error || '保存失败', icon: 'none' })
        wx.showToast({ title: '预算已保存：月 ¥' + result.monthlyAmount + ' / 日 ¥' + result.dailyAmount, icon: 'none' })
        this.loadBudgets()
      })
    } })
  },
  openBudgetGoals() { wx.navigateTo({ url: '/pages/budget-goals/budget-goals' }) },
  addCategoryBudget() {
    wx.showModal({ title: '分类预算', editable: true, placeholderText: '请输入分类，例如 餐饮', confirmText: '下一步', success: res => {
      if (!res.confirm) return
      const category = (res.content || '').trim()
      if (!category) return wx.showToast({ title: '请输入分类', icon: 'none' })
      wx.showModal({ title: category + '月预算', editable: true, placeholderText: '请输入每月金额', confirmText: '保存', success: amountRes => {
        if (!amountRes.confirm) return
        const amount = Number(amountRes.content)
        if (!amount || amount <= 0) return wx.showToast({ title: '请输入有效金额', icon: 'none' })
        this.callService('budgets.set', { month: this.data.viewDate.slice(0, 7), type: 'category', category, period: 'month', amount }).then(result => {
          if (!result.ok) return wx.showToast({ title: result.error || '保存失败', icon: 'none' })
          wx.showToast({ title: '分类预算已保存', icon: 'success' })
          this.loadBudgets()
        })
      } })
    } })
  },
  editCategoryBudget(e) {
    const item = this.data.categoryBudgets[e.currentTarget.dataset.index]
    if (!item) return
    wx.showModal({ title: item.category + '月预算', editable: true, content: String(item.monthlyAmount || item.amount || ''), placeholderText: '请输入每月金额', confirmText: '保存', success: res => {
      if (!res.confirm) return
      const amount = Number(res.content)
      if (!amount || amount <= 0) return wx.showToast({ title: '请输入有效金额', icon: 'none' })
      this.callService('budgets.set', { month: this.data.viewDate.slice(0, 7), type: 'category', category: item.category, period: 'month', amount }).then(result => {
        if (!result.ok) return wx.showToast({ title: result.error || '保存失败', icon: 'none' })
        wx.showToast({ title: '已更新', icon: 'success' })
        this.loadBudgets()
      })
    } })
  },
  deleteCategoryBudget(e) {
    const item = this.data.categoryBudgets[e.currentTarget.dataset.index]
    if (!item) return
    wx.showModal({ title: '删除分类预算', content: '确认删除' + item.category + '预算吗？', confirmColor: '#D9534F', success: res => {
      if (!res.confirm) return
      this.callService('budgets.delete', { recordId: item._id }).then(result => {
        if (!result.ok) return wx.showToast({ title: result.error || '删除失败', icon: 'none' })
        wx.showToast({ title: '已删除', icon: 'success' })
        this.loadBudgets()
      })
    } })
  },
  onDateChange(e) { const viewDate = e.detail.value; this.setData({ viewDate, viewDateLabel: this.formatDate(viewDate) }, () => this.loadTransactions(this.data.sharedLedger && this.data.sharedLedger._id)) },
  openHistory() { wx.navigateTo({ url: '/pages/history-calendar/history-calendar' }) },
  onCategoryChange(e) { const index = Number(e.detail.value); this.setData({ categoryIndex: index, category: index ? CATEGORIES[index] : '' }, () => this.loadTransactions(this.data.sharedLedger && this.data.sharedLedger._id)) },
  onKeywordInput(e) { this.setData({ keyword: e.detail.value }) },
  search() { this.loadTransactions(this.data.sharedLedger && this.data.sharedLedger._id) },
  addTransaction() {
    const ledgerId = this.data.tab === 'shared' && this.data.sharedLedger ? this.data.sharedLedger._id : ''
    wx.navigateTo({ url: '/pages/transaction-edit/transaction-edit?mode=create&ledgerId=' + ledgerId })
  },
  openItem(e) { wx.navigateTo({ url: '/pages/transaction-edit/transaction-edit?mode=edit&id=' + e.currentTarget.dataset.id }) },
  createLedger() {
    wx.showLoading({ title: '创建中' })
    this.callService('ledgers.create').then(res => {
      wx.hideLoading()
      if (!res.ok) return wx.showToast({ title: res.error || '创建失败', icon: 'none' })
      this.setData({ sharedLedger: res.ledger, hasShared: true, tab: 'shared' }, () => this.loadData())
      wx.showToast({ title: '共同账本已创建', icon: 'success' })
    }).catch(() => { wx.hideLoading(); wx.showToast({ title: '创建失败', icon: 'none' }) })
  },
  onInviteInput(e) { this.setData({ inviteInput: e.detail.value }) },
  joinByCode() { const code = this.data.inviteInput.trim().toUpperCase(); if (!code) return wx.showToast({ title: '请输入邀请码', icon: 'none' }); this.joinLedger(code) },
  setRelationship() {
    const current = this.data.sharedLedger && this.data.sharedLedger.relationship || ''
    wx.showModal({ title: '设置共同账本关系', editable: true, placeholderText: '例如 家庭、情侣、朋友、室友', content: current, confirmText: '保存', success: res => {
      if (!res.confirm) return
      const relationship = (res.content || '').trim()
      if (!relationship) return wx.showToast({ title: '请输入关系', icon: 'none' })
      this.callService('ledgers.update', { ledgerId: this.data.sharedLedger._id, relationship }).then(result => {
        if (!result.ok) return wx.showToast({ title: result.error || '设置失败', icon: 'none' })
        this.setData({ relationshipText: relationship })
        wx.showToast({ title: '关系已保存', icon: 'success' })
      })
    } })
  },
  leaveLedger() {
    const ledger = this.data.sharedLedger
    if (!ledger) return
    wx.showModal({ title: '退出共同账本', content: '退出后将无法继续查看该共同账本，确认退出吗？', confirmColor: '#D9534F', success: res => {
      if (!res.confirm) return
      this.callService('ledgers.leave', { ledgerId: ledger._id }).then(result => {
        if (!result.ok) return wx.showToast({ title: result.error || '退出失败', icon: 'none' })
        this.setData({ tab: 'personal', sharedLedger: null, hasShared: false, relationshipText: '', memberText: '' }, () => this.loadData())
        wx.showToast({ title: '已退出共同账本', icon: 'success' })
      })
    } })
  },
  copyCode() {
    if (!this.data.sharedLedger) return
    wx.setClipboardData({ data: this.data.sharedLedger.inviteCode, success: () => wx.showToast({ title: '邀请码已复制', icon: 'success' }) })
  },
  joinLedger(inviteCode) {
    this.callService('ledgers.join', { inviteCode }).then(res => {
      if (!res.ok) return wx.showModal({ title: '加入失败', content: res.error || '邀请码无效', showCancel: false })
      wx.showToast({ title: '已加入共同账本', icon: 'success' })
      this.setData({ tab: 'shared' }, () => this.loadData())
    })
  },
  onShareAppMessage() {
    const ledger = this.data.sharedLedger
    return {
      title: ledger ? '邀请你加入共同账本，邀请码：' + ledger.inviteCode : '邀请你加入共同账本',
      path: ledger ? '/pages/bill/bill?inviteCode=' + ledger.inviteCode : '/pages/bill/bill'
    }
  }
})
