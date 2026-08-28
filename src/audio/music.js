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
    tempo: 0.62, swing: 0, mode: 'aeolian',
    drone: 0.85, pad: 1.6, perc: 0.55, snare: 0, lead: 0.5, bass: 0.9, texture: 0.8,
    grit: 0, melody: 1, pattern: 'lament',
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

// The lament.
//
// A written tune rather than a generated one, because the Hall of Fame is the
// only screen in the game that is *about* something -- a list of people who
// went down and did not come back -- and a phrase that wanders is a phrase
// nobody remembers. It is a single voice over a slow bell, in the manner of
// the war memorial that plays over the boot hill in Cannon Fodder: the tune is
// simple, it is nearly a folk song, and what makes it sad is that it is played
// alone and never resolves upward.
//
// Degrees, not semitones, so it takes the colour of whatever mode the scene
// is in. `null` holds the previous note; the length column is in sixteenths.
const LAMENT = [
  // Falling phrase, answered a step lower each time: the shape of giving up.
  { d: 4, len: 6 }, { d: 3, len: 2 }, { d: 2, len: 6 }, { d: 4, len: 2 },
  { d: 1, len: 8 }, { d: 2, len: 4 }, { d: 0, len: 12 },
  { d: 2, len: 6 }, { d: 1, len: 2 }, { d: 0, len: 6 }, { d: -3, len: 2 },
  { d: -1, len: 8 }, { d: 0, len: 4 }, { d: -3, len: 16 },
];
const LAMENT_CHORDS = [0, -3, 1, -2, 0, 3, -1, -3];

// Movements for the exploring score.
//
// The labyrinth's own music used to be one sixteen-step figure with the gains
// moved around it, which meant a long descent heard the same bar for twenty
// minutes -- the mix changed and the music did not. So the score now walks
// through a set of movements: each has its own harmony, its own drum, and its
// own idea about how much melody is allowed, and it changes on its own clock
// as well as in answer to what is happening.
//
// `kick`/`frame` are step masks within eight; `roots` is the chord walk;
// `melody` scales how often the biome's phrase is let out; `weight` biases
// which movements come up when things are calm or bad.
const MOVEMENTS = [
  // Patient. Nearly nothing: two chords and a drum you feel rather than hear.
  { id: 'hollow', roots: [0, 5], kick: [0], frame: [], melody: 0.75,
    bassSteps: [0], bars: 3, calm: 1.6, tense: 0.3 },
  // The one the old score played. Kept, because it is the sound of the game.
  { id: 'walk', roots: [0, 5, 3, 6], kick: [0, 4], frame: [2], melody: 1,
    bassSteps: [0, 5], bars: 2, calm: 1.2, tense: 0.9 },
  // Turning: a chord walk that keeps arriving somewhere it did not mean to.
  { id: 'turning', roots: [0, 6, 4, 2], kick: [0, 6], frame: [2, 5], melody: 1.15,
    bassSteps: [0, 3, 6], bars: 2, calm: 1, tense: 1 },
  // Low and pressing. Comes up when the depth has noticed you.
  { id: 'pressing', roots: [0, 1, 0, 4], kick: [0, 3, 6], frame: [2, 4, 6], melody: 0.6,
    bassSteps: [0, 2, 4, 6], bars: 2, calm: 0.3, tense: 1.7 },
  // Open: the hall music. Wants a big room and gets one when the space allows.
  { id: 'vaulted', roots: [0, 4, 5, 3], kick: [0], frame: [4], melody: 1.4,
    bassSteps: [0, 4], bars: 3, calm: 1.3, tense: 0.5 },
];

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
    // Which movement the exploring score is playing, and how many bars it has
    // left before it may change. See MOVEMENTS.
    this.movement = MOVEMENTS[1];
    this.movementBars = 2;
    this.lamentStep = 0;
    this.lamentHold = 0;
    // A short-lived push on top of the intensity, spent by things that happen
    // rather than by things that are true. Decays on its own.
    this.sting = 0;
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
    // Trouble arrives faster than it leaves. A symmetric filter meant the
    // score took the same six seconds to notice a fight starting as it took
    // to let go of one, so it was always describing the room you were in a
    // moment ago. Rising is nearly immediate; falling is a long exhale, which
    // is also how relief actually works.
    const want = Math.min(1, this.targetIntensity + this.sting);
    const rate = want > this.intensity ? 0.34 : 0.045;
    this.intensity += (want - this.intensity) * rate;
    this.sting = Math.max(0, this.sting - 0.035);
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
    if (pattern === 'lament') { this._playLament(step % 32, time, beat); return; }
    if (pattern === 'drive') { this._playDrive(step % 16, time, beat); return; }
    this._playExplore(step, time, beat);
  }

  // Something happened. A brief push on the intensity that decays on its own,
  // so an event is heard as an event rather than having to be held true for
  // long enough for the smoothing to notice it.
  push(amount) {
    this.sting = Math.min(0.55, this.sting + amount);
  }

  // Picks the next movement. Weighted by how bad things are, never the same
  // one twice running, and only ever on a bar line -- so the score changes
  // its mind without ever changing it mid-phrase.
  _nextMovement() {
    const i = this.intensity;
    let total = 0;
    const weights = MOVEMENTS.map((m) => {
      if (m === this.movement) return 0;
      // A vaulted movement wants a hall; a pressing one wants a passage.
      const room = m.id === 'vaulted' ? 0.4 + this.openness * 1.6
        : m.id === 'pressing' ? 1.3 - this.openness * 0.6 : 1;
      const w = (m.calm * (1 - i) + m.tense * i) * room;
      total += w;
      return w;
    });
    let roll = Math.random() * total;
    for (let k = 0; k < MOVEMENTS.length; k++) {
      roll -= weights[k];
      if (roll <= 0) { this.movement = MOVEMENTS[k]; break; }
    }
    this.movementBars = this.movement.bars + (Math.random() < 0.35 ? 1 : 0);
  }

  // The labyrinth's own pattern: patient, adaptive, and the one that listens
  // to the room it is being played in.
  //
  // Two clocks run here. The movement clock changes what is being played every
  // few bars (see MOVEMENTS); the intensity changes how hard it is played, and
  // adds layers as things get worse. Neither on its own was enough: the mix
  // alone repeated, and a pattern alone would have ignored the game.
  _playExplore(step, time, beat) {
    const i = this.intensity;
    const mv = this.movement;

    // --- bar line: the movement gets a chance to change here and nowhere else
    if (step % 16 === 0) {
      if (--this.movementBars <= 0) this._nextMovement();
      this.chordIndex = (this.chordIndex + 1) % mv.roots.length;
      this._pad(time, mv.roots[this.chordIndex], beat * 16 * (1 + this.openness * 0.2));
    }
    const root = mv.roots[this.chordIndex % mv.roots.length];
    const s8 = step % 8;

    // --- deep drum: the movement's own pulse, with the intensity filling it in
    if (mv.kick.includes(s8) || (i > 0.55 && s8 === 4) || (this.boss && step % 4 === 2)) {
      this._kick(time, s8 === 0 ? 0.95 : 0.62);
    }
    // --- frame drum
    if (mv.frame.includes(s8) && i > 0.18) this._frame(time, 0.4 + i * 0.5);
    if (i > 0.62 && s8 === 7 && Math.random() < 0.4) this._frame(time, 0.3);
    if (this.boss && step % 2 === 1) this._frame(time, 0.3);
    // A fill on the way into a new movement, so the change is announced.
    if (this.movementBars === 1 && step % 16 === 14 && i > 0.25) {
      this._frame(time, 0.5);
      this._frame(time + beat * 0.5, 0.4);
    }

    // --- bass: the chord root on the movement's own steps
    if (mv.bassSteps.includes(s8)) {
      this._bass(time, this._note(root, -1), beat * (s8 === 0 ? 2.4 : 1.4));
    }

    // --- the biome's phrase, one note at a time, with the odd octave leap.
    // A hall gets the whole figure; a passage only lets a note or two out.
    const melodyChance = (0.16 + i * 0.3) * (0.55 + this.openness * 0.75) * mv.melody;
    if (step % 4 === 0 && Math.random() < melodyChance) {
      const degree = this.motif[this.motifStep % this.motif.length] + root;
      this.motifStep++;
      const oct = Math.random() < 0.18 ? 2 : 1;
      const tail = beat * (1.6 + this.openness * 2.4 + Math.random());
      this._horn(time + (Math.random() - 0.5) * 0.02, this._note(degree, oct), tail);
    }
    // An answering note a fifth up, sparingly: it is what turns a phrase into
    // a conversation, and hearing it every time would ruin that.
    if (step % 8 === 6 && i > 0.2 && Math.random() < 0.22 * mv.melody) {
      this._horn(time, this._note(root + 4, 1), beat * 2.4);
    }

    // --- combat tension: a rising two-note figure
    if (i > 0.5 && step % 8 === 6) {
      this._tense(time, this._note(root + 1, 1), beat);
    }

    // --- and once things are genuinely bad, the low strings come in on the
    // root. This is the rocky layer arriving as a consequence rather than as
    // a style: the player hears it because they are in trouble.
    if (i > 0.42 && (s8 === 0 || (i > 0.7 && s8 === 3))) {
      this._riffNote(time, this._note(root, 0), beat * 2.4, 0.1 + (i - 0.42) * 0.2);
    }
    if (i > 0.62 && step % 4 === 2) this._snare(time, 0.5);
    if (i > 0.82 && step % 8 === 5) this._snare(time, 0.35);
  }

  // The Hall of Fame.
  //
  // One voice, one bell, and a chord that arrives late. The tune is in LAMENT
  // and is played straight through -- no randomness anywhere in it, because
  // this is the one piece of music in the game that is supposed to be the same
  // every time you hear it.
  _playLament(step, time, beat) {
    if (step % 16 === 0) {
      this.chordIndex = (this.chordIndex + 1) % LAMENT_CHORDS.length;
      const root = LAMENT_CHORDS[this.chordIndex];
      this._pad(time, root, beat * 17);
      this._bass(time, this._note(root, -1), beat * 9);
    }
    // The bell. Slow, and always the tonic: the one thing that does not move.
    if (step % 16 === 0) this._bell(time, this._note(0, 0), 3.4);
    if (step % 32 === 24) this._bell(time, this._note(0, -1), 4.2);

    // The tune, held between its own notes rather than clocked off the bar.
    if (this.lamentHold > 0) { this.lamentHold--; return; }
    const note = LAMENT[this.lamentStep % LAMENT.length];
    this.lamentStep++;
    this.lamentHold = note.len - 1;
    this._whistle(time, this._note(note.d, 1), beat * (note.len + 1.2));
  }

  // A single reed voice with air in it. Deliberately thin and slightly flat
  // at the top of its breath: a person playing, not an instrument sounding.
  _whistle(time, freq, duration) {
    const ctx = this.engine.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq * 0.985, time);
    osc.frequency.linearRampToValueAtTime(freq, time + 0.22);
    osc.frequency.linearRampToValueAtTime(freq * 0.995, time + duration);
    // Breath: a slow vibrato that only arrives once the note is held.
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 4.6;
    lfoGain.gain.setValueAtTime(0, time);
    lfoGain.gain.linearRampToValueAtTime(freq * 0.006, time + duration * 0.6);
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    f.type = 'lowpass';
    f.frequency.value = 1900;
    f.Q.value = 1.2;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(0.13, time + 0.16);
    g.gain.linearRampToValueAtTime(0.1, time + duration * 0.7);
    g.gain.linearRampToValueAtTime(0.0001, time + duration);
    osc.connect(f); f.connect(g); g.connect(this.nodes.leadGain);
    osc.start(time); lfo.start(time);
    osc.stop(time + duration + 0.2);
    lfo.stop(time + duration + 0.2);
  }

  // A struck bell, as a stack of inharmonic partials over a long decay. The
  // minor third in it is what makes it a funeral bell rather than a chime.
  _bell(time, freq, duration) {
    const ctx = this.engine.ctx;
    const partials = [
      [1, 0.5], [2, 0.24], [2.4, 0.2], [3, 0.12], [4.2, 0.07], [5.4, 0.045],
    ];
    for (const [mult, level] of partials) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq * mult;
      const tail = duration * (mult > 3 ? 0.3 : mult > 2 ? 0.6 : 1);
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(Math.max(0.002, level * 0.22), time + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, time + tail);
      osc.connect(g);
      g.connect(this.nodes.percGain);
      osc.start(time);
      osc.stop(time + tail + 0.1);
    }
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
    // The lament is a written tune, so it starts at its beginning every time
    // rather than picking up where a previous visit left off.
    this.lamentStep = 0;
    this.lamentHold = 0;
    this.chordIndex = 0;
    this.movementBars = 1;
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
