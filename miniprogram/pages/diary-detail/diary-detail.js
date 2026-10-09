function escapeHtml(value) { return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>') }
Page({
  data: { date: '', diary: null, title: '', content: '', contentHtml: '', mode: 'read', isLong: false, expanded: false, loading: true, saving: false, empty: false, showPolish: false, polishedText: '', originalText: '', colors: ['#0A3323', '#839958', '#105666', '#D3968C', '#D9534F', '#8B6F47'] },
  onLoad(options) { const date = options.date || this.today(); this.setData({ date }); this.loadDiary(date) },
  today() { const d = new Date(Date.now() + 8 * 60 * 60 * 1000); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0') },
  loadDiary(date) {
    wx.showLoading({ title: '正在生成中' })
    wx.cloud.callFunction({ name: 'generateDiary', data: { action: 'diaries.get', date } }).then(res => {
      wx.hideLoading(); const result = res.result || {}; const diary = result.diary
      if (!diary) return this.setData({ loading: false, empty: true })
      const content = diary.content || ''; const contentHtml = diary.contentHtml || escapeHtml(content)
      this.setData({ diary, title: diary.title || date, content, contentHtml, isLong: content.length > 260 || content.split('\n').length > 6, loading: false, empty: false })
    }).catch(() => { wx.hideLoading(); this.setData({ loading: false }); wx.showToast({ title: '日记加载失败', icon: 'none' }) })
  },
  toggleExpanded() { this.setData({ expanded: !this.data.expanded }) },
  enterEdit() {
    this.undoStack = []
    this._lastEditorHtml = this.data.contentHtml || escapeHtml(this.data.content)
    this.setData({ mode: 'edit' })
    setTimeout(() => this.initEditor(), 120)
  },
  initEditor() {
    this.createSelectorQuery().select('#diaryEditor').context(res => {
      this.editorCtx = res && res.context
      if (!this.editorCtx) return
      const html = this.data.contentHtml || escapeHtml(this.data.content)
      this._settingContent = true
      this.editorCtx.setContents({ html, success: () => { this._settingContent = false; this._lastEditorHtml = html } })
    }).exec()
  },
  onTitle(e) { this.setData({ title: e.detail.value }) },
  pushUndo() {
    if (!this._lastEditorHtml) return
    this.undoStack = this.undoStack || []
    if (this.undoStack[this.undoStack.length - 1] !== this._lastEditorHtml) this.undoStack.push(this._lastEditorHtml)
    if (this.undoStack.length > 30) this.undoStack.shift()
  },
  applyFormat(name, value) {
    if (!this.editorCtx) return
    this.pushUndo()
    if (value === undefined) this.editorCtx.format(name)
    else this.editorCtx.format(name, value)
  },
  format(e) { this.applyFormat(e.currentTarget.dataset.type) },
  setColor(e) { this.applyFormat('color', e.currentTarget.dataset.color) },
  undo() {
    if (!this.editorCtx || !this.undoStack || !this.undoStack.length) return wx.showToast({ title: '没有可撤销的操作', icon: 'none' })
    const html = this.undoStack.pop()
    this._settingContent = true
    this.editorCtx.setContents({ html, success: () => { this._settingContent = false; this._lastEditorHtml = html } })
  },
  onEditorInput(e) {
    if (this._settingContent) return
    const html = (e.detail && e.detail.html) || ''
    if (this._lastEditorHtml && html !== this._lastEditorHtml) {
      this.undoStack = this.undoStack || []
      this.undoStack.push(this._lastEditorHtml)
      if (this.undoStack.length > 30) this.undoStack.shift()
    }
    this._lastEditorHtml = html
  },
  chooseFontSize() {
    const sizes = ['16px', '18px', '20px', '22px', '24px']
    wx.showActionSheet({ itemList: ['小', '较小', '标准', '较大', '大'], success: res => { this.applyFormat('fontSize', sizes[res.tapIndex]) } })
  },
  getEditorContent() {
    return new Promise(resolve => {
      if (!this.editorCtx) return resolve({ html: escapeHtml(this.data.content), text: this.data.content })
      this.editorCtx.getContents({ success: res => resolve({ html: res.html || escapeHtml(res.text || ''), text: res.text || '' }), fail: () => resolve({ html: escapeHtml(this.data.content), text: this.data.content }) })
    })
  },
  save() {
    this.getEditorContent().then(({ html, text }) => {
      this.setData({ saving: true })
      wx.cloud.callFunction({ name: 'generateDiary', data: { action: 'diaries.update', date: this.data.date, title: this.data.title, content: text, contentHtml: html } }).then(res => {
        const result = res.result || {}; this.setData({ saving: false })
        if (!result.ok) return wx.showToast({ title: result.error || '保存失败', icon: 'none' })
        this.setData({ mode: 'read', content: text, contentHtml: html, isLong: text.length > 260 || text.split('\n').length > 6 })
        wx.showToast({ title: '已保存', icon: 'success' })
      }).catch(() => { this.setData({ saving: false }); wx.showToast({ title: '保存失败', icon: 'none' }) })
    })
  },
  cancelEdit() { this.setData({ mode: 'read' }); this.loadDiary(this.data.date) },
  polish() {
    this.getEditorContent().then(({ text }) => {
      if (!text.trim()) return wx.showToast({ title: '正文为空', icon: 'none' })
      wx.showLoading({ title: '正在润色' })
      wx.cloud.callFunction({ name: 'generateDiary', data: { action: 'diaries.polish', content: text } }).then(res => {
        wx.hideLoading(); const result = res.result || {}
        if (!result.ok) return wx.showToast({ title: result.error || '润色失败', icon: 'none' })
        this.setData({ showPolish: true, originalText: text, polishedText: result.content })
      }).catch(() => { wx.hideLoading(); wx.showToast({ title: '润色失败', icon: 'none' }) })
    })
  },
  applyPolish() {
    const text = this.data.polishedText
    const html = escapeHtml(text)
    this.pushUndo()
    if (this.editorCtx) this.editorCtx.setContents({ html, success: () => { this._lastEditorHtml = html } })
    this.setData({ showPolish: false, content: text, contentHtml: html })
  },
  keepOriginal() { this.setData({ showPolish: false }) },
  remove() {
    if (this.data.mode !== 'edit') return
    wx.showModal({ title: '删除日记', content: '确认删除这篇日记吗？', confirmColor: '#D9534F', success: res => {
      if (!res.confirm) return
      wx.cloud.callFunction({ name: 'generateDiary', data: { action: 'diaries.delete', date: this.data.date } }).then(result => { if ((result.result || {}).ok) wx.redirectTo({ url: '/pages/diary-list/diary-list' }) })
    } })
  },
  exportDiary() {
    wx.showActionSheet({ itemList: ['导出 TXT（纯文本）', '导出 HTML（保留格式）'], success: res => { this.doExport(res.tapIndex === 0 ? 'txt' : 'html') } })
  },
  doExport(type) {
    const fs = wx.getFileSystemManager(); const base = 'diary-' + this.data.date; const filePath = wx.env.USER_DATA_PATH + '/' + base + '.' + type
    const data = type === 'txt' ? this.data.title + '\n' + this.data.date + '\n\n' + this.data.content : '<!doctype html><html><head><meta charset="utf-8"><title>' + this.data.title + '</title></head><body><h1>' + this.data.title + '</h1><p>' + this.data.date + '</p><div>' + this.data.contentHtml + '</div></body></html>'
    fs.writeFile({ filePath, data, encoding: 'utf8', success: () => { if (wx.shareFileMessage) wx.shareFileMessage({ filePath, fileName: base + '.' + type, success: () => wx.showToast({ title: '已导出', icon: 'success' }), fail: () => wx.setClipboardData({ data: this.data.content || '' }) }) }, fail: () => wx.showToast({ title: '导出失败', icon: 'none' }) })
  },
  goList() { wx.redirectTo({ url: '/pages/diary-list/diary-list' }) },
  noop() {}
})
