App({
  onLaunch() {
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
  globalData: {}
});