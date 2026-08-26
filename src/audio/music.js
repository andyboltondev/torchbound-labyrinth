// Adaptive procedural score.
//
// There are no tracks to cut between: a small set of layers is always running
// and their gains are crossfaded by what is happening in the dungeon. Fog is
// sparse and distant, embers get low percussion, combat adds rhythm, a boss
// opens everything up.

const SCALES = {
  ruins: { root: 146.83, steps: [0, 2, 3, 5, 7, 8, 10] },       // D aeolian
  crypt: { root: 130.81, steps: [0, 1, 3, 5, 7, 8, 10] },       // C phrygian
  tomb: { root: 164.81, steps: [0, 2, 3, 5, 7, 9, 10] },        // E dorian
  embers: { root: 110.00, steps: [0, 3, 5, 6, 7, 10] },         // A minor blues
  rainruins: { root: 98.00, steps: [0, 2, 3, 5, 7, 8, 10] },    // G aeolian
};

const HAZARD_COLOUR = {
  fog: { droneGain: 0.5, percussion: 0.25, texture: 1.3, brightness: 0.6 },
  rain: { droneGain: 0.8, percussion: 0.6, texture: 1.1, brightness: 0.75 },
  embers: { droneGain: 0.9, percussion: 1.5, texture: 0.7, brightness: 1.1 },
  ice: { droneGain: 0.7, percussion: 0.4, texture: 1.2, brightness: 1.35 },
  mud: { droneGain: 1.0, percussion: 0.9, texture: 0.8, brightness: 0.7 },
  vines: { droneGain: 0.9, percussion: 0.8, texture: 1.0, brightness: 0.85 },
  dust: { droneGain: 0.85, percussion: 0.7, texture: 0.9, brightness: 0.95 },
  clear: { droneGain: 1.0, percussion: 1.0, texture: 1.0, brightness: 1.0 },
};

export class Music {
  constructor(engine) {
    this.engine = engine;
    this.running = false;
    this.step = 0;
    this.nextNoteTime = 0;
    this.timer = null;
    this.intensity = 0;
    this.targetIntensity = 0;
    this.boss = false;
    this.scale = SCALES.ruins;
    this.colour = HAZARD_COLOUR.clear;
    this.chordIndex = 0;
    this.nodes = {};
  }

  start() {
    const ctx = this.engine.ctx;
    if (!ctx || this.running) return;
    this.running = true;
    const bus = this.engine.musicBus;

    const mk = (gainValue) => {
      const g = ctx.createGain();
      g.gain.value = gainValue;
      g.connect(bus);
      return g;
    };
    this.nodes.droneGain = mk(0);
    this.nodes.padGain = mk(0);
    this.nodes.percGain = mk(0);
    this.nodes.textureGain = mk(0);
    this.nodes.combatGain = mk(0);

    // Continuous drone: two saws a hair apart, heavily filtered.
    this.nodes.droneFilter = ctx.createBiquadFilter();
    this.nodes.droneFilter.type = 'lowpass';
    this.nodes.droneFilter.frequency.value = 320;
    this.nodes.droneFilter.Q.value = 2;
    this.nodes.droneFilter.connect(this.nodes.droneGain);
    this.drones = [];
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      osc.type = i === 2 ? 'sine' : 'sawtooth';
      osc.frequency.value = this.scale.root * (i === 2 ? 0.5 : 1);
      osc.detune.value = (i - 1) * 9;
      const g = ctx.createGain();
      g.gain.value = i === 2 ? 0.5 : 0.16;
      osc.connect(g);
      g.connect(this.nodes.droneFilter);
      osc.start();
      this.drones.push({ osc, gain: g });
    }

    // Texture wash: filtered noise, moved slowly by an LFO.
    const noiseSrc = ctx.createBufferSource();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.5;
    noiseSrc.buffer = buffer;
    noiseSrc.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 600;
    nf.Q.value = 0.8;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 260;
    lfo.connect(lfoGain);
    lfoGain.connect(nf.frequency);
    lfo.start();
    noiseSrc.connect(nf);
    nf.connect(this.nodes.textureGain);
    noiseSrc.start();
    this.nodes.textureFilter = nf;

    this.nextNoteTime = ctx.currentTime + 0.1;
    this.step = 0;
    this.timer = setInterval(() => this._schedule(), 90);
    this.setIntensity(0.12);
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    clearInterval(this.timer);
    const ctx = this.engine.ctx;
    const t = ctx.currentTime;
    for (const key of Object.keys(this.nodes)) {
      const node = this.nodes[key];
      if (node && node.gain) node.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    }
    setTimeout(() => {
      for (const d of this.drones || []) { try { d.osc.stop(); } catch (e) { /* already stopped */ } }
      this.drones = [];
      this.nodes = {};
    }, 900);
  }

  setBiome(biomeId, hazardId) {
    const scale = SCALES[biomeId] || SCALES.ruins;
    this.colour = HAZARD_COLOUR[hazardId] || HAZARD_COLOUR.clear;
    if (scale !== this.scale && this.running) {
      this.scale = scale;
      const t = this.engine.ctx.currentTime;
      // Slide the drone rather than cutting -- transitions must never jar.
      this.drones.forEach((d, i) => {
        d.osc.frequency.exponentialRampToValueAtTime(
          scale.root * (i === 2 ? 0.5 : 1), t + 2.4);
      });
    } else {
      this.scale = scale;
    }
    this._applyColour();
  }

  _applyColour() {
    if (!this.running) return;
    const t = this.engine.ctx.currentTime;
    if (this.nodes.droneFilter) {
      this.nodes.droneFilter.frequency.linearRampToValueAtTime(
        240 + this.colour.brightness * 260, t + 2.0);
    }
    if (this.nodes.textureFilter) {
      this.nodes.textureFilter.frequency.linearRampToValueAtTime(
        420 * this.colour.brightness + 200, t + 2.0);
    }
  }

  setIntensity(value, boss = false) {
    this.targetIntensity = Math.max(0, Math.min(1, value));
    this.boss = boss;
    if (!this.running) return;
    const ctx = this.engine.ctx;
    const t = ctx.currentTime;
    const ramp = 1.6;
    const i = this.targetIntensity;
    const c = this.colour;
    const set = (node, value) => {
      if (!node) return;
      node.gain.cancelScheduledValues(t);
      node.gain.setValueAtTime(Math.max(0.0001, node.gain.value), t);
      node.gain.linearRampToValueAtTime(Math.max(0.0001, value), t + ramp);
    };
    set(this.nodes.droneGain, (0.16 + i * 0.07) * c.droneGain);
    set(this.nodes.padGain, 0.05 + i * 0.09);
    set(this.nodes.percGain, (0.02 + i * 0.16) * c.percussion);
    set(this.nodes.textureGain, (0.035 + (1 - i) * 0.03) * c.texture);
    set(this.nodes.combatGain, Math.max(0, i - 0.45) * 0.26);
  }

  _tempo() {
    // Slow and patient while exploring; urgent in a fight.
    return 0.52 - this.intensity * 0.16 - (this.boss ? 0.06 : 0);
  }

  _schedule() {
    if (!this.running) return;
    const ctx = this.engine.ctx;
    this.intensity += (this.targetIntensity - this.intensity) * 0.08;
    const beat = this._tempo();
    while (this.nextNoteTime < ctx.currentTime + 0.35) {
      this._playStep(this.step, this.nextNoteTime, beat);
      this.nextNoteTime += beat;
      this.step = (this.step + 1) % 32;
    }
  }

  _note(degree, octave = 0) {
    const steps = this.scale.steps;
    const idx = ((degree % steps.length) + steps.length) % steps.length;
    const oct = octave + Math.floor(degree / steps.length);
    return this.scale.root * Math.pow(2, steps[idx] / 12 + oct);
  }

  _playStep(step, time, beat) {
    const ctx = this.engine.ctx;
    const i = this.intensity;

    // --- deep drum: the heartbeat of the hall
    if (step % 8 === 0 || (i > 0.45 && step % 8 === 4) || (this.boss && step % 4 === 2)) {
      this._kick(time, 0.9);
    }
    // --- frame drum
    if (i > 0.3 && (step % 4 === 2)) this._frame(time, 0.5 + i * 0.4);
    if (this.boss && step % 2 === 1) this._frame(time, 0.3);

    // --- chord change every 16 steps
    if (step % 16 === 0) {
      this.chordIndex = (this.chordIndex + 1) % 4;
      const roots = [0, 5, 3, 6];
      this._pad(time, roots[this.chordIndex], beat * 16);
    }

    // --- sparse melodic figure, more likely as things heat up
    if (step % 4 === 0 && Math.random() < 0.16 + i * 0.3) {
      const degree = [0, 2, 4, 6, 3][Math.floor(Math.random() * 5)];
      this._horn(time, this._note(degree, 1), beat * (2 + Math.random() * 2));
    }

    // --- combat tension: a rising two-note figure
    if (i > 0.5 && step % 8 === 6) {
      this._tense(time, this._note(1, 1), beat);
    }
  }

  _kick(time, gainScale) {
    const ctx = this.engine.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, time);
    osc.frequency.exponentialRampToValueAtTime(38, time + 0.22);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.9 * gainScale, time + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.42);
    osc.connect(g);
    g.connect(this.nodes.percGain);
    osc.start(time);
    osc.stop(time + 0.5);
  }

  _frame(time, gainScale) {
    const ctx = this.engine.ctx;
    const src = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.5);
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 220;
    f.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.value = 0.5 * gainScale;
    src.connect(f); f.connect(g); g.connect(this.nodes.percGain);
    src.start(time);
  }

  _pad(time, degree, duration) {
    const ctx = this.engine.ctx;
    for (const offset of [0, 2, 4]) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = this._note(degree + offset, 0);
      osc.detune.value = (Math.random() - 0.5) * 12;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 500 + this.colour.brightness * 400;
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(0.1, time + duration * 0.3);
      g.gain.linearRampToValueAtTime(0.0001, time + duration);
      osc.connect(f); f.connect(g); g.connect(this.nodes.padGain);
      osc.start(time);
      osc.stop(time + duration + 0.2);
    }
  }

  _horn(time, freq, duration) {
    const ctx = this.engine.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq * 0.996, time);
    osc.frequency.linearRampToValueAtTime(freq, time + 0.35);
    f.type = 'lowpass';
    f.frequency.setValueAtTime(400, time);
    f.frequency.linearRampToValueAtTime(1400, time + duration * 0.4);
    f.Q.value = 3;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(0.16, time + 0.28);
    g.gain.linearRampToValueAtTime(0.0001, time + duration);
    osc.connect(f); f.connect(g); g.connect(this.nodes.padGain);
    osc.start(time);
    osc.stop(time + duration + 0.2);
  }

  _tense(time, freq, duration) {
    const ctx = this.engine.ctx;
    for (const mult of [1, 1.0595]) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = freq * mult * 2;
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(0.09, time + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, time + duration * 1.6);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq * 3;
      f.Q.value = 4;
      osc.connect(f); f.connect(g); g.connect(this.nodes.combatGain);
      osc.start(time);
      osc.stop(time + duration * 2);
    }
  }
}
