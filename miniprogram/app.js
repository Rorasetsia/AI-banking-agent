App({
  onLaunch() {
    this.initMascotState();
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
      return;
    }
    wx.cloud.init({
      // TODO: 替换为你的云开发环境 ID（在微信开发者工具-云开发控制台创建后获得）
      env: 'aifinance-d8gg5pftj80748c97',
      traceUser: true
    });
  },
  initMascotState() {
    let state = { hidden: false, dx: 0, dy: 0 };
    try {
      const saved = wx.getStorageSync('mascotPenguinState') || {};
      state = {
        hidden: !!saved.hidden,
        dx: Number(saved.dx) || 0,
        dy: Number(saved.dy) || 0
      };
    } catch (e) {}
    this.globalData.mascotState = state;
    this.globalData.mascotListeners = [];
  },
  setMascotState(state) {
    const next = Object.assign({}, this.globalData.mascotState || {}, state || {});
    this.globalData.mascotState = next;
    try { wx.setStorageSync('mascotPenguinState', next); } catch (e) {}
    (this.globalData.mascotListeners || []).forEach(listener => {
      try { listener(next); } catch (e) {}
    });
  },
  subscribeMascot(listener) {
    if (!this.globalData.mascotListeners) this.globalData.mascotListeners = [];
    this.globalData.mascotListeners.push(listener);
    return () => {
      this.globalData.mascotListeners = (this.globalData.mascotListeners || []).filter(fn => fn !== listener);
    };
  },
  globalData: {
    mascotState: { hidden: false, dx: 0, dy: 0 },
    mascotListeners: []
  }
});
