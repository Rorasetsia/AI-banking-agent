Page({
  data: { userInfo: null },
  onLoad() { /* TODO: 获取用户信息 + 偏好设置 */ },
  goPage(e) { wx.navigateTo({ url: e.currentTarget.dataset.route }) },
  onShow() {
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tabBar && tabBar.data.selected !== 4) {
      tabBar.setData({ selected: 4 });
    }
  }
});
