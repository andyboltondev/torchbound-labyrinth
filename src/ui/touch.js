// On-screen controls for touch devices: an analogue d-pad and three large,
// well-spaced action buttons that thumbs can find without looking.

export class TouchControls {
  constructor(input) {
    this.input = input;
    this.root = document.getElementById('touch');
    this.dpad = document.getElementById('dpad');
    this.stick = document.getElementById('dpadStick');
    this.fireBtn = document.getElementById('touchFire');
    this.visible = false;
    this.pointerId = null;
    this.centre = { x: 0, y: 0 };
    this.maxRadius = 52;
    this._bindStick();
    this._bindButtons();
  }

  setVisible(on) {
    if (this.visible === on) return;
    this.visible = on;
    this.root.hidden = !on;
    if (!on) {
      this.input.setStick(0, 0);
      this.stick.style.transform = 'translate(0px, 0px)';
    }
  }

  setCrossbow(on) { this.fireBtn.hidden = !on; }

  _bindStick() {
    const start = (e) => {
      const touch = e.changedTouches ? e.changedTouches[0] : e;
      this.pointerId = touch.identifier !== undefined ? touch.identifier : 'mouse';
      const rect = this.dpad.getBoundingClientRect();
      this.centre = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      this.maxRadius = rect.width * 0.36;
      this._move(touch);
      e.preventDefault();
    };
    const move = (e) => {
      if (this.pointerId === null) return;
      const touch = this._find(e);
      if (!touch) return;
      this._move(touch);
      e.preventDefault();
    };
    const end = (e) => {
      if (this.pointerId === null) return;
      if (e.changedTouches && !this._find(e, true)) return;
      this.pointerId = null;
      this.input.setStick(0, 0);
      this.stick.style.transform = 'translate(0px, 0px)';
    };

    this.dpad.addEventListener('touchstart', start, { passive: false });
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
    this.dpad.addEventListener('mousedown', start);
    window.addEventListener('mousemove', (e) => { if (this.pointerId === 'mouse') move(e); });
    window.addEventListener('mouseup', () => { if (this.pointerId === 'mouse') end({}); });
  }

  _find(e, changed = false) {
    const list = changed ? e.changedTouches : e.touches;
    if (!list) return this.pointerId === 'mouse' ? e : null;
    for (const t of list) if (t.identifier === this.pointerId) return t;
    return null;
  }

  _move(touch) {
    let dx = touch.clientX - this.centre.x;
    let dy = touch.clientY - this.centre.y;
    const m = Math.hypot(dx, dy);
    const limit = this.maxRadius;
    if (m > limit) { dx = (dx / m) * limit; dy = (dy / m) * limit; }
    this.stick.style.transform = `translate(${dx}px, ${dy}px)`;
    // A small dead zone stops a resting thumb from drifting the player.
    const dead = limit * 0.18;
    if (m < dead) { this.input.setStick(0, 0); return; }
    const scale = Math.min(1, (m - dead) / (limit - dead));
    this.input.setStick((dx / (m || 1)) * scale, (dy / (m || 1)) * scale);
  }

  _bindButtons() {
    for (const btn of this.root.querySelectorAll('.tbtn')) {
      const action = btn.dataset.action;
      const down = (e) => {
        btn.classList.add('down');
        this.input.setVirtual(action, true);
        e.preventDefault();
      };
      const up = (e) => {
        btn.classList.remove('down');
        this.input.setVirtual(action, false);
        if (e) e.preventDefault();
      };
      btn.addEventListener('touchstart', down, { passive: false });
      btn.addEventListener('touchend', up, { passive: false });
      btn.addEventListener('touchcancel', up, { passive: false });
      btn.addEventListener('mousedown', down);
      btn.addEventListener('mouseup', up);
      btn.addEventListener('mouseleave', () => {
        if (btn.classList.contains('down')) up(null);
      });
    }
  }
}

export function isTouchDevice() {
  return ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
}
