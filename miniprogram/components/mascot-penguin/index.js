Component({
  properties: {
    state: {
      type: String,
      value: ''
    },
    size: {
      type: Number,
      value: 360
    }
  },
  data: {
    activeState: 'idle',
    hidden: false,
    dx: 0,
    dy: 0
  },
  lifetimes: {
    attached() {
      const app = getApp();
      if (app && app.globalData) {
        if (!app.globalData.mascotState && app.initMascotState) app.initMascotState();
        if (app.subscribeMascot) {
          this._unsubscribeMascot = app.subscribeMascot(state => this.applySharedState(state));
        }
        this.applySharedState(app.globalData.mascotState || {});
        return;
      }
      try {
        const saved = wx.getStorageSync('mascotPenguinState') || {};
        this.applySharedState(saved);
      } catch (e) {}
    },
    detached() {
      if (this._unsubscribeMascot) this._unsubscribeMascot();
    }
  },
  pageLifetimes: {
    show() {
      this.syncSharedState();
    }
  },
  observers: {
    state(value) {
      this.setData({ activeState: value || 'idle' });
    }
  },
  methods: {
    getTouch(e) {
      return (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || null;
    },
    clampPosition(dx, dy) {
      let width = 375;
      let height = 667;
      try {
        const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        width = info.windowWidth || width;
        height = info.windowHeight || height;
      } catch (e) {}
      return {
        dx: Math.max(-width + 80, Math.min(80, dx)),
        dy: Math.max(-height + 100, Math.min(100, dy))
      };
    },
    applySharedState(state) {
      const next = state || {};
      this.setData({
        hidden: !!next.hidden,
        dx: Number(next.dx) || 0,
        dy: Number(next.dy) || 0
      });
    },
    syncSharedState() {
      const app = getApp();
      if (app && app.globalData && app.globalData.mascotState) this.applySharedState(app.globalData.mascotState);
    },
    publishState(patch) {
      const next = Object.assign({}, {
        hidden: this.data.hidden,
        dx: Math.round(this.data.dx),
        dy: Math.round(this.data.dy)
      }, patch || {});
      this.setData(next);
      const app = getApp();
      if (app && app.setMascotState) {
        app.setMascotState(next);
      } else {
        try { wx.setStorageSync('mascotPenguinState', next); } catch (e) {}
      }
    },
    savePosition() {
      this.publishState({});
    },
    handleTap() {
      if (this.data.activeState === 'jump') return;
      this.setData({ activeState: 'jump' });
      this.triggerEvent('mascotTap');
      setTimeout(() => {
        if (!this.properties.state) {
          this.setData({ activeState: 'idle' });
        }
      }, 850);
    },
    noop() {},
    onHideTouchStart() {
      this._hiding = true;
    },
    onHideTouchEnd() {
      if (this._hiding) this.hide();
      this._hiding = false;
    },
    onTouchStart(e) {
      if (this._hiding) return;
      const touch = this.getTouch(e);
      if (!touch || this.data.hidden) return;
      this._startX = touch.clientX;
      this._startY = touch.clientY;
      this._startDx = this.data.dx;
      this._startDy = this.data.dy;
      this._moved = false;
    },
    onTouchMove(e) {
      if (this._hiding) return;
      const touch = this.getTouch(e);
      if (!touch || this.data.hidden) return;
      const rawDx = this._startDx + touch.clientX - this._startX;
      const rawDy = this._startDy + touch.clientY - this._startY;
      if (Math.abs(touch.clientX - this._startX) > 4 || Math.abs(touch.clientY - this._startY) > 4) this._moved = true;
      const pos = this.clampPosition(rawDx, rawDy);
      this.setData(pos);
    },
    onTouchEnd() {
      if (this._hiding || this.data.hidden) return;
      if (this._moved) this.savePosition();
      else this.handleTap();
    },
    hide() {
      this.publishState({ hidden: true });
    },
    show() {
      this.publishState({ hidden: false });
    }
  }
});
