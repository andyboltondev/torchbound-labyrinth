// Enemy runtime and AI.
//
// Each archetype from section 28 gets genuinely different logic rather than a
// shared "walk at the player" loop. Awareness is driven by the player's own
// torchlight, which is what turns a bigger flame into a real trade-off.

import { BEHAVIOUR, ENEMIES, ELITE_MOD } from './enemyData.js';
import { hasLineOfSight } from './physics.js';
import { GridMover } from './gridmove.js';
import { clamp, damp } from '../core/util.js';

const STATE = {
  DORMANT: 'dormant', IDLE: 'idle', ALERT: 'alert', CHASE: 'chase',
  STRIKE: 'strike', RETREAT: 'retreat', RETURN: 'return',
};

let nextId = 1;

export class Enemy {
  constructor(spawn, depth, rng) {
    this.id = nextId++;
    this.def = ENEMIES[spawn.defId];
    this.elite = !!spawn.elite;
    this.x = spawn.x;
    this.y = spawn.y;
    this.anchor = spawn.anchor || { x: spawn.x, y: spawn.y };
    this.encounter = spawn.encounter || null;
    this.guard = !!spawn.guard;
    this.carriesKey = spawn.carriesKey !== undefined ? spawn.carriesKey : null;
    this.zone = spawn.zone || 0;
    this.seed = rng ? rng.next() : Math.random();

    const scaleHp = 1 + Math.max(0, depth - this.def.minDepth) * 0.09;
    this.maxHp = Math.round(this.def.hp * scaleHp * (this.elite ? ELITE_MOD.hp : 1));
    this.hp = this.maxHp;
    this.damage = this.def.damage * (1 + depth * 0.045) * (this.elite ? ELITE_MOD.damage : 1);
    this.radius = this.def.radius * (this.elite ? ELITE_MOD.radius : 1);
    this.scale = (this.elite ? 1.2 : 1) * (0.94 + this.def.height * 0.12);
    this.scoreValue = this.def.score * (this.elite ? ELITE_MOD.score : 1);

    this.state = spawn.dormant ? STATE.DORMANT : STATE.IDLE;
    this.dormant = !!spawn.dormant;
    this.sealed = false;      // held in place until its encounter triggers
    this.faceX = 1; this.faceY = 0;
    this.speedNow = 0;
    this.mover = new GridMover(this);
    this.mover.placeAt(Math.floor(spawn.x), Math.floor(spawn.y));
    this.anchorTile = { x: this.mover.tileX, y: this.mover.tileY };
    this.knockX = 0; this.knockY = 0;
    this._desire = null;
    this._desiredSpeed = 2.5;
    this.animTime = rng ? rng.float(0, 5) : 0;
    this.windup = 0;
    this.cooldown = rng ? rng.float(0, 0.6) : 0;
    this.alertPulse = 0;
    this.lostTimer = 0;
    this.hurtFlash = 0;
    this.strafe = rng && rng.bool() ? 1 : -1;
    this.wanderTimer = 0;
    this.wanderX = 0; this.wanderY = 0;
    this.dead = false;
    this.lastKnown = null;
    this.dashTimer = 0;
  }

  get behaviour() { return this.def.behaviour; }

  // --- perception ---------------------------------------------------------
  detectionRange(world) {
    const mods = world.run.mods;
    const hz = world.hazardMods;
    const gx = Math.floor(this.x), gy = Math.floor(this.y);
    const lit = world.vis.lightAt(gx, gy);
    let range = this.def.detect * (mods.enemyAggro || 1) * (hz.enemyAggro || 1);
    if (this.def.prefersDark) {
      // Creatures of the dark see best when the torch is not in their eyes.
      range *= 1.35 - clamp(lit, 0, 1) * 0.45;
    } else {
      // Everything else is drawn to the light.
      range *= 1 + (this.def.torchSensitivity - 1) * clamp(lit * 1.15, 0, 1);
    }
    return range;
  }

  canSeePlayer(world) {
    const p = world.player;
    const d = Math.hypot(p.x - this.x, p.y - this.y);
    if (d > this.detectionRange(world)) {
      // Footsteps still give the player away at knife range.
      if (d > 2.2 || !hasLineOfSight(world, this.x, this.y, p.x, p.y)) return false;
      return true;
    }
    return hasLineOfSight(world, this.x, this.y, p.x, p.y);
  }

  alert(world, reason = 'sight') {
    if (this.state === STATE.DORMANT) {
      this.dormant = false;
      world.onAmbushWake(this);
    }
    if (this.state === STATE.IDLE || this.state === STATE.RETURN || this.state === STATE.DORMANT) {
      this.alertPulse = 1.2;
      world.onEnemyAlerted(this, reason);
    }
    this.state = STATE.CHASE;
    this.lostTimer = this.behaviour === BEHAVIOUR.PURSUER ? 9 : 4.5;
    this.lastKnown = { x: world.player.x, y: world.player.y };
  }

  takeDamage(amount, world, source) {
    if (this.dead) return;
    this.hp -= amount;
    this.hurtFlash = 1;
    if (this.state === STATE.DORMANT || this.state === STATE.IDLE) this.alert(world, 'hit');
    if (this.hp <= 0) {
      this.dead = true;
      world.onEnemyKilled(this, source);
    }
  }

  // --- update -------------------------------------------------------------
  update(dt, world) {
    if (this.dead) return;
    const hz = world.hazardMods;
    const mods = world.run.mods;
    this.animTime += dt;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 4);
    this.alertPulse = Math.max(0, this.alertPulse - dt * 1.4);
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.dashTimer = Math.max(0, this.dashTimer - dt);
    this._desire = null;

    const speedMul = (mods.enemySpeed || 1) * (hz.enemySpeed || 1) * (this.elite ? ELITE_MOD.speed : 1);
    const rateMul = (hz.enemyAttackRate || 1);
    const p = world.player;
    const dist = Math.hypot(p.x - this.x, p.y - this.y);

    if (this.state === STATE.DORMANT) {
      if (!this.sealed && dist < 2.6 && hasLineOfSight(world, this.x, this.y, p.x, p.y)) {
        this.alert(world, 'ambush');
      }
    } else if (this.sealed) {
      // Held in place until the encounter it belongs to is triggered.
    } else {
      const sees = this.canSeePlayer(world);
      if (sees) {
        if (this.state === STATE.IDLE || this.state === STATE.RETURN) this.alert(world);
        this.lastKnown = { x: p.x, y: p.y };
        this.lostTimer = this.behaviour === BEHAVIOUR.PURSUER ? 9 : 4.5;
      } else if (this.state !== STATE.IDLE) {
        this.lostTimer -= dt;
        if (this.lostTimer <= 0) {
          this.state = this.guard || this.behaviour === BEHAVIOUR.DEFENDER ? STATE.RETURN : STATE.IDLE;
          this.lastKnown = null;
        }
      }

      if (this.windup > 0) {
        // Winding up roots the attacker: the telegraph has to be readable.
        this.windup -= dt * rateMul;
        this._face(p.x - this.x, p.y - this.y, dt, 6);
        if (this.windup <= 0) {
          this.windup = 0;
          this._release(world, dist);
        }
      } else {
        switch (this.behaviour) {
          case BEHAVIOUR.CHARGER: this._charger(dt, world, dist, speedMul, rateMul); break;
          case BEHAVIOUR.PURSUER: this._pursuer(dt, world, dist, speedMul, rateMul); break;
          case BEHAVIOUR.SKIRMISHER: this._skirmisher(dt, world, dist, speedMul, rateMul); break;
          case BEHAVIOUR.DEFENDER: this._defender(dt, world, dist, speedMul, rateMul); break;
          case BEHAVIOUR.RANGED: this._ranged(dt, world, dist, speedMul, rateMul); break;
          case BEHAVIOUR.AMBUSHER: this._ambusher(dt, world, dist, speedMul, rateMul); break;
          default: this._pursuer(dt, world, dist, speedMul, rateMul); break;
        }
      }
    }

    // Always applied, so a step already under way finishes cleanly no matter
    // what the behaviour above decided.
    this._applyMovement(dt, world);
  }

  _face(dx, dy, dt, rate = 10) {
    const m = Math.hypot(dx, dy);
    if (m < 0.001) return;
    this.faceX = damp(this.faceX, dx / m, rate, dt);
    this.faceY = damp(this.faceY, dy / m, rate, dt);
    const fm = Math.hypot(this.faceX, this.faceY) || 1;
    this.faceX /= fm; this.faceY /= fm;
  }

  // Records where this enemy wants to go. Movement itself is applied once per
  // frame in _applyMovement, so a step in progress always lands cleanly.
  _step(world, dt, dx, dy, speed) {
    const m = Math.hypot(dx, dy);
    if (m < 0.0001) return;
    this._desire = { x: dx / m, y: dy / m };
    this._desiredSpeed = speed;
  }

  _applyMovement(dt, world) {
    const blocked = (x, y) => world.tileTakenBy(x, y, this.id);
    this.mover.update(dt, world, this._desire, {
      speed: this._desiredSpeed,
      isBlocked: blocked,
    });
    this.speedNow = this.mover.speedNow;
    const h = this.mover.moving ? this.mover.heading : null;
    if (h) this._face(h.x, h.y, dt, 12);
    else if (this._desire) this._face(this._desire.x, this._desire.y, dt, 8);
    this._desire = null;
    this.knockX *= Math.exp(-9 * dt);
    this.knockY *= Math.exp(-9 * dt);
  }

  // Follow the shared flow field toward the player; fall back to a straight
  // line when the player is outside the field (very close or off-field).
  _pursue(world, dt, speed) {
    const dir = world.flowDirection(this.x, this.y);
    if (dir) this._step(world, dt, dir.x, dir.y, speed);
    else if (this.lastKnown) this._step(world, dt, this.lastKnown.x - this.x, this.lastKnown.y - this.y, speed);
    else this.speedNow = 0;
  }

  _wander(world, dt, speed) {
    this.wanderTimer -= dt;
    if (this.wanderTimer <= 0) {
      this.wanderTimer = 1.2 + Math.random() * 2.4;
      if (Math.random() < 0.45) { this.wanderX = 0; this.wanderY = 0; }
      else {
        const a = Math.random() * Math.PI * 2;
        this.wanderX = Math.cos(a); this.wanderY = Math.sin(a);
      }
    }
    if (this.wanderX || this.wanderY) this._step(world, dt, this.wanderX, this.wanderY, speed * 0.4);
    else this.speedNow = 0;
  }

  _returnHome(world, dt, speed) {
    const dx = this.anchor.x - this.x, dy = this.anchor.y - this.y;
    if (Math.hypot(dx, dy) < 0.7) { this.state = STATE.IDLE; return; }
    this._step(world, dt, dx, dy, speed * 0.7);
  }

  _beginAttack(world, windup = 0.34) {
    this.windup = windup;
    this.cooldown = this.def.attackCooldown;
    world.onEnemyWindup(this);
  }

  _release(world, distAtStart) {
    const p = world.player;
    const dist = Math.hypot(p.x - this.x, p.y - this.y);
    if (this.behaviour === BEHAVIOUR.RANGED) {
      world.fireEnemyShot(this);
      return;
    }
    if (dist <= this.def.attackRange + this.radius + p.radius + 0.25) {
      world.damagePlayer(this.damage, this);
    } else {
      world.onEnemyMiss(this);
    }
    if (this.behaviour === BEHAVIOUR.SKIRMISHER) {
      this.state = STATE.RETREAT;
      this.retreatTimer = 0.9;
    }
  }

  // --- archetypes ---------------------------------------------------------

  _charger(dt, world, dist, speedMul, rateMul) {
    const speed = this.def.speed * speedMul;
    if (this.state === STATE.CHASE) {
      const reach = this.def.attackRange + this.radius + world.player.radius;
      if (dist <= reach && this.cooldown <= 0) { this._beginAttack(world, 0.4 / rateMul); return; }
      // Committed dash: once it decides, it does not course-correct much.
      if (dist < 4.5 && this.dashTimer <= 0 && this.cooldown <= 0) {
        this.dashTimer = 0.55;
        this.dashDir = { x: world.player.x - this.x, y: world.player.y - this.y };
      }
      if (this.dashTimer > 0 && this.dashDir) {
        this._step(world, dt, this.dashDir.x, this.dashDir.y, speed * 1.5);
      } else {
        this._pursue(world, dt, speed);
      }
    } else if (this.state === STATE.RETURN) this._returnHome(world, dt, speed);
    else this._wander(world, dt, speed);
  }

  _pursuer(dt, world, dist, speedMul, rateMul) {
    const speed = this.def.speed * speedMul;
    if (this.state === STATE.CHASE) {
      const reach = this.def.attackRange + this.radius + world.player.radius;
      if (dist <= reach && this.cooldown <= 0) { this._beginAttack(world, 0.26 / rateMul); return; }
      this._pursue(world, dt, speed);
    } else if (this.state === STATE.RETURN) this._returnHome(world, dt, speed);
    else this._wander(world, dt, speed);
  }

  _skirmisher(dt, world, dist, speedMul, rateMul) {
    const speed = this.def.speed * speedMul;
    const p = world.player;
    if (this.state === STATE.RETREAT) {
      this.retreatTimer -= dt;
      this._step(world, dt, this.x - p.x, this.y - p.y, speed * 1.05);
      this._face(p.x - this.x, p.y - this.y, dt, 8);
      if (this.retreatTimer <= 0) this.state = STATE.CHASE;
      return;
    }
    if (this.state === STATE.CHASE) {
      const reach = this.def.attackRange + this.radius + p.radius;
      if (dist <= reach && this.cooldown <= 0) { this._beginAttack(world, 0.22 / rateMul); return; }
      if (dist < reach * 0.85) {
        this._step(world, dt, this.x - p.x, this.y - p.y, speed * 0.8);
      } else if (dist > reach + 1.6) {
        this._pursue(world, dt, speed);
      } else {
        // Circle, looking for an opening.
        const ax = -(p.y - this.y), ay = (p.x - this.x);
        this._step(world, dt, ax * this.strafe, ay * this.strafe, speed * 0.75);
        if (Math.random() < dt * 0.5) this.strafe *= -1;
      }
    } else if (this.state === STATE.RETURN) this._returnHome(world, dt, speed);
    else this._wander(world, dt, speed);
  }

  _defender(dt, world, dist, speedMul, rateMul) {
    const speed = this.def.speed * speedMul;
    const leash = this.guard ? 4.5 : 6.5;
    const fromAnchor = Math.hypot(this.x - this.anchor.x, this.y - this.anchor.y);
    if (this.state === STATE.CHASE) {
      const reach = this.def.attackRange + this.radius + world.player.radius;
      if (dist <= reach && this.cooldown <= 0) { this._beginAttack(world, 0.46 / rateMul); return; }
      if (fromAnchor > leash) { this._returnHome(world, dt, speed); return; }
      this._pursue(world, dt, speed);
    } else if (this.state === STATE.RETURN || fromAnchor > 0.6) {
      this._returnHome(world, dt, speed);
    } else {
      this.speedNow = 0;
      // Idle guards keep watch, slowly sweeping their arc.
      this._face(Math.cos(this.animTime * 0.5 + this.seed * 6),
        Math.sin(this.animTime * 0.5 + this.seed * 6), dt, 1.5);
    }
  }

  _ranged(dt, world, dist, speedMul, rateMul) {
    const speed = this.def.speed * speedMul;
    const p = world.player;
    if (this.state === STATE.CHASE) {
      const ideal = this.def.attackRange * 0.72;
      const los = hasLineOfSight(world, this.x, this.y, p.x, p.y);
      if (dist < ideal * 0.6) {
        this._step(world, dt, this.x - p.x, this.y - p.y, speed * 1.15);
      } else if (dist > this.def.attackRange || !los) {
        this._pursue(world, dt, speed);
      } else {
        this.speedNow = 0;
        this._face(p.x - this.x, p.y - this.y, dt, 8);
        if (this.cooldown <= 0) this._beginAttack(world, 0.5 / rateMul);
      }
    } else if (this.state === STATE.RETURN) this._returnHome(world, dt, speed);
    else this._wander(world, dt, speed);
  }

  _ambusher(dt, world, dist, speedMul, rateMul) {
    const speed = this.def.speed * speedMul;
    if (this.state === STATE.CHASE) {
      const reach = this.def.attackRange + this.radius + world.player.radius;
      if (dist <= reach && this.cooldown <= 0) { this._beginAttack(world, 0.2 / rateMul); return; }
      this._pursue(world, dt, speed * 1.1);
      // Loses interest quickly and goes back to lying in wait.
      if (dist > 7) { this.state = STATE.RETURN; }
    } else if (this.state === STATE.RETURN) {
      this._returnHome(world, dt, speed);
      if (Math.hypot(this.x - this.anchor.x, this.y - this.anchor.y) < 0.5) {
        this.state = STATE.DORMANT;
        this.dormant = true;
      }
    } else {
      this.speedNow = 0;
    }
  }
}

export { STATE };
