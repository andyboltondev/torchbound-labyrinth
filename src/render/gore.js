// Drawing for what a fight leaves behind.
//
// Stains and bodies are flat on the floor, so both go down in the ground pass
// before anything standing up is drawn. Both are dimmed by the light at their
// own tile, which means a corridor you fought down and walked away from keeps
// its blood as a cold memory rather than glowing in the dark.

import { screenX, screenY } from './iso.js';
import { rgba, shade } from './palette.js';

const TAU = Math.PI * 2;
const RANGE = 17;   // tiles from the player worth drawing at all

export function drawStains(ctx, world, tier) {
  const gore = world.gore;
  if (!gore || !gore.stains.length) return;
  const p = world.player;
  const layer = world.playerLayer;
  const vis = world.vis;

  ctx.save();
  for (const s of gore.stains) {
    if (Math.abs(s.x - p.x) > RANGE || Math.abs(s.y - p.y) > RANGE) continue;
    const gx = Math.floor(s.x), gy = Math.floor(s.y);
    if (world.layerAt(gy) !== layer) continue;
    const lit = vis.lightAt(gx, gy);
    const mem = vis.memoryAt(gx, gy);
    const seen = lit > 0.02 ? 0.35 + lit * 0.65 : mem * 0.3;
    if (seen < 0.04) continue;
    const sx = screenX(s.x, s.y), sy = screenY(s.x, s.y);
    ctx.fillStyle = rgba(s.colour, s.alpha * seen);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(s.angle || 0);
    ctx.beginPath();
    // The vertical squash is the isometric floor plane; the per-stain squash
    // on top of it is what stops every splash being a circle.
    ctx.ellipse(0, 0, s.r * 32, s.r * 32 * (s.squash || 0.6) * 0.5, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

export function drawCorpses(ctx, world, tier) {
  const gore = world.gore;
  if (!gore || !gore.corpses.length) return;
  const p = world.player;
  const layer = world.playerLayer;
  const vis = world.vis;

  for (const c of gore.corpses) {
    if (Math.abs(c.x - p.x) > RANGE || Math.abs(c.y - p.y) > RANGE) continue;
    const gx = Math.floor(c.x), gy = Math.floor(c.y);
    if (world.layerAt(gy) !== layer) continue;
    const lit = vis.lightAt(gx, gy);
    const mem = vis.memoryAt(gx, gy);
    const seen = lit > 0.02 ? 0.4 + lit * 0.6 : mem * 0.28;
    if (seen < 0.05) continue;
    drawCorpse(ctx, c, seen);
  }
}

// A body seen from above and slightly to one side: a slumped trunk, a head
// fallen off the line of it, and limbs thrown where the last hit put them.
// Deliberately not the standing sprite lying down -- the point is that it is
// no longer holding itself up.
function drawCorpse(ctx, c, seen) {
  const sx = screenX(c.x, c.y), sy = screenY(c.x, c.y);
  const s = (c.scale || 1) * (c.elite ? 1.15 : 1);
  const angle = Math.atan2(c.faceY || 0, c.faceX || 1) * 0.5 + (c.seed - 0.5) * 1.2;
  const body = c.palette ? c.palette.body : '#5a5148';

  ctx.save();
  ctx.translate(sx, sy);
  ctx.globalAlpha = seen;
  ctx.rotate(angle);
  ctx.scale(1, 0.5);   // onto the isometric floor plane

  // The dent it makes in the floor. Without this a body floats.
  ctx.fillStyle = rgba('#000000', 0.32);
  ctx.beginPath();
  ctx.ellipse(0, 2, 15 * s, 9 * s, 0, 0, TAU);
  ctx.fill();

  // Limbs first, so the trunk sits over where they join.
  ctx.strokeStyle = rgba(shade(body, -0.28), 0.92);
  ctx.lineWidth = 4.8 * s;
  ctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const a = (c.seed * 9 + i * 1.9) % TAU;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 3 * s, Math.sin(a) * 3 * s);
    ctx.lineTo(Math.cos(a) * 14 * s, Math.sin(a) * 14 * s);
    ctx.stroke();
  }

  ctx.fillStyle = rgba(shade(body, -0.12), 0.95);
  ctx.beginPath();
  ctx.ellipse(0, 0, 13 * s, 8.4 * s, 0, 0, TAU);
  ctx.fill();

  // The head, off the line of the spine.
  ctx.fillStyle = rgba(shade(body, 0.06), 0.95);
  ctx.beginPath();
  ctx.arc(-13 * s, 3.4 * s, 5.2 * s, 0, TAU);
  ctx.fill();

  // Whatever it had instead of blood, leaking out of it.
  ctx.fillStyle = rgba(c.blood || '#7a1f1c', 0.5);
  ctx.beginPath();
  ctx.ellipse(2 * s, 1 * s, 11 * s, 6.6 * s, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
  ctx.globalAlpha = 1;
}
