Page({
  data: {
    todayExpense: '0.00',   // TODO: 从云数据库统计
    todayIncome: '0.00',
    moods: ['很开心', '开心', '平静', '心情一般', '难过'],
    morning: '', noon: '', night: ''
  },
  onLoad() {
    // TODO: 拉取今日账目概览 + 今日心情
  },
  pickMood(e) {
    const { period, mood } = e.currentTarget.dataset;
    this.setData({ [period]: mood });
    // TODO: 调用云函数保存心情
  },
  goChat() { wx.switchTab({ url: '/pages/chat/chat' }); },
  goDiary() { wx.showToast({ title: '日记功能开发中', icon: 'none' }); }
});