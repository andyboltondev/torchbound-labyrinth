// Boss encounters. Multi-phase, heavily telegraphed, and built around a small
// set of readable attacks that recombine as phases advance.

import { moveEntity, hasLineOfSight } from './physics.js';
import { damp, clamp } from '../core/util.js';
import { burstStone, ring, burstSparks } from '../render/particles.js';

const PHASE_THRESHOLDS = [0.66, 0.33];

export class Boss {
  constructor(def, spawn, depth, rng, mods = null) {
    this.def = def;
    this.x = spawn.x;
    this.y = spawn.y;
    this.home = { x: spawn.x, y: spawn.y };
    this.radius = def.radius;
    this.scale = 2.0 + def.radius * 0.5;
    this.maxHp = Math.max(1, Math.round((def.scaledHp || def.hp) * ((mods && mods.enemyHp) || 1)));
    this.hp = this.maxHp;
    this.damage = (def.scaledDamage || def.damage) * ((mods && mods.enemyDamage) || 1);
    this.speed = def.speed;
    this.depth = depth;
    this.rng = rng;
    this.phase = 0;
    this.faceX = 0; this.faceY = 1;
    this.vx = 0; this.vy = 0;
    this.speedNow = 0;
    this.animTime = 0;
    this.hurtFlash = 0;
    this.dead = false;
    this.state = 'wait';
    this.timer = 0;
    this.telegraph = 0;
    this.telegraphRadius = 0;
    this.windup = 0;
    this.attack = null;
    this.stun = 0;
    this.awake = false;
    this.contactCooldown = 0;
  }

  get phaseCount() { return this.def.phases || 2; }

  availableAttacks() {
    const all = this.def.attacks || ['charge', 'slam'];
    // Phase 0 uses the first two; later phases unlock the rest.
    if (this.phase === 0) return all.slice(0, 2);
    if (this.phase === 1) return all.slice(0, Math.min(all.length, 3));
    return all;
  }

  takeDamage(amount, world, source) {
    if (this.dead) return;
    this.hp -= amount;
    this.hurtFlash = 1;
    this.awake = true;
    const frac = this.hp / this.maxHp;
    while (this.phase < PHASE_THRESHOLDS.length && frac <= PHASE_THRESHOLDS[this.phase]) {
      this.phase++;
      this.onPhaseChange(world);
    }
    if (this.hp <= 0) {
      this.dead = true;
      world.onBossKilled(this);
    }
  }

  onPhaseChange(world) {
    this.speed *= 1.12;
    this.state = 'roar';
    this.timer = 1.1;
    this.telegraph = 1;
    this.telegraphRadius = 3.4;
    world.onBossPhase(this);
  }

  update(dt, world) {
    if (this.dead) return;
    const p = world.player;
    this.animTime += dt;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 4);
    this.contactCooldown = Math.max(0, this.contactCooldown - dt);
    this.telegraph = Math.max(0, this.telegraph - dt * 1.4);
    const dist = Math.hypot(p.x - this.x, p.y - this.y);

    if (!this.awake) {
      if (dist < 9) { this.awake = true; world.onBossAwake(this); }
      else return;
    }
    if (this.stun > 0) {
      this.stun -= dt;
      this.speedNow = 0;
      return;
    }

    switch (this.state) {
      case 'wait': this._approach(dt, world, dist); break;
      case 'roar':
        this.timer -= dt;
        this.speedNow = 0;
        if (this.timer <= 0) this.state = 'wait';
        break;
      case 'telegraph': this._telegraph(dt, world, dist); break;
      case 'execute': this._execute(dt, world, dist); break;
      case 'recover':
        this.timer -= dt;
        this.speedNow = 0;
        this._face(p.x - this.x, p.y - this.y, dt, 3);
        if (this.timer <= 0) this.state = 'wait';
        break;
      default: this.state = 'wait';
    }
  }

  _face(dx, dy, dt, rate = 6) {
    const m = Math.hypot(dx, dy);
    if (m < 0.001) return;
    this.faceX = damp(this.faceX, dx / m, rate, dt);
    this.faceY = damp(this.faceY, dy / m, rate, dt);
    const fm = Math.hypot(this.faceX, this.faceY) || 1;
    this.faceX /= fm; this.faceY /= fm;
  }

  _step(world, dt, dx, dy, speed) {
    const m = Math.hypot(dx, dy);
    if (m < 0.0001) { this.speedNow = 0; return; }
    const before = { x: this.x, y: this.y };
    const hit = moveEntity(world, this, (dx / m) * speed * dt, (dy / m) * speed * dt);
    this.speedNow = Math.hypot(this.x - before.x, this.y - before.y) / Math.max(dt, 0.0001);
    this._face(dx, dy, dt);
    return hit;
  }

  _approach(dt, world, dist) {
    const p = world.player;
    this.timer -= dt;
    if (this.timer <= 0) {
      // Pick something appropriate to the range.
      const options = this.availableAttacks().filter((a) => {
        if (a === 'charge') return dist > 3.5;
        if (a === 'slam' || a === 'lash') return dist < 6.5;
        return true;
      });
      const choice = options.length ? this.rng.pick(options) : 'slam';
      this.attack = choice;
      this.state = 'telegraph';
      this.windup = this._windupFor(choice);
      this.timer = this.windup;
      this.telegraph = 1;
      this.telegraphRadius = choice === 'slam' ? 3.2 : choice === 'shards' ? 4 : 1.6;
      world.onBossTelegraph(this, choice);
      return;
    }
    if (dist > 2.2) this._step(world, dt, p.x - this.x, p.y - this.y, this.speed * 0.85);
    else { this.speedNow = 0; this._face(p.x - this.x, p.y - this.y, dt, 5); }
  }

  _windupFor(attack) {
    const base = { charge: 0.95, slam: 0.85, shards: 0.8, summon: 1.1, lash: 0.7 }[attack] || 0.9;
    // Phase 3 stops being polite about it.
    return base * (this.phase >= 2 ? 0.62 : this.phase === 1 ? 0.82 : 1);
  }

  _telegraph(dt, world, dist) {
    this.timer -= dt;
    this.telegraph = clamp(1 - this.timer / Math.max(0.01, this.windup), 0, 1);
    this.speedNow = 0;
    if (this.attack === 'charge' || this.attack === 'lash') {
      this._face(world.player.x - this.x, world.player.y - this.y, dt, 4);
    }
    if (this.timer <= 0) {
      this.state = 'execute';
      this.timer = this._executeDuration();
      this._beginExecute(world);
    }
  }

  _executeDuration() {
    return { charge: 0.85, slam: 0.28, shards: 0.4, summon: 0.6, lash: 0.45 }[this.attack] || 0.4;
  }

  _beginExecute(world) {
    const p = world.player;
    switch (this.attack) {
      case 'charge':
        this.chargeDir = { x: p.x - this.x, y: p.y - this.y };
        world.onBossAttack(this, 'charge');
        break;
      case 'slam':
        world.bossSlam(this, 3.2 + this.phase * 0.4);
        break;
      case 'shards':
        world.bossShards(this, 8 + this.phase * 3);
        break;
      case 'summon':
        world.bossSummon(this, 2 + this.phase);
        break;
      case 'lash':
        world.bossLash(this, 5.5);
        break;
      default: break;
    }
  }

  _execute(dt, world, dist) {
    this.timer -= dt;
    if (this.attack === 'charge') {
      const hit = this._step(world, dt, this.chargeDir.x, this.chargeDir.y, this.speed * 3.1);
      if (dist < this.radius + world.player.radius + 0.5 && this.contactCooldown <= 0) {
        this.contactCooldown = 0.8;
        world.damagePlayer(this.damage, this);
      }
      if (hit && (hit.hitX || hit.hitY)) {
        // Slamming into the wall is the player's window.
        this.stun = 1.5;
        this.state = 'recover';
        this.timer = 0.3;
        burstStone(world.particles, this.x, this.y);
        world.shake(12);
        world.playSfx('stoneBreak');
        return;
      }
    }
    if (this.timer <= 0) {
      this.state = 'recover';
      this.timer = this.phase >= 2 ? 0.5 : 0.95;
    }
  }
}
