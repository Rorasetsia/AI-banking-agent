Page({
  data: {
    messages: [
      { role: 'ai', text: '你好，我是你的财务管家。试试对我说：\n「中午喝了晨光酸奶，花了5块」' }
    ],
    input: '',
    loading: false,
    scrollIntoView: '',
    showBackBottom: false
  },
  onInput(e) { this.setData({ input: e.detail.value }); },
  scrollToBottom() {
    const last = this.data.messages.length - 1;
    this.setData({ scrollIntoView: 'msg-' + last, showBackBottom: false });
  },
  onScroll(e) {
    const { scrollTop, scrollHeight } = e.detail;
    // 距离底部超过 400px 时显示"回到底部"按钮
    this.setData({ showBackBottom: scrollHeight - scrollTop > 400 });
  },
  goBottom() { this.scrollToBottom(); },
  async send() {
    const text = this.data.input.trim();
    if (!text || this.data.loading) return;
    const messages = this.data.messages.concat([{ role: 'user', text }]);
    this.setData({ messages, input: '', loading: true });
    this.scrollToBottom();
    try {
      const res = await wx.cloud.callFunction({ name: 'chatAgent', data: { message: text } });
      const r = res.result || {};
      const reply = r.reply || '（没有返回结果，请检查云函数）';
      this.setData({ messages: this.data.messages.concat([{ role: 'ai', text: reply }]) });
      this.scrollToBottom();
    } catch (e) {
      this.setData({ messages: this.data.messages.concat([{ role: 'ai', text: '调用失败：' + (e.errMsg || e.message) }]) });
      this.scrollToBottom();
    } finally {
      this.setData({ loading: false });
    }
  },
  voice() { wx.showToast({ title: '语音记账开发中', icon: 'none' }); },
  photo() { wx.showToast({ title: '拍照记账开发中', icon: 'none' }); }
});