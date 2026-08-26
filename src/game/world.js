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
import { ENEMIES, enemyPoolFor } from './enemyData.js';
import { moveEntity, hasLineOfSight, tileBlocks } from './physics.js';
import { clamp } from '../core/util.js';
import { RNG } from '../core/rng.js';

const FLOW_INTERVAL = 0.14;
const FLOW_RADIUS = 30;

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
    this.lowHealthPulse = 0;
    this.secretsFound = 0;
    // When true, a direction key moves exactly that way on screen or not at
    // all -- no deflecting into a corridor that is merely nearby.
    this.strictMovement = false;
    this.listeners = new Set();
    this.damageTakenThisLevel = 0;
    this.shakeRequest = 0;

    this._spawnEntities();
    this._applyRelicReveals();
    this.updateHazard();
    this.refreshVisibility(0);
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, data) { for (const fn of this.listeners) fn(type, data || {}); }
  shake(amount) { this.shakeRequest = Math.max(this.shakeRequest, amount); }
  playSfx(name, opts) { this.emit('sfx', { name, ...opts }); }

  _spawnEntities() {
    for (const spawn of this.level.spawns) {
      if (spawn.isBoss) {
        this.boss = new Boss(this.level.boss, spawn, this.level.depth, this.rng);
        continue;
      }
      if (!ENEMIES[spawn.defId]) continue;
      const e = new Enemy(spawn, this.level.depth, this.rng);
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

    this.updateHazard();
    this.torch.update(dt, this.hazardMods);
    this.player.torchFlicker = this.torch.flicker;

    this._refreshOccupancy();
    this.player.update(dt, this, intent);
    this.updateFlow(dt);
    this.refreshVisibility(dt);

    for (const e of this.enemies) e.update(dt, this);
    if (this.boss) this.boss.update(dt, this);
    this.updateProjectiles(dt);
    this.particles.update(dt);
    this.updateEncounters(dt);
    this.updatePickups();
    this.updateSecretAwareness();
    this.updateInteractTarget();
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
    const hz = this.hazardMods;
    const colour = hz.footstepSplash ? '#8fb4c4' : hz.footprints ? '#4a3722' : '#6f6a5e';
    footDust(this.particles, x + 0.5, y + 0.5, colour);
    this.playSfx(hz.footstepSplash ? 'stepWet' : hz.playerSpeed ? 'stepMud' : 'step');
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
    this.torchRadius = this.torch.effectiveRadius(this.hazardMods);
    this.revealRadius = this.hazardMods.revealMovers || 0;
  }

  refreshVisibility(dt) {
    const sources = [{
      x: this.player.x, y: this.player.y,
      radius: this.torchRadius, intensity: 1,
    }];
    // Wall sconces contribute genuine light, but only nearby ones.
    for (const s of this.level.sconces) {
      if (Math.abs(s.x - this.player.x) + Math.abs(s.y - this.player.y) > 14) continue;
      sources.push({ x: s.x, y: s.y, radius: 3.6, intensity: 0.6 });
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
            this.playSfx('arrowHit');
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
    this.playSfx(p.friendly ? 'arrowWall' : 'shotWall');
  }

  // --- player combat ------------------------------------------------------
  onSwing(player) {
    this.playSfx('swing');
  }

  resolveSlash(player) {
    const damage = player.swordDamage();
    let hitSomething = false;

    for (const e of this.enemies) {
      if (e.dead || e.sealed) continue;
      if (!player.hitsWithSword(e.x, e.y, e.radius)) continue;
      hitSomething = true;
      e.takeDamage(damage, this, 'sword');
      const dx = e.x - player.x, dy = e.y - player.y;
      const m = Math.hypot(dx, dy) || 1;
      this.knock(e, dx, dy, 0.3);
      burstBlood(this.particles, e.x, e.y, dx / m, dy / m);
      this.particles.text(e.x, e.y, Math.round(damage), '#ffe0b0', 13);
    }

    if (this.boss && !this.boss.dead && player.hitsWithSword(this.boss.x, this.boss.y, this.boss.radius)) {
      hitSomething = true;
      this.boss.takeDamage(damage, this, 'sword');
      burstBlood(this.particles, this.boss.x, this.boss.y - 0.2, player.faceX, player.faceY, '#7a2440');
      this.particles.text(this.boss.x, this.boss.y, Math.round(damage), '#ffe0b0', 14);
    }

    // Cracked walls break to the same swing -- no separate verb to learn.
    if (this.actionableSecret) {
      this.breakSecret(this.actionableSecret);
      hitSomething = true;
    }

    if (hitSomething) {
      this.playSfx('hit');
      this.shake(4.5);
      this.emit('hitstop', { seconds: 0.055 });
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
    burstBlood(this.particles, projectile.x, projectile.y, projectile.vx, projectile.vy);
    this.particles.text(enemy.x, enemy.y, Math.round(damage), '#ffe0b0', 13);
    this.playSfx('arrowHit');
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
    this.playSfx('enemyShot');
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
    this.shake(6 + dealt * 0.2);
    this.playSfx('playerHurt');
    this.emit('health', { hp: this.run.hp, maxHp: this.run.maxHp });

    // Any encounter in progress loses its flawless status.
    for (const enc of this.level.encounters) {
      if (enc.state === 'active') enc.flawlessIntact = false;
    }
    if (source && source.def && source.def.chills) this.player.slowTimer = 2.4;
    if (source && source.def && source.def.burns) this.player.burnTimer = 2.2;

    if (this.run.hp <= 0) {
      this.playerDead = true;
      this.playSfx('death');
      this.emit('playerDied', {});
    }
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
    this.playSfx(enemy.elite ? 'eliteDeath' : 'enemyDeath');
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

  onEnemyAlerted(enemy) { this.playSfx('alert'); this.emit('alert', { enemy }); }
  onEnemyWindup(enemy) { this.playSfx('windup'); }
  onEnemyMiss(enemy) { this.playSfx('swingMiss'); }
  onAmbushWake(enemy) {
    burstStone(this.particles, enemy.x, enemy.y, '#4a5540');
    this.playSfx('ambush');
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
      default: return false;
    }
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
      }, this.level.depth, this.rng);
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
      }, this.level.depth, this.rng);
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
      setTimeout(() => {
        if (!this.particles) return;
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
    this.listeners.clear();
    this.particles.clear();
    this.enemies.length = 0;
    this.projectiles.length = 0;
  }
}
