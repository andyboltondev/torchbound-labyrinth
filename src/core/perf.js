// Frame-time measurement and the adaptive quality controller.
//
// Everything expensive in the renderer asks this module what it is allowed to
// do this frame. The contract is deliberately blunt: 30fps is the floor and
// the controller will strip effects until it holds, 60fps is the target and
// the controller adds them back once there is headroom.

const WINDOW = 45;

// Presets, cheapest first -- the array index is the quality level.
// `scale` multiplies particle and weather counts.
export const TIERS = [
  {
    // The 30fps safety net: the original renderer, plus enough ambience that
    // the dungeon still feels inhabited.
    id: 'low', name: 'Low', scale: 0.35,
    bloom: false, bloomDiv: 6, torchLight: false, contactShadows: false,
    ambience: 0.15, softShadows: false, sconceGlow: false, grade: false,
  },
  {
    // Everything that lights the scene, nothing that resamples the whole frame.
    id: 'medium', name: 'Medium', scale: 0.7,
    bloom: false, bloomDiv: 6, torchLight: true, contactShadows: true,
    ambience: 0.55, softShadows: true, sconceGlow: true, grade: false,
  },
  {
    id: 'high', name: 'High', scale: 1,
    bloom: true, bloomDiv: 4, torchLight: true, contactShadows: true,
    ambience: 1, softShadows: true, sconceGlow: true, grade: true,
  },
];

const INDEX = { low: 0, medium: 1, high: 2 };

export class Perf {
  constructor() {
    this.samples = new Float32Array(WINDOW);
    this.count = 0;
    this.cursor = 0;
    this.sum = 0;
    this.fps = 60;
    this.avgMs = 16.7;
    // The best frame interval this display has managed. Frames are handed out
    // by the compositor on a vsync boundary, so "fast enough" means landing on
    // that boundary -- not beating some absolute millisecond figure, which a
    // 60Hz screen makes impossible by construction.
    this.period = 16.7;
    this.mode = 'auto';
    this.level = TIERS.length - 1;
    this.tier = TIERS[this.level];
    this.cooldown = 1.5;
    this.headroom = 0;    // seconds of sustained slack
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'auto') {
      // Start at the top and let the machine argue it down: the player should
      // see the best this hardware can do before anything is taken away.
      this.level = TIERS.length - 1;
    } else {
      this.level = INDEX[mode] === undefined ? TIERS.length - 1 : INDEX[mode];
    }
    this.tier = TIERS[this.level];
    this.cooldown = 2;
    this.headroom = 0;
  }

  // `dt` is the real elapsed wall-clock time for the frame just presented.
  frame(dt) {
    const ms = Math.min(200, dt * 1000);
    if (this.count < WINDOW) this.count++;
    else this.sum -= this.samples[this.cursor];
    this.samples[this.cursor] = ms;
    this.sum += ms;
    this.cursor = (this.cursor + 1) % WINDOW;
    const avg = this.sum / this.count;
    // Track the display's own cadence, drifting up slowly so a machine that
    // genuinely slows down is not measured against its best day forever.
    if (ms > 4) this.period = Math.min(this.period * 1.0008, Math.max(ms, 6));
    // Smoothed so the readout is legible rather than twitchy.
    this.fps += (1000 / Math.max(1, avg) - this.fps) * 0.12;
    this.avgMs = avg;
    if (this.mode === 'auto') this._adapt(dt, avg);
    return this.tier;
  }

  _adapt(dt, avg) {
    this.cooldown -= dt;
    // A full window is needed before the first judgement: the opening frames
    // of a level include generation and sprite baking.
    if (this.count < WINDOW || this.cooldown > 0) return;

    const struggling = avg > this.period * 1.25 || avg > 30;
    if (struggling && this.level > 0) {
      this.level--;
      this.tier = TIERS[this.level];
      this.cooldown = 3;
      this.headroom = 0;
      return;
    }
    if (!struggling && avg < this.period * 1.08 && this.level < TIERS.length - 1) {
      // Only climb after sustained slack, so quality does not oscillate on the
      // way through a doorway into a busy room.
      this.headroom += 1;
      this.cooldown = 1;
      if (this.headroom >= 4) {
        this.level++;
        this.tier = TIERS[this.level];
        this.cooldown = 5;
        this.headroom = 0;
      }
      return;
    }
    this.headroom = 0;
    this.cooldown = 1;
  }

  reset() {
    this.count = 0; this.cursor = 0; this.sum = 0;
    this.cooldown = 2;
    this.headroom = 0;
  }
}
