Page({
  data: {
    state: 'idle'
  },
  setState(e) {
    const next = e.currentTarget.dataset.state;
    this.setData({ state: 'idle' });
    setTimeout(() => this.setData({ state: next }), 20);
    if (next === 'wave') {
      setTimeout(() => this.setData({ state: 'idle' }), 2400);
    }
    if (next === 'jump') {
      setTimeout(() => this.setData({ state: 'idle' }), 850);
    }
  },
  playJump() {
    this.setState({ currentTarget: { dataset: { state: 'jump' } } });
  }
});
