Page({
  data: { tab: 'budget', month: '', total: null, categories: [], goals: [], loading: false },
  onLoad() { const d = new Date(); this.setData({ month: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') }); this.loadAll() },
  onShow() { this.loadAll() },
  callService(action, data) { return wx.cloud.callFunction({ name: 'ledgerService', data: Object.assign({ action }, data || {}) }).then(res => res.result || {}) },
  loadAll() { this.loadBudgets(); this.loadGoals() },
  loadBudgets() {
    this.callService('budgets.list', { month: this.data.month }).then(res => {
      if (!res.ok) return
      const total = res.total || null
      const categories = (res.categories || []).map(item => Object.assign({}, item, { monthlyText: Number(item.monthlyAmount || item.amount || 0).toFixed(2), dailyText: Number(item.dailyAmount || 0).toFixed(2) }))
      this.setData({ total, categories })
    })
  },
  loadGoals() { this.callService('goals.list').then(res => { if (res.ok) this.setData({ goals: (res.list || []).map(g => Object.assign({}, g, { progress: g.targetAmount ? Math.min(100, Math.round(Number(g.savedAmount || 0) / Number(g.targetAmount) * 100)) : 0 })) }) }) },
  switchTab(e) { this.setData({ tab: e.currentTarget.dataset.tab }) },
  editTotal(e) {
    const period = e.currentTarget.dataset.period
    const current = this.data.total && (period === 'day' ? this.data.total.dailyAmount : this.data.total.monthlyAmount)
    wx.showModal({ title: period === 'day' ? '设置日预算' : '设置月预算', editable: true, content: current ? String(current) : '', placeholderText: '请输入金额', success: res => {
      if (!res.confirm) return
      const amount = Number(res.content)
      if (!amount || amount <= 0) return wx.showToast({ title: '金额无效', icon: 'none' })
      this.callService('budgets.set', { month: this.data.month, type: 'total', period, amount }).then(result => {
        if (!result.ok) return wx.showToast({ title: result.error || '保存失败', icon: 'none' })
        wx.showToast({ title: '月 ¥' + result.monthlyAmount + ' / 日 ¥' + result.dailyAmount, icon: 'none' }); this.loadBudgets()
      })
    } })
  },
  addCategory() {
    wx.showModal({ title: '分类预算', editable: true, placeholderText: '分类名称，例如 餐饮', success: r1 => {
      if (!r1.confirm || !r1.content.trim()) return
      const category = r1.content.trim()
      wx.showModal({ title: category + '月预算', editable: true, placeholderText: '每月金额', success: r2 => {
        if (!r2.confirm) return
        const amount = Number(r2.content)
        if (!amount || amount <= 0) return wx.showToast({ title: '金额无效', icon: 'none' })
        this.callService('budgets.set', { month: this.data.month, type: 'category', category, period: 'month', amount }).then(() => this.loadBudgets())
      } })
    } })
  },
  editCategory(e) {
    const item = this.data.categories[e.currentTarget.dataset.index]
    wx.showModal({ title: item.category + '月预算', editable: true, content: String(item.monthlyAmount || item.amount), success: res => {
      if (!res.confirm) return
      const amount = Number(res.content)
      if (!amount || amount <= 0) return
      this.callService('budgets.set', { month: this.data.month, type: 'category', category: item.category, period: 'month', amount }).then(() => this.loadBudgets())
    } })
  },
  deleteCategory(e) { const item = this.data.categories[e.currentTarget.dataset.index]; wx.showModal({ title: '删除预算', content: '确认删除' + item.category + '预算？', confirmColor: '#D9534F', success: res => { if (res.confirm) this.callService('budgets.delete', { recordId: item._id }).then(() => this.loadBudgets()) } }) },
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
  deleteGoal(e) { const goal = this.data.goals[e.currentTarget.dataset.index]; wx.showModal({ title: '删除目标', content: '确认删除「' + goal.name + '」吗？', confirmColor: '#D9534F', success: res => { if (res.confirm) this.callService('goals.delete', { recordId: goal._id }).then(() => this.loadGoals()) } }) }
})
