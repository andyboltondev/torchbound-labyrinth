// Character rendering. Everything is drawn immediate-mode from vector shapes
// so animation is continuous (no sprite-sheet stepping) and every enemy can
// have a genuinely different silhouette without an art pipeline.

import { screenX, screenY } from './iso.js';
import { rgba, shade, mix } from './palette.js';

const TAU = Math.PI * 2;

export function groundShadow(ctx, sx, sy, rx, ry, alpha = 0.42) {
  ctx.save();
  const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, rx);
  g.addColorStop(0, rgba('#000000', alpha));
  g.addColorStop(1, rgba('#000000', 0));
  ctx.fillStyle = g;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(1, ry / rx);
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, TAU);
  ctx.fill();
  ctx.restore();
  ctx.restore();
}

function limb(ctx, x1, y1, x2, y2, width, colour) {
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function blob(ctx, x, y, rx, ry, colour, rot = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// Screen-space facing, derived from a grid direction, plus a couple of handy
// booleans the drawing routines use to decide what is in front of what.
export function facingInfo(gx, gy) {
  const sx = (gx - gy);
  const sy = (gx + gy) * 0.5;
  const m = Math.hypot(sx, sy) || 1;
  const nx = sx / m, ny = sy / m;
  return { x: nx, y: ny, flip: nx < -0.05 ? -1 : 1, away: ny < -0.25, toward: ny > 0.25 };
}

// --- the player -----------------------------------------------------------
// A torchbearer: helm, cloak, sword in the lead hand, flame in the other.

export function drawPlayer(ctx, p, t, opts = {}) {
  // Knockback is a render-space shove, so it reads as impact without pushing
  // the character off its movement lane.
  const px = p.x + (p.knockX || 0), py = p.y + (p.knockY || 0);
  const sx = screenX(px, py);
  const sy = screenY(px, py);
  const f = facingInfo(p.faceX, p.faceY);
  const scale = 1;
  const walk = p.moving ? Math.sin(p.animTime * 11) : 0;
  const bob = p.moving ? Math.abs(Math.sin(p.animTime * 11)) * 2.2 : Math.sin(t * 2.1) * 0.9;
  const hurt = p.hurtFlash > 0;

  groundShadow(ctx, sx, sy + 1, 15 * scale, 7 * scale, 0.45);

  ctx.save();
  ctx.translate(sx, sy - bob);
  ctx.scale(f.flip, 1);

  const skin = '#c8a180';
  const cloth = hurt ? '#c05a4a' : '#4a5568';
  const leather = hurt ? '#a8523f' : '#5c4632';
  const metal = '#9aa3ad';
  const gold = '#d9a441';
  const hipY = -20, headY = -38;

  // Cloak billows behind, and leans with movement.
  ctx.save();
  ctx.beginPath();
  const sway = walk * 2.4 + (p.moving ? 3 : 0);
  ctx.moveTo(-7, headY + 5);
  ctx.quadraticCurveTo(-16 - sway, hipY + 2, -10 - sway * 1.4, -2);
  ctx.lineTo(7, -2);
  ctx.quadraticCurveTo(11, hipY, 7, headY + 5);
  ctx.closePath();
  ctx.fillStyle = hurt ? '#8e3b30' : '#3a2f3d';
  ctx.fill();
  ctx.restore();

  // Legs.
  limb(ctx, -3, hipY, -3 + walk * 4, -1, 5, leather);
  limb(ctx, 3, hipY, 3 - walk * 4, -1, 5, shade(leather, -0.12));

  // Torso.
  ctx.fillStyle = cloth;
  ctx.beginPath();
  ctx.moveTo(-7, hipY + 2);
  ctx.lineTo(7, hipY + 2);
  ctx.lineTo(6, headY + 7);
  ctx.lineTo(-6, headY + 7);
  ctx.closePath();
  ctx.fill();
  // Mail and belt.
  ctx.fillStyle = rgba(metal, 0.35);
  ctx.fillRect(-6.5, headY + 8, 13, 8);
  ctx.fillStyle = gold;
  ctx.fillRect(-7, hipY - 2, 14, 2.6);

  // Head, helm with a nasal bar.
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(0, headY, 6.2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = metal;
  ctx.beginPath();
  ctx.arc(0, headY - 1, 6.4, Math.PI, TAU);
  ctx.fill();
  ctx.fillRect(-6.4, headY - 1.4, 12.8, 2.4);
  if (!f.away) {
    ctx.fillStyle = shade(metal, -0.35);
    ctx.fillRect(1.2, headY - 1, 1.8, 5.4);
    ctx.fillStyle = '#241d19';
    ctx.fillRect(3.4, headY + 1.4, 2, 1.4);
  }
  ctx.fillStyle = gold;
  ctx.fillRect(-6.4, headY - 2.6, 12.8, 1.4);

  drawPlayerArms(ctx, p, t, { walk, hipY, headY, skin, metal, gold, leather, away: f.away });
  ctx.restore();

  if (p.invulnTimer > 0 && Math.floor(t * 18) % 2 === 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba('#ffffff', 0.16);
    ctx.beginPath();
    ctx.ellipse(sx, sy - 22, 14, 24, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  if (opts.shield && p.shieldPulse > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba('#8fd7ff', p.shieldPulse * 0.8);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(sx, sy - 20, 22 + (1 - p.shieldPulse) * 12, 30 + (1 - p.shieldPulse) * 14, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
}

function drawPlayerArms(ctx, p, t, cfg) {
  const { walk, hipY, headY, skin, metal, gold, leather } = cfg;
  const shoulderY = headY + 9;

  // Off hand: the torch. Always readable, always the light source.
  const torchAngle = -0.55 + Math.sin(t * 2.3) * 0.05 + walk * 0.12;
  const tx = -9 + Math.cos(torchAngle) * -6;
  const ty = shoulderY + Math.sin(torchAngle) * 6;
  limb(ctx, -5, shoulderY, tx, ty, 4.4, skin);
  ctx.save();
  ctx.translate(tx, ty);
  ctx.rotate(-0.35);
  ctx.fillStyle = leather;
  ctx.fillRect(-2, -14, 4, 16);
  ctx.fillStyle = gold;
  ctx.fillRect(-2.6, -3, 5.2, 2);
  drawFlame(ctx, 0, -16, 1, t, p.torchFlicker || 1);
  ctx.restore();

  // Sword hand: rests at the hip, swings on attack.
  const atk = p.attack;
  let angle = 0.35 + walk * 0.18;
  let extend = 8;
  if (atk && atk.type === 'slash') {
    const k = atk.t / atk.duration;
    // Fast wind-up, faster follow-through, a beat of recovery.
    const swing = k < 0.28 ? -0.9 * (k / 0.28)
      : k < 0.62 ? -0.9 + 3.0 * ((k - 0.28) / 0.34)
        : 2.1 - 1.75 * ((k - 0.62) / 0.38);
    angle = 0.35 + swing;
    extend = 10 + Math.sin(Math.min(1, k * 2.2) * Math.PI) * 6;
  } else if (atk && atk.type === 'fire') {
    angle = -0.1;
    extend = 12;
  }

  const hx = 6 + Math.cos(angle) * extend * 0.55;
  const hy = shoulderY + 4 + Math.sin(angle) * extend * 0.55;
  limb(ctx, 5, shoulderY, hx, hy, 4.4, skin);

  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(angle);
  if (p.hasCrossbow && atk && atk.type === 'fire') {
    // Crossbow: stock, limbs and a taut string.
    ctx.fillStyle = leather;
    ctx.fillRect(-4, -2, 18, 4);
    ctx.strokeStyle = shade(metal, -0.2);
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(9, -9); ctx.lineTo(9, 9);
    ctx.stroke();
    ctx.strokeStyle = rgba('#e6dcc6', 0.8);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(9, -9); ctx.lineTo(3, 0); ctx.lineTo(9, 9);
    ctx.stroke();
  } else {
    // Sword: fuller, guard, pommel.
    ctx.fillStyle = shade(leather, -0.2);
    ctx.fillRect(-5, -1.8, 7, 3.6);
    ctx.fillStyle = gold;
    ctx.fillRect(1, -5, 2.6, 10);
    const grad = ctx.createLinearGradient(3, 0, 27, 0);
    grad.addColorStop(0, '#d9dee5');
    grad.addColorStop(0.5, '#f2f5f8');
    grad.addColorStop(1, '#9aa3ad');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(3, -2.6);
    ctx.lineTo(24, -1.8);
    ctx.lineTo(28, 0);
    ctx.lineTo(24, 1.8);
    ctx.lineTo(3, 2.6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = rgba('#000000', 0.18);
    ctx.fillRect(4, -0.4, 19, 0.8);
  }
  ctx.restore();

  // Weapon trail: sells the arc without smearing the whole screen.
  if (atk && atk.type === 'slash') {
    const k = atk.t / atk.duration;
    if (k > 0.24 && k < 0.75) {
      const a0 = 0.35 - 0.9;
      const a1 = 0.35 + 2.1;
      const prog = (k - 0.24) / 0.51;
      ctx.save();
      ctx.translate(6, shoulderY + 4);
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, 0, 8, 0, 0, 30);
      g.addColorStop(0, rgba('#ffffff', 0));
      g.addColorStop(1, rgba('#dbe8ff', 0.42 * (1 - prog)));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 30, a0, a0 + (a1 - a0) * prog);
      ctx.arc(0, 0, 12, a0 + (a1 - a0) * prog, a0, true);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
}

// A small living flame: core, body, halo and a wobble that never stops.
export function drawFlame(ctx, x, y, scale, t, flicker = 1) {
  const s = scale * (0.9 + flicker * 0.14);
  const w = 5 * s, h = 12 * s;
  const wob = Math.sin(t * 9.1) * 0.8 + Math.sin(t * 15.7) * 0.4;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const halo = ctx.createRadialGradient(x, y, 0, x, y, 26 * s);
  halo.addColorStop(0, rgba('#ffb257', 0.36 * flicker));
  halo.addColorStop(0.5, rgba('#ff7a2a', 0.12 * flicker));
  halo.addColorStop(1, rgba('#ff7a2a', 0));
  ctx.fillStyle = halo;
  ctx.fillRect(x - 26 * s, y - 26 * s, 52 * s, 52 * s);
  ctx.restore();

  ctx.save();
  ctx.translate(x + wob * 0.5, y);
  ctx.fillStyle = '#e2571f';
  ctx.beginPath();
  ctx.moveTo(0, -h);
  ctx.quadraticCurveTo(w + wob, -h * 0.4, 0, h * 0.28);
  ctx.quadraticCurveTo(-w + wob, -h * 0.4, 0, -h);
  ctx.fill();
  ctx.fillStyle = '#ffa53a';
  ctx.beginPath();
  ctx.moveTo(0, -h * 0.78);
  ctx.quadraticCurveTo(w * 0.62 + wob * 0.6, -h * 0.3, 0, h * 0.2);
  ctx.quadraticCurveTo(-w * 0.62 + wob * 0.6, -h * 0.3, 0, -h * 0.78);
  ctx.fill();
  ctx.fillStyle = '#ffe9a8';
  ctx.beginPath();
  ctx.ellipse(wob * 0.3, -h * 0.18, w * 0.3, h * 0.3, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// --- enemies --------------------------------------------------------------

export function drawEnemy(ctx, e, t) {
  const ex = e.x + (e.knockX || 0), ey = e.y + (e.knockY || 0);
  const sx = screenX(ex, ey);
  const sy = screenY(ex, ey);
  const def = e.def;
  const s = e.scale || 1;

  if (e.dormant) { drawDormant(ctx, e, sx, sy, t, s); return; }

  const f = facingInfo(e.faceX, e.faceY);
  const hurt = e.hurtFlash > 0;
  const pal = {
    body: hurt ? mix(def.palette.body, '#ffffff', 0.65) : def.palette.body,
    trim: hurt ? mix(def.palette.trim, '#ffffff', 0.65) : def.palette.trim,
    eye: def.palette.eye,
  };
  const walk = Math.sin(e.animTime * (7 + def.speed * 2));
  const moving = e.speedNow > 0.25;
  const bob = moving ? Math.abs(walk) * 1.8 : Math.sin(t * 1.8 + e.seed * 6) * 0.7;
  const wind = e.windup > 0 ? Math.min(1, e.windup) : 0;

  groundShadow(ctx, sx, sy + 1, 13 * s * def.radius * 2.6, 6 * s * def.radius * 2.6, 0.4);

  ctx.save();
  ctx.translate(sx, sy - bob);
  ctx.scale(f.flip * s, s);

  switch (def.id) {
    case 'barrow_hound': drawHound(ctx, pal, walk, moving, wind, f); break;
    case 'rune_shade': drawShade(ctx, pal, t, e.seed, wind, f); break;
    case 'crypt_warden': drawWarden(ctx, pal, walk, wind, f); break;
    case 'mire_lurker': drawLurker(ctx, pal, walk, wind, f); break;
    case 'bone_slinger': drawSlinger(ctx, pal, walk, wind, f); break;
    case 'frost_revenant': drawRevenant(ctx, pal, walk, wind, f, t); break;
    case 'ember_fiend': drawFiend(ctx, pal, walk, wind, f, t); break;
    case 'root_horror': drawRootHorror(ctx, pal, walk, wind, f, t); break;
    case 'valkyr_wraith': drawValkyr(ctx, pal, walk, wind, f, t); break;
    default: drawThrall(ctx, pal, walk, wind, f); break;
  }

  if (e.elite) {
    ctx.fillStyle = rgba('#e8b45c', 0.9);
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 4 - 1.6, -46);
      ctx.lineTo(i * 4, -52);
      ctx.lineTo(i * 4 + 1.6, -46);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillRect(-6, -46, 12, 1.8);
  }
  ctx.restore();

  drawEnemyStatus(ctx, e, sx, sy, t);
}

function drawThrall(ctx, pal, walk, wind, f) {
  limb(ctx, -3, -18, -3 + walk * 4, 0, 5, pal.trim);
  limb(ctx, 3, -18, 3 - walk * 4, 0, 5, pal.trim);
  ctx.fillStyle = pal.body;
  ctx.beginPath();
  ctx.moveTo(-7, -17); ctx.lineTo(7, -17); ctx.lineTo(5.5, -33); ctx.lineTo(-5.5, -33);
  ctx.closePath(); ctx.fill();
  // Ragged wrappings.
  ctx.fillStyle = rgba(pal.trim, 0.7);
  for (let i = 0; i < 3; i++) ctx.fillRect(-7, -30 + i * 5, 14, 2);
  blob(ctx, 0, -37, 5.4, 5.8, pal.body);
  if (!f.away) {
    ctx.fillStyle = pal.eye;
    ctx.fillRect(1.5, -38.5, 2.4, 1.8);
    ctx.fillRect(-3.6, -38.5, 2.4, 1.8);
  }
  // Axe, raised as it winds up.
  ctx.save();
  ctx.translate(6, -26);
  ctx.rotate(-0.4 - wind * 1.5);
  ctx.strokeStyle = '#4a3a2c'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(16, -3); ctx.stroke();
  ctx.fillStyle = '#8f959c';
  ctx.beginPath();
  ctx.moveTo(13, -3); ctx.lineTo(20, -9); ctx.lineTo(22, -1); ctx.lineTo(15, 1);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawHound(ctx, pal, walk, moving, wind, f) {
  const gait = moving ? walk : 0;
  limb(ctx, -6, -9, -8 + gait * 4, 0, 3.4, pal.trim);
  limb(ctx, 6, -9, 8 - gait * 4, 0, 3.4, pal.trim);
  limb(ctx, -4, -9, -3 - gait * 3, 0, 3.4, pal.body);
  limb(ctx, 5, -9, 6 + gait * 3, 0, 3.4, pal.body);
  blob(ctx, 0, -12, 11, 6.4, pal.body);
  ctx.strokeStyle = pal.trim; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-10, -13);
  ctx.quadraticCurveTo(-17, -16 + gait * 3, -18, -22);
  ctx.stroke();
  blob(ctx, 10, -16, 6, 5, pal.body);
  ctx.fillStyle = pal.body;
  ctx.beginPath();
  ctx.moveTo(13, -17); ctx.lineTo(22, -14 + wind * 2); ctx.lineTo(13, -12);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = pal.eye;
  ctx.fillRect(12, -18.5, 2.6, 2);
  if (wind > 0.1) {
    ctx.fillStyle = rgba('#ffffff', 0.8);
    for (let i = 0; i < 3; i++) ctx.fillRect(15 + i * 2.4, -13.5, 1.6, 2.6);
  }
}

function drawShade(ctx, pal, t, seed, wind, f) {
  const float = Math.sin(t * 2.2 + seed * 7) * 2.4;
  ctx.save();
  ctx.translate(0, float);
  // Robe, tattered at the hem.
  ctx.fillStyle = pal.body;
  ctx.beginPath();
  ctx.moveTo(0, -40);
  ctx.quadraticCurveTo(11, -26, 9, -2);
  for (let i = 0; i < 4; i++) ctx.lineTo(6 - i * 4, -4 + (i % 2) * 4);
  ctx.quadraticCurveTo(-11, -26, 0, -40);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = rgba('#000000', 0.55);
  ctx.beginPath();
  ctx.ellipse(0, -34, 5.2, 6, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = pal.eye;
  ctx.fillRect(-3, -35, 2.2, 1.8);
  ctx.fillRect(1, -35, 2.2, 1.8);
  // Orbiting runes: the tell that it is about to strike.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 3; i++) {
    const a = t * (1.4 + i * 0.4) + i * 2.1 + seed * 6;
    const rx = Math.cos(a) * (13 + wind * 5);
    const ry = -24 + Math.sin(a) * 5;
    ctx.fillStyle = rgba(pal.trim, 0.55 + wind * 0.4);
    ctx.fillRect(rx - 1, ry - 3.5, 2, 7);
    ctx.fillRect(rx - 1, ry - 1, 4, 1.6);
  }
  ctx.restore();
  ctx.restore();
}

function drawWarden(ctx, pal, walk, wind, f) {
  limb(ctx, -4, -20, -4 + walk * 2.5, 0, 6.5, pal.trim);
  limb(ctx, 4, -20, 4 - walk * 2.5, 0, 6.5, pal.trim);
  ctx.fillStyle = pal.body;
  ctx.beginPath();
  ctx.moveTo(-10, -19); ctx.lineTo(10, -19); ctx.lineTo(8, -38); ctx.lineTo(-8, -38);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = rgba(pal.trim, 0.85);
  ctx.fillRect(-10, -30, 20, 3);
  blob(ctx, 0, -42, 6, 6.4, pal.body);
  ctx.fillStyle = pal.trim;
  ctx.beginPath();
  ctx.arc(0, -43, 6.4, Math.PI, TAU);
  ctx.fill();
  ctx.fillStyle = pal.eye;
  ctx.fillRect(-3.6, -42, 7.2, 1.8);
  // Tower shield, pushed forward on the wind-up.
  ctx.save();
  ctx.translate(-11 - wind * 3, -26);
  ctx.fillStyle = shade(pal.trim, -0.3);
  ctx.beginPath();
  ctx.moveTo(0, -12); ctx.lineTo(9, -10); ctx.lineTo(9, 10); ctx.lineTo(0, 14);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = pal.trim; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(4.5, -10); ctx.lineTo(4.5, 12); ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.translate(9, -26);
  ctx.rotate(-0.2 - wind * 1.2);
  ctx.strokeStyle = '#4a3a2c'; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(15, 0); ctx.stroke();
  ctx.fillStyle = '#9aa3ad';
  ctx.fillRect(14, -6, 5, 12);
  ctx.restore();
}

function drawLurker(ctx, pal, walk, wind, f) {
  blob(ctx, 0, -9, 12, 8.5, pal.body);
  for (let i = 0; i < 4; i++) blob(ctx, -8 + i * 5.5, -14 + (i % 2) * 2, 3.4, 2.6, rgba(pal.trim, 0.7));
  // Long grasping arms.
  ctx.strokeStyle = pal.body; ctx.lineWidth = 3.6; ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * 8, -12);
    ctx.quadraticCurveTo(side * (18 + wind * 6), -14, side * (20 + wind * 9), -2 - wind * 6);
    ctx.stroke();
  }
  ctx.fillStyle = pal.eye;
  ctx.fillRect(-5, -15, 2.6, 2);
  ctx.fillRect(2.4, -15, 2.6, 2);
  ctx.fillStyle = rgba('#0b0f0a', 0.9);
  ctx.beginPath();
  ctx.ellipse(0, -7, 5 + wind * 3, 2 + wind * 3, 0, 0, TAU);
  ctx.fill();
}

function drawSlinger(ctx, pal, walk, wind, f) {
  limb(ctx, -3, -17, -3 + walk * 3.4, 0, 3.4, pal.trim);
  limb(ctx, 3, -17, 3 - walk * 3.4, 0, 3.4, pal.trim);
  ctx.strokeStyle = pal.body; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, -17); ctx.lineTo(0, -33); ctx.stroke();
  ctx.strokeStyle = rgba(pal.body, 0.9); ctx.lineWidth = 1.8;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(-4.5, -30 + i * 3.2);
    ctx.quadraticCurveTo(0, -28.5 + i * 3.2, 4.5, -30 + i * 3.2);
    ctx.stroke();
  }
  blob(ctx, 0, -37, 4.8, 5.2, pal.body);
  ctx.fillStyle = '#12100c';
  ctx.fillRect(-3.4, -38.5, 2.4, 2.2);
  ctx.fillRect(1, -38.5, 2.4, 2.2);
  ctx.fillStyle = pal.eye;
  ctx.fillRect(-3.1, -38.2, 1.6, 1.6);
  ctx.fillRect(1.3, -38.2, 1.6, 1.6);
  // Sling, whirling faster as it prepares to loose.
  ctx.save();
  ctx.translate(7, -30);
  ctx.rotate(-1.1 + wind * 4.5);
  ctx.strokeStyle = rgba('#6b6152', 0.9); ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(13, 0); ctx.stroke();
  ctx.fillStyle = '#cfc6b2';
  ctx.beginPath(); ctx.arc(14, 0, 2.6, 0, TAU); ctx.fill();
  ctx.restore();
}

function drawRevenant(ctx, pal, walk, wind, f, t) {
  limb(ctx, -3.4, -19, -3.4 + walk * 3.6, 0, 5.4, pal.trim);
  limb(ctx, 3.4, -19, 3.4 - walk * 3.6, 0, 5.4, pal.trim);
  ctx.fillStyle = pal.body;
  ctx.beginPath();
  ctx.moveTo(-8, -18); ctx.lineTo(8, -18); ctx.lineTo(6.5, -35); ctx.lineTo(-6.5, -35);
  ctx.closePath(); ctx.fill();
  blob(ctx, 0, -40, 5.6, 6, pal.body);
  ctx.fillStyle = pal.eye;
  ctx.fillRect(-3.6, -41, 2.4, 2);
  ctx.fillRect(1.4, -41, 2.4, 2);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = rgba(pal.trim, 0.55 + wind * 0.4);
  for (const sh of [[-8, -34, 12], [8, -33, 10], [-5, -37, 8], [6, -38, 7]]) {
    ctx.beginPath();
    ctx.moveTo(sh[0] - 2, sh[1]); ctx.lineTo(sh[0], sh[1] - sh[2]); ctx.lineTo(sh[0] + 2, sh[1]);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  ctx.save();
  ctx.translate(8, -26);
  ctx.rotate(-0.3 - wind * 1.3);
  ctx.fillStyle = rgba(pal.trim, 0.95);
  ctx.beginPath();
  ctx.moveTo(0, -2.4); ctx.lineTo(20, -1); ctx.lineTo(24, 0); ctx.lineTo(20, 1); ctx.lineTo(0, 2.4);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawFiend(ctx, pal, walk, wind, f, t) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(0, -22, 2, 0, -22, 34);
  g.addColorStop(0, rgba('#ff7a2a', 0.32 + wind * 0.25));
  g.addColorStop(1, rgba('#ff7a2a', 0));
  ctx.fillStyle = g;
  ctx.fillRect(-34, -56, 68, 68);
  ctx.restore();
  limb(ctx, -3.4, -18, -3.4 + walk * 4.4, 0, 5, pal.body);
  limb(ctx, 3.4, -18, 3.4 - walk * 4.4, 0, 5, pal.body);
  ctx.fillStyle = pal.body;
  ctx.beginPath();
  ctx.moveTo(-7.5, -17); ctx.lineTo(7.5, -17); ctx.lineTo(6, -34); ctx.lineTo(-6, -34);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = rgba(pal.trim, 0.9); ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-4, -32); ctx.lineTo(1, -26); ctx.lineTo(-2, -22); ctx.lineTo(3, -18);
  ctx.stroke();
  blob(ctx, 0, -38, 5.4, 5.8, pal.body);
  ctx.fillStyle = pal.eye;
  ctx.fillRect(-3.4, -39.4, 2.4, 2);
  ctx.fillRect(1.2, -39.4, 2.4, 2);
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = rgba('#ffb257', 0.5);
    ctx.beginPath();
    ctx.arc(Math.sin(t * 3 + i * 2.1) * 9, -42 - ((t * 14 + i * 5) % 14), 1.4, 0, TAU);
    ctx.fill();
  }
}

function drawRootHorror(ctx, pal, walk, wind, f, t) {
  ctx.strokeStyle = shade(pal.body, -0.25); ctx.lineWidth = 4; ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * 5, -12);
    ctx.quadraticCurveTo(side * 13, -6 + walk * 2, side * 11, 1);
    ctx.stroke();
  }
  ctx.fillStyle = pal.body;
  ctx.beginPath();
  ctx.moveTo(-15, -8);
  ctx.quadraticCurveTo(-18, -34, 0, -44);
  ctx.quadraticCurveTo(18, -34, 15, -8);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = rgba('#000000', 0.28); ctx.lineWidth = 1.6;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(-13 + i * 3, -10);
    ctx.quadraticCurveTo(-8 + i * 5, -26, -4 + i * 6, -40);
    ctx.stroke();
  }
  for (let i = 0; i < 5; i++) {
    const a = t * 0.6 + i * 1.3;
    blob(ctx, Math.cos(a) * 12, -44 + Math.sin(a) * 4, 4.5, 3, rgba(pal.trim, 0.8));
  }
  ctx.fillStyle = pal.eye;
  ctx.fillRect(-6, -32, 3.4, 2.6);
  ctx.fillRect(2.6, -32, 3.4, 2.6);
  ctx.strokeStyle = shade(pal.body, -0.1); ctx.lineWidth = 5.5;
  ctx.beginPath();
  ctx.moveTo(13, -26);
  ctx.quadraticCurveTo(24 + wind * 8, -22, 26 + wind * 12, -8 - wind * 6);
  ctx.stroke();
}

function drawValkyr(ctx, pal, walk, wind, f, t) {
  const flap = Math.sin(t * 6) * 0.3;
  ctx.save();
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = pal.trim;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.scale(side, 1);
    ctx.beginPath();
    ctx.moveTo(4, -34);
    ctx.quadraticCurveTo(22, -46 - flap * 8, 30, -22);
    ctx.quadraticCurveTo(18, -28, 5, -22);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
  limb(ctx, -3, -20, -3 + walk * 3, -2, 4.4, pal.body);
  limb(ctx, 3, -20, 3 - walk * 3, -2, 4.4, pal.body);
  ctx.fillStyle = pal.body;
  ctx.beginPath();
  ctx.moveTo(-7, -19); ctx.lineTo(7, -19); ctx.lineTo(5.5, -36); ctx.lineTo(-5.5, -36);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = rgba(pal.trim, 0.9);
  ctx.fillRect(-7, -31, 14, 2.4);
  blob(ctx, 0, -41, 5.4, 5.8, pal.body);
  ctx.fillStyle = pal.trim;
  ctx.beginPath();
  ctx.moveTo(-6, -43); ctx.lineTo(-9, -50); ctx.lineTo(-3.5, -45);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(6, -43); ctx.lineTo(9, -50); ctx.lineTo(3.5, -45);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = pal.eye;
  ctx.fillRect(-3.4, -42.4, 2.4, 2);
  ctx.fillRect(1.2, -42.4, 2.4, 2);
  ctx.save();
  ctx.translate(8, -28);
  ctx.rotate(-0.5 - wind * 1.4);
  ctx.strokeStyle = '#5a4a35'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(20, 0); ctx.stroke();
  ctx.fillStyle = '#dfe6ee';
  ctx.beginPath();
  ctx.moveTo(19, -3.4); ctx.lineTo(29, 0); ctx.lineTo(19, 3.4);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawDormant(ctx, e, sx, sy, t, s) {
  // Ambushers read as terrain until they wake -- but never as *nothing*, so a
  // careful player still has a chance to notice something is off.
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(s, s);
  ctx.fillStyle = rgba('#2b3128', 0.92);
  ctx.beginPath();
  ctx.ellipse(0, -3, 13, 6.5, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = rgba('#3c4534', 0.9);
  ctx.beginPath();
  ctx.ellipse(-3, -5, 7, 3.4, 0.2, 0, TAU);
  ctx.fill();
  const pulse = 0.25 + Math.abs(Math.sin(t * 1.3 + e.seed * 5)) * 0.35;
  ctx.fillStyle = rgba(e.def.palette.eye, pulse);
  ctx.fillRect(-4, -6, 2, 1.2);
  ctx.fillRect(2, -6, 2, 1.2);
  ctx.restore();
}

function drawEnemyStatus(ctx, e, sx, sy, t) {
  const top = sy - 46 * (e.scale || 1);
  // Health only appears once it matters, so idle rooms stay uncluttered.
  if (e.hp < e.maxHp) {
    const w = 26, frac = Math.max(0, e.hp / e.maxHp);
    ctx.fillStyle = rgba('#000000', 0.6);
    ctx.fillRect(sx - w / 2 - 1, top - 1, w + 2, 5);
    ctx.fillStyle = e.elite ? '#e8b45c' : '#c2452f';
    ctx.fillRect(sx - w / 2, top, w * frac, 3);
  }
  if (e.alertPulse > 0) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, e.alertPulse);
    ctx.fillStyle = '#ffd27a';
    ctx.font = '700 15px "Trebuchet MS", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('!', sx, top - 6 - (1 - e.alertPulse) * 6);
    ctx.restore();
  }
  if (e.carriesKey !== undefined && e.carriesKey !== null) {
    const colours = ['#e05a3c', '#4d86d6', '#4fae62', '#d9a441'];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba(colours[e.carriesKey % 4], 0.5 + Math.sin(t * 4) * 0.2);
    ctx.beginPath();
    ctx.arc(sx, top - 10, 4.5, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = colours[e.carriesKey % 4];
    ctx.fillRect(sx - 1, top - 13, 2, 6);
    ctx.fillRect(sx - 1, top - 9, 4, 1.6);
  }
}

// --- bosses ---------------------------------------------------------------

export function drawBoss(ctx, b, t) {
  const sx = screenX(b.x, b.y);
  const sy = screenY(b.x, b.y);
  const s = b.scale || 2.1;
  const f = facingInfo(b.faceX, b.faceY);
  const hurt = b.hurtFlash > 0;
  const pal = {
    body: hurt ? mix(b.def.palette.body, '#ffffff', 0.6) : b.def.palette.body,
    trim: hurt ? mix(b.def.palette.trim, '#ffffff', 0.6) : b.def.palette.trim,
    eye: b.def.palette.eye,
  };
  const walk = Math.sin(b.animTime * 5.5);
  const wind = b.windup > 0 ? Math.min(1, b.windup) : 0;

  groundShadow(ctx, sx, sy + 2, 34 * s * 0.5, 16 * s * 0.5, 0.5);

  // Telegraph ring: bosses always announce the big attacks.
  if (b.telegraph > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(pal.trim, 0.28 + b.telegraph * 0.5);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(sx, sy, b.telegraphRadius * 32, b.telegraphRadius * 16, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.translate(sx, sy - Math.abs(walk) * 2);
  ctx.scale(f.flip * s, s);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const aura = ctx.createRadialGradient(0, -24, 2, 0, -24, 42);
  aura.addColorStop(0, rgba(pal.trim, 0.18 + wind * 0.26));
  aura.addColorStop(1, rgba(pal.trim, 0));
  ctx.fillStyle = aura;
  ctx.fillRect(-42, -66, 84, 84);
  ctx.restore();

  // Heavy, wide-shouldered build so the silhouette reads at a glance.
  const dark = shade(pal.body, -0.4);
  limb(ctx, -7, -22, -7 + walk * 4, 0, 10, dark);
  limb(ctx, 7, -22, 7 - walk * 4, 0, 10, dark);
  ctx.fillStyle = dark;
  ctx.fillRect(-11, -6, 9, 6);
  ctx.fillRect(2, -6, 9, 6);

  ctx.fillStyle = pal.body;
  ctx.beginPath();
  ctx.moveTo(-12, -20);
  ctx.lineTo(12, -20);
  ctx.lineTo(17, -44);
  ctx.lineTo(-17, -44);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = rgba('#000000', 0.45);
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // Belt and chest banding.
  ctx.fillStyle = rgba(pal.trim, 0.6);
  ctx.fillRect(-12.5, -26, 25, 4);
  ctx.fillStyle = rgba('#000000', 0.25);
  ctx.fillRect(-15, -38, 30, 2.4);

  // Pauldrons.
  for (const side of [-1, 1]) {
    ctx.fillStyle = shade(pal.body, 0.12);
    ctx.beginPath();
    ctx.ellipse(side * 17, -42, 8, 6, side * 0.4, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = rgba(pal.trim, 0.5);
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  // Head, set low between the shoulders.
  ctx.fillStyle = shade(pal.body, -0.2);
  ctx.beginPath();
  ctx.ellipse(0, -49, 7.5, 7, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = rgba('#000000', 0.5);
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = pal.eye;
  ctx.fillRect(-4.6, -51, 3.4, 2.6);
  ctx.fillRect(1.2, -51, 3.4, 2.6);
  ctx.restore();

  drawBossCrest(ctx, b.def.id, pal, t, wind);
  ctx.restore();
}

function drawBossCrest(ctx, id, pal, t, wind) {
  ctx.fillStyle = pal.trim;
  if (id === 'jarl_of_ash') {
    // Burning crown and a great axe.
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 4 - 2, -52);
      ctx.lineTo(i * 4, -62 - Math.abs(Math.sin(t * 6 + i)) * 4);
      ctx.lineTo(i * 4 + 2, -52);
      ctx.closePath();
      ctx.fill();
    }
    ctx.save();
    ctx.translate(15, -34);
    ctx.rotate(-0.35 - wind * 1.3);
    ctx.strokeStyle = '#3a2a20'; ctx.lineWidth = 3.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-4, 2); ctx.lineTo(17, -3); ctx.stroke();
    ctx.fillStyle = '#b9642f';
    ctx.beginPath();
    ctx.moveTo(13, -4); ctx.lineTo(23, -12); ctx.lineTo(26, 1); ctx.lineTo(15, 2.5);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = rgba('#000000', 0.4); ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  } else if (id === 'hrimthurs') {
    for (const sh of [[-11, -44, 20], [11, -44, 18], [-6, -50, 14], [7, -51, 12]]) {
      ctx.beginPath();
      ctx.moveTo(sh[0] - 3, sh[1]); ctx.lineTo(sh[0], sh[1] - sh[2]); ctx.lineTo(sh[0] + 3, sh[1]);
      ctx.closePath(); ctx.fill();
    }
    ctx.save();
    ctx.translate(14, -28);
    ctx.rotate(-0.3 - wind * 1.1);
    ctx.fillStyle = rgba(pal.trim, 0.95);
    ctx.beginPath();
    ctx.moveTo(0, -4); ctx.lineTo(30, -1.5); ctx.lineTo(36, 0); ctx.lineTo(30, 1.5); ctx.lineTo(0, 4);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  } else if (id === 'root_crowned') {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI - Math.PI;
      ctx.strokeStyle = pal.trim; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 7, -50);
      ctx.quadraticCurveTo(Math.cos(a) * 14, -60, Math.cos(a) * 11, -68 - Math.sin(t + i) * 3);
      ctx.stroke();
    }
    ctx.strokeStyle = shade(pal.body, -0.1); ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(12, -30);
    ctx.quadraticCurveTo(30 + wind * 12, -26, 34 + wind * 18, -8 - wind * 10);
    ctx.stroke();
  } else {
    // Nidhogg-Brood: horns, and a maw that opens as it winds up.
    ctx.beginPath();
    ctx.moveTo(-8, -50); ctx.quadraticCurveTo(-18, -60, -12, -68);
    ctx.quadraticCurveTo(-8, -60, -4, -52);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(8, -50); ctx.quadraticCurveTo(18, -60, 12, -68);
    ctx.quadraticCurveTo(8, -60, 4, -52);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = rgba('#12060e', 0.95);
    ctx.beginPath();
    ctx.ellipse(0, -42, 5, 2 + wind * 4, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = rgba(pal.trim, 0.9);
    ctx.save();
    ctx.translate(15, -30);
    ctx.rotate(-0.4 - wind * 1.3);
    ctx.beginPath();
    ctx.moveTo(0, -5); ctx.lineTo(28, -2); ctx.lineTo(34, 0); ctx.lineTo(28, 2); ctx.lineTo(0, 5);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}
