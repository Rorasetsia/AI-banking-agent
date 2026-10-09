Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/index/index', text: '首页', icon: 'home' },
      { pagePath: '/pages/bill/bill', text: '账单', icon: 'bill' },
      { pagePath: '/pages/chat/chat', text: '记一笔', icon: 'edit' },
      { pagePath: '/pages/subscription/subscription', text: '订阅', icon: 'bell' },
      { pagePath: '/pages/profile/profile', text: '我的', icon: 'user' }
    ]
  },
  methods: {
    getCurrentRoute() {
      const pages = getCurrentPages();
      return pages.length ? '/' + pages[pages.length - 1].route : '';
    },
    syncSelected() {
      const route = this.getCurrentRoute();
      const selected = this.data.list.findIndex(item => item.pagePath === route);
      if (selected > -1 && selected !== this.data.selected) {
        this.setData({ selected });
      }
    },
    switchTab(e) {
      const index = parseInt(e.currentTarget.dataset.index, 10);
      const path = e.currentTarget.dataset.path;
      if (path === this.getCurrentRoute() || this._switching) return;
      this._switching = true;
      this.setData({ selected: index });
      wx.switchTab({
        url: path,
        fail: () => this.syncSelected(),
        complete: () => {
          this._switching = false;
        }
      });
    }
  }
});

