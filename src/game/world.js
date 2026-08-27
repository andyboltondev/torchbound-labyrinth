// The live level: entities, hazards, encounters, interaction and combat.
// Everything that happens during play is coordinated here; the UI and audio
// layers subscribe to events rather than reaching into this state.

import { T, keyColour, isWalkableTile } from '../gen/tiles.js';
import { bfsField, N4 } from '../gen/grid.js';
import { HAZARDS } from '../gen/biomes.js';
import { Visibility, Torch } from '../render/lighting.js';
import { Particles, burstSparks, burstBlood, burstStone, ring, footDust } from '../render/particles.js';
import { Player } from './player.js';
import { Enemy } from './enemies.js';
import { Boss } from './boss.js';
import { ENEMIES, enemyPoolFor, DEFAULT_BLOOD, HEARING_REACH } from './enemyData.js';
import { SoundField } from './soundfield.js';
import { buildOffers } from './altars.js';
import { Gore } from './gore.js';
import { hasLineOfSight, tileBlocks } from './physics.js';
import { probeAcoustics, spaceProfile, blendSpace, DEFAULT_SPACE } from '../audio/space.js';
import { clamp } from '../core/util.js';
import { RNG } from '../core/rng.js';

const FLOW_INTERVAL = 0.14;
const FLOW_RADIUS = 30;

// How far a torchbearer sees with the torch out. Enough not to walk into the
// walls, nothing like enough to see what is coming.
const DOUSED_RADIUS = 2.4;

// How much better the ears work in the dark. Deliberately slight: this is
// compensation for going blind, not a second way of seeing.
const DOUSED_HEARING = 1.3;

// What each size of fire is called when the player is standing over a cold one.
const FIRE_NAMES = {
  sconce: 'sconce', brazier: 'brazier', firepit: 'firepit', campfire: 'campfire',
};

// One colour per kind of answer, used by the chart arrow, the toast and the
// mark on the map, so the player learns to read the colour rather than the
// words. Keys use their own colour instead.
const HINT_COLOUR = {
  exit: '#6fce87', secret: '#c46ad8', treasure: '#e8b45c', health: '#e0607a',
};

// Not everything in the labyrinth bleeds. The spark colour a hit throws is
// the visual half of the same material lookup the mixer uses for the sound.
const IMPACT_SPARK = {
  bone: '#d8cfae', armour: '#ffd27a', ethereal: '#9fb8ff',
  ice: '#bfe8ff', ember: '#ff9a3a', wood: '#6d8447', stone: '#9a9184',
};

export class World {
  constructor(run, level, rng) {
    this.run = run;
    this.level = level;
    this.rng = rng || new RNG(level.seed + ':world:' + level.depth);
    this.grid = level.grid;

    this.player = new Player(run);
    this.player.placeAt(level.entrance.x, level.entrance.y);

    this.vis = new Visibility(level.grid);
    this.torch = new Torch();
    this.particles = new Particles();
    // Blood, bodies and the prints they get tracked around on.
    this.gore = new Gore(level.grid);

    this.enemies = [];
    this.projectiles = [];
    this.boss = null;
    this.time = 0;
    this.elapsed = 0;
    this.finished = false;
    this.playerDead = false;

    this.gateIndex = new Map();
    for (const g of level.gates) {
      g.open = false;
      g.openAmount = 0;
      this.gateIndex.set(this.grid.idx(g.x, g.y), g);
    }
    this.secretIndex = new Map();
    for (const s of level.secrets) {
      s.broken = false;
      s.discovered = false;
      this.secretIndex.set(this.grid.idx(s.x, s.y), s);
    }
    this.revealedProps = new Set();
    this.sealBlocks = new Set();
    // Places the player has been told about but not yet reached. The chart
    // puts an arrow on its rim for each one; whatever adds a hint owns
    // clearing it, and reaching the spot resolves it automatically.
    this.hints = [];
    // Rooms the player has actually walked into, so a chamber only announces
    // itself the first time.
    this.enteredRooms = new Set();
    this.currentRoom = null;
    this.occupied = new Map();   // tile index -> enemy id, refreshed each frame

    this.flow = null;
    this.flowTimer = 0;
    this.interactTarget = null;
    this.actionableSecret = null;
    this.hazardMods = {};
    this.currentHazard = HAZARDS.clear;
    this.currentZone = 0;
    this.torchRadius = 7;
    this.revealRadius = 0;
    // A torch can be put out. It is the only thing the player carries that
    // the labyrinth can see from a distance, so dousing it is a real choice:
    // you go nearly blind, and so does most of what is hunting you.
    this.torchLit = true;
    this.torchToggleCooldown = 0;
    // What the player can hear from where they are standing, worked out along
    // open ground. Rebuilt a few times a second; every creature that makes a
    // noise looks itself up in it rather than working it out for itself.
    this.hearing = new SoundField(level.grid);
    this.hearingTimer = 0;
    this.hearingRange = 12;
    // A second field, built on demand when something loud happens, so
    // creatures can decide whether they heard it. Loud things are rare.
    this.noiseField = new SoundField(level.grid);
    // What the player has heard recently and roughly where from, for the
    // sonar relic and anything else that wants to draw it.
    this.echoes = [];
    this.revealRadius = 0;
    this.lowHealthPulse = 0;
    this.secretsFound = 0;
    // When true, a direction key moves exactly that way on screen or not at
    // all -- no deflecting into a corridor that is merely nearby.
    this.strictMovement = false;
    this.listeners = new Set();
    this.damageTakenThisLevel = 0;
    this.shakeRequest = 0;
    // What the level sounds like where the player is standing. Re-probed a
    // few times a second and eased, so a doorway is a slide rather than a cut.
    this.acoustics = { ...DEFAULT_SPACE };
    this.acousticTarget = { ...DEFAULT_SPACE };
    this.acousticProfile = 'chamber';
    this.acousticTimer = 0;
    this.ambientTimer = 1.5;
    this.disposed = false;
    this._timers = [];

    this._spawnEntities();
    this._applyRelicReveals();
    this.updateHazard();
    this.refreshVisibility(0);
  }

  // Deferred presentation (a death throe that plays out over a second) has to
  // be cancellable: the player can be on the next depth before it finishes.
  later(fn, ms) {
    if (this.disposed) return;
    const id = setTimeout(() => {
      if (this.disposed) return;
      fn();
    }, ms);
    this._timers.push(id);
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, data) { for (const fn of this.listeners) fn(type, data || {}); }
  shake(amount) { this.shakeRequest = Math.max(this.shakeRequest, amount); }
  // Sounds default to the player's own position, which is also the listener,
  // so anything player-centric lands dead centre and unattenuated.
  playSfx(name, opts) {
    this.emit('sfx', { name, x: this.player.x, y: this.player.y, ...opts });
  }

  _spawnEntities() {
    for (const spawn of this.level.spawns) {
      if (spawn.isBoss) {
        this.boss = new Boss(this.level.boss, spawn, this.level.depth, this.rng, this.run.mods);
        continue;
      }
      if (!ENEMIES[spawn.defId]) continue;
      const e = new Enemy(spawn, this.level.depth, this.rng, this.run.mods);
      if (spawn.encounter) {
        const enc = this.level.encounters.find((x) => x.id === spawn.encounter);
        if (enc && enc.state === 'idle') e.sealed = enc.type !== 'guardedKey' ? true : false;
      }
      this.enemies.push(e);
    }
    for (const enc of this.level.encounters) {
      enc.state = 'idle';
      enc.flawlessIntact = true;
      enc.waveIndex = 0;
      enc.waveTimer = 0;
    }
  }

  _applyRelicReveals() {
    if (!this.run.mods.revealObjectives) return;
    // Seer's Eye marks objectives without revealing the route to them.
    const mark = (x, y) => {
      const i = this.grid.idx(x, y);
      this.vis.seen[i] = 1;
      this.vis.memory[i] = Math.max(this.vis.memory[i], 0.55);
    };
    for (const k of this.level.keys) mark(k.x, k.y);
    mark(this.level.stairs.x, this.level.stairs.y);
    for (const g of this.level.gates) mark(g.x, g.y);
  }

  // What the player is trying to do right now, in one line. Without this a
  // newcomer has a torch, a sword and no idea what the level wants.
  currentObjective() {
    if (this.level.isBoss) {
      return this.boss && !this.boss.dead
        ? { text: 'Slay ' + this.boss.def.name, colour: '#e05a3c' }
        : { text: 'Take the stairs down', colour: '#6fce87' };
    }
    for (const gate of this.level.gates) {
      if (gate.open) continue;
      const col = keyColour(gate.colourIndex);
      const key = this.level.keys.find((k) => k.colourIndex === gate.colourIndex);
      if (this.run.keys.has(gate.colourIndex)) {
        return { text: 'Unlock the ' + col.name + ' Gate', colour: col.hex };
      }
      if (key && key.holder === 'enemy') {
        return { text: 'Something is carrying the ' + col.name + ' Key', colour: col.hex };
      }
      return { text: 'Find the ' + col.name + ' Key', colour: col.hex };
    }
    return { text: 'Find the stairs down', colour: '#6fce87' };
  }

  // --- lookups ------------------------------------------------------------
  gateAt(x, y) { return this.gateIndex.get(this.grid.idx(x, y)) || null; }
  secretAt(x, y) { return this.secretIndex.get(this.grid.idx(x, y)) || null; }
  secretDiscoveredAt(x, y) {
    const s = this.secretAt(x, y);
    return !!(s && s.discovered);
  }
  // Vaults live in a strip below the maze on the same grid. They are a
  // different place, so they are drawn as one: only the layer the player is
  // standing on is rendered at all.
  layerAt(y) {
    const band = this.level.mazeHeight;
    return band !== undefined && y >= band ? 1 : 0;
  }

  get playerLayer() { return this.layerAt(Math.floor(this.player.y)); }

  zoneAt(x, y) {
    const i = this.grid.idx(Math.floor(x), Math.floor(y));
    return this.level.zoneMap ? this.level.zoneMap[i] : 0;
  }

  // --- per-frame ----------------------------------------------------------
  update(dt, intent) {
    this.time += dt;
    if (!this.finished && !this.playerDead) this.elapsed += dt;

    this.torchToggleCooldown = Math.max(0, this.torchToggleCooldown - dt);
    this.updateHazard();
    this.updateHearing(dt);
    this.updateAcoustics(dt);
    this.torch.update(dt, this.hazardMods);
    this.player.torchFlicker = this.torch.flicker;
    this.player.torchLit = this.torchLit;

    this._refreshOccupancy();
    this.player.update(dt, this, intent);
    // Burning is applied inside the player's own update, so this is the tick
    // where a damage-over-time death has to be noticed.
    this.checkPlayerDeath();
    this.updateFlow(dt);
    this.refreshVisibility(dt);

    for (const e of this.enemies) e.update(dt, this);
    if (this.boss) this.boss.update(dt, this);
    this.updateProjectiles(dt);
    this.particles.update(dt);
    this.gore.update(dt);
    this.updateEncounters(dt);
    this.updatePickups();
    this.updateSecretAwareness();
    this.updateHints(dt);
    this.updateCaptives(dt);
    this.updateInteractTarget();
    this.updateAmbience(dt);
    this.run.score.update(dt, this.run.mods.streakWindow);

    const frac = this.run.hp / Math.max(1, this.run.maxHp);
    this.lowHealthPulse = frac < 0.3 ? (0.3 - frac) / 0.3 : 0;

      // Retire the dead once their effects have played out.
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (this.enemies[i].dead) this.enemies.splice(i, 1);
    }
  }

  // Rebuilt once a frame so the direction chooser can reject tiles another
  // enemy already stands on or is stepping into.
  _refreshOccupancy() {
    this.occupied.clear();
    for (const e of this.enemies) {
      if (e.dead || !e.mover) continue;
      this.occupied.set(this.grid.idx(e.mover.tileX, e.mover.tileY), e.id);
      if (e.mover.moving) this.occupied.set(this.grid.idx(e.mover.toX, e.mover.toY), e.id);
    }
  }

  tileTakenBy(x, y, id) {
    const who = this.occupied.get(this.grid.idx(x, y));
    if (who !== undefined && who !== id) return true;
    // Enemies stop next to the player rather than on top of them.
    const pm = this.player.mover;
    if (pm.tileX === x && pm.tileY === y) return true;
    if (pm.moving && pm.toX === x && pm.toY === y) return true;
    return false;
  }

  // One footfall per tile, which is exactly the rhythm grid movement wants.
  onPlayerEnterTile(x, y) {
    this.gore.tread(this.player, x, y);
    this.checkChamber(x, y);
    const hz = this.hazardMods;
    const colour = hz.footstepSplash ? '#8fb4c4' : hz.footprints ? '#4a3722' : '#6f6a5e';
    footDust(this.particles, x + 0.5, y + 0.5, colour);
    this.playSfx('step', { surface: this.surfaceAt() });
  }

  // Anything that walks tracks blood the same way the player does. This is
  // also the one place that knows an enemy has taken a step, which is what
  // the noise it makes will be hung off.
  onEnemyEnterTile(enemy, x, y) {
    this.gore.tread(enemy, x, y);
  }

  // Walking into a room nobody has been into yet. Announced once per room,
  // so the score can make something of the moment without doing it every
  // time the player crosses the same threshold.
  checkChamber(x, y) {
    let found = null;
    for (const r of this.level.rooms) {
      if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) { found = r; break; }
    }
    if (!found || found === this.currentRoom) {
      this.currentRoom = found;
      return;
    }
    this.currentRoom = found;
    if (this.enteredRooms.has(found.id)) return;
    this.enteredRooms.add(found.id);
    const area = (found.x1 - found.x0 + 1) * (found.y1 - found.y0 + 1);
    this.emit('chamber', { room: found, area });
  }

  // Knockback is presentation only: shoving a grid mover off its lane would
  // undo the whole point of tile-to-tile movement.
  knock(entity, dx, dy, power = 0.28) {
    const m = Math.hypot(dx, dy) || 1;
    entity.knockX = (dx / m) * power;
    entity.knockY = (dy / m) * power;
  }

  updateHazard() {
    const zoneId = this.zoneAt(this.player.x, this.player.y);
    const info = this.level.zoneInfo[zoneId] || this.level.zoneInfo[0];
    const hazard = (info && info.hazard) || HAZARDS.clear;
    if (hazard !== this.currentHazard) {
      this.currentHazard = hazard;
      this.currentZone = zoneId;
      this.run.seenHazards.add(hazard.id);
      this.emit('hazard', { hazard, zone: zoneId, biome: info && info.biome });
    }
    this.hazardMods = hazard.mods || {};
    const mods = this.run.mods;
    this.torch.baseRadius = 7.5 * mods.torchRadius;
    this.torch.instability = mods.torchInstability;
    this.torchRadius = this.torchLit
      ? this.torch.effectiveRadius(this.hazardMods)
      : DOUSED_RADIUS * (0.94 + this.torch.flicker * 0.06);
    this.revealRadius = this.hazardMods.revealMovers || 0;
  }

  // --- hearing ------------------------------------------------------------
  // Sound is the half of the labyrinth that works in the dark, so the field
  // it travels through is a first-class thing rather than a mixer trick. See
  // soundfield.js for how it is worked out.
  updateHearing(dt) {
    this.hearingTimer -= dt;
    for (let i = this.echoes.length - 1; i >= 0; i--) {
      this.echoes[i].life -= dt;
      if (this.echoes[i].life <= 0) this.echoes.splice(i, 1);
    }
    if (this.hearingTimer > 0) return;
    this.hearingTimer = 0.22;
    // Hearing reaches further than the torch, and further again in the dark.
    this.hearingRange = this.torch.baseRadius * HEARING_REACH * this.hearingScale;
    this.hearing.build(this.player.x, this.player.y, this.hearingRange,
      (x, y) => this.soundBlocked(x, y));
  }

  soundBlocked(x, y) {
    if (this.sealBlocks.has(this.grid.idx(x, y))) return true;
    const g = this.gateAt(x, y);
    return !!(g && !g.open);
  }

  // Plays a sound only if it could actually reach the player, at the volume
  // and dullness the journey left it with, and from the direction it arrived
  // rather than from wherever the thing making it happens to be standing.
  hearSfx(name, x, y, loudness = 1, opts = {}) {
    const heard = this.hearing.hear(x, y, loudness);
    if (!heard || heard.volume < 0.015) return null;
    // Placed at the mouth of whatever it came round, not through the wall.
    const apparent = Math.min(heard.distance, 9);
    this.emit('sfx', {
      name,
      x: this.player.x + heard.dirX * apparent,
      y: this.player.y + heard.dirY * apparent,
      heard,
      ...opts,
    });
    if (this.run.mods.sonar) {
      this.echoes.push({
        x: this.player.x + heard.dirX * apparent,
        y: this.player.y + heard.dirY * apparent,
        trueX: x, trueY: y,
        strength: heard.volume, corners: heard.corners,
        life: 1.6, maxLife: 1.6, colour: opts.colour || '#8fd7ff',
      });
      if (this.echoes.length > 24) this.echoes.shift();
    }
    return heard;
  }

  // Something loud happened at a place that is not the player. Everything
  // that could have heard it goes to look, which is what makes a bolt fired
  // down a side passage a tool rather than a wasted bolt.
  makeNoise(x, y, loudness = 1, opts = {}) {
    // Roughly as far as the bolt that made it flew, before the walls and the
    // corners take their cut. A distraction that only carried across a room
    // would never be worth spending a bolt on.
    const range = 12 * loudness;
    this.noiseField.build(x, y, range, (gx, gy) => this.soundBlocked(gx, gy));
    let drawn = 0;
    for (const e of this.enemies) {
      if (e.dead || e.sealed || e.dormant) continue;
      if (!e.investigable) continue;
      const heard = this.noiseField.hear(e.x, e.y, 1);
      if (!heard || heard.volume < 0.07) continue;
      if (e.hearNoise(this, x, y, heard)) drawn++;
    }
    if (opts.playerHears !== false) this.hearSfx(opts.sfx || 'clatterFar', x, y, loudness);
    return drawn;
  }

  // --- acoustics ----------------------------------------------------------
  // Rooms and corridors are genuinely different places to make a noise in, so
  // the mixer is told about the geometry rather than about the room's name.
  updateAcoustics(dt) {
    this.acousticTimer -= dt;
    if (this.acousticTimer <= 0) {
      this.acousticTimer = 0.2;
      const extra = (x, y) => {
        if (this.sealBlocks.has(this.grid.idx(x, y))) return true;
        const g = this.gateAt(x, y);
        return !!(g && !g.open);
      };
      this.acousticTarget = probeAcoustics(this.grid, this.player.x, this.player.y, extra);
    }
    // Ease toward the probe so the reverb never snaps mid-stride.
    this.acoustics = blendSpace(this.acoustics, this.acousticTarget, Math.min(1, dt * 3.2));
    this.acousticProfile = spaceProfile(this.acoustics);
  }

  // How the mixer should colour the room: fog and mud swallow reflections,
  // ice and bare crypt stone keep them bright.
  acousticMods() {
    const hz = this.currentHazard.id;
    const biome = this.level.biome.id;
    let absorb = 0;
    let brightness = 1;
    if (hz === 'fog') { absorb = 0.55; brightness = 0.55; }
    else if (hz === 'mud') { absorb = 0.4; brightness = 0.6; }
    else if (hz === 'vines') { absorb = 0.5; brightness = 0.7; }
    else if (hz === 'dust') { absorb = 0.15; brightness = 0.85; }
    else if (hz === 'ice') { absorb = -0.05; brightness = 1.35; }
    else if (hz === 'rain') { absorb = 0.2; brightness = 1.1; }
    else if (hz === 'embers') { absorb = 0.2; brightness = 0.9; }
    if (biome === 'crypt') brightness *= 1.15;
    if (biome === 'tomb') { absorb += 0.15; brightness *= 0.85; }
    return { absorb: Math.max(0, absorb), brightness };
  }

  // What the player is walking on. Hazards win over the biome, because the
  // hazard is the thing that also changed how walking feels.
  surfaceAt() {
    const hz = this.hazardMods;
    if (hz.footstepSplash) return 'wet';
    if (hz.slide) return 'ice';
    if (hz.footprints) return 'mud';
    const info = this.level.zoneInfo[this.zoneAt(this.player.x, this.player.y)];
    const id = (info && info.biome && info.biome.id) || this.level.biome.id;
    if (id === 'crypt') return 'crypt';
    if (id === 'tomb') return 'moss';
    if (id === 'embers') return 'ash';
    if (id === 'rainruins') return 'wet';
    return 'stone';
  }

  // Occasional, quiet, and always sourced from somewhere the player could
  // plausibly be hearing: a drip in a wet hall, a settling ember, wind down a
  // long gallery. Never fires during a fight.
  updateAmbience(dt) {
    this.ambientTimer -= dt;
    if (this.ambientTimer > 0) return;
    const s = this.acoustics;
    const biome = this.level.biome.id;
    const hazard = this.currentHazard.id;
    this.ambientTimer = 3.5 + Math.random() * 6;

    const a = Math.random();
    const spot = () => {
      const ang = Math.random() * Math.PI * 2;
      const r = 2 + Math.random() * 5;
      return { x: this.player.x + Math.cos(ang) * r, y: this.player.y + Math.sin(ang) * r };
    };
    if (biome === 'rainruins' || hazard === 'rain' || biome === 'crypt') {
      if (a < 0.6) { this.playSfx('drip', spot()); return; }
    }
    if (biome === 'embers' || hazard === 'embers') {
      if (a < 0.6) { this.playSfx('emberPop', spot()); return; }
    }
    if (s.corridor > 0.4 && a < 0.45) { this.playSfx('gust'); return; }
    if (s.size > 0.5 && a < 0.3) { this.playSfx('distantFall', spot()); return; }
    this.ambientTimer = 2 + Math.random() * 4;
  }

  refreshVisibility(dt) {
    const sources = [{
      x: this.player.x, y: this.player.y,
      radius: this.torchRadius, intensity: this.torchLit ? 1 : 0.5,
    }];
    // Fires contribute genuine light, but only nearby ones. A doused
    // torchbearer can still see by somebody else's flame, which is what makes
    // walking a lit hall in the dark a thing worth doing.
    for (const s of this.level.sconces) {
      if (s.lit === false) continue;
      const reach = (s.radius || 3.6) + 7;
      if (Math.abs(s.x - this.player.x) + Math.abs(s.y - this.player.y) > reach) continue;
      sources.push({ x: s.x, y: s.y, radius: s.radius || 3.6, intensity: s.intensity || 0.6 });
    }
    const decay = 0.05 * this.run.mods.memoryDecay * (this.hazardMods.memoryDecay || 1);
    this.vis.update(sources, dt, decay);
  }

  // Shared BFS field from the player, used by every chasing enemy.
  updateFlow(dt) {
    this.flowTimer -= dt;
    if (this.flow && this.flowTimer > 0) return;
    this.flowTimer = FLOW_INTERVAL;
    const px = Math.floor(this.player.x), py = Math.floor(this.player.y);
    const passable = (x, y, t) => {
      if (Math.abs(x - px) + Math.abs(y - py) > FLOW_RADIUS) return false;
      if (this.sealBlocks.has(this.grid.idx(x, y))) return false;
      if (t === T.GATE) {
        const g = this.gateAt(x, y);
        return !!(g && g.open);
      }
      return isWalkableTile(t);
    };
    this.flow = bfsField(this.grid, [{ x: px, y: py }], passable);
  }

  flowDirection(x, y) {
    if (!this.flow) return null;
    const gx = Math.floor(x), gy = Math.floor(y);
    const here = this.flow[this.grid.idx(gx, gy)];
    if (here < 0) return null;
    if (here === 0) {
      return { x: this.player.x - x, y: this.player.y - y };
    }
    let best = null, bestD = here;
    for (const [dx, dy] of N4) {
      const nx = gx + dx, ny = gy + dy;
      if (!this.grid.inBounds(nx, ny)) continue;
      const d = this.flow[this.grid.idx(nx, ny)];
      if (d >= 0 && d < bestD) { bestD = d; best = { x: nx, y: ny }; }
    }
    if (!best) return { x: this.player.x - x, y: this.player.y - y };
    // Aim at the centre of the next cell so movement stays in the corridor.
    return { x: best.x + 0.5 - x, y: best.y + 0.5 - y };
  }

  // --- projectiles --------------------------------------------------------
  updateProjectiles(dt) {
    for (const p of this.projectiles) {
      if (p.dead) continue;
      const steps = 3;
      const sdt = dt / steps;
      for (let s = 0; s < steps && !p.dead; s++) {
        p.x += p.vx * sdt;
        p.y += p.vy * sdt;
        p.travelled += Math.hypot(p.vx, p.vy) * sdt;
        if (p.travelled > p.range) { p.dead = true; this.onProjectileExpire(p); break; }
        const gx = Math.floor(p.x), gy = Math.floor(p.y);
        if (tileBlocks(this, gx, gy) || this.sealBlocks.has(this.grid.idx(gx, gy))) {
          p.dead = true;
          this.onProjectileHitWall(p);
          break;
        }
        if (p.friendly) {
          for (const e of this.enemies) {
            if (e.dead || e.sealed) continue;
            if (Math.hypot(e.x - p.x, e.y - p.y) < e.radius + 0.18) {
              this.hitEnemyWithBolt(e, p);
              p.dead = true;
              break;
            }
          }
          if (!p.dead && this.boss && !this.boss.dead &&
              Math.hypot(this.boss.x - p.x, this.boss.y - p.y) < this.boss.radius + 0.2) {
            this.boss.takeDamage(this.run.boltDamage(), this, 'bolt');
            burstSparks(this.particles, p.x, p.y, '#ffd27a', 8, 3);
            this.playSfx('arrowHit', { x: p.x, y: p.y, material: 'armour' });
            p.dead = true;
          }
        } else if (Math.hypot(this.player.x - p.x, this.player.y - p.y) < this.player.radius + 0.2) {
          this.damagePlayer(p.damage, p.owner || null);
          p.dead = true;
          burstSparks(this.particles, p.x, p.y, p.colour || '#ffb35c', 6, 2.4);
          break;
        }
      }
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      if (this.projectiles[i].dead) this.projectiles.splice(i, 1);
    }
  }

  onProjectileExpire(p) {
    if (p.friendly) burstSparks(this.particles, p.x, p.y, '#8a8272', 3, 1.4);
  }

  onProjectileHitWall(p) {
    burstSparks(this.particles, p.x, p.y, p.friendly ? '#c9b48b' : (p.colour || '#cfc6b2'), 5, 2);
    this.playSfx(p.friendly ? 'arrowWall' : 'shotWall', { x: p.x, y: p.y });
    // A bolt hitting stone is a noise somewhere the player is not, which is
    // the one deliberate distraction the player owns.
    if (p.friendly) {
      const drawn = this.makeNoise(p.x, p.y, 1.15, { playerHears: false });
      if (drawn > 0) {
        ring(this.particles, p.x, p.y, '#8fd7ff', 14, 1.1, 0.5);
        this.emit('distraction', { x: p.x, y: p.y, count: drawn });
      }
    }
  }

  // --- player combat ------------------------------------------------------
  // The whoosh leaves the blade before anything is hit, so all it can know is
  // whether the arc has room to finish. A swing into a wall is a shorter,
  // duller sound than the same swing across an open hall.
  onSwing(player) {
    this.playSfx('swing', { blocked: !!this.swordWall(player) });
  }

  // The wall a swing would land on, if any: the tile in front of the player
  // within reach that a blade could actually strike.
  swordWall(player) {
    const reach = player.swordReach();
    for (const d of [0.55, 0.85, 1.0]) {
      const wx = player.x + player.faceX * reach * d;
      const wy = player.y + player.faceY * reach * d;
      const gx = Math.floor(wx), gy = Math.floor(wy);
      if (!this.grid.inBounds(gx, gy)) continue;
      if (gx === Math.floor(player.x) && gy === Math.floor(player.y)) continue;
      const t = this.grid.get(gx, gy);
      if (t === T.WALL || t === T.SECRET || t === T.RUBBLE) return { x: gx, y: gy, tile: t };
    }
    return null;
  }

  resolveSlash(player) {
    const damage = player.swordDamage();
    let hitSomething = false;
    let material = 'flesh';
    let hitAt = null;

    for (const e of this.enemies) {
      if (e.dead || e.sealed) continue;
      if (!player.hitsWithSword(e.x, e.y, e.radius)) continue;
      hitSomething = true;
      e.takeDamage(damage, this, 'sword');
      const dx = e.x - player.x, dy = e.y - player.y;
      const m = Math.hypot(dx, dy) || 1;
      this.knock(e, dx, dy, 0.3);
      burstBlood(this.particles, e.x, e.y, dx / m, dy / m, IMPACT_SPARK[e.def.material]);
      this.gore.splat(e.x, e.y, e.def.blood || DEFAULT_BLOOD,
        Math.min(1.4, 0.35 + damage / 40), dx / m, dy / m);
      this.particles.text(e.x, e.y, Math.round(damage), '#ffe0b0', 13);
      material = e.def.material || 'flesh';
      hitAt = { x: e.x, y: e.y };
    }

    if (this.boss && !this.boss.dead && player.hitsWithSword(this.boss.x, this.boss.y, this.boss.radius)) {
      hitSomething = true;
      this.boss.takeDamage(damage, this, 'sword');
      burstBlood(this.particles, this.boss.x, this.boss.y - 0.2, player.faceX, player.faceY, '#7a2440');
      this.particles.text(this.boss.x, this.boss.y, Math.round(damage), '#ffe0b0', 14);
      material = this.boss.def.material || 'armour';
      hitAt = { x: this.boss.x, y: this.boss.y };
    }

    // A captive is in reach of the same swing as anything else. Nothing stops
    // it and nothing warns you, because a choice you are protected from making
    // is not a choice.
    for (const prop of this.level.props) {
      if (prop.type !== 'prisoner' || prop.mood === 'dead' || prop.freed) continue;
      if (!player.hitsWithSword(prop.x, prop.y, 0.3)) continue;
      this.murderCaptive(prop);
      hitSomething = true;
      material = 'flesh';
      hitAt = { x: prop.x, y: prop.y };
    }

    // Cracked walls break to the same swing -- no separate verb to learn.
    if (this.actionableSecret) {
      this.breakSecret(this.actionableSecret);
      hitSomething = true;
    }

    if (hitSomething) {
      this.playSfx('hit', { material, x: hitAt ? hitAt.x : player.x, y: hitAt ? hitAt.y : player.y });
      this.shake(4.5);
      this.emit('hitstop', { seconds: 0.055 });
      return;
    }

    // Nothing to cut, but stone in the way: the blade rings off the masonry,
    // strikes sparks and jars the swing short.
    const wall = this.swordWall(player);
    if (wall) {
      const sx = player.x + player.faceX * player.swordReach() * 0.8;
      const sy = player.y + player.faceY * player.swordReach() * 0.8;
      burstSparks(this.particles, sx, sy, '#ffd9a0', 7, 2.6);
      this.playSfx('swingWall', { x: sx, y: sy });
      this.shake(1.6);
      this.emit('hitstop', { seconds: 0.03 });
    }
  }

  fireBolt(player) {
    if (!this.run.spendArrow()) return;
    const mods = this.run.mods;
    const speed = 11 * mods.boltSpeed;
    this.projectiles.push({
      x: player.x + player.faceX * 0.4,
      y: player.y + player.faceY * 0.4,
      vx: player.faceX * speed,
      vy: player.faceY * speed,
      range: this.run.boltRange(),
      travelled: 0,
      damage: this.run.boltDamage(),
      friendly: true,
      kind: 'arrow',
      dead: false,
    });
    this.playSfx('crossbow');
    this.emit('ammo', { arrows: this.run.arrows });
  }

  hitEnemyWithBolt(enemy, projectile) {
    const damage = this.run.boltDamage();
    const wasAlive = !enemy.dead;
    enemy.takeDamage(damage, this, 'bolt');
    burstBlood(this.particles, projectile.x, projectile.y, projectile.vx, projectile.vy,
      IMPACT_SPARK[enemy.def.material]);
    this.gore.splat(projectile.x, projectile.y, enemy.def.blood || DEFAULT_BLOOD, 0.7,
      projectile.vx * 0.1, projectile.vy * 0.1);
    this.particles.text(enemy.x, enemy.y, Math.round(damage), '#ffe0b0', 13);
    this.playSfx('arrowHit', { x: enemy.x, y: enemy.y, material: enemy.def.material || 'flesh' });
    // Reclaimer: a killing bolt sometimes comes home.
    if (wasAlive && enemy.dead && this.rng.next() < this.run.mods.reclaim) {
      if (this.run.giveArrows(1)) {
        this.particles.text(enemy.x, enemy.y - 0.4, 'BOLT RECOVERED', '#8fd7ff', 11, 1.3);
        this.playSfx('pickup');
      }
    }
  }

  fireEnemyShot(enemy) {
    const p = this.player;
    const dx = p.x - enemy.x, dy = p.y - enemy.y;
    const m = Math.hypot(dx, dy) || 1;
    const speed = 7.2;
    this.projectiles.push({
      x: enemy.x + (dx / m) * 0.4,
      y: enemy.y + (dy / m) * 0.4,
      vx: (dx / m) * speed,
      vy: (dy / m) * speed,
      range: enemy.def.attackRange + 2,
      travelled: 0,
      damage: enemy.damage,
      friendly: false,
      owner: enemy,
      kind: 'shard',
      colour: enemy.def.palette.eye,
      dead: false,
    });
    this.playSfx('enemyShot', { x: enemy.x, y: enemy.y });
  }

  // --- damage to the player ----------------------------------------------
  damagePlayer(amount, source) {
    const player = this.player;
    if (player.invulnTimer > 0 || this.playerDead || this.finished) return;
    const result = player.resolveIncoming(amount, this.rng);

    if (result.outcome === 'reflect') {
      player.shieldPulse = 1;
      this.playSfx('reflect');
      this.shake(7);
      ring(this.particles, player.x, player.y, '#8fd7ff', 22, 1.4, 0.5);
      this.particles.text(player.x, player.y, 'RICOCHET', '#8fd7ff', 15, 1.2);
      if (source && source.takeDamage) {
        source.takeDamage(amount * 2.2, this, 'reflect');
        this.particles.text(source.x, source.y, Math.round(amount * 2.2), '#8fd7ff', 13);
      }
      return;
    }
    if (result.outcome === 'block') {
      player.shieldPulse = 1;
      player.invulnTimer = 0.35;
      this.playSfx('block');
      this.particles.text(player.x, player.y, 'BLOCKED', '#8fd7ff', 14, 1.0);
      burstSparks(this.particles, player.x, player.y, '#cfe8ff', 8, 2.6);
      return;
    }
    if (result.outcome === 'reduced') {
      player.shieldPulse = 0.7;
      this.playSfx('blockPartial');
      this.particles.text(player.x, player.y, 'GLANCING', '#a8c8e8', 12, 0.9);
    }

    const dealt = Math.max(1, Math.round(result.damage));
    this.run.hp = Math.max(0, this.run.hp - dealt);
    this.damageTakenThisLevel += dealt;
    player.onDamaged(dealt);
    this.particles.text(player.x, player.y, '-' + dealt, '#ff8a72', 15, 1.1);
    burstBlood(this.particles, player.x, player.y, -player.faceX, -player.faceY, '#a02020');
    this.gore.splat(player.x, player.y, '#8e2320', Math.min(1.4, 0.4 + dealt / 26),
      -player.faceX, -player.faceY);
    this.shake(6 + dealt * 0.2);
    this.playSfx('playerHurt');
    this.emit('health', { hp: this.run.hp, maxHp: this.run.maxHp });

    // Any encounter in progress loses its flawless status.
    for (const enc of this.level.encounters) {
      if (enc.state === 'active') enc.flawlessIntact = false;
    }
    if (source && source.def && source.def.chills) this.player.slowTimer = 2.4;
    if (source && source.def && source.def.burns) this.player.burnTimer = 2.2;

    this.checkPlayerDeath();
  }

  // The one place a run ends. Damage over time (burning) deliberately bypasses
  // damagePlayer -- a burn must not be blocked by a shield or shrugged off by
  // invulnerability frames -- so the death test cannot live in there.
  checkPlayerDeath() {
    if (this.playerDead || this.finished || this.run.hp > 0) return false;
    this.playerDead = true;
    this.playSfx('death');
    this.emit('playerDied', {});
    return true;
  }

  // --- kills and rewards --------------------------------------------------
  onEnemyKilled(enemy, source) {
    const mods = this.run.mods;
    const result = this.run.score.addKill(enemy.scoreValue, { elite: enemy.elite, mods });
    this.particles.text(enemy.x, enemy.y - 0.5,
      '+' + Math.round(result.points), enemy.elite ? '#e8b45c' : '#dfe6ee', 13, 1.1);
    if (result.streak >= 3) {
      this.particles.text(enemy.x, enemy.y - 1.0,
        'x' + result.multiplier.toFixed(2).replace(/0$/, '') + ' streak', '#ffb257', 12, 1.3);
    }
    burstBlood(this.particles, enemy.x, enemy.y, 0, -1);
    burstSparks(this.particles, enemy.x, enemy.y, enemy.def.palette.eye, 6, 2.4);
    // The body stays where it fell for the rest of the depth.
    const blood = enemy.def.blood || DEFAULT_BLOOD;
    this.gore.pool(enemy.x, enemy.y, blood, 0.8 + (enemy.elite ? 0.5 : 0));
    this.gore.splat(enemy.x, enemy.y, blood, 1.3, this.player.faceX, this.player.faceY);
    this.gore.corpse({
      defId: enemy.def.id, x: enemy.x, y: enemy.y,
      faceX: enemy.faceX, faceY: enemy.faceY,
      elite: enemy.elite, scale: enemy.scale, seed: enemy.seed,
      palette: enemy.def.palette, blood,
    });
    this.playSfx(enemy.elite ? 'eliteDeath' : 'enemyDeath',
      { x: enemy.x, y: enemy.y, material: enemy.def.material || 'flesh' });
    this.run.discover(enemy.def.id);

    if (source === 'sword' && mods.lifesteal > 0 && this.rng.next() < mods.lifesteal) {
      const healed = this.run.heal(mods.lifestealAmount, true);
      if (healed > 0) {
        this.particles.text(this.player.x, this.player.y - 0.6, '+' + healed, '#6fce87', 13, 1.1);
        this.playSfx('lifesteal');
      }
    }
    if (enemy.def.burns) {
      ring(this.particles, enemy.x, enemy.y, '#ff7a2a', 14, 0.9, 0.6);
    }
    if (enemy.carriesKey !== null && enemy.carriesKey !== undefined) {
      const key = this.level.keys.find((k) => k.colourIndex === enemy.carriesKey);
      if (key && !key.taken) {
        key.holder = null;
        key.x = Math.floor(enemy.x);
        key.y = Math.floor(enemy.y);
        // Make sure the dropped key is standing on real floor.
        if (!isWalkableTile(this.grid.get(key.x, key.y))) {
          key.x = Math.floor(this.player.x); key.y = Math.floor(this.player.y);
        }
        this.emit('keyDropped', { colourIndex: key.colourIndex });
        this.playSfx('keyDrop');
      }
    }
    this.emit('kill', { enemy, points: result.points, streak: result.streak });
    this.checkEncounterProgress();
  }

  // Something went to look at a noise. Presentation only -- the decision was
  // taken in the creature -- but the player has to be able to tell it worked.
  onEnemyHeardNoise(enemy, x, y, heard) {
    this.particles.text(enemy.x, enemy.y - 0.9, '?', '#8fd7ff', 15, 1.1);
    this.playSfx('alert', { x: enemy.x, y: enemy.y, key: 'heard' + enemy.id, peak: 0.4 });
  }

  onEnemyAlerted(enemy) {
    this.playSfx('alert', { x: enemy.x, y: enemy.y, key: 'alert' + enemy.id });
    this.emit('alert', { enemy });
  }
  onEnemyWindup(enemy) { this.playSfx('windup', { x: enemy.x, y: enemy.y, key: 'windup' + enemy.id }); }
  onEnemyMiss(enemy) { this.playSfx('swingMiss', { x: enemy.x, y: enemy.y }); }
  onAmbushWake(enemy) {
    burstStone(this.particles, enemy.x, enemy.y, '#4a5540');
    this.playSfx('ambush', { x: enemy.x, y: enemy.y });
    this.shake(5);
  }

  // --- pickups ------------------------------------------------------------
  updatePickups() {
    const p = this.player;
    for (const key of this.level.keys) {
      if (key.taken || key.holder === 'enemy') continue;
      if (Math.hypot(key.x + 0.5 - p.x, key.y + 0.5 - p.y) > 0.72) continue;
      key.taken = true;
      this.run.keys.add(key.colourIndex);
      const col = keyColour(key.colourIndex);
      this.particles.text(p.x, p.y - 0.6, col.name.toUpperCase() + ' KEY', col.glow, 15, 1.4);
      ring(this.particles, p.x, p.y, col.glow, 16, 0.8, 0.6);
      this.playSfx('keyPickup');
      this.emit('keyTaken', { colourIndex: key.colourIndex });
    }

    for (const prop of this.level.props) {
      if (prop.consumed) continue;
      if (prop.hidden && !this.revealedProps.has(prop.id)) continue;
      const d = Math.hypot(prop.x - p.x, prop.y - p.y);
      if (d > 0.75) continue;
      if (prop.type === 'potion') {
        const healed = this.run.heal(prop.heal || 30);
        prop.consumed = true;
        this.particles.text(p.x, p.y - 0.6, '+' + healed, '#6fce87', 15, 1.2);
        this.playSfx('drink');
        this.emit('health', { hp: this.run.hp, maxHp: this.run.maxHp });
      } else if (prop.type === 'arrows') {
        if (!this.run.hasCrossbow) continue;
        const taken = this.run.giveArrows(prop.amount || 2);
        if (taken <= 0) continue; // quiver full: leave it on the floor
        prop.consumed = true;
        this.particles.text(p.x, p.y - 0.6, '+' + taken + ' bolts', '#e8b45c', 14, 1.2);
        this.playSfx('pickup');
        this.emit('ammo', { arrows: this.run.arrows });
      } else if (prop.type === 'crossbow') {
        prop.consumed = true;
        this.run.giveCrossbow();
        this.particles.text(p.x, p.y - 0.8, 'CROSSBOW', '#e8b45c', 18, 1.8);
        ring(this.particles, p.x, p.y, '#e8b45c', 22, 1.2, 0.8);
        this.playSfx('fanfare');
        this.emit('crossbow', {});
      } else if (prop.type === 'treasure') {
        prop.consumed = true;
        const points = this.run.score.addBonus(220 + this.level.depth * 45, this.run.mods);
        this.particles.text(p.x, p.y - 0.6, '+' + Math.round(points), '#e8b45c', 15, 1.3);
        this.playSfx('coins');
      }
    }
  }

  // --- hints ---------------------------------------------------------------
  //
  // Anything that tells the player where something is goes through here: a
  // map scrap, a prisoner who will talk, an altar taking payment for the
  // answer. One place, so a hint always looks and behaves the same however it
  // was earned, and so nothing can point at something already found.
  hintTarget(kind) {
    const level = this.level;
    if (kind === 'exit') {
      return { x: level.stairs.x + 0.5, y: level.stairs.y + 0.5, colour: HINT_COLOUR.exit, label: 'the stairs down' };
    }
    if (kind === 'key') {
      // The next key they will need, which is the one for the next gate on
      // the route -- not whichever happens to be nearest.
      for (const gate of level.gates) {
        if (gate.open || this.run.keys.has(gate.colourIndex)) continue;
        const key = level.keys.find((k) => k.colourIndex === gate.colourIndex && !k.taken);
        if (!key) continue;
        const col = keyColour(key.colourIndex);
        if (key.holder === 'enemy') {
          const carrier = this.enemies.find((e) => e.carriesKey === key.colourIndex && !e.dead);
          if (!carrier) continue;
          return { x: carrier.x, y: carrier.y, colour: col.glow, follow: carrier,
            label: 'what carries the ' + col.name + ' Key' };
        }
        return { x: key.x + 0.5, y: key.y + 0.5, colour: col.glow, label: 'the ' + col.name + ' Key' };
      }
      return null;
    }
    if (kind === 'secret') {
      const s = level.secrets.find((x) => !x.broken && !x.discovered && !x.hiddenUntil);
      if (!s) return null;
      return { x: s.x + 0.5, y: s.y + 0.5, colour: HINT_COLOUR.secret, label: 'a hollow wall', secret: s };
    }
    if (kind === 'treasure') {
      const prop = level.props.find((x) => !x.consumed && !x.opened
        && (x.type === 'chest' || x.type === 'cursedChest' || x.type === 'treasure'));
      if (!prop) return null;
      return { x: prop.x, y: prop.y, colour: HINT_COLOUR.treasure, label: 'something worth carrying' };
    }
    if (kind === 'health') {
      const prop = level.props.find((x) => !x.consumed && !x.used
        && (x.type === 'potion' || x.type === 'shrine' || x.type === 'shrineSmall'));
      if (!prop) return null;
      return { x: prop.x, y: prop.y, colour: HINT_COLOUR.health, label: 'something to drink' };
    }
    return null;
  }

  // Adds the hint and marks the spot on the chart. Returns what it revealed,
  // or null when there was nothing left of that kind to point at.
  revealHint(kind, source) {
    let target = this.hintTarget(kind);
    let gave = kind;
    // Nothing of that kind left. Fall back rather than wasting the moment --
    // being told nothing is a worse outcome than being told something else.
    // The hint reports what it actually points at, not what was asked for.
    if (!target) {
      for (const alt of ['exit', 'key', 'secret', 'treasure', 'health']) {
        if (alt === kind) continue;
        target = this.hintTarget(alt);
        if (target) { gave = alt; break; }
      }
    }
    if (!target) return null;
    if (this.hints.some((h) => !h.resolved && Math.hypot(h.x - target.x, h.y - target.y) < 0.6)) {
      return null;
    }
    // Put the spot itself on the chart without lighting the road to it: the
    // player is being told where, not how.
    const gx = Math.floor(target.x), gy = Math.floor(target.y);
    if (this.grid.inBounds(gx, gy)) {
      const i = this.grid.idx(gx, gy);
      this.vis.seen[i] = 1;
      this.vis.memory[i] = Math.max(this.vis.memory[i], 0.55);
    }
    if (target.secret) target.secret.discovered = true;
    const hint = { ...target, kind: gave, asked: kind, source: source || null, resolved: false };
    this.hints.push(hint);
    this.emit('hint', { hint });
    return hint;
  }

  // A hint stops pointing once the player has been to the spot, or once the
  // thing it named has been taken.
  updateHints(dt) {
    const p = this.player;
    for (const h of this.hints) {
      if (h.resolved) continue;
      if (h.follow) {
        if (h.follow.dead) { h.resolved = true; continue; }
        h.x = h.follow.x; h.y = h.follow.y;
      }
      if (Math.hypot(h.x - p.x, h.y - p.y) < 2.2) {
        h.resolved = true;
        this.emit('hintReached', { hint: h });
      }
    }
  }

  // --- secrets ------------------------------------------------------------
  updateSecretAwareness() {
    const p = this.player;
    const sense = 3.4 * this.run.mods.secretSense;
    this.actionableSecret = null;
    let bestDot = 0.3;
    for (const s of this.level.secrets) {
      if (s.broken) continue;
      if (s.hiddenUntil) {
        const enc = this.level.encounters.find((e) => e.id === s.hiddenUntil);
        if (!enc || enc.state !== 'cleared') continue;
      }
      const dx = s.x + 0.5 - p.x, dy = s.y + 0.5 - p.y;
      const d = Math.hypot(dx, dy);
      if (!s.discovered && d < sense && this.vis.lightAt(s.x, s.y) > 0.05) {
        s.discovered = true;
        this.playSfx('secretSense');
        this.emit('secretFound', { secret: s });
      }
      if (!s.discovered) continue;
      // Green only when a swing would genuinely connect.
      if (d <= this.player.swordReach() + 0.55) {
        const dot = (dx / (d || 1)) * p.faceX + (dy / (d || 1)) * p.faceY;
        if (dot > bestDot) { bestDot = dot; this.actionableSecret = s; }
      }
    }
  }

  breakSecret(secret) {
    secret.broken = true;
    this.grid.set(secret.x, secret.y, T.FLOOR);
    burstStone(this.particles, secret.x + 0.5, secret.y + 0.5);
    this.shake(8);
    this.playSfx('stoneBreak');
    this.secretsFound++;
    const points = this.run.score.addSecret(180 + this.level.depth * 30, this.run.mods);
    this.particles.text(secret.x + 0.5, secret.y + 0.5, 'SECRET  +' + Math.round(points), '#e8b45c', 15, 1.6);
    for (const prop of this.level.props) {
      if (prop.secret !== undefined && this.level.secrets[prop.secret] === secret) {
        this.revealedProps.add(prop.id);
        prop.hidden = false;
      }
    }
    this.actionableSecret = null;
    this.flow = null;
    this.emit('secretBroken', { secret });
  }

  // --- captives -------------------------------------------------------------
  //
  // The one part of the labyrinth that can be wronged. Everything else in it
  // is trying to kill you; these are people, and what the player does about
  // that is the only genuinely moral choice in the game -- so it has to cost
  // something, and the exception has to be real.
  updateCaptives(dt) {
    for (const prop of this.level.props) {
      if (prop.type !== 'prisoner' || prop.mood !== 'raving' || prop.freed) continue;
      prop.screamTimer = (prop.screamTimer === undefined ? 3 + prop.seed * 6 : prop.screamTimer) - dt;
      if (prop.screamTimer > 0) continue;
      prop.screamTimer = 9 + Math.random() * 12;
      if (Math.hypot(prop.x - this.player.x, prop.y - this.player.y) > 22) continue;
      // A scream is a noise like any other, which means it brings company --
      // and that is the whole reason a raving captive is a problem and not
      // just a sad thing to walk past.
      this.makeNoise(prop.x, prop.y, 1.6, { sfx: 'scream' });
      this.emit('scream', { prop });
    }
  }

  captiveLabel(prop) {
    if (prop.mood === 'dead') {
      return prop.searched ? { label: 'Nothing else on them', enabled: false }
        : { label: 'Search the body', enabled: true };
    }
    if (prop.freed) return { label: 'They have said all they will', enabled: false };
    if (prop.mood === 'raving') {
      return { label: 'It does not hear you', hint: 'Its screaming carries', enabled: false };
    }
    if (prop.mood === 'begging') {
      return prop.spoken
        ? { label: 'End it', hint: 'They asked', enabled: true }
        : { label: 'Listen', enabled: true };
    }
    return { label: prop.spoken ? 'Cut them down' : 'Speak to them', enabled: true };
  }

  useCaptive(prop) {
    if (prop.mood === 'dead') {
      prop.searched = true;
      this.playSfx('chest', { x: prop.x, y: prop.y });
      if (prop.carries) {
        this.grantFrom(prop, prop.carries);
        prop.carries = null;
      } else {
        this.particles.text(prop.x, prop.y - 1, 'nothing', '#8fa0b8', 12, 1.2);
      }
      this.emit('captive', { prop, action: 'searched' });
      return true;
    }
    if (prop.mood === 'begging' && prop.spoken) return this.releaseCaptive(prop, true);
    if (prop.mood === 'afraid' && prop.spoken) return this.releaseCaptive(prop, false);

    prop.spoken = true;
    this.playSfx('shrineBless', { x: prop.x, y: prop.y });
    if (prop.mood === 'begging') {
      this.particles.text(prop.x, prop.y - 1, 'Please.', '#c9b9d8', 13, 2.4);
      this.emit('captive', { prop, action: 'begged' });
      return true;
    }
    // They will talk. What they know is worth more than what they carry.
    const hint = prop.knows === 'nothing' ? null : this.revealHint(prop.knows, 'captive');
    if (hint) {
      this.particles.text(prop.x, prop.y - 1, 'THEY KNOW', hint.colour, 13, 2.0);
    } else {
      this.particles.text(prop.x, prop.y - 1, 'I have been here too long.', '#c9b9d8', 12, 2.4);
    }
    this.emit('captive', { prop, action: 'spoke', hint });
    return true;
  }

  // Cutting a captive loose. Merciful when they asked for it, which is the
  // one case that pays instead of costing.
  releaseCaptive(prop, mercy) {
    prop.freed = true;
    prop.mood = 'dead';
    prop.searched = !prop.carries;
    this.gore.pool(prop.x, prop.y, '#7a1f1c', 0.7);
    if (mercy) {
      this.playSfx('shrineHeal', { x: prop.x, y: prop.y });
      const pts = this.run.score.addBonus(260 + this.level.depth * 30, this.run.mods);
      this.particles.text(prop.x, prop.y - 1, 'MERCY  +' + Math.round(pts), '#8fb7ff', 14, 2.2);
      // They had been saving it for whoever was willing.
      const hint = this.revealHint(prop.knows === 'nothing' ? 'exit' : prop.knows, 'captive');
      if (hint) this.particles.text(prop.x, prop.y - 1.7, 'THEY KNEW', hint.colour, 12, 2.0);
      if (prop.carries) { this.grantFrom(prop, prop.carries); prop.carries = null; }
    } else {
      this.playSfx('gateUnlock', { x: prop.x, y: prop.y });
      const pts = this.run.score.addBonus(120, this.run.mods);
      this.particles.text(prop.x, prop.y - 1, 'FREED  +' + Math.round(pts), '#6fce87', 13, 1.8);
    }
    this.emit('captive', { prop, action: mercy ? 'mercy' : 'freed' });
    return true;
  }

  // Killing one that did not ask. The labyrinth does not stop you; it simply
  // takes it out of the tally, and it takes rather a lot.
  murderCaptive(prop) {
    if (prop.mood === 'dead' || prop.freed) return false;
    const asked = prop.mood === 'begging' && prop.spoken;
    this.gore.splat(prop.x, prop.y, '#7a1f1c', 1.4, this.player.faceX, this.player.faceY);
    this.shake(6);
    if (asked) return this.releaseCaptive(prop, true);

    prop.freed = true;
    prop.mood = 'dead';
    prop.searched = !prop.carries;
    this.gore.pool(prop.x, prop.y, '#7a1f1c', 1.1);
    const cost = this.run.score.addPenalty(500 + this.level.depth * 60,
      prop.mood === 'raving' ? 'the one that was screaming' : 'someone who did not ask');
    this.particles.text(prop.x, prop.y - 1, 'MURDER  -' + Math.round(cost), '#e05a3c', 15, 2.4);
    this.playSfx('curse', { x: prop.x, y: prop.y });
    this.emit('captive', { prop, action: 'murdered', cost });
    return true;
  }

  // Hands over whatever a captive was carrying, wherever it came from.
  grantFrom(prop, kind) {
    if (kind === 'potion') {
      const healed = this.run.heal(30 + this.level.depth);
      this.particles.text(prop.x, prop.y - 1, '+' + healed + ' vigour', '#6fce87', 14, 1.6);
      this.emit('health', { hp: this.run.hp, maxHp: this.run.maxHp });
    } else if (kind === 'arrows' && this.run.hasCrossbow) {
      const got = this.run.giveArrows(2);
      if (got > 0) this.particles.text(prop.x, prop.y - 1, '+' + got + ' bolts', '#e8b45c', 14, 1.6);
    } else {
      const pts = this.run.score.addBonus(180 + this.level.depth * 30, this.run.mods);
      this.particles.text(prop.x, prop.y - 1, '+' + Math.round(pts), '#e8b45c', 14, 1.6);
      this.playSfx('coins', { x: prop.x, y: prop.y });
    }
  }

  // --- altars ---------------------------------------------------------------
  //
  // The world owns applying an offer, because the map, the monsters and the
  // score all live here. What is on offer, and whether the player can pay for
  // it, is worked out in altars.js.
  altarOffers(prop) {
    if (!prop.offers) {
      prop.offers = buildOffers(this.run, this,
        new RNG(this.level.seed + ':altar:' + prop.id));
    }
    return prop.offers;
  }

  takeOffer(prop, offer) {
    if (!prop || prop.used || !offer) return false;
    prop.used = true;
    this.playSfx('curse', { x: prop.x, y: prop.y });
    this.shake(9);
    ring(this.particles, prop.x, prop.y, '#c46ad8', 26, 1.4, 0.9);
    // Paid first, then answered. An ambush that arrives before the reward
    // reads as a betrayal; after it, as a price.
    const paid = this.paySacrifice(offer);
    const gave = this.grantReward(offer);
    this.emit('altarUsed', { prop, offer, paid, gave });
    // Paying in blood can kill. It is allowed to: the price was stated.
    this.checkPlayerDeath();
    return true;
  }

  paySacrifice(offer) {
    const id = offer.sacrifice.id;
    const depth = this.level.depth;
    if (id === 'hpFixed' || id === 'hpPercent' || id === 'hpDrop') {
      const dealt = Math.max(0, Math.min(this.run.hp, Math.round(offer.amount)));
      this.run.hp -= dealt;
      this.damageTakenThisLevel += dealt;
      this.player.onDamaged(dealt);
      this.particles.text(this.player.x, this.player.y, '-' + dealt, '#e05a3c', 17, 1.4);
      this.gore.pool(this.player.x, this.player.y, '#8e2320', 0.9);
      this.emit('health', { hp: this.run.hp, maxHp: this.run.maxHp });
      return dealt + ' vitality';
    }
    if (id === 'scoreFixed') {
      const cost = this.run.score.addPenalty(offer.amount, 'given to an altar');
      this.particles.text(this.player.x, this.player.y - 1, '-' + Math.round(cost), '#e05a3c', 15, 1.4);
      return Math.round(cost) + ' points';
    }
    if (id === 'scoreLevel') {
      const had = this.run.score.levelSubtotal;
      this.run.score.resetLevel();
      this.particles.text(this.player.x, this.player.y - 1,
        'THIS DEPTH IS FORGOTTEN', '#e05a3c', 14, 2.2);
      return Math.round(had) + ' points';
    }
    if (id === 'ambushSmall' || id === 'ambush') {
      const n = id === 'ambush'
        ? 3 + this.rng.int(0, 2) + Math.floor(depth / 3)
        : 1 + this.rng.int(0, 1) + Math.floor(depth / 6);
      this.spawnAmbushAround(this.player.x, this.player.y, n);
      this.particles.text(this.player.x, this.player.y - 1.4, 'THEY HEARD', '#e05a3c', 15, 2.0);
      return 'they came';
    }
    if (id === 'amnesia') {
      this.forgetEverything();
      return 'everything you had seen';
    }
    return '';
  }

  // Wipes the chart back to the moment the player stepped off the stair. The
  // tile underfoot is left known so the next frame does not read as a bug.
  forgetEverything() {
    this.vis.seen.fill(0);
    this.vis.memory.fill(0);
    this.vis.discoveredCount = 0;
    this.hints.length = 0;
    this.revealedProps.clear();
    for (const s of this.level.secrets) if (!s.broken) s.discovered = false;
    this.refreshVisibility(0);
    this.particles.text(this.player.x, this.player.y - 2,
      'YOU HAVE NEVER BEEN HERE', '#c46ad8', 15, 2.6);
    this.playSfx('reveal');
    this.emit('forgot', {});
  }

  grantReward(offer) {
    const id = offer.reward.id;
    const boost = (this.run.mods && this.run.mods.rewardScale) || 1;
    if (id === 'arrows') {
      const got = this.run.giveArrows(this.run.maxArrows);
      this.particles.text(this.player.x, this.player.y - 1, '+' + got + ' bolts', '#e8b45c', 15, 1.6);
      this.emit('ammo', { arrows: this.run.arrows });
      return got + ' bolts';
    }
    if (id === 'mend' || id === 'heal' || id === 'restored') {
      const share = id === 'mend' ? 0.34 : id === 'heal' ? 0.67 : 1;
      const missing = this.run.maxHp - this.run.hp;
      const healed = this.run.heal(missing * Math.min(1, share * boost), true);
      if (id === 'restored') this.run.giveArrows(this.run.maxArrows);
      this.particles.text(this.player.x, this.player.y - 1.4, '+' + healed, '#6fce87', 17, 1.6);
      this.emit('health', { hp: this.run.hp, maxHp: this.run.maxHp });
      return '+' + healed + ' vitality';
    }
    if (id === 'key' || id === 'exit') {
      const hint = this.revealHint(id, 'altar');
      if (hint && boost > 1) this.revealHint('treasure', 'altar');
      return hint ? hint.label : 'nothing it did not know';
    }
    if (id === 'chart') {
      const tiles = this.revealLayout(boost > 1);
      return tiles + ' tiles of passage';
    }
    return '';
  }

  // The layout, and only the layout. Every walkable tile becomes known and
  // faintly remembered -- so the chart fills in -- but nothing standing in it
  // is marked, and the memory is low enough that the world itself still has
  // to be walked to be seen properly.
  revealLayout(withMarks) {
    const grid = this.grid;
    const band = this.level.mazeHeight;
    const layer = this.playerLayer;
    let count = 0;
    for (let y = 0; y < grid.h; y++) {
      if (band !== undefined && (y >= band) !== (layer === 1)) continue;
      for (let x = 0; x < grid.w; x++) {
        const i = grid.idx(x, y);
        if (this.vis.seen[i]) continue;
        if (!isWalkableTile(grid.cells[i]) && grid.cells[i] !== T.WALL) continue;
        // Walls are charted only where they border something walkable, so
        // the reveal draws rooms and passages rather than a solid rectangle.
        if (grid.cells[i] === T.WALL) {
          let touches = false;
          for (const [dx, dy] of N4) {
            if (isWalkableTile(grid.get(x + dx, y + dy))) { touches = true; break; }
          }
          if (!touches) continue;
        }
        this.vis.seen[i] = 1;
        this.vis.discoveredCount++;
        this.vis.memory[i] = Math.max(this.vis.memory[i], 0.28);
        count++;
      }
    }
    if (withMarks) for (const g of this.level.gates) this.revealHint('key', 'altar');
    this.emit('charted', { tiles: count });
    return count;
  }

  // --- map scraps -----------------------------------------------------------
  readMap(prop) {
    if (prop.read) return false;
    prop.read = true;
    prop.consumed = true;
    this.playSfx('reveal', { x: prop.x, y: prop.y });
    const hint = this.revealHint(prop.shows, 'map');
    if (hint) {
      ring(this.particles, prop.x, prop.y, hint.colour, 18, 1.1, 0.8);
      this.particles.text(prop.x, prop.y - 0.8, 'A MAP', hint.colour, 15, 1.8);
    } else {
      this.particles.text(prop.x, prop.y - 0.8, 'Nothing you did not know', '#8fa0b8', 12, 2);
    }
    this.emit('mapRead', { prop, hint });
    return true;
  }

  // --- contextual action --------------------------------------------------
  updateInteractTarget() {
    const p = this.player;
    const near = (x, y, r = 1.25) => Math.hypot(x - p.x, y - p.y) <= r;
    let target = null;

    const st = this.level.stairs;
    if (near(st.x + 0.5, st.y + 0.5, 1.1)) {
      const blocked = this.level.requiresBoss && this.boss && !this.boss.dead;
      target = {
        type: 'stairs',
        label: blocked ? 'The way is sealed while it lives' : 'Descend',
        hint: blocked ? '' : 'Depth ' + (this.level.depth + 1),
        enabled: !blocked,
        hx: st.x + 0.5, hy: st.y + 0.5,
      };
    }

    if (!target) {
      for (const g of this.level.gates) {
        if (g.open || !near(g.x + 0.5, g.y + 0.5, 1.3)) continue;
        const col = keyColour(g.colourIndex);
        const has = this.run.keys.has(g.colourIndex);
        target = {
          type: 'gate', gate: g,
          label: has ? 'Unlock the ' + col.name + ' Gate' : col.name + ' Gate is locked',
          hint: has ? '' : 'You need the ' + col.name + ' Key',
          enabled: has,
          hx: g.x + 0.5, hy: g.y + 0.5,
        };
        break;
      }
    }

    if (!target) {
      for (const prop of this.level.props) {
        if (prop.consumed) continue;
        if (prop.hidden && !this.revealedProps.has(prop.id)) continue;
        if (!near(prop.x, prop.y, 1.15)) continue;
        if (prop.type === 'chest' && !prop.opened) {
          target = { type: 'chest', prop, label: 'Open the chest', enabled: true, hx: prop.x, hy: prop.y };
        } else if (prop.type === 'cursedChest' && !prop.opened) {
          target = {
            type: 'chest', prop, label: 'Open the cursed chest',
            hint: 'Something is bound to it', enabled: true, hx: prop.x, hy: prop.y,
          };
        } else if (prop.type === 'ladder') {
          const down = prop.dir === 'down';
          const vault = this.level.vaults[prop.vault];
          target = {
            type: 'ladder', prop,
            label: down ? 'Climb down the ladder' : 'Climb back up',
            hint: down ? (vault && vault.visited ? 'Back to the vault' : 'Something is sealed down there')
              : 'Return to the labyrinth',
            enabled: true, hx: prop.x, hy: prop.y,
          };
        } else if (prop.type === 'prisoner') {
          const c = this.captiveLabel(prop);
          target = { type: 'captive', prop, label: c.label, hint: c.hint || '',
            enabled: c.enabled, hx: prop.x, hy: prop.y };
        } else if (prop.type === 'altar') {
          const offers = this.altarOffers(prop);
          target = {
            type: 'altar', prop,
            label: prop.used ? 'The altar is spent' : 'Make an offering',
            hint: prop.used ? '' : (offers.length ? '' : 'It wants nothing you have'),
            enabled: !prop.used && offers.length > 0,
            hx: prop.x, hy: prop.y,
          };
        } else if (prop.type === 'mapScrap' && !prop.read) {
          target = { type: 'map', prop, label: 'Read the map', enabled: true, hx: prop.x, hy: prop.y };
        } else if ((prop.type === 'shrine' || prop.type === 'shrineSmall') && !prop.used) {
          const heal = prop.flavour === 'heal' || prop.type === 'shrineSmall';
          target = {
            type: 'shrine', prop,
            label: heal ? 'Drink from the shrine' : 'Kneel at the shrine',
            enabled: true, hx: prop.x, hy: prop.y,
          };
        }
        if (target) break;
      }
    }

    // Cold fires come last: they are everywhere, and should never stand
    // between the player and a chest they are also standing on.
    if (!target) {
      const fire = this.fireAt(p.x, p.y, 1.35);
      if (fire) {
        target = {
          type: 'fire', fire,
          label: 'Light the ' + (FIRE_NAMES[fire.kind] || 'fire'),
          hint: this.torchLit ? '' : 'Your torch is out',
          enabled: this.torchLit,
          hx: fire.x, hy: fire.y,
        };
      }
    }
    this.interactTarget = target;
  }

  interact() {
    const target = this.interactTarget;
    if (!target || !target.enabled) {
      if (target) this.playSfx('denied');
      return false;
    }
    switch (target.type) {
      case 'stairs':
        this.finished = true;
        this.playSfx('descend');
        this.emit('descend', {});
        return true;
      case 'gate': return this.unlockGate(target.gate);
      case 'chest': return this.openChest(target.prop);
      case 'shrine': return this.useShrine(target.prop);
      case 'ladder': return this.useLadder(target.prop);
      case 'fire': return this.lightFire(target.fire);
      case 'captive': return this.useCaptive(target.prop);
      case 'map': return this.readMap(target.prop);
      case 'altar':
        // The choice itself is an interface question, so the world only says
        // that one is being asked. Nothing happens until takeOffer is called.
        this.emit('altarOpen', { prop: target.prop, offers: this.altarOffers(target.prop) });
        return true;
      default: return false;
    }
  }

  // Douse or relight. Free either way: the cost of the dark is the dark, and
  // making the player hunt for a flame to get their sight back would turn a
  // tactical choice into a punishment.
  toggleTorch() {
    if (this.torchToggleCooldown > 0 || this.playerDead || this.finished) return false;
    this.torchToggleCooldown = 0.45;
    this.torchLit = !this.torchLit;
    if (this.torchLit) {
      this.playSfx('torchLight');
      burstSparks(this.particles, this.player.x, this.player.y - 0.2, '#ffb35c', 8, 2.2);
      this.particles.text(this.player.x, this.player.y - 1.1, 'TORCH LIT', '#ffb35c', 12, 1.0);
    } else {
      this.playSfx('torchDouse');
      for (let i = 0; i < 7; i++) {
        this.particles.spawn({
          x: this.player.x, y: this.player.y, z: 0.9,
          vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4,
          vz: 0.5 + Math.random() * 0.5, gravity: -0.2, drag: 0.8,
          life: 1.4, size: 2.4, colour: '#59524a', fade: 1.6,
        });
      }
      this.particles.text(this.player.x, this.player.y - 1.1, 'TORCH OUT', '#8fa0b8', 12, 1.0);
    }
    this.updateHazard();
    this.refreshVisibility(0);
    this.emit('torch', { lit: this.torchLit });
    return true;
  }

  // How much better sound carries to the player right now. The ears sharpen
  // when the eyes have nothing to do.
  get hearingScale() {
    const relic = (this.run.mods && this.run.mods.hearing) || 1;
    return relic * (this.torchLit ? 1 : DOUSED_HEARING);
  }

  // The nearest cold fire the player could set alight, if they are standing
  // over it and still carrying a flame.
  fireAt(x, y, r = 1.3) {
    let best = null, bestD = r;
    for (const f of this.level.sconces) {
      if (f.lit !== false) continue;
      if (this.layerAt(Math.floor(f.y)) !== this.playerLayer) continue;
      const d = Math.hypot(f.x - x, f.y - y);
      if (d < bestD) { bestD = d; best = f; }
    }
    return best;
  }

  lightFire(fire) {
    if (!fire || fire.lit || !this.torchLit) return false;
    fire.lit = true;
    this.playSfx('torchLight', { x: fire.x, y: fire.y });
    ring(this.particles, fire.x, fire.y, '#ff9a3a', 16, 0.9, 0.6);
    burstSparks(this.particles, fire.x, fire.y, '#ffd27a', 14, 3);
    const points = this.run.score.addBonus(40, this.run.mods);
    this.particles.text(fire.x, fire.y - 0.8,
      'LIT  +' + Math.round(points), '#ffb35c', 13, 1.4);
    this.refreshVisibility(0);
    this.emit('fireLit', { fire });
    return true;
  }

  unlockGate(gate) {
    if (gate.open || !this.run.keys.has(gate.colourIndex)) return false;
    gate.open = true;
    gate.openAmount = 0;
    const col = keyColour(gate.colourIndex);
    this.playSfx('gateUnlock');
    this.shake(5);
    ring(this.particles, gate.x + 0.5, gate.y + 0.5, col.glow, 20, 1.0, 0.8);
    this.particles.text(gate.x + 0.5, gate.y + 0.5, col.name.toUpperCase() + ' GATE OPEN', col.glow, 15, 1.6);
    // The bars rise over the next second, advanced by the simulation clock so
    // that pausing genuinely pauses it.
    this.flow = null;
    this.emit('gateOpened', { gate });
    return true;
  }

  // Ladders move you within the same depth: down into a sealed vault that
  // nothing else connects to, and back up again. They never change level.
  useLadder(prop) {
    const dest = prop.link;
    const vault = this.level.vaults[prop.vault];
    this.player.placeAt(dest.x, dest.y);
    this.player.invulnTimer = 0.8;
    this.flow = null;
    this.particles.clear();
    this.playSfx('descend');

    if (prop.dir === 'down' && vault && !vault.visited) {
      vault.visited = true;
      this.secretsFound++;
      const pts = this.run.score.addSecret(320 + this.level.depth * 45, this.run.mods);
      this.particles.text(dest.x + 0.5, dest.y + 0.5 - 1,
        'VAULT FOUND  +' + Math.round(pts), '#e8b45c', 16, 2.2);
      ring(this.particles, dest.x + 0.5, dest.y + 0.5, '#e8b45c', 20, 1.1, 0.8);
      this.playSfx('reveal');
    }
    this.emit('ladder', { dir: prop.dir, vault: prop.vault, first: vault && vault.visited });
    return true;
  }

  openChest(prop) {
    prop.opened = true;
    this.playSfx('chest');
    const depth = this.level.depth;
    const cursed = prop.type === 'cursedChest';
    const rewards = [];
    const points = this.run.score.addBonus((cursed ? 420 : 200) + depth * 55, this.run.mods);
    rewards.push('+' + Math.round(points));

    if (this.run.hasCrossbow && this.rng.bool(0.7)) {
      const got = this.run.giveArrows(this.rng.int(1, cursed ? 4 : 2));
      if (got > 0) rewards.push('+' + got + ' bolts');
    }
    if (this.rng.bool(cursed ? 0.75 : 0.45)) {
      const healed = this.run.heal(cursed ? 35 : 22);
      if (healed > 0) rewards.push('+' + healed + ' vigour');
    }
    this.particles.text(prop.x, prop.y - 0.8, rewards.join('   '), '#e8b45c', 14, 1.8);
    ring(this.particles, prop.x, prop.y, '#e8b45c', 16, 0.9, 0.7);

    if (cursed) {
      // High value, real consequence.
      this.spawnAmbushAround(prop.x, prop.y, 2 + Math.floor(depth / 4));
      this.particles.text(prop.x, prop.y - 1.4, 'THE SEAL BREAKS', '#c46ad8', 15, 2.0);
      this.playSfx('curse');
      this.shake(9);
    }
    this.emit('chestOpened', { prop, cursed });
    return true;
  }

  useShrine(prop) {
    prop.used = true;
    const heal = prop.flavour === 'heal' || prop.type === 'shrineSmall';
    if (heal) {
      const healed = this.run.heal(38 + this.level.depth * 2);
      this.particles.text(prop.x, prop.y - 0.8, '+' + healed + ' vigour', '#6fce87', 15, 1.6);
      this.playSfx('shrineHeal');
    } else {
      this.run.addBlessing();
      this.particles.text(prop.x, prop.y - 0.8, 'BLESSED', '#8fb7ff', 16, 1.8);
      this.playSfx('shrineBless');
    }
    ring(this.particles, prop.x, prop.y, heal ? '#6fce87' : '#8fb7ff', 18, 1.0, 0.8);
    this.emit('shrineUsed', { prop, heal });
    return true;
  }

  spawnAmbushAround(x, y, count) {
    const pool = enemyPoolFor(this.level.depth);
    let placed = 0;
    for (let attempt = 0; attempt < count * 12 && placed < count; attempt++) {
      const a = this.rng.float(0, Math.PI * 2);
      const r = this.rng.float(1.8, 4.2);
      const sx = x + Math.cos(a) * r, sy = y + Math.sin(a) * r;
      if (tileBlocks(this, Math.floor(sx), Math.floor(sy))) continue;
      const def = this.rng.weighted(pool, (p) => p.weight).def;
      const e = new Enemy({
        defId: def.id, x: sx, y: sy, elite: this.rng.bool(0.15), dormant: false,
        zone: this.zoneAt(sx, sy), anchor: { x: sx, y: sy },
      }, this.level.depth, this.rng, this.run.mods);
      e.alert(this, 'ambush');
      this.enemies.push(e);
      burstStone(this.particles, sx, sy, '#3a3a3a');
      placed++;
    }
  }

  // --- encounters ---------------------------------------------------------
  roomDoorways(room) {
    const cells = [];
    for (let y = room.y0 - 1; y <= room.y1 + 1; y++) {
      for (let x = room.x0 - 1; x <= room.x1 + 1; x++) {
        const inside = x >= room.x0 && x <= room.x1 && y >= room.y0 && y <= room.y1;
        if (inside) continue;
        if (!isWalkableTile(this.grid.get(x, y))) continue;
        let touches = false;
        for (const [dx, dy] of N4) {
          const nx = x + dx, ny = y + dy;
          if (nx >= room.x0 && nx <= room.x1 && ny >= room.y0 && ny <= room.y1 &&
              isWalkableTile(this.grid.get(nx, ny))) { touches = true; break; }
        }
        if (touches) cells.push({ x, y });
      }
    }
    return cells;
  }

  playerInRoom(room, margin = 0) {
    const p = this.player;
    return p.x >= room.x0 - margin && p.x <= room.x1 + 1 + margin &&
           p.y >= room.y0 - margin && p.y <= room.y1 + 1 + margin;
  }

  updateEncounters(dt) {
    for (const enc of this.level.encounters) {
      if (enc.state === 'cleared') continue;
      if (enc.state === 'idle') {
        if (enc.type === 'boss') {
          if (this.boss && this.boss.awake) this.triggerEncounter(enc);
        } else if (enc.room && this.playerInRoom(enc.room)) {
          this.triggerEncounter(enc);
        }
        continue;
      }
      // Active.
      enc.activeTime = (enc.activeTime || 0) + dt;
      // Failsafe: a sealed room must never become a permanent cage. If the
      // fight somehow cannot resolve, the doors open anyway (without paying
      // out the bonus, so it is never worth waiting one out).
      if (enc.seal && enc.activeTime > 150) {
        const stranded = this.enemies.some((e) => e.encounter === enc.id && !e.dead);
        if (stranded) {
          this.releaseSeal(enc);
          enc.flawlessIntact = false;
        }
      }
      if (enc.type === 'survival') {
        enc.waveTimer -= dt;
        const alive = this.enemies.some((e) => e.encounter === enc.id && !e.dead);
        if (!alive && enc.waveIndex < enc.waves && enc.waveTimer <= 0) {
          this.spawnWave(enc);
        } else if (!alive && enc.waveIndex >= enc.waves) {
          this.clearEncounter(enc);
        }
      }
      if (enc.type === 'boss' && this.boss && this.boss.dead) this.clearEncounter(enc);
    }
    for (const g of this.level.gates) {
      if (g.open && g.openAmount < 1) g.openAmount = Math.min(1, g.openAmount + dt * 1.1);
    }
  }

  triggerEncounter(enc) {
    enc.state = 'active';
    enc.flawlessIntact = true;
    enc.activeTime = 0;
    for (const e of this.enemies) {
      if (e.encounter !== enc.id) continue;
      e.sealed = false;
      if (e.dormant) { e.dormant = false; e.state = 'chase'; }
      e.alert(this, 'encounter');
    }
    if (enc.seal && enc.room) {
      enc.sealedCells = this.roomDoorways(enc.room);
      for (const c of enc.sealedCells) this.sealBlocks.add(this.grid.idx(c.x, c.y));
      this.flow = null;
      this.playSfx('seal');
    }
    if (enc.type === 'survival') { enc.waveIndex = 0; enc.waveTimer = 0.6; }
    this.shake(4);
    this.emit('encounterStart', { encounter: enc });
  }

  spawnWave(enc) {
    enc.waveIndex++;
    enc.waveTimer = 2.4;
    const pool = enemyPoolFor(this.level.depth);
    const room = enc.room;
    let placed = 0;
    for (let attempt = 0; attempt < enc.waveSize * 14 && placed < enc.waveSize; attempt++) {
      const x = this.rng.int(room.x0, room.x1) + 0.5;
      const y = this.rng.int(room.y0, room.y1) + 0.5;
      if (tileBlocks(this, Math.floor(x), Math.floor(y))) continue;
      if (Math.hypot(x - this.player.x, y - this.player.y) < 2.4) continue;
      const def = this.rng.weighted(pool, (p) => p.weight).def;
      const e = new Enemy({
        defId: def.id, x, y, elite: this.rng.bool(0.1 + enc.waveIndex * 0.06),
        dormant: false, zone: room.zone, encounter: enc.id, anchor: { x, y },
      }, this.level.depth, this.rng, this.run.mods);
      e.alert(this, 'wave');
      this.enemies.push(e);
      burstStone(this.particles, x, y, '#3a3a3a');
      placed++;
    }
    this.playSfx('wave');
    this.emit('wave', { encounter: enc, index: enc.waveIndex, total: enc.waves });
  }

  checkEncounterProgress() {
    for (const enc of this.level.encounters) {
      if (enc.state !== 'active' || enc.type === 'survival' || enc.type === 'boss') continue;
      const alive = this.enemies.some((e) => e.encounter === enc.id && !e.dead);
      if (!alive) this.clearEncounter(enc);
    }
  }

  releaseSeal(enc) {
    if (!enc.sealedCells) return;
    for (const c of enc.sealedCells) this.sealBlocks.delete(this.grid.idx(c.x, c.y));
    enc.sealedCells = null;
    this.flow = null;
    this.playSfx('gateUnlock');
  }

  clearEncounter(enc) {
    if (enc.state === 'cleared') return;
    enc.state = 'cleared';
    this.releaseSeal(enc);
    const mods = this.run.mods;
    let text = 'CLEARED';
    if (enc.scoreBonus) {
      const pts = this.run.score.addBonus(enc.scoreBonus, mods);
      text += '  +' + Math.round(pts);
    }
    if (enc.flawless && enc.flawlessIntact) {
      const pts = this.run.score.addFlawless(300 + this.level.depth * 40, mods);
      this.particles.text(this.player.x, this.player.y - 1.6,
        'FLAWLESS  +' + Math.round(pts), '#8fd7ff', 16, 2.0);
      this.playSfx('flawless');
    }
    const cx = enc.room ? (enc.room.x0 + enc.room.x1) / 2 + 0.5 : this.player.x;
    const cy = enc.room ? (enc.room.y0 + enc.room.y1) / 2 + 0.5 : this.player.y;
    this.particles.text(cx, cy, text, '#e8b45c', 16, 1.8);
    this.playSfx('encounterClear');

    // A hidden chamber sometimes opens once the room falls quiet.
    if (enc.revealSecret !== undefined) {
      const secret = this.level.secrets[enc.revealSecret];
      if (secret && !secret.discovered) {
        secret.discovered = true;
        burstStone(this.particles, secret.x + 0.5, secret.y + 0.5);
        this.shake(6);
        this.particles.text(secret.x + 0.5, secret.y + 0.5, 'THE WALL CRACKS', '#e8b45c', 14, 2.2);
        this.playSfx('reveal');
      }
    }
    this.emit('encounterClear', { encounter: enc });
  }

  // --- boss hooks ---------------------------------------------------------
  onBossAwake(boss) {
    this.playSfx('bossRoar');
    this.shake(10);
    this.emit('bossAwake', { boss });
  }
  onBossPhase(boss) {
    this.playSfx('bossRoar');
    this.shake(14);
    ring(this.particles, boss.x, boss.y, boss.def.palette.trim, 30, 2.2, 0.9);
    this.emit('bossPhase', { boss, phase: boss.phase });
  }
  onBossTelegraph(boss, attack) { this.playSfx('bossTelegraph'); }
  onBossAttack(boss, attack) { this.playSfx('bossCharge'); }

  bossSlam(boss, radius) {
    this.shake(15);
    this.playSfx('bossSlam');
    ring(this.particles, boss.x, boss.y, boss.def.palette.trim, 34, radius * 0.9, 0.7);
    burstStone(this.particles, boss.x, boss.y);
    const d = Math.hypot(this.player.x - boss.x, this.player.y - boss.y);
    if (d <= radius) {
      this.damagePlayer(boss.damage, boss);
      this.knock(this.player, this.player.x - boss.x, this.player.y - boss.y, 0.5);
    }
  }

  bossShards(boss, count) {
    this.playSfx('bossShards');
    const base = Math.atan2(this.player.y - boss.y, this.player.x - boss.x);
    for (let i = 0; i < count; i++) {
      const a = base + (i - count / 2) * (Math.PI * 2 / count) * (boss.phase >= 2 ? 1 : 0.55);
      const speed = 6.4;
      this.projectiles.push({
        x: boss.x + Math.cos(a) * 0.6, y: boss.y + Math.sin(a) * 0.6,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        range: 11, travelled: 0, damage: boss.damage * 0.55,
        friendly: false, owner: boss, kind: 'shard',
        colour: boss.def.palette.trim, dead: false,
      });
    }
  }

  bossSummon(boss, count) {
    this.playSfx('bossSummon');
    this.spawnAmbushAround(boss.x, boss.y, count);
  }

  bossLash(boss, range) {
    this.playSfx('bossLash');
    const p = this.player;
    const dx = p.x - boss.x, dy = p.y - boss.y;
    const d = Math.hypot(dx, dy);
    const dot = d > 0 ? (dx / d) * boss.faceX + (dy / d) * boss.faceY : 1;
    for (let i = 0; i < 14; i++) {
      const t = i / 14;
      this.particles.spawn({
        x: boss.x + boss.faceX * range * t, y: boss.y + boss.faceY * range * t,
        z: 0.3, life: 0.35, size: 3, colour: boss.def.palette.trim, glow: 1, drag: 4,
      });
    }
    if (d <= range && dot > 0.72) {
      this.damagePlayer(boss.damage * 0.85, boss);
      this.player.slowTimer = 1.8;
    }
  }

  onBossKilled(boss) {
    const blood = boss.def.blood || DEFAULT_BLOOD;
    this.gore.pool(boss.x, boss.y, blood, 2.4);
    this.gore.corpse({
      defId: boss.def.id, x: boss.x, y: boss.y,
      faceX: boss.faceX, faceY: boss.faceY,
      elite: true, scale: 2.2, seed: 0.5, palette: boss.def.palette, blood, boss: true,
    });
    const pts = this.run.score.addBoss(boss.def.score || 3000, this.run.mods);
    this.particles.text(boss.x, boss.y - 1, '+' + Math.round(pts), '#e8b45c', 22, 2.4);
    // Killing a great foe mends you. Without this a boss is followed by a
    // much larger depth entered on the health the fight left behind, which
    // reads as the run ending by arithmetic rather than by mistake.
    const mended = this.run.heal(this.run.maxHp * 0.4, true);
    if (mended > 0) {
      this.particles.text(this.player.x, this.player.y - 1.2,
        '+' + mended + ' VIGOUR', '#6fce87', 17, 2.2);
    }
    for (let i = 0; i < 5; i++) {
      this.later(() => {
        ring(this.particles, boss.x + (Math.random() - 0.5) * 2, boss.y + (Math.random() - 0.5) * 2,
          boss.def.palette.trim, 20, 1.4, 0.8);
      }, i * 140);
    }
    this.shake(18);
    this.playSfx('bossDeath');
    this.run.bossesDefeated++;
    this.run.discoverBoss(boss.def.id);
    this.emit('bossKilled', { boss });
  }

  // --- level completion ---------------------------------------------------
  summary() {
    return this.run.score.finishLevel({
      depth: this.level.depth,
      elapsed: this.elapsed,
      parTime: this.level.parTime,
      hp: this.run.hp,
      maxHp: this.run.maxHp,
      mods: this.run.mods,
    });
  }

  dispose() {
    this.disposed = true;
    for (const id of this._timers) clearTimeout(id);
    this._timers.length = 0;
    this.listeners.clear();
    this.particles.clear();
    this.enemies.length = 0;
    this.projectiles.length = 0;
    this.gore.clear();
  }
}
