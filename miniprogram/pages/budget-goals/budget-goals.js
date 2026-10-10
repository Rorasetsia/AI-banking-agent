Page({
  data: {
    tab: 'budget',
    budgetScope: 'personal',
    month: '',
    total: null,
    categories: [],
    goals: [],
    ledgers: [],
    ledgerIndex: 0,
    selectedLedger: null,
    initialLedgerId: '',
    loading: false
  },
  onLoad(options) {
    const d = new Date()
    this.setData({
      month: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'),
      budgetScope: options.scope === 'shared' ? 'shared' : 'personal',
      initialLedgerId: options.ledgerId || ''
    })
  },
  onShow() { this.loadAll() },
  callService(action, data) {
    return wx.cloud.callFunction({ name: 'ledgerService', data: Object.assign({ action }, data || {}) }).then(res => res.result || {})
  },
  loadAll() {
    this.loadLedgers().then(() => {
      this.loadBudgets()
      this.loadGoals()
    })
  },
  loadLedgers() {
    return this.callService('ledgers.list').then(res => {
      const ledgers = res.ok ? (res.list || []) : []
      let ledgerIndex = this.data.ledgerIndex
      let selectedLedger = this.data.initialLedgerId ? ledgers.find(item => item._id === this.data.initialLedgerId) : null
      selectedLedger = selectedLedger || ledgers[ledgerIndex] || ledgers[0] || null
      ledgerIndex = selectedLedger ? ledgers.findIndex(item => item._id === selectedLedger._id) : 0
      const budgetScope = this.data.budgetScope === 'shared' && !selectedLedger ? 'personal' : this.data.budgetScope
      this.setData({ ledgers, ledgerIndex: ledgerIndex < 0 ? 0 : ledgerIndex, selectedLedger, budgetScope, initialLedgerId: '' })
    }).catch(() => this.setData({ ledgers: [], selectedLedger: null, budgetScope: 'personal' }))
  },
  currentLedgerId() {
    return this.data.budgetScope === 'shared' && this.data.selectedLedger ? this.data.selectedLedger._id : ''
  },
  switchBudgetScope(e) {
    const budgetScope = e.currentTarget.dataset.scope
    if (budgetScope === 'shared' && !this.data.selectedLedger && this.data.ledgers.length) {
      const selectedLedger = this.data.ledgers[0]
      this.setData({ budgetScope, selectedLedger, ledgerIndex: 0 }, () => this.loadBudgets())
      return
    }
    this.setData({ budgetScope }, () => this.loadBudgets())
  },
  onLedgerChange(e) {
    const ledgerIndex = Number(e.detail.value) || 0
    this.setData({ ledgerIndex, selectedLedger: this.data.ledgers[ledgerIndex] || null }, () => this.loadBudgets())
  },
  loadBudgets() {
    if (this.data.budgetScope === 'shared' && !this.data.selectedLedger) {
      this.setData({ total: null, categories: [] })
      return
    }
    this.callService('budgets.list', { month: this.data.month, ledgerId: this.currentLedgerId() }).then(res => {
      if (!res.ok) return
      const total = res.total ? Object.assign({}, res.total, {
        monthlyText: Number(res.total.monthlyAmount || res.total.amount || 0).toFixed(2),
        dailyText: Number(res.total.dailyAmount || 0).toFixed(2),
        reminderThreshold: Number(res.total.reminderThreshold || 80)
      }) : null
      const categories = (res.categories || []).map(item => Object.assign({}, item, {
        monthlyText: Number(item.monthlyAmount || item.amount || 0).toFixed(2),
        dailyText: Number(item.dailyAmount || 0).toFixed(2),
        reminderThreshold: Number(item.reminderThreshold || 80)
      }))
      this.setData({ total, categories })
    })
  },
  loadGoals() {
    this.callService('goals.list').then(res => {
      if (res.ok) this.setData({ goals: (res.list || []).map(g => Object.assign({}, g, { progress: g.targetAmount ? Math.min(100, Math.round(Number(g.savedAmount || 0) / Number(g.targetAmount) * 100)) : 0 })) })
    })
  },
  switchTab(e) { this.setData({ tab: e.currentTarget.dataset.tab }) },
  goBill() { wx.switchTab({ url: '/pages/bill/bill' }) },
  editTotal(e) {
    const period = e.currentTarget.dataset.period
    const current = this.data.total && (period === 'day' ? this.data.total.dailyAmount : this.data.total.monthlyAmount)
    wx.showModal({ title: period === 'day' ? '设置日预算' : '设置月预算', editable: true, content: current ? String(current) : '', placeholderText: '请输入金额', success: res => {
      if (!res.confirm) return
      const amount = Number(res.content)
      if (!amount || amount <= 0) return wx.showToast({ title: '金额无效', icon: 'none' })
      this.callService('budgets.set', { month: this.data.month, ledgerId: this.currentLedgerId(), type: 'total', period, amount }).then(result => {
        if (!result.ok) return wx.showToast({ title: result.error || '保存失败', icon: 'none' })
        wx.showToast({ title: '月 ¥' + result.monthlyAmount + ' / 日 ¥' + result.dailyAmount, icon: 'none' })
        this.loadBudgets()
      })
    } })
  },
  addCategory() {
    if (this.data.budgetScope === 'shared' && !this.data.selectedLedger) return wx.showToast({ title: '请先创建共同账本', icon: 'none' })
    wx.showModal({ title: '分类预算', editable: true, placeholderText: '分类名称，例如 餐饮', success: r1 => {
      if (!r1.confirm || !r1.content.trim()) return
      const category = r1.content.trim()
      wx.showModal({ title: category + '月预算', editable: true, placeholderText: '每月金额', success: r2 => {
        if (!r2.confirm) return
        const amount = Number(r2.content)
        if (!amount || amount <= 0) return wx.showToast({ title: '金额无效', icon: 'none' })
        this.callService('budgets.set', { month: this.data.month, ledgerId: this.currentLedgerId(), type: 'category', category, period: 'month', amount }).then(result => {
          if (!result.ok) return wx.showToast({ title: result.error || '保存失败', icon: 'none' })
          this.loadBudgets()
        })
      } })
    } })
  },
  editCategory(e) {
    const item = this.data.categories[e.currentTarget.dataset.index]
    wx.showModal({ title: item.category + '月预算', editable: true, content: String(item.monthlyAmount || item.amount), success: res => {
      if (!res.confirm) return
      const amount = Number(res.content)
      if (!amount || amount <= 0) return
      this.callService('budgets.set', { month: this.data.month, ledgerId: this.currentLedgerId(), type: 'category', category: item.category, period: 'month', amount }).then(result => {
        if (!result.ok) return wx.showToast({ title: result.error || '保存失败', icon: 'none' })
        this.loadBudgets()
      })
    } })
  },
  editThreshold(e) {
    const index = e.currentTarget.dataset.index
    const item = index === 'total' ? this.data.total : this.data.categories[Number(index)]
    if (!item) return
    const type = index === 'total' ? 'total' : 'category'
    const category = type === 'category' ? item.category : '全部'
    wx.showModal({ title: '预算提醒阈值', editable: true, content: String(item.reminderThreshold || 80), placeholderText: '请输入 1-100 的整数', success: res => {
      if (!res.confirm) return
      const reminderThreshold = Number(res.content)
      if (!reminderThreshold || reminderThreshold < 1 || reminderThreshold > 100) return wx.showToast({ title: '请输入 1-100', icon: 'none' })
      this.callService('budgets.set', {
        month: this.data.month,
        ledgerId: this.currentLedgerId(),
        type,
        category,
        period: item.period || 'month',
        amount: item.amount,
        reminderThreshold
      }).then(result => {
        if (!result.ok) return wx.showToast({ title: result.error || '保存失败', icon: 'none' })
        wx.showToast({ title: '提醒阈值已设为 ' + reminderThreshold + '%', icon: 'none' })
        this.loadBudgets()
      })
    } })
  },
  deleteCategory(e) {
    const item = this.data.categories[e.currentTarget.dataset.index]
    wx.showModal({ title: '删除预算', content: '确认删除' + item.category + '预算？', confirmColor: '#D9534F', success: res => {
      if (res.confirm) this.callService('budgets.delete', { recordId: item._id, ledgerId: this.currentLedgerId() }).then(() => this.loadBudgets())
    } })
  },
  addGoal() { this.showGoalModal({ name: '', targetAmount: '', savedAmount: '', deadline: '' }, false) },
  editGoal(e) { const goal = this.data.goals[e.currentTarget.dataset.index]; this.showGoalModal(goal, true) },
  showGoalModal(goal, edit) {
    wx.showModal({ title: edit ? '编辑攒钱目标' : '新建攒钱目标', editable: true, content: goal.name || '', placeholderText: '目标名称，例如 旅行基金', success: r1 => {
      if (!r1.confirm || !r1.content.trim()) return
      const name = r1.content.trim()
      wx.showModal({ title: '目标金额', editable: true, content: goal.targetAmount ? String(goal.targetAmount) : '', placeholderText: '目标金额', success: r2 => {
        if (!r2.confirm || !Number(r2.content)) return
        const targetAmount = Number(r2.content)
        wx.showModal({ title: '已存金额', editable: true, content: goal.savedAmount ? String(goal.savedAmount) : '', placeholderText: '已存金额，可填 0', success: r3 => {
          if (!r3.confirm) return
          const savedAmount = Number(r3.content) || 0
          wx.showModal({ title: '截止日期', editable: true, content: goal.deadline || '', placeholderText: 'YYYY-MM-DD，可留空', success: r4 => {
            if (!r4.confirm) return
            const payload = { name, targetAmount, savedAmount, deadline: r4.content || '' }
            if (edit) payload.recordId = goal._id
            this.callService(edit ? 'goals.update' : 'goals.create', payload).then(() => this.loadGoals())
          } })
        } })
      } })
    } })
  },
  deleteGoal(e) {
    const goal = this.data.goals[e.currentTarget.dataset.index]
    wx.showModal({ title: '删除目标', content: '确认删除「' + goal.name + '」吗？', confirmColor: '#D9534F', success: res => {
      if (res.confirm) this.callService('goals.delete', { recordId: goal._id }).then(() => this.loadGoals())
    } })
  }
})
