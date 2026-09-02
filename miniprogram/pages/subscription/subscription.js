Page({
  data: { list: [] },
  onLoad() { /* TODO: 拉取订阅列表 + 下次扣费提醒 */ },
  scan() { wx.showToast({ title: '订阅识别开发中', icon: 'none' }); }
});