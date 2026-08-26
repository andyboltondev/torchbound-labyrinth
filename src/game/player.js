// The player character: movement (including ice and mud), the sword, the
// crossbow, and the shield relic's damage resolution.

import { moveEntity, inCone } from './physics.js';
import { clamp, damp } from '../core/util.js';

const BASE_SPEED = 3.7;
const BASE_SWORD_DAMAGE = 18;
const SWORD_RANGE = 1.45;
const SWORD_HALF_ANGLE_COS = Math.cos(1.05); // ~120 degree arc

export class Player {
  constructor(run) {
    this.run = run;
    this.x = 0; this.y = 0;
    this.vx = 0; this.vy = 0;
    this.radius = 0.3;
    this.faceX = 1; this.faceY = 0;
    this.moving = false;
    this.speedNow = 0;
    this.animTime = 0;
    this.attack = null;
    this.attackCooldown = 0;
    this.fireCooldown = 0;
    this.invulnTimer = 0;
    this.hurtFlash = 0;
    this.damageFlash = 0;
    this.shieldPulse = 0;
    this.slowTimer = 0;
    this.burnTimer = 0;
    this.torchFlicker = 1;
    this.hasCrossbow = false;
    this.hasShieldRelic = false;
    this.footTimer = 0;
  }

  placeAt(x, y) {
    this.x = x + 0.5; this.y = y + 0.5;
    this.vx = 0; this.vy = 0;
    this.attack = null;
    this.attackCooldown = 0;
    this.fireCooldown = 0;
    this.invulnTimer = 0.6;
  }

  get hp() { return this.run.hp; }
  get maxHp() { return this.run.maxHp; }

  update(dt, world, intent) {
    const mods = this.run.mods;
    const hz = world.hazardMods;
    this.animTime += dt;
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.invulnTimer = Math.max(0, this.invulnTimer - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 4);
    this.damageFlash = Math.max(0, this.damageFlash - dt * 2.4);
    this.shieldPulse = Math.max(0, this.shieldPulse - dt * 2.2);
    this.slowTimer = Math.max(0, this.slowTimer - dt);
    this.hasCrossbow = this.run.hasCrossbow;
    this.hasShieldRelic = !!mods.shield;

    if (this.burnTimer > 0) {
      this.burnTimer -= dt;
      this.run.damageOverTime(dt * 5);
    }

    this._move(dt, world, intent, mods, hz);
    this._weapons(dt, world, intent, mods, hz);
  }

  _move(dt, world, intent, mods, hz) {
    const ice = !mods.hazardFooting && hz.slide;
    const mudMul = mods.hazardFooting ? 1 : (hz.playerSpeed || 1);
    const attackPenalty = this.attack ? 0.4 : 1;
    const slowPenalty = this.slowTimer > 0 ? 0.65 : 1;
    const speed = BASE_SPEED * mods.moveSpeed * mudMul * attackPenalty * slowPenalty;

    const wantX = intent.moveX * speed;
    const wantY = intent.moveY * speed;

    if (ice) {
      // Momentum carries. Steering is weak, and letting go of the stick does
      // NOT stop you -- only a little drag bleeds the slide off, which is the
      // whole point of the hazard.
      const steering = intent.moveX !== 0 || intent.moveY !== 0;
      if (steering) {
        const accel = 4.4 * dt;
        this.vx += (wantX - this.vx) * accel;
        this.vy += (wantY - this.vy) * accel;
      }
      const drag = Math.exp(-(steering ? 0.12 : 0.45) * dt);
      this.vx *= drag;
      this.vy *= drag;
    } else {
      const responsiveness = 1 - Math.exp(-26 * dt);
      this.vx += (wantX - this.vx) * responsiveness;
      this.vy += (wantY - this.vy) * responsiveness;
    }

    const hit = moveEntity(world, this, this.vx * dt, this.vy * dt);
    if (hit.hitX) this.vx *= ice ? -0.15 : 0;
    if (hit.hitY) this.vy *= ice ? -0.15 : 0;

    this.speedNow = Math.hypot(this.vx, this.vy);
    this.moving = this.speedNow > 0.35;
    if (intent.moveX !== 0 || intent.moveY !== 0) {
      const m = Math.hypot(intent.moveX, intent.moveY);
      this.faceX = damp(this.faceX, intent.moveX / m, 22, dt);
      this.faceY = damp(this.faceY, intent.moveY / m, 22, dt);
      const fm = Math.hypot(this.faceX, this.faceY) || 1;
      this.faceX /= fm; this.faceY /= fm;
    }

    // Footsteps: audio and a puff of whatever is underfoot.
    if (this.moving) {
      this.footTimer -= dt * this.speedNow;
      if (this.footTimer <= 0) {
        this.footTimer = 1.15;
        world.onFootstep(this);
      }
    }
  }

  _weapons(dt, world, intent, mods, hz) {
    if (this.attack) {
      this.attack.t += dt;
      if (!this.attack.resolved && this.attack.t >= this.attack.hitAt) {
        this.attack.resolved = true;
        if (this.attack.type === 'slash') world.resolveSlash(this);
        else world.fireBolt(this);
      }
      if (this.attack.t >= this.attack.duration) this.attack = null;
    }

    const attackSpeed = mods.attackSpeed * (hz.attackSpeed || 1);
    if (intent.slash && !this.attack && this.attackCooldown <= 0) {
      const duration = 0.42 / attackSpeed;
      this.attack = { type: 'slash', t: 0, duration, hitAt: duration * 0.34, resolved: false };
      this.attackCooldown = 0.5 / attackSpeed;
      world.onSwing(this);
    } else if (intent.fire && !this.attack && this.fireCooldown <= 0 &&
               this.run.hasCrossbow && this.run.arrows > 0) {
      const duration = 0.3;
      this.attack = { type: 'fire', t: 0, duration, hitAt: 0.1, resolved: false };
      this.fireCooldown = 0.7;
      this.attackCooldown = 0.24;
    }
  }

  swordDamage() {
    const mods = this.run.mods;
    let dmg = BASE_SWORD_DAMAGE * mods.swordDamage * (1 + this.run.depth * 0.06);
    if (mods.desperation && this.run.hp / this.run.maxHp < 0.34) dmg *= 1 + mods.desperation;
    return dmg;
  }

  swordReach() { return SWORD_RANGE * this.run.mods.swordRange; }

  hitsWithSword(x, y, extraRadius = 0) {
    return inCone(this.x, this.y, this.faceX, this.faceY, x, y,
      this.swordReach() + extraRadius, SWORD_HALF_ANGLE_COS);
  }

  // Shield resolution. The three outcomes are mutually exclusive by
  // construction: one roll, cumulative thresholds (design section 25).
  resolveIncoming(amount, rng) {
    const mods = this.run.mods;
    const result = { damage: amount * mods.damageTaken, outcome: 'hit' };
    if (mods.shield) {
      const roll = rng.next();
      if (roll < 0.01) { result.outcome = 'reflect'; result.damage = 0; }
      else if (roll < 0.06) { result.outcome = 'block'; result.damage = 0; }
      else if (roll < 0.26) { result.outcome = 'reduced'; result.damage *= 0.5; }
    }
    return result;
  }

  onDamaged(amount) {
    this.invulnTimer = 0.62;
    this.hurtFlash = 1;
    this.damageFlash = Math.min(1, 0.4 + amount / 40);
  }
}
