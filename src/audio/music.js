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

// The five places the score has to be, and how each of them balances the same
// set of layers. Nothing here starts or stops anything: a scene change is a
// crossfade of gains plus a different pattern generator, so the music flows
// from the menu into a descent into a boss hall into the relic table without
// a seam anywhere.
//
// `tempo` is seconds per sixteenth. `swing` delays the off-beats, which is
// most of what separates a march from a groove.
const SCENES = {
  // Melancholy. Slow, minor, almost all pad and drone, one horn line a long
  // way off, and no drum at all -- a menu should feel like the moment before
  // you decide to go down.
  menu: {
    tempo: 0.60, swing: 0, mode: 'aeolian',
    drone: 1.3, pad: 1.5, perc: 0, snare: 0, lead: 0.35, bass: 0.45, texture: 1.4,
    grit: 0, melody: 0.55, pattern: 'slow',
  },
  // Sombre, and meant to move you. Fuller than the menu, with a rising
  // figure and a low swell under it: these are the names of the dead.
  hall: {
    tempo: 0.66, swing: 0, mode: 'aeolian',
    drone: 1.1, pad: 1.9, perc: 0.2, snare: 0, lead: 0.7, bass: 0.8, texture: 1.1,
    grit: 0, melody: 0.85, pattern: 'slow',
  },
  // The labyrinth itself. Atmospheric and adaptive; the grit only arrives
  // with the intensity, so the guitar is something that happens to you.
  explore: {
    tempo: 0.52, swing: 0, mode: 'biome',
    drone: 1, pad: 1, perc: 1, snare: 0.35, lead: 0.5, bass: 1, texture: 1,
    grit: 0.45, melody: 1, pattern: 'explore',
  },
  // Energetic action. Everything open, a driving riff on the low strings and
  // the drum on every beat.
  boss: {
    tempo: 0.30, swing: 0.06, mode: 'phrygian',
    drone: 0.8, pad: 0.7, perc: 1.6, snare: 1.5, lead: 1.35, bass: 1.5, texture: 0.5,
    grit: 1, melody: 0.5, pattern: 'drive',
  },
  // Relaxed and upbeat: the depth is behind you. Swung, warm, major-leaning,
  // a bouncing bass and a bright tune over it -- the one place in the game
  // that is allowed to sound like fun.
  relics: {
    tempo: 0.34, swing: 0.2, mode: 'dorian',
    drone: 0.35, pad: 0.9, perc: 1.1, snare: 1, lead: 1, bass: 1.35, texture: 0.35,
    grit: 0.35, melody: 1, pattern: 'drive',
  },
};

// Mode overrides. The biome scales stay as they are while exploring; the
// framing scenes borrow the same root and re-colour it, so moving between
// them is a change of mood rather than a change of key.
const MODES = {
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
};

// Sixteen-step patterns. `null` is a rest; numbers are scale degrees.
//
// The driving pair are deliberately built the way a tracker would: a bass
// that lands on the beat and answers itself off it, a lead that runs in
// eighths, and a snare on two and four. That is the shape the score is
// reaching for whenever it is not being frightening.
const RIFFS = {
  boss: {
    bass: [0, null, 0, 0, null, 0, 3, null, 0, null, 0, 0, 6, null, 5, 4],
    lead: [0, null, 3, null, 4, null, 3, null, 0, null, 6, null, 5, null, 4, 3],
    snare: [4, 12],
    kick: [0, 3, 6, 8, 11, 14],
  },
  relics: {
    bass: [0, null, 4, null, 2, null, 4, null, 3, null, 5, null, 4, null, 2, 1],
    lead: [4, null, 5, 4, 2, null, 4, null, 5, null, 6, 5, 4, null, 2, null],
    snare: [4, 12],
    kick: [0, 6, 8, 14],
  },
};

// A soft clipping curve. Gentle enough that a single note still reads as a
// note; hard enough that a chord reads as a chord being pushed.
function gritCurve(amount) {
  const n = 1024;
  const curve = new Float32Array(n);
  const k = Math.max(0.001, amount) * 70;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

export class Music {
  constructor(engine) {
    this.engine = engine;
    this.running = false;
    this.step = 0;
    this.nextNoteTime = 0;
    this.timer = null;
    this.teardown = null;
    this.drones = [];
    this.sources = [];
    this.intensity = 0;
    this.targetIntensity = 0;
    this.boss = false;
    this.scale = SCALES.ruins;
    this.colour = HAZARD_COLOUR.clear;
    this.chordIndex = 0;
    this.nodes = {};
    // How the room is playing the score back. A passage keeps the music
    // close and dry; a hall lets the pad and the horn open out.
    this.space = { size: 0.35, corridor: 0.3, tight: 0.4, ceiling: 0.5 };
    this.openness = 0.4;
    this.motif = [0, 2, 4, 2];
    this.motifStep = 0;
    // Which of the five places the score is. Changed by crossfade, never by
    // stopping and starting, so every transition in the game is seamless.
    this.scene = SCENES.explore;
    this.sceneName = 'explore';
    this.biomeSteps = SCALES.ruins.steps;
    // A brief tonal lift when a new chamber opens up. Decays on its own.
    this.chamber = 0;
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
    this.nodes.bassGain = mk(0);
    this.nodes.snareGain = mk(0);
    // The rocky layer. Two detuned saws through a soft clipper and a mid
    // bandpass, which is about as close to an overdriven string as a couple
    // of oscillators get -- and close enough at this volume.
    this.nodes.leadGain = mk(0);
    this.nodes.leadTone = ctx.createBiquadFilter();
    this.nodes.leadTone.type = 'bandpass';
    this.nodes.leadTone.frequency.value = 900;
    this.nodes.leadTone.Q.value = 0.9;
    this.nodes.leadShaper = ctx.createWaveShaper();
    this.nodes.leadShaper.curve = gritCurve(0.5);
    this.nodes.leadShaper.oversample = '2x';
    this.nodes.leadShaper.connect(this.nodes.leadTone);
    this.nodes.leadTone.connect(this.nodes.leadGain);

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
    // Both of these loop forever. Without a reference, stop() cannot reach
    // them and every finished run leaves a noise source and an LFO running
    // silently in the graph for the lifetime of the audio context.
    this.sources = [noiseSrc, lfo];

    this.nextNoteTime = ctx.currentTime + 0.1;
    this.step = 0;
    this.timer = setInterval(() => this._schedule(), 90);
    this._applyScene();
    this.setIntensity(0.12);
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    clearInterval(this.timer);
    this.timer = null;
    const ctx = this.engine.ctx;
    const t = ctx.currentTime;
    for (const key of Object.keys(this.nodes)) {
      const node = this.nodes[key];
      if (node && node.gain) node.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    }
    // Everything the fade-out is about to tear down, captured now: a run
    // started inside the fade calls start() again, and the teardown must not
    // reach into the score that replaced this one.
    const drones = this.drones || [];
    const sources = this.sources || [];
    this.drones = [];
    this.sources = [];
    clearTimeout(this.teardown);
    this.teardown = setTimeout(() => {
      for (const d of drones) { try { d.osc.stop(); } catch (e) { /* already stopped */ } }
      for (const src of sources) { try { src.stop(); } catch (e) { /* already stopped */ } }
      if (!this.running) this.nodes = {};
    }, 900);
  }

  // A short phrase per biome, so the melodic layer reads as written rather
  // than as a die being rolled every four beats.
  _buildMotif(biomeId) {
    const shapes = {
      ruins: [0, 2, 4, 3], crypt: [0, 1, 4, 2], tomb: [0, 4, 2, 5],
      embers: [0, 3, 2, 5], rainruins: [0, 2, 5, 4],
    };
    this.motif = shapes[biomeId] || shapes.ruins;
    this.motifStep = 0;
  }

  // The geometry the listener is standing in. Layers are rebalanced rather
  // than switched: the score never restarts, it just breathes differently.
  setSpace(space) {
    this.space = space;
    this.openness += (space.size - this.openness) * 0.35;
    if (!this.running) return;
    const t = this.engine.ctx.currentTime;
    if (this.nodes.textureFilter) {
      // A tight passage narrows the wash; a hall lets it spread.
      this.nodes.textureFilter.Q.linearRampToValueAtTime(0.6 + space.tight * 1.9, t + 1.5);
    }
    this.setIntensity(this.targetIntensity, this.boss);
  }

  setBiome(biomeId, hazardId) {
    const scale = SCALES[biomeId] || SCALES.ruins;
    this._buildMotif(biomeId);
    // Kept aside so a scene that borrows the biome's mode can find it again
    // after the framing scenes have overridden it.
    this.biomeSteps = scale.steps;
    this.colour = HAZARD_COLOUR[hazardId] || HAZARD_COLOUR.clear;
    if (scale.root !== this.scale.root && this.running) {
      this.scale = { root: scale.root, steps: this.scale.steps };
      const t = this.engine.ctx.currentTime;
      // Slide the drone rather than cutting -- transitions must never jar.
      this.drones.forEach((d, i) => {
        d.osc.frequency.exponentialRampToValueAtTime(
          scale.root * (i === 2 ? 0.5 : 1), t + 2.4);
      });
    } else {
      this.scale = { root: scale.root, steps: this.scale.steps };
    }
    this._applyScene();
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
    // Space rebalances the layers: in a corridor the drone and the drum are
    // what you hear; in a hall the pad and the horn have somewhere to go.
    const open = 0.35 + this.openness * 0.9;
    const close = 1 - this.openness * 0.4;
    const sc = this.scene;
    // The scene decides the shape of the mix; intensity and the room decide
    // how far it leans. Multiplying rather than replacing is what lets a
    // scene change be a crossfade of the same six layers.
    set(this.nodes.droneGain, (0.16 + i * 0.07) * c.droneGain * close * sc.drone);
    set(this.nodes.padGain, (0.05 + i * 0.09) * open * sc.pad);
    set(this.nodes.percGain, (0.02 + i * 0.16) * c.percussion * (1.15 - this.openness * 0.25) * sc.perc);
    set(this.nodes.textureGain, (0.035 + (1 - i) * 0.03) * c.texture * (0.7 + this.openness * 0.7) * sc.texture);
    set(this.nodes.combatGain, Math.max(0, i - 0.45) * 0.26);
    set(this.nodes.bassGain, (0.04 + i * 0.1) * (1.1 - this.openness * 0.2) * sc.bass);
    set(this.nodes.snareGain, (0.02 + i * 0.09) * sc.snare);
    // While exploring the rocky layer is something that arrives with the
    // trouble; in the riff scenes it is the tune.
    const leadDrive = sc.pattern === 'explore' ? Math.max(0, i - 0.35) * 1.5 : 1;
    set(this.nodes.leadGain, 0.13 * sc.lead * leadDrive);
  }

  _tempo() {
    // The scene sets the pace; intensity only pushes on it while exploring,
    // because the framing scenes are not reacting to anything.
    const base = this.scene.tempo;
    if (this.scene.pattern !== 'explore') return base;
    return base - this.intensity * 0.16 - (this.boss ? 0.06 : 0);
  }

  _schedule() {
    if (!this.running) return;
    const ctx = this.engine.ctx;
    this.intensity += (this.targetIntensity - this.intensity) * 0.08;
    this.chamber = Math.max(0, this.chamber - 0.09);
    const beat = this._tempo();
    while (this.nextNoteTime < ctx.currentTime + 0.35) {
      // Swing: the off-beats land late, which is the whole difference between
      // a march and a groove and costs one line.
      const nudge = (this.step % 2 === 1) ? beat * this.scene.swing : 0;
      this._playStep(this.step, this.nextNoteTime + nudge, beat);
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
    const pattern = this.scene.pattern;
    if (pattern === 'slow') { this._playSlow(step % 32, time, beat); return; }
    if (pattern === 'drive') { this._playDrive(step % 16, time, beat); return; }
    this._playExplore(step, time, beat);
  }

  // The labyrinth's own pattern: patient, adaptive, and the one that listens
  // to the room it is being played in.
  _playExplore(step, time, beat) {
    const i = this.intensity;

    // --- deep drum: the heartbeat of the hall
    if (step % 8 === 0 || (i > 0.45 && step % 8 === 4) || (this.boss && step % 4 === 2)) {
      this._kick(time, 0.9);
    }
    // --- frame drum
    if (i > 0.3 && (step % 4 === 2)) this._frame(time, 0.5 + i * 0.4);
    if (this.boss && step % 2 === 1) this._frame(time, 0.3);

    // --- chord change every 16 steps
    const roots = [0, 5, 3, 6];
    if (step % 16 === 0) {
      this.chordIndex = (this.chordIndex + 1) % 4;
      this._pad(time, roots[this.chordIndex], beat * 16 * (1 + this.openness * 0.2));
    }

    // --- bass: the chord root, plucked on the downbeat and the half
    if (step % 8 === 0 || (i > 0.5 && step % 8 === 5)) {
      this._bass(time, this._note(roots[this.chordIndex], -1), beat * 2.2);
    }

    // --- the biome's phrase, one note at a time, with the odd octave leap.
    // A hall gets the whole figure; a passage only lets a note or two out.
    const melodyChance = (0.2 + i * 0.32) * (0.55 + this.openness * 0.75);
    if (step % 4 === 0 && Math.random() < melodyChance) {
      const degree = this.motif[this.motifStep % this.motif.length];
      this.motifStep++;
      const oct = Math.random() < 0.18 ? 2 : 1;
      const tail = beat * (1.6 + this.openness * 2.4 + Math.random());
      this._horn(time + (Math.random() - 0.5) * 0.02, this._note(degree, oct), tail);
    }

    // --- combat tension: a rising two-note figure
    if (i > 0.5 && step % 8 === 6) {
      this._tense(time, this._note(1, 1), beat);
    }

    // --- and once things are genuinely bad, the low strings come in on the
    // root. This is the rocky layer arriving as a consequence rather than as
    // a style: the player hears it because they are in trouble.
    if (i > 0.42 && (step % 8 === 0 || (i > 0.7 && step % 8 === 3))) {
      this._riffNote(time, this._note(0, 0), beat * 2.4, 0.1 + (i - 0.42) * 0.2);
    }
    if (i > 0.62 && step % 4 === 2) this._snare(time, 0.5);
  }

  // --- scenes ---------------------------------------------------------------
  // Moving between them is a crossfade and a change of pattern generator. The
  // clock, the drones and the noise wash all keep running underneath, which
  // is what makes every transition in the game seamless.
  setScene(name) {
    const scene = SCENES[name];
    if (!scene || this.sceneName === name) return;
    this.sceneName = name;
    this.scene = scene;
    this.boss = name === 'boss';
    // Land the change on the next bar rather than mid-phrase.
    this.step = 0;
    this.motifStep = 0;
    this._applyScene();
    this.setIntensity(this.targetIntensity, this.boss);
  }

  // The scene's key colour: its own mode, or the biome's while exploring.
  _applyScene() {
    if (!this.running) return;
    const ctx = this.engine.ctx;
    const t = ctx.currentTime;
    const steps = this.scene.mode === 'biome'
      ? this.biomeSteps
      : (MODES[this.scene.mode] || MODES.aeolian);
    this.scale = { root: this.scale.root, steps };
    if (this.nodes.leadShaper) {
      this.nodes.leadShaper.curve = gritCurve(0.12 + this.scene.grit * 0.9);
    }
    if (this.nodes.leadTone) {
      this.nodes.leadTone.frequency.linearRampToValueAtTime(
        620 + this.scene.grit * 900, t + 1.2);
    }
  }

  // A new chamber opens up. A brief lift -- the drone bends up a whole tone
  // and a shimmer comes off the top of the pad -- then it settles back on its
  // own. Two seconds of "what is in here", and never twice for the same room.
  chamberShift(size = 1) {
    if (!this.running) return;
    const ctx = this.engine.ctx;
    const t = ctx.currentTime;
    this.chamber = 1;
    const bend = 1 + 0.055 * Math.min(1.4, size);
    for (const d of this.drones) {
      const f = d.osc.frequency;
      const base = f.value;
      f.cancelScheduledValues(t);
      f.setValueAtTime(base, t);
      f.exponentialRampToValueAtTime(base * bend, t + 0.45);
      f.exponentialRampToValueAtTime(base, t + 2.4);
    }
    if (this.nodes.droneFilter) {
      const f = this.nodes.droneFilter.frequency;
      const base = f.value;
      f.cancelScheduledValues(t);
      f.setValueAtTime(base, t);
      f.linearRampToValueAtTime(base * 1.9, t + 0.5);
      f.linearRampToValueAtTime(base, t + 2.6);
    }
    // A suspended fourth over the top: unresolved, which is the sound of a
    // room you have not looked at yet.
    this._shimmer(t + 0.02, this._note(3, 2), 2.2);
    this._shimmer(t + 0.06, this._note(4, 2), 2.0);
  }

  _shimmer(time, freq, duration) {
    const ctx = this.engine.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq * 0.997, time);
    osc.frequency.linearRampToValueAtTime(freq, time + duration * 0.5);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(0.075, time + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    osc.connect(g);
    g.connect(this.nodes.padGain);
    osc.start(time);
    osc.stop(time + duration + 0.2);
  }

  // --- pattern generators ---------------------------------------------------
  // One per scene shape. All three read the same clock and write to the same
  // layers; what differs is what they ask for and how often.

  // Slow, unmetered, no drum. Used by the menu and the hall: a chord every
  // four bars and a single line over the top of it.
  _playSlow(step, time, beat) {
    const roots = [0, 5, 3, 4];
    if (step % 16 === 0) {
      this.chordIndex = (this.chordIndex + 1) % 4;
      this._pad(time, roots[this.chordIndex], beat * 17);
      this._bass(time, this._note(roots[this.chordIndex], -1), beat * 8);
    }
    // A rising figure rather than a wandering one: it has somewhere to go,
    // which is the difference between sombre and merely quiet.
    if (step % 8 === 4 && Math.random() < this.scene.melody) {
      const rise = [0, 2, 4, 5, 4, 2][this.motifStep % 6];
      this.motifStep++;
      this._horn(time, this._note(roots[this.chordIndex] + rise, 1), beat * 7);
    }
    if (this.sceneName === 'hall' && step % 32 === 16) {
      // A low swell under the names.
      this._pad(time, roots[this.chordIndex] - 2, beat * 20);
    }
  }

  // Driving and metered: the riff scenes. Bass, lead, kick and snare all read
  // straight out of a sixteen-step table, which is why they lock together.
  _playDrive(step, time, beat) {
    const riff = RIFFS[this.sceneName] || RIFFS.boss;
    const i = this.intensity;
    if (riff.kick.includes(step)) this._kick(time, this.sceneName === 'boss' ? 1 : 0.75);
    if (riff.snare.includes(step)) this._snare(time, this.sceneName === 'boss' ? 1 : 0.7);
    // Hats on the off-beats carry the swing.
    if (step % 2 === 1) this._hat(time, 0.32 + (this.sceneName === 'boss' ? 0.2 : 0));

    const bassDegree = riff.bass[step];
    if (bassDegree !== null && bassDegree !== undefined) {
      this._bass(time, this._note(bassDegree, -1), beat * 1.8);
    }
    const leadDegree = riff.lead[step];
    if (leadDegree !== null && leadDegree !== undefined && Math.random() < 0.92) {
      this._riffNote(time, this._note(leadDegree, 1), beat * 1.7,
        this.sceneName === 'boss' ? 0.24 : 0.17);
    }
    if (step % 16 === 0) {
      this.chordIndex = (this.chordIndex + 1) % 4;
      this._pad(time, [0, 5, 3, 4][this.chordIndex], beat * 15);
    }
    // The boss keeps escalating: an extra octave over the top as it goes on.
    if (this.sceneName === 'boss' && i > 0.85 && step % 16 === 8) {
      this._riffNote(time, this._note(0, 2), beat * 6, 0.14);
    }
  }

  // --- voices added for the riff scenes -------------------------------------
  _snare(time, gainScale) {
    const ctx = this.engine.ctx;
    const src = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.22, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3.2);
    }
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 1300;
    const g = ctx.createGain();
    g.gain.value = 0.6 * gainScale;
    // A tuned body under the noise, or it reads as a hiss rather than a drum.
    const body = ctx.createOscillator();
    const bg = ctx.createGain();
    body.type = 'triangle';
    body.frequency.setValueAtTime(210, time);
    body.frequency.exponentialRampToValueAtTime(150, time + 0.09);
    bg.gain.setValueAtTime(0.0001, time);
    bg.gain.exponentialRampToValueAtTime(0.34 * gainScale, time + 0.004);
    bg.gain.exponentialRampToValueAtTime(0.0001, time + 0.13);
    src.connect(f); f.connect(g); g.connect(this.nodes.snareGain);
    body.connect(bg); bg.connect(this.nodes.snareGain);
    src.start(time);
    body.start(time);
    body.stop(time + 0.2);
  }

  _hat(time, gainScale) {
    const ctx = this.engine.ctx;
    const src = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.06, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 5);
    }
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 6500;
    const g = ctx.createGain();
    g.gain.value = 0.28 * gainScale;
    src.connect(f); f.connect(g); g.connect(this.nodes.snareGain);
    src.start(time);
  }

  // The rocky voice: two saws a few cents apart into the soft clipper. The
  // detune is what makes it a string section rather than a synth lead.
  _riffNote(time, freq, duration, peak) {
    const ctx = this.engine.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(Math.max(0.002, peak), time + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    g.connect(this.nodes.leadShaper);
    for (const cents of [-7, 7]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = cents;
      osc.connect(g);
      osc.start(time);
      osc.stop(time + duration + 0.05);
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

  // A short bowed pluck an octave under the drone. Present rather than heard.
  _bass(time, freq, duration) {
    const ctx = this.engine.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq * 1.01, time);
    osc.frequency.exponentialRampToValueAtTime(freq, time + 0.09);
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1200, time);
    f.frequency.exponentialRampToValueAtTime(240, time + duration * 0.7);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.5, time + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    osc.connect(f); f.connect(g); g.connect(this.nodes.bassGain);
    osc.start(time);
    osc.stop(time + duration + 0.1);
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
