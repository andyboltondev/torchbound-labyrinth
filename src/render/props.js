// Gates, pickups, interactables and scenery.
//
// The gate routine is the important one: every part of a door (posts, lintel,
// bars, lock, runes, glow and its shadow) is built from the same span vector,
// so a door always sits across the corridor it blocks no matter which way that
// corridor runs (design rules 4 and 5).

import { screenX, screenY, HALF_W, HALF_H } from './iso.js';
import { rgba, shade, mix } from './palette.js';
import { keyColour } from '../gen/tiles.js';
import { drawFlame } from './actors.js';

const TAU = Math.PI * 2;
const GATE_H = 46;

// The screen-space vector along which a door panel lies.
function spanVector(passage) {
  return passage === 'x'
    ? { x: -HALF_W, y: HALF_H }   // corridor runs east-west, panel spans north-south
    : { x: HALF_W, y: HALF_H };   // corridor runs north-south, panel spans east-west
}

export function drawGate(ctx, gate, t) {
  const cx = screenX(gate.x + 0.5, gate.y + 0.5);
  const cy = screenY(gate.x + 0.5, gate.y + 0.5);
  const span = spanVector(gate.passage);
  const col = keyColour(gate.colourIndex);
  const open = gate.openAmount || 0;
  const pulse = 0.6 + Math.sin(t * 2.2) * 0.2;

  const ax = cx - span.x * 0.5, ay = cy - span.y * 0.5;
  const bx = cx + span.x * 0.5, by = cy + span.y * 0.5;

  // A pool of coloured light on the threshold: a locked gate has to be
  // findable from across a dark room.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const pool = ctx.createRadialGradient(cx, cy, 0, cx, cy, 46);
  pool.addColorStop(0, rgba(col.hex, (0.26 - open * 0.18) * pulse));
  pool.addColorStop(1, rgba(col.hex, 0));
  ctx.fillStyle = pool;
  ctx.fillRect(cx - 46, cy - 30, 92, 60);
  ctx.restore();

  // Shadow follows the same span, so it never looks pasted on.
  ctx.fillStyle = rgba('#000000', 0.4);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.lineTo(bx + 7, by + 4);
  ctx.lineTo(ax + 7, ay + 4);
  ctx.closePath();
  ctx.fill();

  const post = (px, py) => {
    ctx.fillStyle = '#33302b';
    ctx.fillRect(px - 6, py - GATE_H - 2, 12, GATE_H + 2);
    ctx.fillStyle = '#565049';
    ctx.fillRect(px - 6, py - GATE_H - 2, 4.5, GATE_H + 2);
    ctx.fillStyle = '#211e1a';
    ctx.fillRect(px - 7, py - GATE_H - 6, 14, 5);
    ctx.fillStyle = rgba('#000000', 0.5);
    for (let i = 0; i < 3; i++) ctx.fillRect(px - 7, py - 12 - i * 16, 14, 3.4);
    ctx.fillStyle = rgba(col.hex, 0.55 * pulse);
    ctx.fillRect(px - 7, py - GATE_H - 7, 14, 2);
  };

  // Lintel across the top, following the span.
  ctx.fillStyle = '#3a3630';
  ctx.beginPath();
  ctx.moveTo(ax - 6, ay - GATE_H);
  ctx.lineTo(bx + 6, by - GATE_H);
  ctx.lineTo(bx + 6, by - GATE_H + 10);
  ctx.lineTo(ax - 6, ay - GATE_H + 10);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = rgba(col.hex, 0.65 * pulse);
  ctx.beginPath();
  ctx.moveTo(ax - 6, ay - GATE_H);
  ctx.lineTo(bx + 6, by - GATE_H);
  ctx.lineTo(bx + 6, by - GATE_H + 2.6);
  ctx.lineTo(ax - 6, ay - GATE_H + 2.6);
  ctx.closePath();
  ctx.fill();

  // Bars retract up into the lintel as the gate opens.
  const bars = 5;
  const lift = open * (GATE_H - 10);
  for (let i = 1; i <= bars; i++) {
    const f = i / (bars + 1);
    const px = ax + (bx - ax) * f;
    const py = ay + (by - ay) * f;
    const topY = py - GATE_H + 8;
    const botY = py - lift;
    if (botY <= topY) continue;
    ctx.strokeStyle = '#8b877e';
    ctx.lineWidth = 4;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(px, topY);
    ctx.lineTo(px, botY);
    ctx.stroke();
    ctx.strokeStyle = rgba('#c8c3b8', 0.55);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(px - 1.3, topY);
    ctx.lineTo(px - 1.3, botY);
    ctx.stroke();
    // Spiked feet, so a closed gate looks unwelcoming.
    if (open < 0.2) {
      ctx.fillStyle = '#8b877e';
      ctx.beginPath();
      ctx.moveTo(px - 2.6, botY - 3);
      ctx.lineTo(px, botY + 3);
      ctx.lineTo(px + 2.6, botY - 3);
      ctx.closePath();
      ctx.fill();
    }
  }

  post(ax, ay);
  post(bx, by);

  // Lock plate, centred on the panel, carrying the colour and its rune.
  if (open < 0.9) {
    const lx = cx, ly = cy - 26 - lift * 0.35;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, 34);
    g.addColorStop(0, rgba(col.glow, 0.55 * pulse * (1 - open)));
    g.addColorStop(1, rgba(col.glow, 0));
    ctx.fillStyle = g;
    ctx.fillRect(lx - 34, ly - 34, 68, 68);
    ctx.restore();

    ctx.fillStyle = '#26231f';
    ctx.beginPath();
    ctx.moveTo(lx - 11, ly - 13);
    ctx.lineTo(lx + 11, ly - 13);
    ctx.lineTo(lx + 11, ly + 9);
    ctx.lineTo(lx, ly + 15);
    ctx.lineTo(lx - 11, ly + 9);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = col.hex;
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.strokeStyle = rgba(col.glow, 0.5 + pulse * 0.5);
    ctx.lineWidth = 2;
    drawRune(ctx, lx, ly - 1, col.rune, 6.5);
  }
}

// Simple angular rune glyphs -- enough to differentiate colours by shape.
export function drawRune(ctx, x, y, name, size = 7) {
  const s = size;
  ctx.beginPath();
  switch (name) {
    case 'fehu':
      ctx.moveTo(x - s * 0.4, y - s); ctx.lineTo(x - s * 0.4, y + s);
      ctx.moveTo(x - s * 0.4, y - s * 0.7); ctx.lineTo(x + s * 0.6, y - s * 1.1);
      ctx.moveTo(x - s * 0.4, y - s * 0.1); ctx.lineTo(x + s * 0.6, y - s * 0.5);
      break;
    case 'isa':
      ctx.moveTo(x, y - s); ctx.lineTo(x, y + s);
      ctx.moveTo(x - s * 0.5, y - s); ctx.lineTo(x + s * 0.5, y - s);
      ctx.moveTo(x - s * 0.5, y + s); ctx.lineTo(x + s * 0.5, y + s);
      break;
    case 'berkano':
      ctx.moveTo(x - s * 0.5, y - s); ctx.lineTo(x - s * 0.5, y + s);
      ctx.moveTo(x - s * 0.5, y - s); ctx.lineTo(x + s * 0.5, y - s * 0.4);
      ctx.lineTo(x - s * 0.5, y); ctx.lineTo(x + s * 0.5, y + s * 0.5);
      ctx.lineTo(x - s * 0.5, y + s);
      break;
    default: // sowilo
      ctx.moveTo(x + s * 0.5, y - s); ctx.lineTo(x - s * 0.4, y - s * 0.2);
      ctx.lineTo(x + s * 0.4, y + s * 0.2); ctx.lineTo(x - s * 0.5, y + s);
      break;
  }
  ctx.stroke();
}

// --- pickups and interactables -------------------------------------------

export function drawKeyItem(ctx, key, t) {
  const col = keyColour(key.colourIndex);
  const sx = screenX(key.x + 0.5, key.y + 0.5);
  const bob = Math.sin(t * 2.4 + key.colourIndex) * 3;
  const sy = screenY(key.x + 0.5, key.y + 0.5) - 16 - bob;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 30);
  g.addColorStop(0, rgba(col.glow, 0.4));
  g.addColorStop(1, rgba(col.glow, 0));
  ctx.fillStyle = g;
  ctx.fillRect(sx - 30, sy - 30, 60, 60);
  // Ground pool so the key reads even at the edge of torchlight.
  ctx.fillStyle = rgba(col.hex, 0.14);
  ctx.beginPath();
  ctx.ellipse(sx, sy + 16 + bob, 20, 10, 0, 0, TAU);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(Math.sin(t * 1.3) * 0.18);
  ctx.strokeStyle = col.hex;
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, -5, 4.5, 0, TAU);
  ctx.moveTo(0, -0.5);
  ctx.lineTo(0, 9);
  ctx.moveTo(0, 4);
  ctx.lineTo(4.5, 4);
  ctx.moveTo(0, 7.5);
  ctx.lineTo(3.4, 7.5);
  ctx.stroke();
  ctx.restore();
}

export function drawProp(ctx, prop, t) {
  const sx = screenX(prop.x, prop.y);
  const sy = screenY(prop.x, prop.y);
  switch (prop.type) {
    case 'chest': case 'cursedChest': drawChest(ctx, sx, sy, t, prop); break;
    case 'shrine': case 'shrineSmall': drawShrine(ctx, sx, sy, t, prop); break;
    case 'potion': drawPotion(ctx, sx, sy, t); break;
    case 'arrows': drawArrows(ctx, sx, sy, t); break;
    case 'crossbow': drawCrossbowPickup(ctx, sx, sy, t); break;
    case 'treasure': drawTreasure(ctx, sx, sy, t); break;
    case 'ladder': drawLadder(ctx, sx, sy, t, prop); break;
    default: break;
  }
}

function pedestalShadow(ctx, sx, sy, r = 15) {
  ctx.fillStyle = rgba('#000000', 0.4);
  ctx.beginPath();
  ctx.ellipse(sx, sy + 1, r, r * 0.48, 0, 0, TAU);
  ctx.fill();
}

function drawChest(ctx, sx, sy, t, prop) {
  const cursed = prop.type === 'cursedChest';
  pedestalShadow(ctx, sx, sy, 16);
  const lid = prop.opened ? 0.9 : 0;
  const wood = cursed ? '#3a2b3d' : '#5b4128';
  const iron = cursed ? '#9a6ab0' : '#8a7346';

  ctx.fillStyle = shade(wood, -0.18);
  ctx.beginPath();
  ctx.moveTo(sx - 16, sy - 6); ctx.lineTo(sx, sy + 2); ctx.lineTo(sx + 16, sy - 6);
  ctx.lineTo(sx + 16, sy - 18); ctx.lineTo(sx, sy - 10); ctx.lineTo(sx - 16, sy - 18);
  ctx.closePath();
  ctx.fill();

  ctx.save();
  ctx.translate(sx, sy - 18);
  ctx.rotate(-lid * 0.9);
  ctx.fillStyle = shade(wood, 0.1);
  ctx.beginPath();
  ctx.moveTo(-16, 0); ctx.lineTo(0, 8); ctx.lineTo(16, 0); ctx.lineTo(0, -8);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = iron;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-8, 4); ctx.lineTo(8, -4);
  ctx.stroke();
  ctx.restore();

  if (!prop.opened) {
    ctx.fillStyle = iron;
    ctx.fillRect(sx - 2.5, sy - 16, 5, 6);
  }
  if (cursed) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(sx, sy - 14, 0, sx, sy - 14, 30);
    g.addColorStop(0, rgba('#b06ad8', 0.3 + Math.sin(t * 3) * 0.16));
    g.addColorStop(1, rgba('#b06ad8', 0));
    ctx.fillStyle = g;
    ctx.fillRect(sx - 30, sy - 44, 60, 60);
    ctx.restore();
  }
}

function drawShrine(ctx, sx, sy, t, prop) {
  const small = prop.type === 'shrineSmall';
  const s = small ? 0.72 : 1;
  const heal = prop.flavour === 'heal' || small;
  pedestalShadow(ctx, sx, sy, 15 * s);
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(s, s);
  ctx.fillStyle = '#4d4a44';
  ctx.beginPath();
  ctx.moveTo(-13, -4); ctx.lineTo(0, 3); ctx.lineTo(13, -4); ctx.lineTo(0, -11);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#3f3c37';
  ctx.fillRect(-7, -30, 14, 24);
  ctx.fillStyle = '#59554d';
  ctx.fillRect(-7, -30, 5, 24);
  ctx.strokeStyle = rgba(prop.used ? '#5a5a5a' : (heal ? '#6fce87' : '#8fb7ff'), 0.85);
  ctx.lineWidth = 1.6;
  drawRune(ctx, 0, -20, heal ? 'berkano' : 'sowilo', 5.5);
  ctx.restore();
  if (!prop.used) drawFlame(ctx, sx, sy - 34 * s, 0.72 * s, t + prop.x, 1);
}

function drawPotion(ctx, sx, sy, t) {
  const bob = Math.sin(t * 2.6 + sx * 0.02) * 2;
  pedestalShadow(ctx, sx, sy, 8);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(sx, sy - 10, 0, sx, sy - 10, 20);
  g.addColorStop(0, rgba('#ff6a5a', 0.22));
  g.addColorStop(1, rgba('#ff6a5a', 0));
  ctx.fillStyle = g;
  ctx.fillRect(sx - 20, sy - 30, 40, 40);
  ctx.restore();
  ctx.save();
  ctx.translate(sx, sy - 10 - bob);
  ctx.fillStyle = rgba('#c2452f', 0.92);
  ctx.beginPath();
  ctx.ellipse(0, 0, 5, 6.5, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#d9cdb4';
  ctx.fillRect(-2, -11, 4, 5);
  ctx.fillStyle = rgba('#ffffff', 0.35);
  ctx.beginPath();
  ctx.ellipse(-1.8, -1.5, 1.3, 2.4, 0.4, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawArrows(ctx, sx, sy, t) {
  pedestalShadow(ctx, sx, sy, 10);
  ctx.save();
  ctx.translate(sx, sy - 4);
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.rotate(-0.5 + i * 0.34);
    ctx.strokeStyle = '#7a6a52';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-9, 2); ctx.lineTo(9, -6);
    ctx.stroke();
    ctx.fillStyle = '#c9ced6';
    ctx.beginPath();
    ctx.moveTo(9, -6); ctx.lineTo(14, -8); ctx.lineTo(9.5, -3.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#9a8f6f';
    ctx.beginPath();
    ctx.moveTo(-9, 2); ctx.lineTo(-13, 0); ctx.lineTo(-9, 4.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function drawCrossbowPickup(ctx, sx, sy, t) {
  pedestalShadow(ctx, sx, sy, 15);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(sx, sy - 12, 0, sx, sy - 12, 40);
  g.addColorStop(0, rgba('#e8b45c', 0.34 + Math.sin(t * 2.2) * 0.14));
  g.addColorStop(1, rgba('#e8b45c', 0));
  ctx.fillStyle = g;
  ctx.fillRect(sx - 40, sy - 52, 80, 80);
  ctx.restore();
  ctx.save();
  ctx.translate(sx, sy - 12 - Math.sin(t * 2) * 2);
  ctx.rotate(-0.22);
  ctx.fillStyle = '#5b4128';
  ctx.fillRect(-13, -2.4, 26, 5);
  ctx.strokeStyle = '#8f959c';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(9, -11); ctx.lineTo(9, 11);
  ctx.stroke();
  ctx.strokeStyle = rgba('#e6dcc6', 0.85);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(9, -11); ctx.lineTo(1, 0); ctx.lineTo(9, 11);
  ctx.stroke();
  ctx.restore();
}

function drawTreasure(ctx, sx, sy, t) {
  pedestalShadow(ctx, sx, sy, 13);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(sx, sy - 4, 0, sx, sy - 4, 26);
  g.addColorStop(0, rgba('#e8b45c', 0.3));
  g.addColorStop(1, rgba('#e8b45c', 0));
  ctx.fillStyle = g;
  ctx.fillRect(sx - 26, sy - 30, 52, 52);
  ctx.restore();
  for (let i = 0; i < 9; i++) {
    ctx.fillStyle = i % 3 === 0 ? '#f0d089' : '#d9a441';
    ctx.beginPath();
    ctx.ellipse(sx + Math.cos(i * 2.1) * (8 - i * 0.5), sy - 2 - (i % 3) * 2.4, 4, 2, 0, 0, TAU);
    ctx.fill();
  }
}

function drawLadder(ctx, sx, sy, t, prop) {
  const down = prop.dir === 'down';
  const glow = 0.3 + Math.sin(t * 1.8 + prop.x) * 0.1;

  // The shaft: a dark opening cut into the floor, sunk below the tile.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(sx, sy - HALF_H * 0.8);
  ctx.lineTo(sx + HALF_W * 0.8, sy);
  ctx.lineTo(sx, sy + HALF_H * 0.8);
  ctx.lineTo(sx - HALF_W * 0.8, sy);
  ctx.closePath();
  ctx.fillStyle = '#05070b';
  ctx.fill();
  ctx.strokeStyle = rgba('#8a7a5c', 0.55);
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.clip();
  // Rails and rungs receding into the dark.
  for (let i = 0; i < 5; i++) {
    const k = i / 5;
    const w = 11 * (1 - k * 0.45);
    const y = sy - 4 + i * 5;
    ctx.strokeStyle = rgba('#6b5636', 0.85 - k * 0.6);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx - w, y);
    ctx.lineTo(sx + w, y);
    ctx.stroke();
  }
  ctx.strokeStyle = rgba('#7d6540', 0.8);
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(sx - 11, sy - 6); ctx.lineTo(sx - 6, sy + 20);
  ctx.moveTo(sx + 11, sy - 6); ctx.lineTo(sx + 6, sy + 20);
  ctx.stroke();
  ctx.restore();

  // A ladder head standing proud of the floor, so it is spottable as an
  // object rather than as a dark patch of ground.
  ctx.save();
  ctx.strokeStyle = '#8a6f45';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(sx - 9, sy - 2); ctx.lineTo(sx - 9, sy - 17);
  ctx.moveTo(sx + 9, sy - 2); ctx.lineTo(sx + 9, sy - 17);
  ctx.stroke();
  ctx.lineWidth = 2.2;
  for (let i = 0; i < 3; i++) {
    const y = sy - 5 - i * 5;
    ctx.beginPath();
    ctx.moveTo(sx - 9, y); ctx.lineTo(sx + 9, y);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(sx, sy - 6, 0, sx, sy - 6, 34);
  g.addColorStop(0, rgba(down ? '#e8b45c' : '#8fd7ff', glow));
  g.addColorStop(1, rgba(down ? '#e8b45c' : '#8fd7ff', 0));
  ctx.fillStyle = g;
  ctx.fillRect(sx - 34, sy - 40, 68, 68);
  ctx.restore();
}

// --- scenery --------------------------------------------------------------

export function drawDecor(ctx, d, t) {
  const sx = screenX(d.x, d.y);
  const sy = screenY(d.x, d.y);
  const r = d.seed;
  switch (d.type) {
    case 'bones':
      ctx.strokeStyle = rgba('#b8ae95', 0.75);
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const a = r * 6 + i * 2;
        ctx.beginPath();
        ctx.moveTo(sx - Math.cos(a) * 6, sy - Math.sin(a) * 3);
        ctx.lineTo(sx + Math.cos(a) * 6, sy + Math.sin(a) * 3);
        ctx.stroke();
      }
      break;
    case 'urn':
      ctx.fillStyle = '#6b5a45';
      ctx.beginPath();
      ctx.ellipse(sx, sy - 6, 5, 7, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = rgba('#000000', 0.3);
      ctx.fillRect(sx - 3, sy - 13, 6, 2.4);
      break;
    case 'rubble':
      ctx.fillStyle = rgba('#57534a', 0.9);
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.ellipse(sx + (r * 37 % 9) - 4 + i * 3, sy - (i % 2) * 3, 4 - i * 0.5, 2.4, 0, 0, TAU);
        ctx.fill();
      }
      break;
    case 'banner':
      ctx.fillStyle = rgba('#7a2f2a', 0.9);
      ctx.beginPath();
      ctx.moveTo(sx - 5, sy - 34);
      ctx.lineTo(sx + 5, sy - 34);
      ctx.lineTo(sx + 5, sy - 8 + Math.sin(t * 1.6 + r * 6) * 1.5);
      ctx.lineTo(sx, sy - 12);
      ctx.lineTo(sx - 5, sy - 8 + Math.cos(t * 1.4 + r * 6) * 1.5);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = rgba('#e8b45c', 0.6);
      ctx.lineWidth = 1.2;
      drawRune(ctx, sx, sy - 24, 'fehu', 4);
      break;
    case 'statue':
      ctx.fillStyle = rgba('#000000', 0.35);
      ctx.beginPath();
      ctx.ellipse(sx, sy, 11, 5, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#615c53';
      ctx.fillRect(sx - 8, sy - 8, 16, 8);
      ctx.fillRect(sx - 5, sy - 30, 10, 24);
      ctx.beginPath();
      ctx.arc(sx, sy - 33, 5, 0, TAU);
      ctx.fill();
      ctx.fillStyle = rgba('#000000', 0.35);
      ctx.fillRect(sx - 5, sy - 20, 10, 2);
      break;
    default: // grass / growth
      ctx.strokeStyle = rgba('#6f9447', 0.7);
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 4; i++) {
        const off = (i - 1.5) * 3;
        const sway = Math.sin(t * 1.4 + r * 8 + i) * 1.6;
        ctx.beginPath();
        ctx.moveTo(sx + off, sy);
        ctx.quadraticCurveTo(sx + off + sway, sy - 5, sx + off + sway * 1.6, sy - 9);
        ctx.stroke();
      }
  }
}

export function drawSconce(ctx, s, t) {
  const sx = screenX(s.x, s.y);
  const sy = screenY(s.x, s.y) - 26;
  ctx.fillStyle = '#3a352e';
  ctx.fillRect(sx - 2, sy, 4, 10);
  ctx.fillStyle = '#4e483e';
  ctx.beginPath();
  ctx.ellipse(sx, sy, 5, 2.6, 0, 0, TAU);
  ctx.fill();
  drawFlame(ctx, sx, sy - 4, 0.62, t + s.seed * 10, 1);
}
