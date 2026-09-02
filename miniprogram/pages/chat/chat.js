Page({
  data: {
    messages: [
      { role: 'ai', text: '你好，我是你的财务管家。试试对我说：\n「中午喝了晨光酸奶，花了5块」' }
    ],
    input: ''
  },
  onInput(e) { this.setData({ input: e.detail.value }); },
  send() {
    const text = this.data.input.trim();
    if (!text) return;
    const messages = this.data.messages.concat([{ role: 'user', text }]);
    this.setData({ messages, input: '' });
    // TODO: 调用云函数 -> Agent 编排（意图识别+槽位抽取+执行）-> 流式返回
    wx.showToast({ title: 'Agent 接入中', icon: 'none' });
  },
  voice() { wx.showToast({ title: '语音记账开发中', icon: 'none' }); },
  photo() { wx.showToast({ title: '拍照记账开发中', icon: 'none' }); }
});