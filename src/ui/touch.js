// On-screen controls for touch devices: a movement pad and three large,
// well-spaced action buttons that thumbs can find without looking.
//
// Two movement pads are offered, because they answer different questions.
//
//   diamond -- four buttons on a 45-degree rotated frame. The isometric view
//              draws the dungeon's four axes as the four screen diagonals, so
//              a rotated pad puts every button exactly where its corridor
//              goes: the top-right button walks north, and north on screen is
//              up and to the right. It maps one tap to one tile, which is
//              what grid movement actually wants.
//   stick   -- the older floating analogue pad, anchored wherever the thumb
//              lands. Kept for players who prefer a continuous surface.

// Dungeon-axis vectors. The diamond feeds these straight through in the
// 'dungeon' frame, so the screen-direction setting never doubles up on them.
const DIRS = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
};

export class TouchControls {
  constructor(input) {
    this.input = input;
    this.root = document.getElementById('touch');
    this.zone = document.getElementById('dpadZone');
    this.dpad = document.getElementById('dpad');
    this.stick = document.getElementById('dpadStick');
    this.diamond = document.getElementById('diamond');
    this.fireBtn = document.getElementById('touchFire');
    this.visible = false;
    this.mode = 'diamond';
    this.pointerId = null;
    this.centre = { x: 0, y: 0 };
    this.maxRadius = 52;
    this.restStyle = null;
    this.heldDirs = [];
    this._bindStick();
    this._bindDiamond();
    this._bindButtons();
    this.setPad('diamond');
  }

  setVisible(on) {
    if (this.visible === on) return;
    this.visible = on;
    this.root.hidden = !on;
    if (!on) { this._release(); this._releaseDiamond(); }
  }

  // 'diamond' | 'stick'
  setPad(mode) {
    this.mode = mode === 'stick' ? 'stick' : 'diamond';
    this.zone.hidden = this.mode !== 'stick';
    this.diamond.hidden = this.mode !== 'diamond';
    this._release();
    this._releaseDiamond();
  }

  setCrossbow(on) { this.fireBtn.hidden = !on; }

  // The pad is anchored wherever the thumb lands rather than sitting in one
  // corner, so it can be found without looking away from the dungeon.
  _anchorAt(clientX, clientY) {
    const zone = this.zone.getBoundingClientRect();
    const size = this.dpad.offsetWidth || 148;
    const half = size / 2;
    // Keep the pad fully on screen even when the thumb lands near an edge.
    const x = Math.min(Math.max(clientX - zone.left, half + 6), zone.width - half - 6);
    const y = Math.min(Math.max(clientY - zone.top, half + 6), zone.height - half - 6);
    this.dpad.style.left = (x - half) + 'px';
    this.dpad.style.top = (y - half) + 'px';
    this.dpad.style.bottom = 'auto';
    this.dpad.classList.add('active');
    this.centre = { x: zone.left + x, y: zone.top + y };
    this.maxRadius = size * 0.36;
  }

  _release() {
    this.pointerId = null;
    if (this.mode === 'stick') this.input.setStick(0, 0);
    this.stick.style.transform = 'translate(0px, 0px)';
    this.dpad.classList.remove('active');
    this.dpad.style.left = '';
    this.dpad.style.top = '';
    this.dpad.style.bottom = '';
  }

  // --- diamond pad --------------------------------------------------------
  // Presses stack rather than replace, so sliding a thumb from one button to
  // the next never drops a frame of movement, and lifting the newer button
  // falls back to the one still held.
  _pressDir(name) {
    const i = this.heldDirs.indexOf(name);
    if (i >= 0) this.heldDirs.splice(i, 1);
    this.heldDirs.push(name);
    this._applyDiamond();
  }

  _releaseDir(name) {
    const i = this.heldDirs.indexOf(name);
    if (i >= 0) this.heldDirs.splice(i, 1);
    this._applyDiamond();
  }

  _releaseDiamond() {
    if (!this.heldDirs.length) return;
    this.heldDirs.length = 0;
    this._applyDiamond();
  }

  _applyDiamond() {
    for (const btn of this.diamond.querySelectorAll('.dbtn')) {
      btn.classList.toggle('down', this.heldDirs.includes(btn.dataset.dir));
    }
    const active = this.heldDirs[this.heldDirs.length - 1];
    if (!active) { this.input.setStick(0, 0); return; }
    const d = DIRS[active];
    this.input.setStick(d.x, d.y, 'dungeon');
  }

  _bindDiamond() {
    for (const btn of this.diamond.querySelectorAll('.dbtn')) {
      const dir = btn.dataset.dir;
      const down = (e) => { this._pressDir(dir); e.preventDefault(); };
      const up = (e) => { this._releaseDir(dir); if (e) e.preventDefault(); };
      btn.addEventListener('touchstart', down, { passive: false });
      btn.addEventListener('touchend', up, { passive: false });
      btn.addEventListener('touchcancel', up, { passive: false });
      btn.addEventListener('mousedown', down);
      btn.addEventListener('mouseup', up);
      btn.addEventListener('mouseleave', () => {
        if (btn.classList.contains('down')) up(null);
      });
      // A button dragged off-screen mid-press must not leave the player
      // walking into a wall forever.
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    window.addEventListener('blur', () => this._releaseDiamond());
  }

  _bindStick() {
    const start = (e) => {
      const touch = e.changedTouches ? e.changedTouches[0] : e;
      this.pointerId = touch.identifier !== undefined ? touch.identifier : 'mouse';
      this._anchorAt(touch.clientX, touch.clientY);
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
      if (e && e.changedTouches && !this._find(e, true)) return;
      this._release();
    };

    this.zone.addEventListener('touchstart', start, { passive: false });
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
    this.zone.addEventListener('mousedown', start);
    window.addEventListener('mousemove', (e) => { if (this.pointerId === 'mouse') move(e); });
    window.addEventListener('mouseup', () => { if (this.pointerId === 'mouse') end(null); });
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
    // A generous dead zone: a thumb resting on the glass must not walk you
    // into a fight. Movement is grid-snapped anyway, so precision below this
    // would be thrown away regardless.
    const dead = Math.max(9, limit * 0.26);
    if (m < dead) { this.input.setStick(0, 0); return; }
    this.input.setStick(dx / (m || 1), dy / (m || 1));
  }

  // The torch button says what the torch is doing, not what pressing it does:
  // the player can see the flame in their own hand either way, and a button
  // that changes its own label is read as a state twice as often as a verb.
  setTorch(lit) {
    const btn = this.root.querySelector('.tbtn.torch');
    if (!btn) return;
    btn.classList.toggle('out', !lit);
    btn.textContent = lit ? 'TORCH' : 'DARK';
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
