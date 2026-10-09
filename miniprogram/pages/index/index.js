Page({
  data: {
    todayExpense: '0.00',
    todayIncome: '0.00',
    moods: ['很开心', '开心', '平静', '心情一般', '难过'],
    moodValues: { morning: '', noon: '', night: '' },
    morning: '', noon: '', night: '',
    customMoods: { morning: '', noon: '', night: '' },
    reminders: []
  },
  onLoad() {
    const customMoods = wx.getStorageSync('customMoods') || {};
    this.setData({
      customMoods: {
        morning: customMoods.morning || '',
        noon: customMoods.noon || '',
        night: customMoods.night || ''
      }
    });
    this.loadReminders();
  },
  onShow() {
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tabBar && tabBar.data.selected !== 0) {
      tabBar.setData({ selected: 0 });
    }
  },
  loadReminders() {
    const db = wx.cloud.database();
    db.collection('reminders').where({ read: false }).orderBy('createdAt', 'desc').limit(5).get()
      .then(res => this.setData({ reminders: res.data }))
      .catch(() => {});
  },
  today() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  },
  saveMood(period, mood) {
    wx.cloud.callFunction({ name: 'addMood', data: { period, mood, date: this.today() } })
      .then(() => wx.showToast({ title: '心情已记录', icon: 'success' }))
      .catch(() => wx.showToast({ title: '保存失败', icon: 'none' }));
  },
  resetMood(e) { const period = e.currentTarget.dataset.period; this.setData({ [period]: '', ['moodValues.' + period]: '' }) },
  pickMood(e) {
    const { period, mood } = e.currentTarget.dataset;
    this.setData({ [period]: mood, ['moodValues.' + period]: mood });
    this.saveMood(period, mood);
  },
  pickCustomMood(e) {
    const { period } = e.currentTarget.dataset;
    const current = this.data.customMoods[period] || '';
    wx.showModal({
      title: '自定义心情',
      editable: true,
      placeholderText: '例如：期待、放松、焦虑',
      content: current,
      confirmText: '保存',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return;
        const mood = (res.content || '').trim();
        if (!mood) {
          wx.showToast({ title: '请输入心情', icon: 'none' });
          return;
        }
        if (mood.length > 6) {
          wx.showToast({ title: '最多输入6个字', icon: 'none' });
          return;
        }
        const customMoods = Object.assign({}, this.data.customMoods, { [period]: mood });
        this.setData({ customMoods, [period]: mood, ['moodValues.' + period]: mood });
        wx.setStorageSync('customMoods', customMoods);
        this.saveMood(period, mood);
      }
    });
  },
  goChat() { wx.switchTab({ url: '/pages/chat/chat' }); },
  goDiary() { wx.navigateTo({ url: '/pages/diary-detail/diary-detail?date=' + this.today() }) }
});
