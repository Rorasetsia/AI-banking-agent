Page({
  data: { year: 0, month: 0, monthLabel: '', today: '', weekdays: ['一','二','三','四','五','六','日'], days: [] },
  onLoad() { const now = new Date(); const today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0'); this.setData({ today }); this.build(now.getFullYear(), now.getMonth() + 1); },
  build(year, month) {
    const first = new Date(year, month - 1, 1)
    const total = new Date(year, month, 0).getDate()
    const offset = (first.getDay() || 7) - 1
    const days = []
    for (let i = 0; i < offset; i++) days.push({ day: '', date: '', blank: true })
    for (let d = 1; d <= total; d++) {
      const date = year + '-' + String(month).padStart(2, '0') + '-' + String(d).padStart(2, '0')
      days.push({ day: d, date, blank: false, future: date > this.data.today })
    }
    this.setData({ year, month, monthLabel: year + '年' + month + '月', days })
  },
  prevMonth() { const m = this.data.month - 1; if (m < 1) this.build(this.data.year - 1, 12); else this.build(this.data.year, m) },
  nextMonth() { const m = this.data.month + 1; if (m > 12) this.build(this.data.year + 1, 1); else this.build(this.data.year, m) },
  selectDay(e) {
    const date = e.currentTarget.dataset.date
    if (!date || date > this.data.today) return
    wx.setStorageSync('billHistoryDate', date)
    wx.switchTab({ url: '/pages/bill/bill' })
  }
})
