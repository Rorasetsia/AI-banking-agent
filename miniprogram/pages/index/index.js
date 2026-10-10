Page({
  data: {
    todayExpense: '0.00',
    todayIncome: '0.00',
    moods: ['很开心', '开心', '平静', '心情一般', '难过'],
    moodValues: { morning: '', afternoon: '', night: '' },
    morning: '', afternoon: '', night: '',
    customMoods: { morning: '', afternoon: '', night: '' },
    reminders: [],
    highlight: ''
  },
  onLoad() {
    const customMoods = wx.getStorageSync('customMoods') || {};
    this.setData({
      customMoods: {
        morning: customMoods.morning || '',
        afternoon: customMoods.afternoon || '',
        night: customMoods.night || ''
      }
    });
  },
  onShow() {
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tabBar && tabBar.data.selected !== 0) {
      tabBar.setData({ selected: 0 });
    }
    this.loadTodaySummary();
    this.loadHighlight();
    this.loadTodayMoods();
    this.loadReminders();
  },
  loadTodayMoods() {
    wx.cloud.database().collection('moods').where({ date: this.today() }).get().then(res => {
      const moodValues = { morning: '', afternoon: '', night: '' };
      (res.data || []).forEach(item => {
        if (moodValues[item.period] !== undefined) moodValues[item.period] = item.mood || '';
      });
      this.setData({ moodValues });
    }).catch(() => {});
  },
  loadTodaySummary() {
    const date = this.today();
    wx.cloud.callFunction({ name: 'ledgerService', data: { action: 'transactions.list', includeShared: true, startDate: date, endDate: date, limit: 1000 } }).then(res => {
      const result = res.result || {};
      if (!result.ok) return;
      this.setData({ todayExpense: Number(result.expense || 0).toFixed(2), todayIncome: Number(result.income || 0).toFixed(2) });
    }).catch(() => {});
  },
  loadHighlight() {
    wx.cloud.callFunction({ name: 'generateDiary', data: { action: 'diaries.peek', date: this.today() } }).then(res => {
      const diary = (res.result || {}).diary;
      this.setData({ highlight: (diary && diary.highlight) || '' });
    }).catch(() => {});
  },
  goHighlight() { wx.navigateTo({ url: '/pages/daily-highlight/daily-highlight?date=' + this.today() }) },
  loadReminders() {
    const db = wx.cloud.database();
    db.collection('reminders').where({ read: false }).orderBy('createdAt', 'desc').limit(50).get()
      .then(res => {
        const seen = {};
        const reminders = [];
        (res.data || []).forEach(item => {
          const key = this.reminderKey(item);
          if (seen[key]) return;
          seen[key] = true;
          reminders.push(item);
        });
        this.setData({ reminders: reminders.slice(0, 5) });
      })
      .catch(() => {});
  },
  reminderKey(item) {
    if (item.dedupeKey) return item.dedupeKey;
    if (item.type === 'budget') {
      const match = String(item.content || '').match(/预算「([^」]+)」/);
      const category = item.budgetCategory || (match && match[1]) || '';
      const month = item.budgetMonth || String(item.date || '').slice(0, 7);
      const owner = item.budgetLedgerId ? 'shared:' + item.budgetLedgerId : 'personal';
      return 'budget:' + month + ':' + owner + ':' + category;
    }
    return String(item.type || 'reminder') + ':' + String(item.content || '');
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
