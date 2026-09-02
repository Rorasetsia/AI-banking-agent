Page({
  data: { monthExpense: '0.00', list: [] },
  onLoad() { /* TODO: 拉取本月流水 + 分类统计 */ },
  askAI() { wx.switchTab({ url: '/pages/chat/chat' }); }
});