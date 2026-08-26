// Pooled particle system. Positions are in grid space with a separate `z`
// height, so particles sit correctly in the isometric world and sort with it.

import { screenX, screenY } from './iso.js';
import { rgba } from './palette.js';

const MAX = 900;

export class Particles {
  constructor() {
    this.pool = new Array(MAX);
    for (let i = 0; i < MAX; i++) this.pool[i] = { alive: false };
    this.cursor = 0;
    this.texts = [];
  }

  _take() {
    for (let i = 0; i < MAX; i++) {
      const p = this.pool[(this.cursor + i) % MAX];
      if (!p.alive) { this.cursor = (this.cursor + i + 1) % MAX; return p; }
    }
    // Everything is busy: recycle the oldest slot rather than dropping input.
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % MAX;
    return p;
  }

  spawn(opts) {
    const p = this._take();
    p.alive = true;
    p.x = opts.x; p.y = opts.y; p.z = opts.z || 0;
    p.vx = opts.vx || 0; p.vy = opts.vy || 0; p.vz = opts.vz || 0;
    p.life = p.maxLife = opts.life || 0.6;
    p.size = opts.size || 2;
    p.colour = opts.colour || '#ffffff';
    p.glow = opts.glow || 0;
    p.gravity = opts.gravity === undefined ? 0 : opts.gravity;
    p.drag = opts.drag === undefined ? 1.6 : opts.drag;
    p.kind = opts.kind || 'dot';
    p.spin = opts.spin || 0;
    p.angle = opts.angle || 0;
    p.fade = opts.fade === undefined ? 1 : opts.fade;
    return p;
  }

  text(x, y, value, colour = '#ffffff', size = 15, rise = 1.0) {
    this.texts.push({ x, y, z: 0.9, value, colour, size, life: rise, maxLife: rise, vx: (Math.random() - 0.5) * 0.4 });
  }

  update(dt) {
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; continue; }
      p.vz -= p.gravity * dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy *= d;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.angle += p.spin * dt;
      if (p.z < 0) { p.z = 0; p.vz = Math.abs(p.vz) * 0.32; p.vx *= 0.6; p.vy *= 0.6; }
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      t.z += dt * 1.4;
      t.x += t.vx * dt;
      if (t.life <= 0) this.texts.splice(i, 1);
    }
  }

  // `lightAt` lets particles respect the darkness like everything else.
  draw(ctx, lightAt) {
    ctx.save();
    for (const p of this.pool) {
      if (!p.alive) continue;
      const lit = lightAt ? lightAt(p.x, p.y) : 1;
      if (lit <= 0.02 && !p.glow) continue;
      const a = Math.pow(p.life / p.maxLife, p.fade) * (p.glow ? 1 : 0.25 + lit * 0.75);
      const sx = screenX(p.x, p.y);
      const sy = screenY(p.x, p.y) - p.z * 26;
      if (p.glow) {
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, p.size * 3.2);
        g.addColorStop(0, rgba(p.colour, a * 0.9));
        g.addColorStop(1, rgba(p.colour, 0));
        ctx.fillStyle = g;
        ctx.fillRect(sx - p.size * 3.2, sy - p.size * 3.2, p.size * 6.4, p.size * 6.4);
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.fillStyle = rgba(p.colour, a);
      if (p.kind === 'chip') {
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(p.angle);
        ctx.fillRect(-p.size, -p.size * 0.6, p.size * 2, p.size * 1.2);
        ctx.restore();
      } else if (p.kind === 'streak') {
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx - p.vx * 6, sy - (p.vy * 6) * 0.5 + p.vz * 8);
        ctx.strokeStyle = rgba(p.colour, a);
        ctx.lineWidth = p.size;
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(sx, sy, p.size, 0, 7);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawTexts(ctx) {
    ctx.save();
    ctx.textAlign = 'center';
    for (const t of this.texts) {
      const a = Math.min(1, t.life / t.maxLife * 1.6);
      const sx = screenX(t.x, t.y);
      const sy = screenY(t.x, t.y) - t.z * 26;
      ctx.font = `700 ${t.size}px "Trebuchet MS", system-ui, sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = rgba('#000000', a * 0.75);
      ctx.strokeText(t.value, sx, sy);
      ctx.fillStyle = rgba(t.colour, a);
      ctx.fillText(t.value, sx, sy);
    }
    ctx.restore();
  }

  clear() {
    for (const p of this.pool) p.alive = false;
    this.texts.length = 0;
  }
}

// --- named effects --------------------------------------------------------

export function burstSparks(ps, x, y, colour = '#ffd27a', count = 8, power = 3.4) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = power * (0.4 + Math.random() * 0.8);
    ps.spawn({
      x, y, z: 0.45 + Math.random() * 0.25,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: 1.4 + Math.random() * 2.2,
      life: 0.3 + Math.random() * 0.35, size: 1.4 + Math.random() * 1.6,
      colour, glow: 1, gravity: 7, drag: 2.4,
    });
  }
}

export function burstBlood(ps, x, y, dirX, dirY, colour = '#8e1f1f') {
  for (let i = 0; i < 10; i++) {
    const a = Math.atan2(dirY, dirX) + (Math.random() - 0.5) * 1.5;
    const s = 1.5 + Math.random() * 3;
    ps.spawn({
      x, y, z: 0.5 + Math.random() * 0.3,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: 1 + Math.random() * 1.8,
      life: 0.45 + Math.random() * 0.4, size: 1.4 + Math.random() * 2.2,
      colour, gravity: 9, drag: 1.8,
    });
  }
}

export function burstStone(ps, x, y, colour = '#8b8377') {
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 1.2 + Math.random() * 3.4;
    ps.spawn({
      x, y, z: 0.3 + Math.random() * 0.8, kind: 'chip',
      vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: 1.5 + Math.random() * 2.6,
      life: 0.6 + Math.random() * 0.6, size: 1.6 + Math.random() * 2,
      colour, gravity: 11, drag: 1.2, spin: (Math.random() - 0.5) * 12,
    });
  }
}

export function ring(ps, x, y, colour, count = 18, radius = 1.1, life = 0.5) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    ps.spawn({
      x: x + Math.cos(a) * 0.1, y: y + Math.sin(a) * 0.1, z: 0.25,
      vx: Math.cos(a) * radius * 3.2, vy: Math.sin(a) * radius * 3.2, vz: 0.2,
      life, size: 2, colour, glow: 1, drag: 3.2, gravity: 0,
    });
  }
}

export function footDust(ps, x, y, colour = '#6f6a5e') {
  ps.spawn({
    x: x + (Math.random() - 0.5) * 0.2, y: y + (Math.random() - 0.5) * 0.2, z: 0.05,
    vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.5, vz: 0.4,
    life: 0.45, size: 2.2 + Math.random() * 2, colour, drag: 3.4, gravity: 0.4, fade: 1.8,
  });
}
