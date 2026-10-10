Page({
  data: {
    messages: [
      { role: 'ai', text: '你好，我是你的财务管家。试试对我说：\n「中午喝了晨光酸奶，花了5块」' }
    ],
    input: '',
    loading: false,
    scrollIntoView: '',
    showBackBottom: false,
    historyAvailable: false,
    historyCount: 0,
    historyMessages: [],
    keyboardHeight: 0,
    inputBarStyle: '',
    context: {}
  },
  onLoad() {
    this.loadHistory();
    this._keyboardHandler = res => {
      const height = res && res.height ? res.height : 0;
      this.setData({ keyboardHeight: height, inputBarStyle: height ? 'bottom:' + height + 'px;' : '' });
    };
    if (wx.onKeyboardHeightChange) wx.onKeyboardHeightChange(this._keyboardHandler);
  },
  onUnload() { if (wx.offKeyboardHeightChange && this._keyboardHandler) wx.offKeyboardHeightChange(this._keyboardHandler); },
  onHide() { if (wx.hideKeyboard) wx.hideKeyboard(); this.setData({ keyboardHeight: 0, inputBarStyle: '' }); },
  onReady() {
    this.createSelectorQuery().select('.msg-list').boundingClientRect(rect => {
      this._scrollViewHeight = rect && rect.height ? rect.height : 0;
    }).exec();
  },
  onShow() {
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tabBar && tabBar.data.selected !== 2) {
      tabBar.setData({ selected: 2 });
    }
  },
  loadHistory() {
    wx.cloud.callFunction({ name: 'chatAgent', data: { action: 'history.list' } }).then(res => {
      const result = res.result || {};
      const history = (result.history || []).slice(-30).map(item => ({ role: item.role === 'assistant' ? 'ai' : 'user', text: item.content || '' }));
      this.setData({ historyMessages: history, historyCount: history.length, historyAvailable: history.length > 0 });
    }).catch(() => {});
  },
  showHistory() {
    if (!this.data.historyAvailable) return;
    this.setData({
      messages: this.data.historyMessages.concat(this.data.messages),
      historyAvailable: false,
      scrollIntoView: 'msg-0'
    });
  },
  onHistoryTouchStart(e) { const touch = e.touches && e.touches[0]; this._historyTouchY = touch ? touch.clientY : 0; },
  onHistoryTouchEnd(e) {
    const touch = e.changedTouches && e.changedTouches[0];
    const endY = touch ? touch.clientY : 0;
    if (this.data.historyAvailable && this._historyTouchY && endY - this._historyTouchY > 60 && (this._scrollTop || 0) <= 10) this.showHistory();
  },
  onInput(e) { this.setData({ input: e.detail.value }); },
  onInputFocus(e) { const height = e.detail && e.detail.height ? e.detail.height : this.data.keyboardHeight; if (height) this.setData({ keyboardHeight: height, inputBarStyle: 'bottom:' + height + 'px;' }); },
  onInputBlur() { this.setData({ keyboardHeight: 0, inputBarStyle: '' }); },
  scrollToBottom() {
    const last = this.data.messages.length - 1;
    this.setData({ scrollIntoView: 'msg-' + last, showBackBottom: false });
  },
  onScroll(e) {
    const { scrollTop, scrollHeight } = e.detail;
    const viewHeight = this._scrollViewHeight || e.detail.height || 0;
    const distanceToBottom = Math.max(0, scrollHeight - scrollTop - viewHeight);
    this._scrollTop = scrollTop;
    this.setData({ showBackBottom: distanceToBottom > 500 });
  },
  goBottom() { this.scrollToBottom(); },
  async send() {
    const text = this.data.input.trim();
    if (!text || this.data.loading) return;
    const messages = this.data.messages.concat([{ role: 'user', text }]);
    this.setData({ messages, input: '', loading: true });
    this.scrollToBottom();
    const history = this.data.messages.slice(-8).map(item => ({
      role: item.role === 'ai' ? 'assistant' : 'user',
      content: item.text
    }));
    try {
      const res = await wx.cloud.callFunction({
        name: 'chatAgent',
        data: { message: text, history, context: this.data.context || {} }
      });
      const r = res.result || {};
      console.log('[chatAgent build]', r.build || 'unknown');
      if (r.executionOk && (r.intent === 'addTransaction' || r.intent === 'ledgerAdd' || r.intent === 'aaSplit' || r.intent === 'moveToSharedLedger')) {
        wx.setStorageSync('billRefreshDate', (r.data && r.data.date) || this.today());
        wx.setStorageSync('billRefreshLedgerId', (r.data && r.data.ledgerId) || (r.data && r.data.lastAction && r.data.lastAction.data && r.data.lastAction.data.ledgerId) || '');
      }
      const reply = r.reply || '（没有返回结果，请检查云函数）';
      this.setData({
        messages: this.data.messages.concat([{ role: 'ai', text: reply }]),
        context: r.context || this.data.context || {}
      });
      this.scrollToBottom();
    } catch (e) {
      this.setData({ messages: this.data.messages.concat([{ role: 'ai', text: '调用失败：' + (e.errMsg || e.message) }]) });
      this.scrollToBottom();
    } finally {
      this.setData({ loading: false });
    }
  }
});
