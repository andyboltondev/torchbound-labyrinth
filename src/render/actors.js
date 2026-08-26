// Character rendering. Everything is drawn immediate-mode from vector shapes
// so animation is continuous (no sprite-sheet stepping) and every enemy can
// have a genuinely different silhouette without an art pipeline.

import { screenX, screenY } from './iso.js';
import { rgba, shade, mix } from './palette.js';

const TAU = Math.PI * 2;

// Where the light is standing, in screen space. The renderer sets it to the
// player's torch each frame, which is the only light strong enough to throw a
// shadow anybody would notice.
const shadowLight = { x: 0, y: -1e6, soft: true };

export function setShadowLight(x, y, soft = true) {
  shadowLight.x = x;
  shadowLight.y = y;
  shadowLight.soft = soft;
}

// A blob shadow that leans away from the torch and lengthens with distance
// from it, which is most of what sells a hand-held light source.
export function groundShadow(ctx, sx, sy, rx, ry, alpha = 0.42) {
  const dx = sx - shadowLight.x;
  const dy = (sy - shadowLight.y) * 1.6;      // the view is squashed vertically
  const d = Math.hypot(dx, dy) || 1;
  const reach = Math.min(1, d / 300);
  const ox = (dx / d) * rx * 0.5 * reach;
  const oy = (dy / d) * ry * 0.5 * reach;
  const stretch = 1 + reach * 0.55;
  const a = alpha * (1 - reach * 0.4);
  const angle = Math.atan2(dy / 1.6, dx);

  ctx.save();
  ctx.translate(sx + ox, sy + oy);
  ctx.rotate(angle);
  ctx.scale(stretch, ry / rx);
  if (shadowLight.soft) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, rgba('#000000', a));
    g.addColorStop(0.6, rgba('#000000', a * 0.42));
    g.addColorStop(1, rgba('#000000', 0));
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = rgba('#000000', a * 0.5);
  }
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, TAU);
  ctx.fill();
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
// A torchbearer: mail under a tunic, a cloak, a sword in the lead hand and
// the flame in the other.
//
// The figure is built from vector shapes rather than a sprite sheet, and that
// is what lets it carry three continuous signals at once without any stepping
// between frames: which of the eight dungeon directions it is walking, what
// its hands are doing, and how close it is to dying.

// Mail is thousands of identical rings. Drawn once into a pattern and stamped
// after that, so the texture costs one fill rather than a few hundred arcs.
let mailPattern = null;
function mailTexture(ctx) {
  if (mailPattern) return mailPattern;
  const c = document.createElement('canvas');
  c.width = 6; c.height = 6;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(226,236,247,0.42)';
  g.lineWidth = 0.9;
  for (const [x, y] of [[1.5, 1.5], [4.5, 4.5]]) {
    g.beginPath();
    g.arc(x, y, 1.35, 0, TAU);
    g.stroke();
  }
  g.strokeStyle = 'rgba(0,0,0,0.3)';
  for (const [x, y] of [[4.5, 1.5], [1.5, 4.5]]) {
    g.beginPath();
    g.arc(x, y, 1.35, 0, TAU);
    g.stroke();
  }
  mailPattern = ctx.createPattern(c, 'repeat');
  return mailPattern;
}

// Where the wounds start showing, and where they take over. Half health is
// early enough that the figure is telling you before the meter is urgent.
const WOUND_START = 0.5;
const DYING_BELOW = 0.22;

export function drawPlayer(ctx, p, t, opts = {}) {
  // Knockback is a render-space shove, so it reads as impact without pushing
  // the character off its movement lane.
  const px = p.x + (p.knockX || 0), py = p.y + (p.knockY || 0);
  const sx = screenX(px, py);
  const sy = screenY(px, py);
  const f = facingInfo(p.faceX, p.faceY);

  // Two numbers describe the turn. `frontal` is how square-on the figure is:
  // 0 is a pure side view, 1 is looking straight at the camera or straight
  // away from it, and the shoulders widen across that range. `f.y` says which
  // of those two it is.
  const frontal = 1 - Math.min(1, Math.abs(f.x));
  const back = f.y < -0.18;

  const hpFrac = p.maxHp > 0 ? clamp01(p.hp / p.maxHp) : 1;
  const wounded = clamp01((WOUND_START - hpFrac) / WOUND_START);
  const dying = clamp01((DYING_BELOW - hpFrac) / DYING_BELOW);

  // A wounded stride is slower, shorter and lopsided: the body drops onto the
  // bad leg every other step, which is what a limp looks like from outside.
  const gait = 11 - wounded * 2.6;
  const phase = p.animTime * gait;
  const walk = p.moving ? Math.sin(phase) : 0;
  const limp = p.moving ? Math.max(0, Math.sin(phase)) * wounded * 2.4 : 0;
  const breath = Math.sin(t * (2.1 + wounded * 3.6)) * (0.9 + wounded * 1.7);
  const bob = (p.moving ? Math.abs(Math.sin(phase)) * 2.2 : breath) - limp;
  // Close to death the whole figure sways as though the floor were moving.
  const sway = dying > 0 ? Math.sin(t * 1.7) * Math.sin(t * 0.9 + 1.2) * dying * 0.085 : 0;

  const hurt = p.hurtFlash > 0;
  const paleSkin = mix('#c8a180', '#a2968d', wounded * 0.55);
  const skin = hurt ? mix(paleSkin, '#ff7a66', 0.45) : paleSkin;
  const cloth = hurt ? '#c05a4a' : mix('#4a5568', '#39404c', wounded * 0.5);
  const leather = hurt ? '#a8523f' : mix('#5c4632', '#453425', wounded * 0.4);
  const metal = hurt ? '#c98b7a' : mix('#9aa3ad', '#71787f', wounded * 0.5);
  const gold = '#d9a441';
  const cloakCol = hurt ? '#8e3b30' : mix('#3a2f3d', '#2a2229', wounded * 0.5);
  const blood = '#5e1a18';

  groundShadow(ctx, sx, sy + 1, 15, 7, 0.45);

  ctx.save();
  ctx.translate(sx, sy - bob);
  if (sway) ctx.rotate(sway);
  ctx.scale(f.flip, 1);

  // A hurt torchbearer hunches: the head drops, the shoulders come forward
  // over the wound, and the stance closes up.
  const hunch = wounded * 3.4;
  const lean = wounded * 2.2;
  const hipY = -19 + hunch * 0.3;
  const headY = -42 + hunch;
  const shoulderY = headY + 9.5;
  const halfW = 6.1 * (0.82 + frontal * 0.36);

  const cfg = {
    p, t, walk, hipY, headY, shoulderY, halfW, lean, skin, metal, gold,
    leather, cloth, wounded, dying, back, frontal,
  };

  drawCloak(ctx, cfg, cloakCol);
  drawLegs(ctx, cfg, leather);
  // Facing away puts both arms on the far side of the body, so they go behind
  // the torso; facing the camera puts them in front of it. That single change
  // of order is most of what makes the two directions read differently.
  if (back) drawPlayerArms(ctx, p, t, cfg);
  drawTorso(ctx, cfg, cloth, blood);
  drawHead(ctx, cfg, skin);
  if (!back) drawPlayerArms(ctx, p, t, cfg);
  ctx.restore();

  drawPlayerAuras(ctx, p, t, sx, sy, opts);
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// The cloak reads the turn more than anything else does: seen from behind it
// is nearly the whole silhouette, seen side-on it is a trailing edge.
function drawCloak(ctx, cfg, colour) {
  const { walk, hipY, headY, halfW, back, frontal, p, wounded } = cfg;
  const drift = walk * 2.2 + (p.moving ? 2.6 : 0);
  const w = halfW + 2.6 + (back ? 2.6 : 0);
  const hem = w * 0.82;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-w + 1, headY + 5);
  ctx.quadraticCurveTo(-w - 7 - drift, hipY, -hem - 2 - drift * 1.4, -4);
  ctx.lineTo(hem - 1, -4);
  ctx.quadraticCurveTo(w + 3, hipY, w - 1, headY + 5);
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
  // Seen from behind there is a centre seam and a fold either side of it,
  // which is the difference between a cloak and a flat grey shape.
  if (back || frontal > 0.5) {
    ctx.strokeStyle = rgba('#000000', 0.3);
    ctx.lineWidth = 1;
    for (const ox of [-w * 0.42, 0, w * 0.42]) {
      ctx.beginPath();
      ctx.moveTo(ox * 0.5, headY + 7);
      ctx.quadraticCurveTo(ox, hipY, ox * 1.1 - drift * 0.5, -4.5);
      ctx.stroke();
    }
  }
  // The hem tears as the run goes badly.
  if (wounded > 0.35) {
    ctx.fillStyle = rgba('#000000', 0.55);
    const notches = Math.round(1 + wounded * 3);
    for (let i = 0; i < notches; i++) {
      const ox = -hem + 1 + ((i + 0.5) / notches) * (hem * 2 - 2) - drift * 0.4;
      ctx.beginPath();
      ctx.moveTo(ox - 1.6, -4);
      ctx.lineTo(ox, -4 - 2.4 - wounded * 2.4);
      ctx.lineTo(ox + 1.6, -4);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();

  // Fur collar, over the shoulders, drawn after the cloak body so it sits on
  // top of the seams.
  const fur = mix(colour, '#6d6154', 0.7);
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(0, headY + 6.4, halfW + 1.8, 2.7, 0, 0, TAU);
  ctx.fill();
  // A few tufts, so the mantle has a texture rather than an outline.
  ctx.strokeStyle = rgba(shade(fur, 0.25), 0.6);
  ctx.lineWidth = 0.8;
  for (let i = -3; i <= 3; i++) {
    const ox = (i / 3) * (halfW + 1.2);
    ctx.beginPath();
    ctx.moveTo(ox, headY + 5.2);
    ctx.lineTo(ox + (i % 2 ? 0.9 : -0.9), headY + 8.4);
    ctx.stroke();
  }
}

function drawLegs(ctx, cfg, leather) {
  const { walk, hipY, halfW, wounded } = cfg;
  const stride = 4 - wounded * 1.1;
  // The wounded leg swings less and lands flatter.
  const bad = 1 - wounded * 0.55;
  const spread = Math.max(2.8, halfW * 0.5);
  const boot = shade(leather, -0.34);

  const leg = (baseX, swing, tone) => {
    const footX = baseX + swing;
    limb(ctx, baseX, hipY, footX, -2.5, 4.6, tone);
    // Boot: a wedge at the ankle, so the feet are not bare stubs.
    ctx.fillStyle = boot;
    ctx.beginPath();
    ctx.moveTo(footX - 2.6, -3.4);
    ctx.lineTo(footX + 3.4, -3.4);
    ctx.lineTo(footX + 3.8, -0.4);
    ctx.lineTo(footX - 2.8, -0.4);
    ctx.closePath();
    ctx.fill();
  };
  leg(-spread, walk * stride * bad, leather);
  leg(spread, -walk * stride, shade(leather, -0.12));
}

function drawTorso(ctx, cfg, cloth, blood) {
  const { hipY, headY, halfW, lean, wounded, p } = cfg;
  const topW = halfW * 0.94;
  const topY = headY + 7;

  ctx.beginPath();
  ctx.moveTo(-halfW, hipY + 2);
  ctx.lineTo(halfW, hipY + 2);
  ctx.lineTo(topW + lean, topY);
  ctx.lineTo(-topW + lean, topY);
  ctx.closePath();
  ctx.fillStyle = cloth;
  ctx.fill();

  // Mail across the chest, clipped to the torso so the rings never spill.
  ctx.save();
  ctx.clip();
  ctx.fillStyle = mailTexture(ctx);
  ctx.fillRect(-halfW - 1, topY, halfW * 2 + 2, 11);
  // A warm edge on the side the torch is on. Cheap rim light, and it is the
  // clearest signal that the figure is lit by something it is carrying.
  const rim = ctx.createLinearGradient(-halfW, 0, halfW * 0.4, 0);
  rim.addColorStop(0, rgba('#ffb567', 0.3));
  rim.addColorStop(1, rgba('#ffb567', 0));
  ctx.fillStyle = rim;
  ctx.fillRect(-halfW - 1, topY, halfW * 2 + 2, hipY + 2 - topY);
  // Blood soaks through from the shoulder down as the run goes badly.
  if (wounded > 0) {
    ctx.fillStyle = rgba(blood, 0.35 + wounded * 0.45);
    ctx.beginPath();
    ctx.ellipse(halfW * 0.35, topY + 7, 3.4 + wounded * 2.6, 5 + wounded * 4, 0.4, 0, TAU);
    ctx.fill();
    if (wounded > 0.55) {
      ctx.beginPath();
      ctx.ellipse(-halfW * 0.45, hipY - 4, 2.6 + wounded * 2, 3.4 + wounded * 3, -0.3, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();

  // A short tunic below the belt. Without it the legs start at the waist and
  // the figure reads as a torso balanced on two sticks.
  ctx.fillStyle = shade(cloth, -0.16);
  ctx.beginPath();
  ctx.moveTo(-halfW, hipY - 1);
  ctx.lineTo(halfW, hipY - 1);
  ctx.lineTo(halfW * 1.06, hipY + 6);
  ctx.lineTo(-halfW * 1.06, hipY + 6);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = rgba('#000000', 0.25);
  ctx.lineWidth = 0.8;
  for (const ox of [-halfW * 0.42, halfW * 0.42]) {
    ctx.beginPath();
    ctx.moveTo(ox, hipY - 1);
    ctx.lineTo(ox * 1.06, hipY + 6);
    ctx.stroke();
  }

  // Shoulder straps and belt.
  ctx.strokeStyle = rgba('#2b2018', 0.85);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-topW * 0.6 + lean, topY + 1);
  ctx.lineTo(halfW * 0.5, hipY - 1);
  ctx.stroke();
  ctx.fillStyle = cfg.gold;
  ctx.fillRect(-halfW, hipY - 2, halfW * 2, 2.6);
  ctx.fillStyle = shade(cfg.gold, -0.35);
  ctx.fillRect(-1.6, hipY - 2.6, 3.2, 3.8);

  // Pauldrons. Two scales of plate at each shoulder: the single clearest cue
  // that this is armour and not a jerkin, and they read at any size.
  const shoulderTop = topY + 0.5;
  for (const side of [-1, 1]) {
    for (let i = 0; i < 2; i++) {
      ctx.fillStyle = shade(cfg.metal, i ? -0.24 : -0.08);
      ctx.beginPath();
      ctx.ellipse(side * (halfW * 0.86 + lean * 0.3), shoulderTop + i * 2.4,
        halfW * 0.5, 2.3 - i * 0.4, side * 0.22, Math.PI, TAU);
      ctx.fill();
    }
  }
  // Held breath: the chest lifts a little more, a little faster, when hurt.
  if (wounded > 0.2 && !p.moving) {
    ctx.fillStyle = rgba('#000000', 0.12 * wounded);
    ctx.fillRect(-halfW, topY + 9, halfW * 2, 1.2);
  }
}

// The helm is the same from every angle; what changes is whether there is a
// face inside it. Seen from behind you get the neck guard instead, which is
// how the eye tells at a glance which way the torchbearer is walking.
function drawHead(ctx, cfg, skin) {
  const { headY, lean, metal, gold, back, frontal, wounded, dying, t } = cfg;
  const hx = lean * 0.6;
  const width = 6.1 * (0.94 + frontal * 0.12);

  ctx.save();
  ctx.translate(hx, 0);

  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(0, headY, width, 6.3, 0, 0, TAU);
  ctx.fill();

  if (!back) {
    // Beard, then the shadow the helm brow casts over the eyes.
    ctx.fillStyle = mix('#6b4a2c', '#8a7a6a', wounded * 0.4);
    ctx.beginPath();
    ctx.moveTo(-width * 0.5, headY + 1.6);
    ctx.quadraticCurveTo(0, headY + 9.4, width * 0.72, headY + 1.4);
    ctx.quadraticCurveTo(width * 0.4, headY + 4.6, -width * 0.5, headY + 1.6);
    ctx.fill();
    ctx.fillStyle = rgba('#000000', 0.34);
    ctx.fillRect(-width, headY - 1.2, width * 2, 2.6);
  }

  // Helm: dome, brow band, cheek guards, and a nasal bar on the seen side.
  ctx.fillStyle = metal;
  ctx.beginPath();
  ctx.arc(0, headY - 1, width + 0.3, Math.PI, TAU);
  ctx.fill();
  ctx.fillRect(-width - 0.3, headY - 1.4, (width + 0.3) * 2, 2.4);
  ctx.fillStyle = shade(metal, -0.28);
  ctx.beginPath();
  ctx.moveTo(-width - 0.3, headY + 1);
  ctx.lineTo(-width * 0.52, headY + 1);
  ctx.lineTo(-width * 0.68, headY + 4.4);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(width + 0.3, headY + 1);
  ctx.lineTo(width * 0.52, headY + 1);
  ctx.lineTo(width * 0.68, headY + 4.4);
  ctx.closePath();
  ctx.fill();

  if (back) {
    // Neck guard: overlapping plates down the back of the skull.
    ctx.fillStyle = shade(metal, -0.18);
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(-width * 0.7, headY + 1.4 + i * 2, width * 1.4, 2.4);
      ctx.strokeStyle = rgba('#000000', 0.4);
      ctx.lineWidth = 0.7;
      ctx.strokeRect(-width * 0.7, headY + 1.4 + i * 2, width * 1.4, 2.4);
    }
  } else {
    ctx.fillStyle = shade(metal, -0.4);
    ctx.fillRect(1.1, headY - 1, 1.8, 5.6);
    // The eye. It narrows to a slit as the run runs out.
    const openness = 1.5 - dying * 0.9;
    ctx.fillStyle = dying > 0.5 ? '#3a2420' : '#241d19';
    ctx.fillRect(3.3, headY + 1.3, 2, openness);
    if (dying > 0.35 && Math.sin(t * 3.1) > 0.55) {
      ctx.fillStyle = skin;
      ctx.fillRect(3.1, headY + 1.1, 2.4, 2);
    }
  }
  ctx.fillStyle = gold;
  ctx.fillRect(-width - 0.3, headY - 2.6, (width + 0.3) * 2, 1.4);
  ctx.restore();
}

// Flashes and rings that sit outside the figure entirely: they are in screen
// space, unaffected by the flip, and must not be clipped by anything.
function drawPlayerAuras(ctx, p, t, sx, sy, opts) {
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
  const { walk, headY, shoulderY, halfW, skin, metal, gold, leather, wounded, dying } = cfg;
  const reach = halfW * 0.82;

  // Off hand: the torch. Always readable, always the light source, and held
  // lower and less steadily the worse things are going.
  const droop = wounded * 0.34;
  const tremor = dying > 0 ? Math.sin(t * 21) * dying * 0.06 : 0;
  const torchAngle = -0.55 + droop + tremor + Math.sin(t * 2.3) * 0.05 + walk * 0.12;
  const tx = -reach - 3 + Math.cos(torchAngle) * -6;
  const ty = shoulderY + 1 + Math.sin(torchAngle) * 6 + wounded * 2;
  limb(ctx, -reach, shoulderY, tx, ty, 4.4, skin);
  // Bracer at the wrist.
  ctx.save();
  ctx.translate(tx, ty);
  ctx.rotate(-0.35);
  ctx.fillStyle = shade(leather, -0.25);
  ctx.fillRect(-2.6, -2.6, 5.2, 4);
  ctx.fillStyle = leather;
  ctx.fillRect(-2, -14, 4, 16);
  ctx.fillStyle = rgba('#000000', 0.35);
  ctx.fillRect(-2, -14, 1.4, 16);
  ctx.fillStyle = gold;
  ctx.fillRect(-2.6, -3, 5.2, 2);
  drawFlame(ctx, 0, -16, 1, t, p.torchFlicker || 1);
  ctx.restore();

  // Sword hand: rests at the hip, swings on attack. A wounded arm hangs.
  const atk = p.attack;
  let angle = 0.35 + droop * 1.3 + walk * 0.18;
  let extend = 8 - wounded * 1.4;
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

  const hx = reach + Math.cos(angle) * extend * 0.55;
  const hy = shoulderY + 4 + Math.sin(angle) * extend * 0.55;
  limb(ctx, reach, shoulderY, hx, hy, 4.4, skin);

  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(angle);
  ctx.fillStyle = shade(leather, -0.25);
  ctx.fillRect(-3.4, -2.4, 4.4, 4.8);
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
    // Sword: grip, guard, fuller and a pommel.
    ctx.fillStyle = shade(leather, -0.2);
    ctx.fillRect(-5, -1.8, 7, 3.6);
    ctx.fillStyle = shade(gold, -0.25);
    ctx.beginPath();
    ctx.arc(-5.4, 0, 2, 0, TAU);
    ctx.fill();
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
    ctx.fillStyle = rgba('#ffffff', 0.5);
    ctx.fillRect(4, -2.2, 19, 0.6);
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
      ctx.translate(reach, shoulderY + 4);
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
  // Nearly gone: the shoulders drop and a hand comes up to the wound.
  if (dying > 0.4 && !atk) {
    ctx.fillStyle = rgba('#000000', 0.2);
    ctx.beginPath();
    ctx.ellipse(0, headY + 12, halfW * 0.8, 2.4, 0, 0, TAU);
    ctx.fill();
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
