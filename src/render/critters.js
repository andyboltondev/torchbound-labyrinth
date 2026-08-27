// Vermin.
//
// The labyrinth is more convincing when something in it is alive that is not
// trying to kill you. These are pure decoration -- nothing here can be hit,
// damaged, or noticed by an enemy -- but they are the difference between a
// dungeon and a set of rooms.
//
// A small fixed pool follows the player around: when one wanders out of the
// torchlight it is recycled somewhere else nearby rather than allocated, so
// the cost is flat however long the level lasts.

import { screenX, screenY } from './iso.js';
import { rgba } from './palette.js';
import { T } from '../gen/tiles.js';

const TAU = Math.PI * 2;
const POOL = 9;
const KEEP = 13;        // recycled once this far from the player

// Each kind lives and moves somewhere different, which is the whole point of
// having more than one.
//   mouse   -- floor, bolts when the torch gets close
//   spider  -- walls, so it crosses stone the player cannot
//   bat     -- the ceiling, and ignores the floor plan entirely
//   beetle  -- floor, slow, does not care about anybody
const KINDS = [
  { id: 'mouse', weight: 3, speed: 2.6, z: 0.02, skittish: 5, colour: '#6a5c4c', size: 2.2 },
  { id: 'spider', weight: 2.4, speed: 1.1, z: 0.55, skittish: 2.4, colour: '#241f1c', size: 2, onWalls: true },
  { id: 'bat', weight: 1.6, speed: 3.4, z: 1.9, skittish: 6, colour: '#2c2430', size: 2.6, flies: true },
  { id: 'beetle', weight: 2, speed: 0.85, z: 0.02, skittish: 0, colour: '#2f2a20', size: 1.8 },
];
const TOTAL_WEIGHT = KINDS.reduce((n, k) => n + k.weight, 0);

function pickKind(r) {
  let acc = r * TOTAL_WEIGHT;
  for (const k of KINDS) { acc -= k.weight; if (acc <= 0) return k; }
  return KINDS[0];
}

export class Critters {
  constructor() {
    this.list = [];
    for (let i = 0; i < POOL; i++) {
      this.list.push({ kind: KINDS[0], x: 0, y: 0, vx: 0, vy: 0, alive: false, t: 0, hop: 0, panic: 0 });
    }
    this.t = 0;
    this.soundTimer = 3;
  }

  bind() {
    for (const c of this.list) c.alive = false;
    this.t = 0;
  }

  // A tile this kind is allowed to be on. Spiders live on the stone itself,
  // bats are above all of it, everything else needs floor.
  _suits(world, kind, gx, gy) {
    if (!world.grid.inBounds(gx, gy)) return false;
    if (world.layerAt(gy) !== world.playerLayer) return false;
    if (kind.flies) return true;
    const tile = world.grid.get(gx, gy);
    if (kind.onWalls) return tile === T.WALL || tile === T.FLOOR;
    return tile === T.FLOOR || tile === T.ENTRANCE;
  }

  _respawn(world, c) {
    const kind = pickKind(Math.random());
    for (let attempt = 0; attempt < 8; attempt++) {
      const a = Math.random() * TAU;
      const r = 4 + Math.random() * 6;
      const x = world.player.x + Math.cos(a) * r;
      const y = world.player.y + Math.sin(a) * r;
      if (!this._suits(world, kind, Math.floor(x), Math.floor(y))) continue;
      c.kind = kind;
      c.x = x; c.y = y;
      c.vx = 0; c.vy = 0;
      c.alive = true;
      c.t = Math.random() * 10;
      c.hop = 0.4 + Math.random() * 1.4;
      c.panic = 0;
      return;
    }
    c.alive = false;
  }

  update(dt, world, tier) {
    const q = tier ? tier.ambience : 1;
    this.t += dt;
    const live = q <= 0.34 ? 0 : Math.round(POOL * Math.min(1, q));

    for (let i = 0; i < this.list.length; i++) {
      const c = this.list[i];
      if (i >= live) { c.alive = false; continue; }
      if (!c.alive) {
        // Staggered, so the pool never repopulates in one visible burst.
        if (Math.random() < dt * 1.6) this._respawn(world, c);
        continue;
      }
      this._move(dt, world, c);
    }

    // Something moving in the dark, occasionally, whether or not it is on
    // screen. The sound is the half of this that still works with the torch
    // out, which is when it is most welcome.
    this.soundTimer -= dt;
    if (this.soundTimer <= 0 && live > 0) {
      this.soundTimer = 5 + Math.random() * 9;
      const c = this.list[Math.floor(Math.random() * live)];
      if (c.alive) world.playSfx(c.kind.id === 'bat' ? 'flutter' : 'scurry', { x: c.x, y: c.y });
    }
  }

  _move(dt, world, c) {
    const k = c.kind;
    c.t += dt;
    const p = world.player;
    const dx = c.x - p.x, dy = c.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d > KEEP) { c.alive = false; return; }

    // The torch is the thing they are frightened of, so a doused player can
    // walk right up to them. A small free reward for going dark, and the
    // first thing a player tends to notice about it.
    if (k.skittish > 0 && d < k.skittish * (world.torchLit ? 1 : 0.45)) {
      c.panic = Math.min(1, c.panic + dt * 4);
    } else {
      c.panic = Math.max(0, c.panic - dt * 1.2);
    }

    let wantX, wantY;
    if (c.panic > 0.15) {
      wantX = dx / (d || 1); wantY = dy / (d || 1);
    } else {
      // A slow wander with a long period, so nothing paces in circles.
      const a = c.t * 0.55 + Math.sin(c.t * 0.23) * 3;
      wantX = Math.cos(a); wantY = Math.sin(a);
    }
    const speed = k.speed * (0.35 + c.panic * 1.4);
    const nx = c.x + wantX * speed * dt;
    const ny = c.y + wantY * speed * dt;
    if (this._suits(world, k, Math.floor(nx), Math.floor(ny))) {
      c.x = nx; c.y = ny;
    } else {
      // Turn rather than stop: something stuck against a wall reads as a bug.
      c.t += 1.7;
    }
    c.vx = wantX * speed; c.vy = wantY * speed;
  }

  draw(ctx, world, tier) {
    const q = tier ? tier.ambience : 1;
    if (q <= 0.34) return;
    const t = this.t;
    for (const c of this.list) {
      if (!c.alive) continue;
      const lit = world.vis.lightAt(Math.floor(c.x), Math.floor(c.y));
      if (lit < 0.05) continue;
      const k = c.kind;
      const sx = screenX(c.x, c.y);
      const sy = screenY(c.x, c.y) - k.z * 26;
      const alpha = Math.min(1, lit * 1.4) * (0.5 + c.panic * 0.4);
      ctx.fillStyle = rgba(k.colour, alpha);

      if (k.id === 'bat') {
        // Two wings beating and a body between them. At this size that is the
        // entire animal, and the shadow underneath is the only thing that
        // says it is up in the air rather than on the floor.
        const beat = Math.sin(t * 17 + c.hop * 9) * 3.4;
        ctx.beginPath();
        ctx.ellipse(sx, sy, 1.6, 2.2, 0, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(sx - 4, sy - beat, sx - 7, sy + 1);
        ctx.quadraticCurveTo(sx - 4, sy + 1.6, sx, sy + 1);
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(sx + 4, sy - beat, sx + 7, sy + 1);
        ctx.quadraticCurveTo(sx + 4, sy + 1.6, sx, sy + 1);
        ctx.fill();
        ctx.fillStyle = rgba('#000000', alpha * 0.22);
        ctx.beginPath();
        ctx.ellipse(sx, screenY(c.x, c.y), 4, 2, 0, 0, TAU);
        ctx.fill();
        continue;
      }

      const bob = k.id === 'mouse' ? Math.abs(Math.sin(t * 14 + c.hop * 5)) * 0.9 : 0;
      ctx.beginPath();
      ctx.ellipse(sx, sy - bob, k.size, k.size * 0.66, Math.atan2(c.vy, c.vx) * 0.2, 0, TAU);
      ctx.fill();

      if (k.id === 'spider') {
        ctx.strokeStyle = rgba(k.colour, alpha * 0.9);
        ctx.lineWidth = 0.7;
        for (let i = 0; i < 4; i++) {
          const swing = Math.sin(t * 9 + i * 1.7 + c.hop * 4) * 1.2;
          const oy = -1.4 + i * 0.95;
          ctx.beginPath();
          ctx.moveTo(sx - 1.2, sy + oy - 1);
          ctx.lineTo(sx - 4.2 - swing, sy + oy + 0.6);
          ctx.moveTo(sx + 1.2, sy + oy - 1);
          ctx.lineTo(sx + 4.2 + swing, sy + oy + 0.6);
          ctx.stroke();
        }
      } else if (k.id === 'mouse') {
        // The tail is most of what says mouse rather than pebble.
        ctx.strokeStyle = rgba(k.colour, alpha * 0.8);
        ctx.lineWidth = 0.8;
        const wag = Math.sin(t * 11 + c.hop * 3) * 1.6;
        ctx.beginPath();
        ctx.moveTo(sx - c.vx * 0.4, sy - bob);
        ctx.quadraticCurveTo(sx - c.vx * 1.4, sy - bob + wag, sx - c.vx * 2.2, sy - bob + wag * 0.5);
        ctx.stroke();
      }
    }
  }
}
