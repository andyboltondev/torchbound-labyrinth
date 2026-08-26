// Environmental effects layer.
//
// Everything here is atmosphere rather than mechanism: motes turning in the
// torchlight, water finding its way through a crypt ceiling, embers lifting
// off a hot floor. It is deliberately separate from the weather in the
// renderer, which is screen-space and tied to a hazard's *rules*. This layer
// is world-space, always on, and the first thing dropped when frames get
// expensive.

import { screenX, screenY, TILE_W, TILE_H } from './iso.js';
import { rgba } from './palette.js';
import { T } from '../gen/tiles.js';
import { clamp } from '../core/util.js';

const MOTE_SPAN = 15;
const MOTES = 54;

// Cheap deterministic hash, so the mote field is stable between frames
// without storing anything.
function h(i) {
  let x = Math.imul(i ^ 0x9e3779b9, 2246822507);
  x = Math.imul(x ^ (x >>> 13), 3266489909);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

// Per-biome ambient character. `rate` is events per second at full quality.
const PROFILES = {
  ruins: { mote: '#d8c49a', moteRate: 1, drip: 0, ember: 0, spore: 0 },
  crypt: { mote: '#cfe4f2', moteRate: 1.1, drip: 0.55, ember: 0, spore: 0 },
  tomb: { mote: '#bfd39a', moteRate: 0.9, drip: 0.2, ember: 0, spore: 0.7 },
  embers: { mote: '#ffb27a', moteRate: 1.3, drip: 0, ember: 1.5, spore: 0 },
  rainruins: { mote: '#c3d6e0', moteRate: 0.7, drip: 1.1, ember: 0, spore: 0 },
};

export class Ambience {
  constructor() {
    this.t = 0;
    this.profile = PROFILES.ruins;
    this.dripTimer = 1;
    this.emberTimer = 1;
    this.sporeTimer = 1;
    this.rippleTimer = 0.6;
    this.ripples = [];
    this.level = null;
  }

  bind(level) {
    this.level = level;
    this.profile = PROFILES[level.biome.id] || PROFILES.ruins;
    this.ripples.length = 0;
    this.t = 0;
  }

  // A lit, walkable tile somewhere near the player -- where an ambient event
  // is allowed to happen. Returns null rather than searching hard: a missed
  // drip costs nothing.
  _spot(world, minR = 1.5, maxR = 7) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const r = minR + Math.random() * (maxR - minR);
      const x = world.player.x + Math.cos(a) * r;
      const y = world.player.y + Math.sin(a) * r;
      const gx = Math.floor(x), gy = Math.floor(y);
      if (!world.grid.inBounds(gx, gy)) continue;
      if (world.layerAt(gy) !== world.playerLayer) continue;
      const tile = world.grid.get(gx, gy);
      if (tile !== T.FLOOR && tile !== T.ENTRANCE) continue;
      if (world.vis.lightAt(gx, gy) < 0.06) continue;
      return { x, y };
    }
    return null;
  }

  update(dt, world, tier) {
    this.t += dt;
    const q = tier ? tier.ambience : 1;
    if (q <= 0) return;
    const p = this.profile;
    const hazard = world.currentHazard.id;
    const ps = world.particles;

    // Water. Falls from the ceiling, lands, spreads a ring.
    const dripRate = (p.drip + (hazard === 'rain' ? 1.2 : 0)) * q;
    if (dripRate > 0) {
      this.dripTimer -= dt * dripRate;
      if (this.dripTimer <= 0) {
        this.dripTimer = 0.5 + Math.random() * 1.4;
        const at = this._spot(world, 1.2, 8);
        if (at) {
          ps.spawn({
            x: at.x, y: at.y, z: 1.5,
            vz: -0.2, gravity: 6.5, drag: 0.2,
            life: 0.85, size: 1.5, colour: '#bcd8e6', kind: 'streak', fade: 0.6,
          });
          this.ripples.push({ x: at.x, y: at.y, t: 0, delay: 0.42, life: 0.9 });
        }
      }
    }

    // Embers lift off hot ground and burn out on the way up.
    const emberRate = (p.ember + (hazard === 'embers' ? 1.6 : 0)) * q;
    if (emberRate > 0) {
      this.emberTimer -= dt * emberRate;
      if (this.emberTimer <= 0) {
        this.emberTimer = 0.25 + Math.random() * 0.6;
        const at = this._spot(world, 1, 8);
        if (at) {
          ps.spawn({
            x: at.x, y: at.y, z: 0.05,
            vx: (Math.random() - 0.5) * 0.35, vy: (Math.random() - 0.5) * 0.35,
            vz: 0.7 + Math.random() * 0.9, gravity: -0.35, drag: 0.6,
            life: 1.3 + Math.random() * 1.1, size: 1.1 + Math.random(),
            colour: Math.random() < 0.3 ? '#ffd79a' : '#ff8b3a', glow: 1, fade: 1.6,
          });
        }
      }
    }

    // Spores drift sideways and never quite settle.
    const sporeRate = (p.spore + (hazard === 'vines' ? 0.8 : 0)) * q;
    if (sporeRate > 0) {
      this.sporeTimer -= dt * sporeRate;
      if (this.sporeTimer <= 0) {
        this.sporeTimer = 0.4 + Math.random() * 1.1;
        const at = this._spot(world, 1, 8);
        if (at) {
          ps.spawn({
            x: at.x, y: at.y, z: 0.2 + Math.random() * 0.9,
            vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.5,
            vz: 0.16, gravity: -0.05, drag: 0.35,
            life: 2.6 + Math.random() * 2, size: 1.2,
            colour: '#a9e07a', glow: 1, fade: 2.2,
          });
        }
      }
    }

    // Standing water answers the rain whether or not anything dripped.
    if (hazard === 'rain' && q > 0.4) {
      this.rippleTimer -= dt;
      if (this.rippleTimer <= 0) {
        this.rippleTimer = 0.12 / q;
        const at = this._spot(world, 0.8, 9);
        if (at) this.ripples.push({ x: at.x, y: at.y, t: 0, delay: 0, life: 0.75 });
      }
    }

    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.t += dt;
      if (r.t > r.delay + r.life) this.ripples.splice(i, 1);
    }
  }

  // --- ground-level drawing, under the actors ------------------------------
  drawGround(ctx, world, tier) {
    const q = tier ? tier.ambience : 1;
    if (q <= 0) return;

    // Ripples on standing water.
    if (this.ripples.length) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineWidth = 1.2;
      for (const r of this.ripples) {
        const age = r.t - r.delay;
        if (age < 0) continue;
        const k = age / r.life;
        const rad = 3 + k * 15;
        const a = (1 - k) * 0.3;
        const sx = screenX(r.x, r.y), sy = screenY(r.x, r.y);
        ctx.strokeStyle = rgba('#a8cfe4', a * world.vis.lightAt(Math.floor(r.x), Math.floor(r.y)));
        ctx.beginPath();
        ctx.ellipse(sx, sy, rad, rad * 0.5, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Pools of light under the wall sconces. The visibility pass already lets
    // them light the room; this is what that light looks like on the floor.
    if (tier && tier.sconceGlow) this._sconcePools(ctx, world);
  }

  _sconcePools(ctx, world) {
    const p = world.player;
    const t = this.t;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of world.level.sconces) {
      if (Math.abs(s.x - p.x) + Math.abs(s.y - p.y) > 11) continue;
      if (world.layerAt(Math.floor(s.y)) !== world.playerLayer) continue;
      if (world.vis.lightAt(Math.floor(s.x), Math.floor(s.y)) < 0.03) continue;
      const flick = 0.78 + Math.sin(t * 7.3 + s.seed * 30) * 0.12
        + Math.sin(t * 13.1 + s.seed * 11) * 0.06;
      const sx = screenX(s.x, s.y), sy = screenY(s.x, s.y);
      const r = TILE_W * 1.5 * flick;
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
      g.addColorStop(0, rgba('#ffa54a', 0.2 * flick));
      g.addColorStop(0.55, rgba('#ff7a2a', 0.06 * flick));
      g.addColorStop(1, rgba('#ff7a2a', 0));
      ctx.save();
      ctx.translate(sx, sy);
      ctx.scale(1, TILE_H / TILE_W);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  // --- motes, drawn over the scene where the torch can catch them ----------
  // Deterministic positions wrapped around the player: no allocation, no
  // pooling, and they parallax correctly because they live in grid space.
  drawMotes(ctx, world, tier) {
    const q = tier ? tier.ambience : 1;
    if (q <= 0.1) return;
    const count = Math.round(MOTES * q * this.profile.moteRate);
    if (count <= 0) return;
    const p = world.player;
    const t = this.t;
    const colour = this.profile.mote;
    const radius = Math.max(3, world.torchRadius);
    const half = MOTE_SPAN / 2;
    const wrap = (v, centre) => {
      const d = ((v - centre + half) % MOTE_SPAN + MOTE_SPAN) % MOTE_SPAN - half;
      return centre + d;
    };

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < count; i++) {
      const a = h(i * 3 + 1), b = h(i * 3 + 2), c = h(i * 3 + 3);
      // A slow curl, different for every mote, so the field never reads as a
      // grid sliding past.
      const drift = t * (0.08 + c * 0.14);
      const x = wrap(a * MOTE_SPAN + Math.sin(drift + a * 40) * 0.9, p.x);
      const y = wrap(b * MOTE_SPAN + Math.cos(drift * 0.8 + b * 40) * 0.9, p.y);
      const dist = Math.hypot(x - p.x, y - p.y);
      if (dist > radius) continue;
      const gx = Math.floor(x), gy = Math.floor(y);
      const lit = world.vis.lightAt(gx, gy);
      if (lit < 0.08) continue;
      const z = 0.25 + c * 1.5 + Math.sin(t * (0.4 + a) + b * 30) * 0.18;
      const fade = 1 - dist / radius;
      const twinkle = 0.55 + Math.sin(t * (1.4 + b * 2.6) + i) * 0.45;
      const alpha = clamp(fade * lit * twinkle * 0.5 * world.torch.flicker, 0, 1);
      if (alpha < 0.015) continue;
      const sx = screenX(x, y);
      const sy = screenY(x, y) - z * 26;
      const size = 0.7 + c * 0.9;
      ctx.fillStyle = rgba(colour, alpha);
      ctx.beginPath();
      ctx.arc(sx, sy, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
