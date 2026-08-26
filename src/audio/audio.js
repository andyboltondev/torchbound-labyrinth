// Sound effects, synthesised at runtime with the Web Audio API.
// No asset downloads, and every sound can be parameterised by context.

let noiseBuffer = null;

function makeNoise(ctx, seconds = 2) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

export class AudioEngine {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.ready = false;
    this.master = null;
    this.sfxBus = null;
    this.musicBus = null;
    this.lastPlayed = new Map();
  }

  init() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    noiseBuffer = makeNoise(this.ctx);
    this.master = this.ctx.createGain();
    this.master.gain.value = this.settings.master;
    this.master.connect(this.ctx.destination);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.settings.sfx;
    this.sfxBus.connect(this.master);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.settings.music;
    this.musicBus.connect(this.master);

    // A gentle limiter keeps busy fights from clipping.
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -10;
    this.limiter.ratio.value = 8;
    this.limiter.attack.value = 0.004;
    this.limiter.release.value = 0.16;
    this.master.disconnect();
    this.master.connect(this.limiter);
    this.limiter.connect(this.ctx.destination);

    this.ready = true;
    return this.ctx;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }

  applySettings() {
    if (!this.ready) return;
    this.master.gain.value = this.settings.master;
    this.sfxBus.gain.value = this.settings.sfx;
    this.musicBus.gain.value = this.settings.music;
  }

  // --- primitives ---------------------------------------------------------
  _env(gain, t, attack, hold, release, peak) {
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    gain.gain.setValueAtTime(Math.max(0.0002, peak), t + attack + hold);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  }

  tone({ freq = 220, to = null, type = 'sine', dur = 0.2, peak = 0.3, attack = 0.005, delay = 0, detune = 0 }) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    if (detune) osc.detune.setValueAtTime(detune, t);
    this._env(gain, t, attack, dur * 0.2, dur * 0.8, peak);
    osc.connect(gain);
    gain.connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + dur + 0.12);
  }

  noise({ dur = 0.2, type = 'bandpass', f0 = 1200, f1 = null, q = 1, peak = 0.3, delay = 0, attack = 0.004 }) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(f0, t);
    if (f1) filter.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    filter.Q.value = q;
    const gain = this.ctx.createGain();
    this._env(gain, t, attack, dur * 0.15, dur * 0.85, peak);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus);
    src.start(t);
    src.stop(t + dur + 0.12);
  }

  // --- the effect table ---------------------------------------------------
  play(name, opts = {}) {
    if (!this.ready) return;
    // Rate-limit anything that could fire many times in one frame.
    const now = this.ctx.currentTime;
    const last = this.lastPlayed.get(name) || -1;
    const minGap = THROTTLE[name] || 0;
    if (minGap && now - last < minGap) return;
    this.lastPlayed.set(name, now);
    const fn = EFFECTS[name];
    if (fn) fn(this, opts);
  }
}

const THROTTLE = {
  hit: 0.04, step: 0.12, stepWet: 0.12, stepMud: 0.12, swing: 0.05,
  enemyDeath: 0.03, arrowHit: 0.03, alert: 0.18, windup: 0.08, enemyShot: 0.06,
};

const EFFECTS = {
  // --- player melee
  swing: (a) => a.noise({ dur: 0.17, type: 'bandpass', f0: 2400, f1: 700, q: 1.1, peak: 0.16 }),
  swingMiss: (a) => a.noise({ dur: 0.2, type: 'bandpass', f0: 1500, f1: 500, q: 0.9, peak: 0.09 }),
  hit: (a) => {
    a.noise({ dur: 0.12, type: 'lowpass', f0: 2600, f1: 300, q: 1, peak: 0.34 });
    a.tone({ freq: 150, to: 60, type: 'triangle', dur: 0.16, peak: 0.3 });
  },
  // --- crossbow
  crossbow: (a) => {
    a.noise({ dur: 0.07, type: 'highpass', f0: 2600, peak: 0.18 });
    a.tone({ freq: 900, to: 300, type: 'square', dur: 0.09, peak: 0.1 });
  },
  arrowHit: (a) => {
    a.noise({ dur: 0.09, type: 'bandpass', f0: 1800, f1: 500, q: 2, peak: 0.24 });
    a.tone({ freq: 220, to: 90, type: 'triangle', dur: 0.1, peak: 0.16 });
  },
  arrowWall: (a) => a.noise({ dur: 0.1, type: 'bandpass', f0: 3200, f1: 900, q: 3, peak: 0.16 }),
  shotWall: (a) => a.noise({ dur: 0.12, type: 'bandpass', f0: 1400, f1: 400, q: 2, peak: 0.14 }),
  enemyShot: (a) => a.tone({ freq: 620, to: 260, type: 'sawtooth', dur: 0.16, peak: 0.1 }),
  // --- damage and death
  playerHurt: (a) => {
    a.tone({ freq: 300, to: 90, type: 'sawtooth', dur: 0.24, peak: 0.24 });
    a.noise({ dur: 0.2, type: 'lowpass', f0: 900, f1: 200, peak: 0.2 });
  },
  enemyDeath: (a) => {
    a.tone({ freq: 220, to: 70, type: 'triangle', dur: 0.3, peak: 0.18 });
    a.noise({ dur: 0.28, type: 'lowpass', f0: 1400, f1: 180, peak: 0.16 });
  },
  eliteDeath: (a) => {
    a.tone({ freq: 160, to: 50, type: 'sawtooth', dur: 0.5, peak: 0.24 });
    a.noise({ dur: 0.45, type: 'lowpass', f0: 1800, f1: 140, peak: 0.2 });
    a.tone({ freq: 520, to: 180, type: 'triangle', dur: 0.4, peak: 0.1, delay: 0.05 });
  },
  death: (a) => {
    a.tone({ freq: 200, to: 40, type: 'sawtooth', dur: 1.6, peak: 0.3 });
    a.tone({ freq: 100, to: 28, type: 'sine', dur: 2.0, peak: 0.26, delay: 0.1 });
    a.noise({ dur: 1.4, type: 'lowpass', f0: 700, f1: 90, peak: 0.18 });
  },
  // --- shield
  block: (a) => {
    a.tone({ freq: 1200, to: 620, type: 'square', dur: 0.16, peak: 0.16 });
    a.noise({ dur: 0.16, type: 'bandpass', f0: 3200, f1: 1200, q: 3, peak: 0.2 });
  },
  blockPartial: (a) => a.noise({ dur: 0.14, type: 'bandpass', f0: 2200, f1: 900, q: 2, peak: 0.14 }),
  reflect: (a) => {
    a.tone({ freq: 1600, to: 420, type: 'square', dur: 0.3, peak: 0.2 });
    a.tone({ freq: 2400, to: 800, type: 'triangle', dur: 0.34, peak: 0.14, delay: 0.03 });
    a.noise({ dur: 0.3, type: 'bandpass', f0: 4200, f1: 1400, q: 4, peak: 0.22 });
  },
  // --- pickups and interaction
  keyPickup: (a) => {
    a.tone({ freq: 880, type: 'triangle', dur: 0.18, peak: 0.2 });
    a.tone({ freq: 1320, type: 'triangle', dur: 0.3, peak: 0.16, delay: 0.08 });
  },
  keyDrop: (a) => a.tone({ freq: 660, to: 990, type: 'triangle', dur: 0.24, peak: 0.16 }),
  pickup: (a) => a.tone({ freq: 740, to: 1100, type: 'triangle', dur: 0.14, peak: 0.16 }),
  coins: (a) => {
    for (let i = 0; i < 5; i++) {
      a.tone({ freq: 900 + Math.random() * 700, type: 'triangle', dur: 0.12, peak: 0.09, delay: i * 0.045 });
    }
  },
  drink: (a) => {
    a.noise({ dur: 0.3, type: 'lowpass', f0: 700, f1: 260, peak: 0.14 });
    a.tone({ freq: 340, to: 620, type: 'sine', dur: 0.4, peak: 0.14 });
  },
  fanfare: (a) => {
    [523, 659, 784, 1046].forEach((f, i) =>
      a.tone({ freq: f, type: 'triangle', dur: 0.5, peak: 0.16, delay: i * 0.09 }));
  },
  chest: (a) => {
    a.noise({ dur: 0.3, type: 'lowpass', f0: 1200, f1: 300, peak: 0.18 });
    a.tone({ freq: 180, to: 320, type: 'sine', dur: 0.32, peak: 0.14 });
  },
  curse: (a) => {
    a.tone({ freq: 320, to: 80, type: 'sawtooth', dur: 0.9, peak: 0.24 });
    a.tone({ freq: 90, to: 60, type: 'sine', dur: 1.2, peak: 0.24, delay: 0.06 });
  },
  denied: (a) => a.tone({ freq: 220, to: 150, type: 'square', dur: 0.14, peak: 0.12 }),
  gateUnlock: (a) => {
    a.noise({ dur: 0.5, type: 'bandpass', f0: 900, f1: 260, q: 1.4, peak: 0.2 });
    a.tone({ freq: 140, to: 90, type: 'sawtooth', dur: 0.7, peak: 0.2 });
    for (let i = 0; i < 4; i++) {
      a.noise({ dur: 0.1, type: 'bandpass', f0: 2600, q: 6, peak: 0.1, delay: 0.25 + i * 0.09 });
    }
  },
  descend: (a) => {
    a.tone({ freq: 260, to: 90, type: 'sine', dur: 1.0, peak: 0.2 });
    a.noise({ dur: 0.8, type: 'lowpass', f0: 900, f1: 180, peak: 0.14 });
  },
  shrineHeal: (a) => {
    [523, 784, 1046].forEach((f, i) =>
      a.tone({ freq: f, type: 'sine', dur: 0.8, peak: 0.14, delay: i * 0.11 }));
  },
  shrineBless: (a) => {
    [392, 587, 880].forEach((f, i) =>
      a.tone({ freq: f, type: 'triangle', dur: 1.0, peak: 0.13, delay: i * 0.13 }));
  },
  lifesteal: (a) => a.tone({ freq: 420, to: 720, type: 'sine', dur: 0.26, peak: 0.14 }),
  // --- world and encounters
  stoneBreak: (a) => {
    a.noise({ dur: 0.45, type: 'lowpass', f0: 2400, f1: 200, peak: 0.34 });
    a.tone({ freq: 120, to: 45, type: 'triangle', dur: 0.5, peak: 0.26 });
    for (let i = 0; i < 5; i++) {
      a.noise({ dur: 0.09, type: 'bandpass', f0: 1800 + Math.random() * 2200, q: 5, peak: 0.1, delay: 0.08 + i * 0.06 });
    }
  },
  secretSense: (a) => a.tone({ freq: 1180, to: 1560, type: 'sine', dur: 0.35, peak: 0.1 }),
  reveal: (a) => {
    a.noise({ dur: 0.6, type: 'lowpass', f0: 1800, f1: 240, peak: 0.24 });
    a.tone({ freq: 300, to: 520, type: 'triangle', dur: 0.7, peak: 0.14 });
  },
  seal: (a) => {
    a.tone({ freq: 160, to: 70, type: 'sawtooth', dur: 0.8, peak: 0.24 });
    a.noise({ dur: 0.6, type: 'lowpass', f0: 1100, f1: 160, peak: 0.2 });
  },
  wave: (a) => a.tone({ freq: 130, to: 200, type: 'sawtooth', dur: 0.7, peak: 0.2 }),
  encounterClear: (a) => {
    [440, 587, 740].forEach((f, i) =>
      a.tone({ freq: f, type: 'triangle', dur: 0.6, peak: 0.14, delay: i * 0.1 }));
  },
  flawless: (a) => {
    [784, 988, 1175, 1568].forEach((f, i) =>
      a.tone({ freq: f, type: 'sine', dur: 0.7, peak: 0.13, delay: i * 0.08 }));
  },
  alert: (a) => a.tone({ freq: 520, to: 760, type: 'square', dur: 0.13, peak: 0.09 }),
  windup: (a) => a.noise({ dur: 0.18, type: 'bandpass', f0: 700, f1: 1500, q: 2, peak: 0.08 }),
  ambush: (a) => {
    a.tone({ freq: 420, to: 120, type: 'sawtooth', dur: 0.45, peak: 0.24 });
    a.noise({ dur: 0.4, type: 'lowpass', f0: 1600, f1: 220, peak: 0.22 });
  },
  // --- footsteps
  step: (a) => a.noise({ dur: 0.07, type: 'lowpass', f0: 900, f1: 320, peak: 0.075 }),
  stepWet: (a) => a.noise({ dur: 0.11, type: 'bandpass', f0: 1500, f1: 500, q: 1.6, peak: 0.09 }),
  stepMud: (a) => a.noise({ dur: 0.15, type: 'lowpass', f0: 520, f1: 180, peak: 0.09 }),
  // --- bosses
  bossRoar: (a) => {
    a.tone({ freq: 110, to: 55, type: 'sawtooth', dur: 1.6, peak: 0.34 });
    a.tone({ freq: 74, to: 40, type: 'square', dur: 1.8, peak: 0.22, delay: 0.05 });
    a.noise({ dur: 1.4, type: 'lowpass', f0: 800, f1: 120, peak: 0.22 });
  },
  bossTelegraph: (a) => a.tone({ freq: 180, to: 420, type: 'sawtooth', dur: 0.6, peak: 0.14 }),
  bossCharge: (a) => a.noise({ dur: 0.7, type: 'lowpass', f0: 500, f1: 1400, peak: 0.2 }),
  bossSlam: (a) => {
    a.tone({ freq: 90, to: 32, type: 'sine', dur: 0.9, peak: 0.4 });
    a.noise({ dur: 0.7, type: 'lowpass', f0: 2200, f1: 120, peak: 0.3 });
  },
  bossShards: (a) => {
    for (let i = 0; i < 4; i++) {
      a.tone({ freq: 900 + i * 140, to: 400, type: 'triangle', dur: 0.3, peak: 0.1, delay: i * 0.04 });
    }
  },
  bossSummon: (a) => {
    a.tone({ freq: 260, to: 130, type: 'sawtooth', dur: 0.9, peak: 0.2 });
    a.tone({ freq: 65, type: 'sine', dur: 1.1, peak: 0.22, delay: 0.08 });
  },
  bossLash: (a) => a.noise({ dur: 0.34, type: 'bandpass', f0: 2600, f1: 500, q: 1.4, peak: 0.24 }),
  bossDeath: (a) => {
    a.tone({ freq: 140, to: 34, type: 'sawtooth', dur: 2.4, peak: 0.36 });
    a.tone({ freq: 70, to: 26, type: 'sine', dur: 2.8, peak: 0.3, delay: 0.15 });
    a.noise({ dur: 2.0, type: 'lowpass', f0: 1200, f1: 70, peak: 0.24 });
    [523, 659, 784, 1046, 1318].forEach((f, i) =>
      a.tone({ freq: f, type: 'triangle', dur: 1.2, peak: 0.12, delay: 0.7 + i * 0.13 }));
  },
  // --- interface
  uiClick: (a) => a.tone({ freq: 660, to: 880, type: 'triangle', dur: 0.08, peak: 0.12 }),
  uiBack: (a) => a.tone({ freq: 520, to: 330, type: 'triangle', dur: 0.1, peak: 0.11 }),
  relicTake: (a) => {
    [392, 523, 659, 880].forEach((f, i) =>
      a.tone({ freq: f, type: 'triangle', dur: 0.9, peak: 0.15, delay: i * 0.1 }));
    a.noise({ dur: 0.5, type: 'highpass', f0: 3400, peak: 0.07 });
  },
  levelStart: (a) => {
    a.tone({ freq: 98, type: 'sine', dur: 1.8, peak: 0.22 });
    a.tone({ freq: 147, type: 'triangle', dur: 1.4, peak: 0.12, delay: 0.2 });
  },
};
