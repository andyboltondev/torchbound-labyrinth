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
    case 'prisoner': drawPrisoner(ctx, sx, sy, t, prop); break;
    case 'mapScrap': drawMapScrap(ctx, sx, sy, t, prop); break;
    default: break;
  }
}

// Somebody chained to the wall. Four states, and the whole point is that you
// can tell which one you are looking at before you are close enough to act:
// a slumped body, someone who lifts their head, someone reaching for you, and
// something that has stopped being a someone.
function drawPrisoner(ctx, sx, sy, t, prop) {
  const r = prop.seed;
  const dead = prop.mood === 'dead' || prop.freed;
  const raving = prop.mood === 'raving';
  const begging = prop.mood === 'begging';
  const breathe = dead ? 0 : Math.sin(t * (raving ? 5.2 : 1.5) + r * 9) * (raving ? 2.2 : 0.9);
  const slump = dead ? 12 : begging ? 5 : 2;

  pedestalShadow(ctx, sx, sy, 11);

  // The chains, from the wall behind down to the wrists. Drawn first so the
  // body hangs in front of them.
  ctx.strokeStyle = rgba('#6b6459', 0.85);
  ctx.lineWidth = 1.7;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(sx + side * 9, sy - 40);
    ctx.quadraticCurveTo(sx + side * 11, sy - 30 + breathe * 0.4, sx + side * 7, sy - 24 + slump);
    ctx.stroke();
  }

  const skin = dead ? '#8c8378' : raving ? '#c9a184' : '#b5967c';
  const cloth = dead ? '#3d3a34' : '#4a4239';
  const headY = sy - 30 + slump + breathe * 0.5;

  // Legs, folded under.
  ctx.strokeStyle = rgba(cloth, 0.95);
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(sx - 2, sy - 14 + slump * 0.6);
  ctx.lineTo(sx - 6, sy - 2);
  ctx.moveTo(sx + 2, sy - 14 + slump * 0.6);
  ctx.lineTo(sx + 6, sy - 3);
  ctx.stroke();

  // Torso.
  ctx.fillStyle = cloth;
  ctx.beginPath();
  ctx.moveTo(sx - 5, sy - 13 + slump * 0.6);
  ctx.lineTo(sx + 5, sy - 13 + slump * 0.6);
  ctx.lineTo(sx + 4.5, headY + 5);
  ctx.lineTo(sx - 4.5, headY + 5);
  ctx.closePath();
  ctx.fill();

  // Arms, up to the wrists the chains hold.
  ctx.strokeStyle = rgba(skin, 0.95);
  ctx.lineWidth = 3.4;
  for (const side of [-1, 1]) {
    const reachOut = raving ? 3.5 : begging ? 2 : 0;
    ctx.beginPath();
    ctx.moveTo(sx + side * 4, headY + 6);
    ctx.lineTo(sx + side * (7 + reachOut), sy - 24 + slump);
    ctx.stroke();
  }

  // Head. Dead ones hang forward; raving ones are thrown back.
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(sx + (dead ? 2.5 : 0), headY, 4.8, 5.2, dead ? 0.6 : raving ? -0.4 : 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = rgba('#241d19', 0.75);
  if (dead) {
    ctx.fillRect(sx - 1, headY - 1, 5, 1.6);
  } else if (raving) {
    // An open mouth, which is all a scream needs to be at this size.
    ctx.beginPath();
    ctx.ellipse(sx + 1, headY + 2, 1.4, 2 + Math.abs(breathe) * 0.4, 0, 0, TAU);
    ctx.fill();
    ctx.fillRect(sx - 2.4, headY - 1.4, 5, 1.2);
  } else {
    ctx.fillRect(sx - 2.4, headY - 1, 5, 1.2);
  }

  // Something to catch the eye of a player who has not learned the shapes yet.
  if (!dead && !prop.spoken) {
    const pulse = 0.4 + Math.sin(t * 2.4 + r * 7) * 0.25;
    ctx.fillStyle = rgba(raving ? '#e05a3c' : begging ? '#c9b9d8' : '#8fb7ff', pulse);
    ctx.beginPath();
    ctx.arc(sx, headY - 12, 1.8, 0, TAU);
    ctx.fill();
  }
}

// A map. Somebody drew it, and did not get to use it.
function drawMapScrap(ctx, sx, sy, t, prop) {
  const bob = Math.sin(t * 1.6 + prop.x) * 1.2;
  pedestalShadow(ctx, sx, sy, 8);
  ctx.save();
  ctx.translate(sx, sy - 5 + bob);
  ctx.rotate(-0.22);
  ctx.fillStyle = '#cbbb92';
  ctx.beginPath();
  ctx.moveTo(-7, -5); ctx.lineTo(7, -6); ctx.lineTo(8, 5); ctx.lineTo(-6, 6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = rgba('#000000', 0.16);
  ctx.beginPath();
  ctx.moveTo(-7, -5); ctx.lineTo(-6, 6); ctx.lineTo(-3, 5); ctx.lineTo(-4, -5);
  ctx.closePath();
  ctx.fill();
  // Lines on it. Not a real map, just enough marks to read as one.
  ctx.strokeStyle = rgba('#5a4a30', 0.8);
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(-4, -2); ctx.lineTo(1, -2); ctx.lineTo(1, 2); ctx.lineTo(5, 2);
  ctx.moveTo(-2, 4); ctx.lineTo(-2, -3);
  ctx.stroke();
  ctx.fillStyle = rgba('#a03a2a', 0.85);
  ctx.beginPath();
  ctx.arc(5, 2, 1.4, 0, TAU);
  ctx.fill();
  ctx.restore();
  // A glimmer, so it is findable in a room full of debris.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = rgba('#e8d9a8', 0.1 + Math.sin(t * 2.1 + prop.y) * 0.05);
  ctx.beginPath();
  ctx.ellipse(sx, sy - 5, 13, 7, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
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
    case 'debris': {
      // Chips of fallen masonry. The commonest thing on the floor, and the
      // main reason a corridor no longer reads as a clean grey ramp.
      ctx.fillStyle = rgba('#4c4740', 0.85);
      for (let i = 0; i < 5; i++) {
        const a = r * 30 + i * 1.7;
        const dx = Math.cos(a) * 7, dy = Math.sin(a) * 3.4;
        ctx.beginPath();
        ctx.moveTo(sx + dx, sy + dy - 1.6);
        ctx.lineTo(sx + dx + 2.4, sy + dy);
        ctx.lineTo(sx + dx - 1.4, sy + dy + 1.2);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'skull':
      ctx.fillStyle = rgba('#000000', 0.3);
      ctx.beginPath();
      ctx.ellipse(sx, sy, 5, 2.4, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#cabfa4';
      ctx.beginPath();
      ctx.ellipse(sx, sy - 3, 4.2, 3.6, r * 2, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#2a241d';
      ctx.beginPath();
      ctx.ellipse(sx - 1.6, sy - 3.4, 1.1, 1.3, 0, 0, TAU);
      ctx.ellipse(sx + 1.6, sy - 3.4, 1.1, 1.3, 0, 0, TAU);
      ctx.fill();
      break;
    case 'crate':
      ctx.fillStyle = rgba('#000000', 0.32);
      ctx.beginPath();
      ctx.ellipse(sx, sy, 10, 4.4, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#5b452c';
      ctx.fillRect(sx - 8, sy - 15, 16, 15);
      ctx.fillStyle = rgba('#000000', 0.28);
      ctx.fillRect(sx - 8, sy - 15, 16, 2);
      ctx.strokeStyle = rgba('#3a2c1c', 0.9);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(sx - 8, sy - 8); ctx.lineTo(sx + 8, sy - 8);
      ctx.moveTo(sx - 8, sy - 15); ctx.lineTo(sx + 8, sy);
      ctx.stroke();
      break;
    case 'chain': {
      // Hanging from somewhere above, swinging just enough to be alive.
      const swing = Math.sin(t * 0.9 + r * 8) * 2.2;
      ctx.strokeStyle = rgba('#5f5a52', 0.85);
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(sx, sy - 40);
      ctx.quadraticCurveTo(sx + swing, sy - 24, sx + swing * 1.4, sy - 10);
      ctx.stroke();
      ctx.fillStyle = rgba('#6b6459', 0.9);
      for (let i = 0; i < 4; i++) {
        const k = i / 4;
        ctx.beginPath();
        ctx.ellipse(sx + swing * (0.4 + k), sy - 34 + i * 7, 2, 2.8, 0, 0, TAU);
        ctx.fill();
      }
      break;
    }
    case 'cobweb': {
      // Strung into the corner it was generated for, so the radials always
      // have two walls to be anchored to.
      const wx = d.wallX || 1, wy = d.wallY || 1;
      const ax = screenX(d.x - wx * 0.5, d.y), ay = screenY(d.x - wx * 0.5, d.y) - 22;
      const bx = screenX(d.x, d.y - wy * 0.5), by = screenY(d.x, d.y - wy * 0.5) - 22;
      ctx.strokeStyle = rgba('#cfd6df', 0.22 + Math.sin(t * 0.7 + r * 9) * 0.03);
      ctx.lineWidth = 0.9;
      const cx = (ax + bx) / 2, cy = (ay + by) / 2;
      for (let i = 0; i <= 4; i++) {
        const k = i / 4;
        ctx.beginPath();
        ctx.moveTo(sx, sy - 26);
        ctx.lineTo(ax + (bx - ax) * k, ay + (by - ay) * k);
        ctx.stroke();
      }
      for (let ring = 1; ring <= 3; ring++) {
        const k = ring / 3.4;
        ctx.beginPath();
        ctx.moveTo(sx + (ax - sx) * k, sy - 26 + (ay - (sy - 26)) * k);
        ctx.quadraticCurveTo(sx + (cx - sx) * k * 1.15, sy - 26 + (cy - (sy - 26)) * k * 1.15,
          sx + (bx - sx) * k, sy - 26 + (by - (sy - 26)) * k);
        ctx.stroke();
      }
      break;
    }
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

// Every fire in the labyrinth, from a wall sconce to a hall-sized campfire.
// A cold one is drawn as the same object without the flame, so the player can
// see at a glance which of them is worth walking over to light.
export function drawSconce(ctx, s, t) {
  const sx = screenX(s.x, s.y);
  const phase = t + s.seed * 10;
  switch (s.kind) {
    case 'brazier': drawBrazier(ctx, sx, screenY(s.x, s.y), phase, s); break;
    case 'firepit': drawFirepit(ctx, sx, screenY(s.x, s.y), phase, s); break;
    case 'campfire': drawCampfire(ctx, sx, screenY(s.x, s.y), phase, s); break;
    default: drawWallSconce(ctx, sx, screenY(s.x, s.y) - 26, phase, s); break;
  }
}

function drawWallSconce(ctx, sx, sy, phase, s) {
  ctx.fillStyle = '#3a352e';
  ctx.fillRect(sx - 2, sy, 4, 10);
  ctx.fillStyle = '#4e483e';
  ctx.beginPath();
  ctx.ellipse(sx, sy, 5, 2.6, 0, 0, TAU);
  ctx.fill();
  if (s.lit === false) { coldMark(ctx, sx, sy - 3, 0.7); return; }
  drawFlame(ctx, sx, sy - 4, 0.62, phase, flicker(phase));
}

function drawBrazier(ctx, sx, sy, phase, s) {
  pedestalShadow(ctx, sx, sy, 13);
  ctx.strokeStyle = '#4a4238';
  ctx.lineWidth = 2.4;
  for (const ox of [-7, 0, 7]) {
    ctx.beginPath();
    ctx.moveTo(sx + ox * 0.55, sy - 12);
    ctx.lineTo(sx + ox, sy - 1);
    ctx.stroke();
  }
  ctx.fillStyle = '#5b5145';
  ctx.beginPath();
  ctx.ellipse(sx, sy - 14, 9, 4.4, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#2a241d';
  ctx.beginPath();
  ctx.ellipse(sx, sy - 15, 7, 3.2, 0, 0, TAU);
  ctx.fill();
  if (s.lit === false) { coals(ctx, sx, sy - 15, 6, 0); coldMark(ctx, sx, sy - 22, 0.9); return; }
  coals(ctx, sx, sy - 15, 6, 1);
  drawFlame(ctx, sx, sy - 17, 1.05, phase, flicker(phase));
}

function drawFirepit(ctx, sx, sy, phase, s) {
  pedestalShadow(ctx, sx, sy, 19);
  // A ring of stones, drawn as an ellipse of blocks so it sits on the floor.
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU + s.seed * 3;
    const rx = sx + Math.cos(a) * 15, ry = sy + Math.sin(a) * 7.5;
    ctx.fillStyle = i % 2 ? '#57503f' : '#6a6250';
    ctx.beginPath();
    ctx.ellipse(rx, ry - 2, 4.2, 3.2, a * 0.3, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = '#20190f';
  ctx.beginPath();
  ctx.ellipse(sx, sy - 1, 10, 5, 0, 0, TAU);
  ctx.fill();
  if (s.lit === false) { coals(ctx, sx, sy - 2, 8, 0); coldMark(ctx, sx, sy - 12, 1); return; }
  coals(ctx, sx, sy - 2, 8, 1);
  drawFlame(ctx, sx, sy - 5, 1.5, phase, flicker(phase));
  drawFlame(ctx, sx - 5, sy - 2, 0.85, phase * 1.17 + 2, flicker(phase * 1.17));
  drawFlame(ctx, sx + 5, sy - 3, 0.9, phase * 0.91 + 4, flicker(phase * 0.91));
}

function drawCampfire(ctx, sx, sy, phase, s) {
  drawFirepit(ctx, sx, sy, phase, s);
  // Logs leaned into the middle. Drawn over the pit so the fire is inside it.
  ctx.strokeStyle = '#4a3826';
  ctx.lineCap = 'round';
  ctx.lineWidth = 4;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + s.seed * 5 + 0.4;
    ctx.beginPath();
    ctx.moveTo(sx + Math.cos(a) * 12, sy + Math.sin(a) * 6 - 1);
    ctx.lineTo(sx + Math.cos(a) * 3, sy - 11);
    ctx.stroke();
  }
  if (s.lit === false) return;
  drawFlame(ctx, sx, sy - 10, 1.35, phase + 1.3, flicker(phase + 1.3));
}

// Layered sines, the same shape the torch uses, so every flame in the level
// breathes rather than strobing -- and no two are ever in step.
function flicker(phase) {
  return 1 + Math.sin(phase * 11.3) * 0.05 + Math.sin(phase * 6.7 + 1.3) * 0.07
    + Math.sin(phase * 3.1 + 0.7) * 0.08;
}

function coals(ctx, sx, sy, spread, heat) {
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + i;
    const cx = sx + Math.cos(a) * spread * 0.6;
    const cy = sy + Math.sin(a) * spread * 0.3;
    ctx.fillStyle = heat
      ? rgba(i % 2 ? '#ff7a2a' : '#ffbe5c', 0.55 + (i % 3) * 0.15)
      : rgba('#3a332b', 0.9);
    ctx.beginPath();
    ctx.ellipse(cx, cy, 2.4, 1.5, 0, 0, TAU);
    ctx.fill();
  }
}

// The mark on a cold fire: a thin curl of nothing, so an unlit brazier does
// not read as a lit one drawn badly.
function coldMark(ctx, sx, sy, scale) {
  ctx.strokeStyle = rgba('#8fa0b8', 0.32);
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.quadraticCurveTo(sx + 3 * scale, sy - 5 * scale, sx - 1 * scale, sy - 10 * scale);
  ctx.stroke();
}
