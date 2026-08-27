// Sound effects, synthesised at runtime with the Web Audio API.
//
// No asset downloads, and every sound is parameterised by where it happened
// and what kind of place it happened in. The signal path is:
//
//   voice -> [tone filter] -> [distance gain] -> [pan] -+-> sfxBus -> master
//                                                       `-> send --.
//   musicBus -+-> master                                           |
//             `-> send ------------------------------------------->+-> damp
//                                                                  -> convolver A/B
//                                                                  -> wet -> master
//
// Two convolvers exist so the impulse can change without a click: the idle one
// is loaded with the new room and the pair is crossfaded.

import { buildImpulse } from './reverb.js';
import { DEFAULT_SPACE } from './space.js';
import { clamp } from '../core/util.js';

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
    this.space = { ...DEFAULT_SPACE };
    this.listener = { x: 0, y: 0 };
    this.profile = 'chamber';
    this.impulses = new Map();
    this.activeConv = 0;
    this.reverbEnabled = true;
    this._dest = null;
  }

  init() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    const ctx = this.ctx;
    noiseBuffer = makeNoise(ctx);

    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -10;
    this.limiter.ratio.value = 8;
    this.limiter.attack.value = 0.004;
    this.limiter.release.value = 0.16;
    this.limiter.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = this.settings.master;
    this.master.connect(this.limiter);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.settings.sfx;
    this.sfxBus.connect(this.master);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.settings.music;
    this.musicBus.connect(this.master);

    this._buildReverb();

    this.ready = true;
    return ctx;
  }

  _buildReverb() {
    const ctx = this.ctx;
    // Everything destined for the room goes through one damping filter, so a
    // fog-choked passage swallows the top of the reverb without touching the
    // dry signal.
    this.damp = ctx.createBiquadFilter();
    this.damp.type = 'lowpass';
    this.damp.frequency.value = 5200;
    this.damp.Q.value = 0.4;

    this.spaceIn = ctx.createGain();
    this.spaceIn.gain.value = 1;
    this.spaceIn.connect(this.damp);

    this.wet = ctx.createGain();
    this.wet.gain.value = 0.28;
    this.wet.connect(this.master);

    this.convs = [];
    this.convGains = [];
    for (let i = 0; i < 2; i++) {
      const c = ctx.createConvolver();
      c.normalize = false;
      const g = ctx.createGain();
      g.gain.value = i === 0 ? 1 : 0;
      this.damp.connect(c);
      c.connect(g);
      g.connect(this.wet);
      this.convs.push(c);
      this.convGains.push(g);
    }
    this.convs[0].buffer = this._impulse('chamber');

    // Sends. Sound effects carry most of the room; music gets a gentler push
    // so the score stays legible while the dungeon reverberates around it.
    this.sfxSend = ctx.createGain();
    this.sfxSend.gain.value = 0.34;
    this.sfxBus.connect(this.sfxSend);
    this.sfxSend.connect(this.spaceIn);

    this.musicSend = ctx.createGain();
    this.musicSend.gain.value = 0.2;
    this.musicBus.connect(this.musicSend);
    this.musicSend.connect(this.spaceIn);
  }

  _impulse(id) {
    if (!this.impulses.has(id)) this.impulses.set(id, buildImpulse(this.ctx, id));
    return this.impulses.get(id);
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }

  applySettings() {
    if (!this.ready) return;
    this.master.gain.value = this.settings.master;
    this.sfxBus.gain.value = this.settings.sfx;
    this.musicBus.gain.value = this.settings.music;
  }

  setListener(x, y) { this.listener.x = x; this.listener.y = y; }

  // --- the room -----------------------------------------------------------
  // Called a few times a second with the geometry around the listener. The
  // continuous parameters move smoothly; the impulse itself only changes when
  // the player crosses into a genuinely different kind of space, and even then
  // it crossfades over the best part of a second.
  setSpace(space, profileId, mods = {}) {
    this.space = space;
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const ramp = 0.9;
    const s = space.size;

    // Absorption: fog, mud and vines eat the reverb; ice and bare stone do not.
    const absorb = clamp(mods.absorb === undefined ? 0 : mods.absorb, 0, 1);
    const bright = clamp(mods.brightness === undefined ? 1 : mods.brightness, 0.3, 1.6);

    const wetTarget = this.reverbEnabled
      ? (0.14 + s * 0.46 + space.corridor * 0.14) * (1 - absorb * 0.6)
      : 0;
    const ease = (node, value) => {
      node.gain.cancelScheduledValues(t);
      node.gain.setValueAtTime(node.gain.value, t);
      node.gain.linearRampToValueAtTime(value, t + ramp);
    };
    ease(this.wet, wetTarget);
    // A tight space returns more of the sound, but returns it early and dark.
    ease(this.sfxSend, 0.24 + space.tight * 0.2 + s * 0.22);
    ease(this.musicSend, 0.12 + s * 0.22);

    const cutoff = (1400 + 6200 * Math.pow(bright, 1.5) * (0.35 + space.ceiling * 0.9))
      * (1 - absorb * 0.55);
    this.damp.frequency.cancelScheduledValues(t);
    this.damp.frequency.setValueAtTime(this.damp.frequency.value, t);
    this.damp.frequency.linearRampToValueAtTime(clamp(cutoff, 500, 16000), t + ramp);

    if (profileId && profileId !== this.profile && this.reverbEnabled) {
      this.profile = profileId;
      const next = this.activeConv === 0 ? 1 : 0;
      this.convs[next].buffer = this._impulse(profileId);
      const swap = 1.1;
      const fade = (node, value) => {
        node.gain.cancelScheduledValues(t);
        node.gain.setValueAtTime(node.gain.value, t);
        node.gain.linearRampToValueAtTime(value, t + swap);
      };
      fade(this.convGains[next], 1);
      fade(this.convGains[this.activeConv], 0);
      this.activeConv = next;
    }
  }

  setReverbEnabled(on) {
    this.reverbEnabled = on;
    if (this.ready) this.setSpace(this.space, this.profile);
  }

  // --- voices -------------------------------------------------------------
  // A positional sound gets its own little chain: muffled and quietened by
  // distance, placed left or right by where it is on screen, and pushed
  // further into the reverb the further away it is.
  _voice(opts) {
    if (!opts || opts.x === undefined) return { input: this.sfxBus, gain: 1 };
    const ctx = this.ctx;
    const dx = opts.x - this.listener.x;
    const dy = opts.y - this.listener.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 26) return null;                       // out of earshot entirely

    // `heard` is the world's own answer to "can this be heard from here",
    // worked out along open ground rather than straight through the stone.
    // When it is present it overrides every distance guess made here.
    const heard = opts.heard || null;
    const travelled = heard ? heard.distance : dist;

    const out = ctx.createGain();
    out.gain.value = heard ? heard.volume : 1 / (1 + Math.pow(dist / 4.5, 1.7));
    // The isometric view draws +x to the upper right and +y to the lower left,
    // so screen-space left/right is (dx - dy).
    const pan = clamp((dx - dy) / 9, -1, 1) * 0.85;

    let tail = out;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      out.connect(p);
      tail = p;
    }
    // Air and stone both take the top off a distant sound; so does a wall
    // between you and it.
    // Every bend the sound turned takes more of the top off it, which is what
    // makes "round the corner" audibly different from "over there".
    const occluded = heard
      ? Math.max(0.14, 1 - heard.echo * 0.72)
      : (opts.occluded ? 0.35 : 1);
    const cutoff = clamp(19000 * Math.exp(-travelled / 9) * occluded, 320, 20000);
    if (cutoff < 17000) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = cutoff;
      f.Q.value = 0.5;
      tail.connect(f);
      tail = f;
    }
    tail.connect(this.sfxBus);
    // Distance is mostly reverb: a far-off door is nearly all room.
    const send = ctx.createGain();
    // A sound that has been round two corners is nearly all reflection by the
    // time it arrives, whatever the room it started in was like.
    send.gain.value = heard
      ? clamp(0.15 + heard.echo * 0.85, 0, 1) * 0.62 * (this.space.size * 0.5 + 0.5)
      : clamp(dist / 14, 0, 1) * 0.5 * (this.space.size * 0.7 + 0.3);
    tail.connect(send);
    send.connect(this.spaceIn);
    return { input: out, gain: out.gain.value };
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
    if (!this.ready || !this._dest) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    if (detune) osc.detune.setValueAtTime(detune, t);
    this._env(gain, t, attack, dur * 0.2, dur * 0.8, peak);
    osc.connect(gain);
    gain.connect(this._dest);
    osc.start(t);
    osc.stop(t + dur + 0.12);
  }

  noise({ dur = 0.2, type = 'bandpass', f0 = 1200, f1 = null, q = 1, peak = 0.3, delay = 0, attack = 0.004 }) {
    if (!this.ready || !this._dest) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    // A random read offset stops repeated hits sounding like the same tape.
    const off = Math.random() * (noiseBuffer.duration - dur - 0.2);
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(f0, t);
    if (f1) filter.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    filter.Q.value = q;
    const gain = this.ctx.createGain();
    this._env(gain, t, attack, dur * 0.15, dur * 0.85, peak);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this._dest);
    src.start(t, Math.max(0, off));
    src.stop(t + dur + 0.12);
  }

  // A struck-metal partial: several inharmonic sines is what separates a
  // sword ringing off stone from a drum.
  ring(freqs, { dur = 0.5, peak = 0.1, delay = 0, spread = 1 }) {
    if (!this.ready || !this._dest) return;
    freqs.forEach((f, i) => {
      this.tone({
        freq: f * spread, type: i === 0 ? 'triangle' : 'sine',
        dur: dur * (1 - i * 0.16), peak: peak * Math.pow(0.62, i),
        attack: 0.002, delay: delay + i * 0.002,
      });
    });
  }

  // --- dispatch -----------------------------------------------------------
  play(name, opts = {}) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    const key = opts.key || name;
    const last = this.lastPlayed.get(key) || -1;
    const minGap = THROTTLE[name] || 0;
    if (minGap && now - last < minGap) return;
    this.lastPlayed.set(key, now);
    if (this.lastPlayed.size > THROTTLE_KEYS) this._pruneThrottle(now);

    const fn = EFFECTS[name];
    if (!fn) return;
    const voice = this._voice(opts);
    if (!voice) return;                     // too far away to bother
    this._dest = voice.input;
    try {
      fn(this, opts);
    } finally {
      this._dest = null;
    }
  }

  // Throttling is keyed per source -- 'alert' + enemy id and the like -- so
  // the table grows by one entry for every creature that ever made a noise.
  // Anything older than the longest gap can never suppress a sound again, so
  // sweeping those out is free. A burst big enough to survive the sweep gets
  // the table dropped wholesale rather than left to be rescanned on every
  // subsequent call: the only cost of forgetting is that one sound may repeat
  // a few milliseconds sooner than it strictly should.
  _pruneThrottle(now) {
    const cutoff = now - MAX_THROTTLE;
    for (const [key, when] of this.lastPlayed) {
      if (when < cutoff) this.lastPlayed.delete(key);
    }
    if (this.lastPlayed.size > THROTTLE_KEYS) this.lastPlayed.clear();
  }
}

// Random variation helpers, used to keep repeated sounds alive.
function vary(amount) { return 1 + (Math.random() * 2 - 1) * amount; }

const THROTTLE = {
  hit: 0.03, step: 0.1, swing: 0.05, swingWall: 0.06,
  enemyDeath: 0.03, arrowHit: 0.03, alert: 0.18, windup: 0.08, enemyShot: 0.06,
  drip: 0.25, emberPop: 0.2, scurry: 0.8, flutter: 1.2,
  creatureVoice: 0.35, clatterFar: 0.12, scream: 1.5,
};

const MAX_THROTTLE = Math.max(...Object.values(THROTTLE));
// Comfortably more live sources than a level can hold, so the sweep is rare.
const THROTTLE_KEYS = 512;

// --- material tables -------------------------------------------------------
// What the blade lands on decides the sound far more than how hard it landed,
// so impacts are looked up by material and only then scaled by damage.

const IMPACTS = {
  flesh: (a) => {
    a.noise({ dur: 0.11, type: 'lowpass', f0: 2400 * vary(0.1), f1: 280, q: 1, peak: 0.34 });
    a.tone({ freq: 150 * vary(0.1), to: 58, type: 'triangle', dur: 0.16, peak: 0.3 });
    a.noise({ dur: 0.16, type: 'bandpass', f0: 620, f1: 240, q: 1.6, peak: 0.12, delay: 0.02 });
  },
  bone: (a) => {
    a.noise({ dur: 0.045, type: 'highpass', f0: 2600, peak: 0.3, attack: 0.001 });
    a.tone({ freq: 460 * vary(0.09), to: 120, type: 'square', dur: 0.09, peak: 0.16 });
    a.ring([880 * vary(0.06), 1290, 1910], { dur: 0.16, peak: 0.09 });
    a.tone({ freq: 120, to: 52, type: 'sine', dur: 0.18, peak: 0.2 });
  },
  armour: (a, o) => {
    a.noise({ dur: 0.028, type: 'highpass', f0: 4200, peak: 0.3, attack: 0.001 });
    a.ring([1640 * vary(0.05), 2510, 3720, 5210], { dur: 0.5 + (a.space.size * 0.4), peak: 0.13 });
    a.tone({ freq: 210 * vary(0.08), to: 70, type: 'triangle', dur: 0.2, peak: 0.24 });
    if (o && o.glancing) a.noise({ dur: 0.14, type: 'bandpass', f0: 3400, f1: 1200, q: 3, peak: 0.1 });
  },
  ethereal: (a) => {
    a.tone({ freq: 720 * vary(0.08), to: 190, type: 'sine', dur: 0.34, peak: 0.16 });
    a.tone({ freq: 1090, to: 288, type: 'sine', dur: 0.3, peak: 0.09, delay: 0.015, detune: 18 });
    a.noise({ dur: 0.3, type: 'bandpass', f0: 2800, f1: 700, q: 0.7, peak: 0.1 });
  },
  ice: (a) => {
    a.noise({ dur: 0.035, type: 'highpass', f0: 5200, peak: 0.26, attack: 0.001 });
    a.ring([2340 * vary(0.05), 3410, 5120, 7180], { dur: 0.36, peak: 0.11 });
    a.tone({ freq: 170, to: 62, type: 'sine', dur: 0.17, peak: 0.2 });
    for (let i = 0; i < 3; i++) {
      a.tone({ freq: 2600 + Math.random() * 2600, to: 1400, type: 'triangle', dur: 0.11, peak: 0.05, delay: 0.05 + i * 0.04 });
    }
  },
  ember: (a) => {
    a.noise({ dur: 0.26, type: 'highpass', f0: 3000, peak: 0.17 });
    a.tone({ freq: 130 * vary(0.1), to: 46, type: 'sine', dur: 0.26, peak: 0.3 });
    a.noise({ dur: 0.18, type: 'lowpass', f0: 1600, f1: 260, peak: 0.2 });
  },
  wood: (a) => {
    a.tone({ freq: 240 * vary(0.09), to: 96, type: 'triangle', dur: 0.14, peak: 0.28 });
    a.noise({ dur: 0.1, type: 'bandpass', f0: 900, f1: 320, q: 2.2, peak: 0.2 });
    a.tone({ freq: 96, to: 52, type: 'sine', dur: 0.22, peak: 0.18 });
  },
  stone: (a) => {
    a.noise({ dur: 0.04, type: 'highpass', f0: 3600, peak: 0.28, attack: 0.001 });
    a.tone({ freq: 200 * vary(0.08), to: 64, type: 'triangle', dur: 0.15, peak: 0.26 });
    a.noise({ dur: 0.2, type: 'bandpass', f0: 1000, f1: 340, q: 1.6, peak: 0.16 });
  },
};

const SURFACES = {
  stone: (a, p) => {
    a.noise({ dur: 0.07 * vary(0.2), type: 'lowpass', f0: 950 * vary(0.16), f1: 300, peak: p });
    a.tone({ freq: 132 * vary(0.14), to: 74, type: 'sine', dur: 0.05, peak: p * 0.5 });
  },
  crypt: (a, p) => {
    a.noise({ dur: 0.06 * vary(0.2), type: 'bandpass', f0: 1900 * vary(0.15), f1: 700, q: 1.1, peak: p * 0.95 });
    a.tone({ freq: 160 * vary(0.12), to: 88, type: 'sine', dur: 0.045, peak: p * 0.4 });
  },
  wet: (a, p) => {
    a.noise({ dur: 0.12 * vary(0.2), type: 'bandpass', f0: 1600 * vary(0.2), f1: 480, q: 1.6, peak: p * 1.15 });
    a.noise({ dur: 0.06, type: 'highpass', f0: 3800, peak: p * 0.6, delay: 0.02 });
  },
  mud: (a, p) => {
    a.noise({ dur: 0.16 * vary(0.18), type: 'lowpass', f0: 540 * vary(0.2), f1: 170, peak: p * 1.2 });
    a.tone({ freq: 92 * vary(0.15), to: 54, type: 'sine', dur: 0.1, peak: p * 0.5 });
  },
  ice: (a, p) => {
    a.noise({ dur: 0.05, type: 'highpass', f0: 4200 * vary(0.15), peak: p * 0.9 });
    a.ring([2900 * vary(0.08), 4300], { dur: 0.12, peak: p * 0.4 });
  },
  ash: (a, p) => {
    a.noise({ dur: 0.13 * vary(0.2), type: 'bandpass', f0: 2600 * vary(0.2), f1: 900, q: 0.7, peak: p * 0.85 });
    a.tone({ freq: 110, to: 62, type: 'sine', dur: 0.05, peak: p * 0.35 });
  },
  moss: (a, p) => {
    a.noise({ dur: 0.1 * vary(0.2), type: 'lowpass', f0: 760 * vary(0.18), f1: 240, peak: p * 0.9 });
    a.noise({ dur: 0.05, type: 'bandpass', f0: 2400, q: 1.2, peak: p * 0.3, delay: 0.015 });
  },
};

// --- the effect table ------------------------------------------------------

const EFFECTS = {
  // --- player melee. The whoosh is shaped by the room it is swung in: long
  // and airy in a hall, clipped and dull in a passage, and cut short entirely
  // when the arc is going to end in stone.
  swing: (a, o) => {
    const s = a.space;
    const air = 0.35 + s.size * 0.65;
    const dur = (o.blocked ? 0.095 : 0.12 + air * 0.1) * vary(0.1);
    a.noise({
      dur, type: 'bandpass', f0: 2500 * vary(0.07),
      f1: 600 + s.tight * 380, q: 1 + s.tight * 0.9, peak: 0.15,
    });
    a.tone({ freq: 3100 * vary(0.05), to: 1450, type: 'sine', dur: dur * 0.7, peak: 0.028 });
    // Between two close walls the swing answers itself almost at once.
    if (s.tight > 0.35) {
      a.noise({ dur: 0.055, type: 'bandpass', f0: 1900, q: 3.2, peak: 0.05 * s.tight, delay: 0.03 });
    }
  },
  // The blade lands on masonry: bright transient, a long metal ring, a dull
  // thud through the wall and a little falling grit.
  swingWall: (a) => {
    const s = a.space;
    a.noise({ dur: 0.03, type: 'highpass', f0: 3800, peak: 0.32, attack: 0.001 });
    a.ring([2180 * vary(0.04), 3260, 4790], { dur: 0.4 + s.size * 0.35, peak: 0.12 });
    a.tone({ freq: 190 * vary(0.09), to: 60, type: 'triangle', dur: 0.17, peak: 0.26 });
    a.noise({ dur: 0.19, type: 'bandpass', f0: 1150, f1: 380, q: 1.4, peak: 0.14, delay: 0.008 });
    for (let i = 0; i < 3; i++) {
      a.noise({
        dur: 0.05, type: 'bandpass', f0: 2200 + Math.random() * 2400,
        q: 5, peak: 0.045, delay: 0.09 + i * 0.055,
      });
    }
  },
  swingMiss: (a) => a.noise({ dur: 0.2, type: 'bandpass', f0: 1500, f1: 500, q: 0.9, peak: 0.09 }),
  hit: (a, o) => (IMPACTS[o.material] || IMPACTS.flesh)(a, o),
  // --- crossbow
  crossbow: (a) => {
    a.noise({ dur: 0.07, type: 'highpass', f0: 2600, peak: 0.18 });
    a.tone({ freq: 900 * vary(0.05), to: 300, type: 'square', dur: 0.09, peak: 0.1 });
    a.ring([1420, 2130], { dur: 0.14, peak: 0.05, delay: 0.005 });
  },
  arrowHit: (a, o) => {
    a.noise({ dur: 0.09, type: 'bandpass', f0: 1800 * vary(0.1), f1: 500, q: 2, peak: 0.24 });
    a.tone({ freq: 220, to: 90, type: 'triangle', dur: 0.1, peak: 0.16 });
    if (o.material === 'armour' || o.material === 'bone') {
      a.ring([1900, 2840], { dur: 0.2, peak: 0.07 });
    }
  },
  arrowWall: (a) => {
    a.noise({ dur: 0.1, type: 'bandpass', f0: 3200, f1: 900, q: 3, peak: 0.16 });
    a.tone({ freq: 1400 * vary(0.08), to: 700, type: 'triangle', dur: 0.12, peak: 0.05 });
  },
  shotWall: (a) => a.noise({ dur: 0.12, type: 'bandpass', f0: 1400, f1: 400, q: 2, peak: 0.14 }),
  enemyShot: (a) => a.tone({ freq: 620 * vary(0.06), to: 260, type: 'sawtooth', dur: 0.16, peak: 0.1 }),
  // --- damage and death
  playerHurt: (a) => {
    a.tone({ freq: 300 * vary(0.06), to: 90, type: 'sawtooth', dur: 0.24, peak: 0.24 });
    a.noise({ dur: 0.2, type: 'lowpass', f0: 900, f1: 200, peak: 0.2 });
  },
  enemyDeath: (a, o) => {
    const mat = o.material || 'flesh';
    a.tone({ freq: 220 * vary(0.08), to: 70, type: 'triangle', dur: 0.3, peak: 0.18 });
    a.noise({ dur: 0.28, type: 'lowpass', f0: 1400, f1: 180, peak: 0.16 });
    if (mat === 'bone' || mat === 'armour') {
      for (let i = 0; i < 4; i++) {
        a.noise({
          dur: 0.07, type: 'bandpass', f0: 1400 + Math.random() * 2000,
          q: 4, peak: 0.07, delay: 0.12 + i * 0.07,
        });
      }
    } else if (mat === 'ethereal') {
      a.tone({ freq: 900, to: 180, type: 'sine', dur: 0.7, peak: 0.1, delay: 0.05 });
    } else if (mat === 'ice') {
      a.ring([2600, 3900, 5400], { dur: 0.4, peak: 0.08, delay: 0.06 });
    }
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
    a.ring([1880, 2760, 4100], { dur: 0.34 + a.space.size * 0.3, peak: 0.09 });
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
  alert: (a) => a.tone({ freq: 520 * vary(0.05), to: 760, type: 'square', dur: 0.13, peak: 0.09 }),
  windup: (a) => a.noise({ dur: 0.18, type: 'bandpass', f0: 700, f1: 1500, q: 2, peak: 0.08 }),
  ambush: (a) => {
    a.tone({ freq: 420, to: 120, type: 'sawtooth', dur: 0.45, peak: 0.24 });
    a.noise({ dur: 0.4, type: 'lowpass', f0: 1600, f1: 220, peak: 0.22 });
  },
  // --- footsteps. The surface picks the timbre; the room supplies the tail.
  step: (a, o) => {
    const fn = SURFACES[o.surface] || SURFACES.stone;
    fn(a, (o.peak || 0.075) * (0.85 + a.space.tight * 0.35));
  },
  // --- ambient punctuation, fired by the environment layer
  drip: (a) => {
    a.tone({ freq: 1500 * vary(0.25), to: 640, type: 'sine', dur: 0.12, peak: 0.09 });
    a.noise({ dur: 0.05, type: 'bandpass', f0: 3200, q: 4, peak: 0.04 });
  },
  emberPop: (a) => {
    a.noise({ dur: 0.05 * vary(0.3), type: 'bandpass', f0: 1800 * vary(0.35), q: 3, peak: 0.07 });
    a.tone({ freq: 300 * vary(0.3), to: 120, type: 'triangle', dur: 0.06, peak: 0.04 });
  },
  gust: (a) => a.noise({ dur: 1.6 * vary(0.2), type: 'bandpass', f0: 380, f1: 900, q: 0.6, peak: 0.055, attack: 0.5 }),
  // --- fire. Catching is a rising rush; going out is the same shape backwards.
  torchLight: (a) => {
    a.noise({ dur: 0.5, type: 'bandpass', f0: 500, f1: 2400, q: 0.8, peak: 0.16, attack: 0.06 });
    a.tone({ freq: 140, to: 320, type: 'sawtooth', dur: 0.3, peak: 0.06 });
  },
  torchDouse: (a) => {
    a.noise({ dur: 0.45, type: 'bandpass', f0: 2200, f1: 260, q: 0.7, peak: 0.14, attack: 0.02 });
    a.tone({ freq: 240, to: 90, type: 'sine', dur: 0.35, peak: 0.05 });
  },
  // --- creature voices
  //
  // One generator, parameterised by the archetype, rather than ten hand-built
  // sounds. `o.variant` picks one of three shapes within a timbre, so a hound
  // heard three times in a corridor is recognisably the same animal and not
  // the same recording.
  creatureVoice: (a, o) => {
    const f = (o.pitch || 140) * vary(0.06) * (1 + (o.variant || 0) * 0.09);
    const long = 0.5 + (o.variant || 0) * 0.16;
    switch (o.timbre) {
      case 'snarl':
        a.noise({ dur: 0.3 * long, type: 'bandpass', f0: f * 3, f1: f * 1.4, q: 1.4, peak: 0.2 });
        a.tone({ freq: f, to: f * 0.7, type: 'sawtooth', dur: 0.28 * long, peak: 0.1 });
        break;
      case 'whisper':
        a.noise({ dur: 0.9 * long, type: 'bandpass', f0: f, f1: f * 1.6, q: 5, peak: 0.1, attack: 0.25 });
        a.tone({ freq: f * 2, to: f * 1.5, type: 'sine', dur: 0.7 * long, peak: 0.035, attack: 0.2 });
        break;
      case 'clank':
        a.tone({ freq: f * 6.2, to: f * 5.4, type: 'square', dur: 0.24, peak: 0.09 });
        a.noise({ dur: 0.16, type: 'bandpass', f0: f * 9, q: 2.4, peak: 0.09 });
        break;
      case 'hiss':
        a.noise({ dur: 1.1 * long, type: 'highpass', f0: f * 4, peak: 0.075, attack: 0.3 });
        break;
      case 'clatter':
        for (let i = 0; i < 4; i++) {
          a.noise({ dur: 0.05, type: 'bandpass', f0: f * (4 + i) * vary(0.2), q: 5, peak: 0.075, delay: i * 0.07 });
        }
        break;
      case 'moan':
        a.tone({ freq: f, to: f * 0.78, type: 'sine', dur: 1.3 * long, peak: 0.16, attack: 0.4 });
        a.tone({ freq: f * 1.5, to: f * 1.2, type: 'triangle', dur: 1.1 * long, peak: 0.05, attack: 0.4 });
        break;
      case 'crackle':
        for (let i = 0; i < 6; i++) {
          a.noise({ dur: 0.06, type: 'bandpass', f0: 1400 * vary(0.5), q: 3, peak: 0.07, delay: i * 0.06 });
        }
        a.tone({ freq: f, to: f * 0.6, type: 'sawtooth', dur: 0.4, peak: 0.06 });
        break;
      case 'creak':
        a.tone({ freq: f, to: f * 1.35, type: 'sawtooth', dur: 1.5 * long, peak: 0.14, attack: 0.5 });
        a.noise({ dur: 0.9, type: 'bandpass', f0: f * 8, q: 6, peak: 0.05, attack: 0.4 });
        break;
      case 'wail':
        a.tone({ freq: f * 0.8, to: f * 1.7, type: 'triangle', dur: 1.4 * long, peak: 0.13, attack: 0.5 });
        a.tone({ freq: f * 1.6, to: f * 2.6, type: 'sine', dur: 1.2 * long, peak: 0.05, attack: 0.5 });
        break;
      default:   // groan
        a.tone({ freq: f, to: f * 0.72, type: 'sawtooth', dur: 1.0 * long, peak: 0.17, attack: 0.3 });
        a.noise({ dur: 0.7 * long, type: 'lowpass', f0: f * 7, f1: f * 3, peak: 0.07, attack: 0.3 });
        break;
    }
  },
  // A stone or bolt landing somewhere the player is not: what a distraction
  // sounds like from the player's side of it.
  clatterFar: (a) => {
    for (let i = 0; i < 3; i++) {
      a.noise({ dur: 0.07, type: 'bandpass', f0: 2200 * vary(0.4), q: 3, peak: 0.11, delay: i * 0.055 });
    }
    a.tone({ freq: 260 * vary(0.3), to: 120, type: 'triangle', dur: 0.16, peak: 0.06 });
  },
  // A human throat, which is a sound nothing else down here makes.
  scream: (a) => {
    a.tone({ freq: 420 * vary(0.2), to: 780, type: 'sawtooth', dur: 0.9, peak: 0.2, attack: 0.04 });
    a.tone({ freq: 860 * vary(0.2), to: 640, type: 'triangle', dur: 0.8, peak: 0.09, attack: 0.06 });
    a.noise({ dur: 0.7, type: 'bandpass', f0: 1600, f1: 900, q: 1.6, peak: 0.07, attack: 0.05 });
  },
  // --- small things living in the walls
  scurry: (a) => {
    for (let i = 0; i < 4; i++) {
      a.noise({ dur: 0.035, type: 'bandpass', f0: 3400 * vary(0.3), q: 6, peak: 0.028, delay: i * 0.055 });
    }
  },
  flutter: (a) => {
    for (let i = 0; i < 5; i++) {
      a.noise({ dur: 0.07, type: 'bandpass', f0: 900 * vary(0.3), q: 2, peak: 0.03, delay: i * 0.09 });
    }
  },
  distantFall: (a) => {
    a.noise({ dur: 0.9, type: 'lowpass', f0: 420, f1: 120, peak: 0.09, attack: 0.05 });
    a.tone({ freq: 70, to: 40, type: 'sine', dur: 1.1, peak: 0.07 });
  },
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

// Older call sites used one name per footstep surface. Keep them working.
EFFECTS.stepWet = (a, o) => EFFECTS.step(a, { ...o, surface: 'wet' });
EFFECTS.stepMud = (a, o) => EFFECTS.step(a, { ...o, surface: 'mud' });

export { EFFECTS, IMPACTS, SURFACES };
