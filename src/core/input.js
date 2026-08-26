// Unified input: keyboard (WASD *and* arrows simultaneously), on-screen touch
// controls, and mouse aiming. Actions are named so bindings stay remappable.
//
// The movement axis produced here is SCREEN relative (-y is up on screen).
// Converting to isometric grid space is the player controller's job.

const DEFAULT_BINDINGS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  slash: ['Space', 'KeyJ'],
  fire: ['KeyF', 'KeyK'],
  action: ['KeyE', 'Enter'],
  pause: ['Escape', 'KeyP'],
  bestiary: ['KeyB'],
  map: ['KeyM'],
  torch: ['KeyT', 'KeyQ'],
};

export class Input {
  constructor(bindings = DEFAULT_BINDINGS) {
    this.bindings = bindings;
    this.codeToAction = new Map();
    for (const [action, codes] of Object.entries(bindings)) {
      for (const code of codes) {
        if (!this.codeToAction.has(code)) this.codeToAction.set(code, []);
        this.codeToAction.get(code).push(action);
      }
    }
    this.down = new Set();          // actions currently held (keyboard)
    this.virtual = new Set();       // actions currently held (touch/UI)
    this.edge = new Set();          // actions pressed since last consume
    this.stick = { x: 0, y: 0 };    // analogue axis from the touch d-pad
    this.stickActive = false;
    // Which frame of reference the current stick vector is expressed in, or
    // null to follow the player's own setting. The diamond pad pins this to
    // 'dungeon': its buttons sit on the dungeon axes by construction, so the
    // screen-direction setting must not be applied to them a second time.
    this.stickFrame = null;
    this.lastDeviceTouch = false;
    this.enabled = true;
    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const actions = this.codeToAction.get(e.code);
      if (!actions) return;
      // Stop the page scrolling / activating buttons under the cursor.
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!this.enabled) return;
      for (const a of actions) { this.down.add(a); this.edge.add(a); }
      this.lastDeviceTouch = false;
    });
    window.addEventListener('keyup', (e) => {
      const actions = this.codeToAction.get(e.code);
      if (!actions) return;
      for (const a of actions) this.down.delete(a);
    });
    // Releasing everything on blur prevents "stuck running" after alt-tab.
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
    window.addEventListener('touchstart', () => { this.lastDeviceTouch = true; }, { passive: true });
  }

  releaseAll() {
    this.down.clear();
    this.virtual.clear();
    this.stick.x = 0; this.stick.y = 0;
    this.stickActive = false;
    this.stickFrame = null;
  }

  // --- touch / UI driven state -------------------------------------------
  setVirtual(action, isDown) {
    if (isDown) {
      if (!this.virtual.has(action)) this.edge.add(action);
      this.virtual.add(action);
    } else {
      this.virtual.delete(action);
    }
  }

  setStick(x, y, frame = null) {
    this.stick.x = x; this.stick.y = y;
    this.stickActive = (x !== 0 || y !== 0);
    this.stickFrame = this.stickActive ? frame : null;
  }

  // The frame the current movement vector should be read in.
  frameFor(setting) {
    return this.stickActive && this.stickFrame ? this.stickFrame : setting;
  }

  // --- queries ------------------------------------------------------------
  held(action) { return this.down.has(action) || this.virtual.has(action); }

  // True once per press. Consumed so a single tap cannot trigger twice.
  consume(action) {
    if (this.edge.has(action)) { this.edge.delete(action); return true; }
    return false;
  }

  clearEdges() { this.edge.clear(); }

  // Screen-relative movement axis, magnitude clamped to 1.
  axis() {
    if (this.stickActive) {
      const m = Math.hypot(this.stick.x, this.stick.y);
      if (m > 1) return { x: this.stick.x / m, y: this.stick.y / m };
      return { x: this.stick.x, y: this.stick.y };
    }
    let x = 0, y = 0;
    if (this.held('left')) x -= 1;
    if (this.held('right')) x += 1;
    if (this.held('up')) y -= 1;
    if (this.held('down')) y += 1;
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    return { x, y };
  }
}
