// The player character: movement (including ice and mud), the sword, the
// crossbow, and the shield relic's damage resolution.

import { inCone } from './physics.js';
import { GridMover } from './gridmove.js';
import { clamp, damp } from '../core/util.js';

const BASE_SPEED = 3.7;
const BASE_SWORD_DAMAGE = 18;
const SWORD_RANGE = 1.45;
const SWORD_HALF_ANGLE_COS = Math.cos(1.05); // ~120 degree arc

export class Player {
  constructor(run) {
    this.run = run;
    this.x = 0; this.y = 0;
    this.radius = 0.3;
    this.mover = new GridMover(this);
    this.knockX = 0; this.knockY = 0;
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
    this.tileX = 0;
    this.tileY = 0;
  }

  placeAt(x, y) {
    this.mover.placeAt(x, y);
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
    this.knockX *= Math.exp(-9 * dt);
    this.knockY *= Math.exp(-9 * dt);

    if (this.burnTimer > 0) {
      this.burnTimer -= dt;
      this.run.damageOverTime(dt * 5);
    }

    this._move(dt, world, intent, mods, hz);
    this._weapons(dt, world, intent, mods, hz);
  }

  _move(dt, world, intent, mods, hz) {
    const ice = !mods.hazardFooting && !!hz.slide;
    const mud = mods.hazardFooting ? 1 : (hz.playerSpeed || 1);
    const attacking = this.attack ? 0.55 : 1;
    const chilled = this.slowTimer > 0 ? 0.7 : 1;
    const speed = BASE_SPEED * mods.moveSpeed * mud * attacking * chilled;

    const hasInput = intent.moveX !== 0 || intent.moveY !== 0;
    this.mover.update(dt, world, hasInput ? { x: intent.moveX, y: intent.moveY } : null, {
      speed,
      ice,
      strict: world.strictMovement,
      // Pressing into a wall beside a doorway steps you into the doorway.
      // Strict movement means exactly what was pressed, so it opts out.
      doorAssist: !world.strictMovement,
      onEnterTile: (x, y) => world.onPlayerEnterTile(x, y),
    });

    this.speedNow = this.mover.speedNow;
    this.moving = this.mover.moving;
    this.tileX = this.mover.tileX;
    this.tileY = this.mover.tileY;

    // Face where you are travelling; if a wall stops you, face the wall you
    // are pushing against, so a cracked wall can be squared up to and struck.
    // A swing in progress locks the facing, so the arc lands where it was
    // aimed rather than sweeping round with the feet.
    const heading = this.mover.moving ? this.mover.heading : null;
    const target = this.attack ? null : (heading || (hasInput ? { x: intent.moveX, y: intent.moveY } : null));
    if (target) {
      const m = Math.hypot(target.x, target.y) || 1;
      this.faceX = damp(this.faceX, target.x / m, 20, dt);
      this.faceY = damp(this.faceY, target.y / m, 20, dt);
      const fm = Math.hypot(this.faceX, this.faceY) || 1;
      this.faceX /= fm; this.faceY /= fm;
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
