// Procedurally baked tile art.
//
// Everything is drawn once into offscreen canvases at load time, in three
// versions: the lit sprite, a black silhouette used to darken it by distance,
// and a cold blue silhouette used for remembered-but-unlit terrain. Two
// drawImage calls per tile then cover the whole lighting model cheaply.

import { TILE_W, TILE_H, WALL_H } from './iso.js';
import { shade, mix, rgba, seeded } from './palette.js';

const FLOOR_H = TILE_H;
const WALL_CANVAS_H = TILE_H + WALL_H;
export const VARIANTS = 6;

function bake(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  return c;
}

function silhouette(src, colour) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

function diamond(ctx, cx, cy, w = TILE_W, h = TILE_H) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - h / 2);
  ctx.lineTo(cx + w / 2, cy);
  ctx.lineTo(cx, cy + h / 2);
  ctx.lineTo(cx - w / 2, cy);
  ctx.closePath();
}

// A random point inside the tile diamond, so speckles never spill over the edge.
function pointInDiamond(rnd, cx, cy, inset = 0.86) {
  let u = rnd() * 2 - 1, v = rnd() * 2 - 1;
  if (Math.abs(u) + Math.abs(v) > 1) { u = -Math.sign(u) * (1 - Math.abs(u)); v = -Math.sign(v) * (1 - Math.abs(v)); }
  return { x: cx + u * (TILE_W / 2) * inset, y: cy + v * (TILE_H / 2) * inset };
}

// --- shared texture helpers -----------------------------------------------

// Fine grain, applied inside whatever path is currently clipped. This is what
// keeps surfaces from reading as flat vector shapes.
function grain(ctx, w, h, rnd, amount = 0.05, count = 90) {
  for (let i = 0; i < count; i++) {
    const x = rnd() * w, y = rnd() * h;
    const light = rnd() > 0.5;
    ctx.fillStyle = light
      ? `rgba(255,252,244,${(amount * rnd()).toFixed(3)})`
      : `rgba(0,0,0,${(amount * 1.3 * rnd()).toFixed(3)})`;
    ctx.fillRect(x, y, rnd() > 0.86 ? 2 : 1, 1);
  }
}

// One stone: body, a lit bevel along the top and left, a shadowed one along
// the bottom and right, and a chipped corner or two.
function stone(ctx, x, y, w, h, colour, rnd, bevel = 1.4) {
  ctx.fillStyle = colour;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,250,238,0.14)';
  ctx.fillRect(x, y, w, bevel);
  ctx.fillRect(x, y, bevel, h);
  ctx.fillStyle = 'rgba(0,0,0,0.26)';
  ctx.fillRect(x, y + h - bevel, w, bevel);
  ctx.fillRect(x + w - bevel, y, bevel, h);
  if (rnd() > 0.62) {
    // Knocked-off corner: small, but it stops the blocks looking stamped.
    const cw = 2 + rnd() * 3;
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    if (rnd() > 0.5) ctx.fillRect(x + w - cw, y, cw, cw);
    else ctx.fillRect(x, y + h - cw, cw, cw);
  }
}

// Staggered courses of masonry filling a rectangle in local space.
function masonry(ctx, w, h, base, rnd, courses = 3) {
  const mortar = shade(base, -0.42);
  ctx.fillStyle = mortar;
  ctx.fillRect(0, 0, w, h);
  const ch = h / courses;
  for (let row = 0; row < courses; row++) {
    const y = row * ch + 0.8;
    const bh = ch - 1.6;
    let x = -((row % 2) * (w * 0.28)) - rnd() * 4;
    while (x < w) {
      const bw = w * (0.3 + rnd() * 0.26);
      const tone = (rnd() - 0.5) * 0.2;
      stone(ctx, x + 0.8, y, bw - 1.6, bh, shade(base, tone), rnd);
      x += bw;
    }
  }
}

// --- floor ----------------------------------------------------------------

function drawFloor(ctx, biome, variant) {
  const rnd = seeded(variant * 7919 + biome.id.length * 104729 + biome.floor.length);
  const cx = TILE_W / 2, cy = FLOOR_H / 2;
  const base = biome.floor[variant % biome.floor.length];

  diamond(ctx, cx, cy);
  ctx.save();
  ctx.clip();

  // Mortar bed, then flagstones laid across it in isometric space.
  ctx.fillStyle = shade(base, -0.4);
  ctx.fillRect(0, 0, TILE_W, FLOOR_H);

  const slabs = 2 + Math.floor(rnd() * 2);
  ctx.save();
  // Skew into the floor plane so the flagstone joints run with the grid.
  ctx.transform(1, 0.5, -1, 0.5, TILE_W / 2, 0);
  const span = TILE_W / 2;
  const step = span / slabs;
  for (let i = 0; i < slabs; i++) {
    for (let j = 0; j < slabs; j++) {
      const tone = (rnd() - 0.5) * 0.14;
      stone(ctx, i * step + 0.7, j * step + 0.7, step - 1.4, step - 1.4,
        shade(base, tone), rnd, 1.2);
    }
  }
  ctx.restore();

  grain(ctx, TILE_W, FLOOR_H, rnd, 0.055, 110);

  // Wear: a crack or two wandering across the joints.
  if (rnd() > 0.4) {
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    ctx.beginPath();
    let p = pointInDiamond(rnd, cx, cy, 0.9);
    ctx.moveTo(p.x, p.y);
    for (let i = 0; i < 3; i++) {
      p = { x: p.x + (rnd() - 0.5) * 20, y: p.y + (rnd() - 0.5) * 10 };
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }
  drawBiomeFloorDetail(ctx, biome, rnd, cx, cy);
  ctx.restore();

  // A soft seam rather than a hard outline: enough to read the grid, not
  // enough to look like graph paper.
  diamond(ctx, cx, cy);
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawBiomeFloorDetail(ctx, biome, rnd, cx, cy) {
  switch (biome.id) {
    case 'crypt':
      for (let i = 0; i < 4; i++) {
        const p = pointInDiamond(rnd, cx, cy, 0.75);
        ctx.fillStyle = rgba('#dff2ff', 0.05 + rnd() * 0.1);
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, 3 + rnd() * 7, 1.5 + rnd() * 3, rnd() * 3, 0, 7);
        ctx.fill();
      }
      break;
    case 'tomb':
      for (let i = 0; i < 5; i++) {
        if (rnd() > 0.6) continue;
        const p = pointInDiamond(rnd, cx, cy, 0.78);
        ctx.fillStyle = rgba('#6f9447', 0.12 + rnd() * 0.16);
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, 4 + rnd() * 8, 2 + rnd() * 3.5, rnd() * 3, 0, 7);
        ctx.fill();
      }
      break;
    case 'embers':
      if (rnd() > 0.55) {
        ctx.strokeStyle = rgba('#ff7a3a', 0.22 + rnd() * 0.2);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        let p = pointInDiamond(rnd, cx, cy, 0.8);
        ctx.moveTo(p.x, p.y);
        for (let i = 0; i < 3; i++) {
          p = { x: p.x + (rnd() - 0.5) * 16, y: p.y + (rnd() - 0.5) * 8 };
          ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }
      break;
    case 'rainruins':
      for (let i = 0; i < 3; i++) {
        const p = pointInDiamond(rnd, cx, cy, 0.7);
        ctx.fillStyle = rgba('#9fc8d8', 0.06 + rnd() * 0.07);
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, 5 + rnd() * 9, 2.5 + rnd() * 3, 0, 0, 7);
        ctx.fill();
      }
      break;
    default:
      if (rnd() > 0.82) {
        ctx.strokeStyle = rgba(biome.accent, 0.2);
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(cx, cy, 7 + rnd() * 4, 0, 7);
        ctx.stroke();
      }
  }
}

// --- walls ----------------------------------------------------------------

const TOP_CY = TILE_H / 2;
const BASE_Y = TILE_H + WALL_H;

function wallFaces(ctx) {
  return {
    left: () => {
      ctx.beginPath();
      ctx.moveTo(0, TOP_CY);
      ctx.lineTo(TILE_W / 2, TILE_H);
      ctx.lineTo(TILE_W / 2, TILE_H + WALL_H);
      ctx.lineTo(0, TOP_CY + WALL_H);
      ctx.closePath();
    },
    right: () => {
      ctx.beginPath();
      ctx.moveTo(TILE_W / 2, TILE_H);
      ctx.lineTo(TILE_W, TOP_CY);
      ctx.lineTo(TILE_W, TOP_CY + WALL_H);
      ctx.lineTo(TILE_W / 2, TILE_H + WALL_H);
      ctx.closePath();
    },
  };
}

function drawWall(ctx, biome, variant, cracked) {
  const rnd = seeded(variant * 6151 + biome.id.length * 33203 + (cracked ? 991 : 7));
  const faces = wallFaces(ctx);

  // Each side is drawn as real masonry: the face is clipped, then the drawing
  // space is skewed into the isometric plane so courses run with the wall
  // rather than being painted flat across it.
  const sides = [
    { key: 'left', base: biome.wallLeft, skew: [1, 0.5, 0, 1, 0, TOP_CY] },
    { key: 'right', base: biome.wallRight, skew: [1, -0.5, 0, 1, TILE_W / 2, TILE_H] },
  ];
  for (const side of sides) {
    ctx.save();
    faces[side.key]();
    ctx.clip();
    ctx.save();
    ctx.transform(side.skew[0], side.skew[1], side.skew[2], side.skew[3], side.skew[4], side.skew[5]);
    masonry(ctx, TILE_W / 2, WALL_H + TILE_H / 2, side.base, rnd, 3);
    ctx.restore();

    // Ambient occlusion toward the floor, and a little bounce light at the top.
    const down = ctx.createLinearGradient(0, TOP_CY, 0, BASE_Y);
    down.addColorStop(0, rgba('#ffffff', 0.05));
    down.addColorStop(0.45, rgba('#000000', 0));
    down.addColorStop(1, rgba('#000000', 0.46));
    ctx.fillStyle = down;
    ctx.fillRect(0, 0, TILE_W, BASE_Y);
    grain(ctx, TILE_W, BASE_Y, rnd, 0.045, 70);
    drawBiomeWallDetail(ctx, biome, rnd, side.key, side.base);
    ctx.restore();
  }

  // Cap.
  diamond(ctx, TILE_W / 2, TOP_CY);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = biome.wallTop;
  ctx.fillRect(0, 0, TILE_W, TILE_H);
  ctx.save();
  ctx.transform(1, 0.5, -1, 0.5, TILE_W / 2, 0);
  const capSpan = TILE_W / 2;
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      stone(ctx, i * capSpan / 2 + 0.7, j * capSpan / 2 + 0.7,
        capSpan / 2 - 1.4, capSpan / 2 - 1.4,
        shade(biome.wallTop, (rnd() - 0.5) * 0.18), rnd, 1.2);
    }
  }
  ctx.restore();
  grain(ctx, TILE_W, TILE_H, rnd, 0.06, 60);
  ctx.restore();

  // Silhouette: a firm dark seam under the cap plus a catch-light along the
  // two upper edges. This is the deliberate stylised touch -- it keeps the
  // blocks reading as solid objects in near-darkness.
  diamond(ctx, TILE_W / 2, TOP_CY);
  ctx.strokeStyle = rgba('#000000', 0.5);
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.strokeStyle = rgba('#ffffff', 0.2);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, TOP_CY);
  ctx.lineTo(TILE_W / 2, 0);
  ctx.lineTo(TILE_W, TOP_CY);
  ctx.stroke();
  // The vertical corner where the two faces meet.
  ctx.strokeStyle = rgba('#000000', 0.34);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(TILE_W / 2, TILE_H);
  ctx.lineTo(TILE_W / 2, BASE_Y);
  ctx.stroke();

  // Carved rune band -- the Norse signature, used sparingly.
  if (!cracked && rnd() > 0.74) {
    ctx.save();
    faces.right();
    ctx.clip();
    ctx.strokeStyle = rgba(biome.accent, 0.5);
    ctx.lineWidth = 1.7;
    const bx = TILE_W * 0.62, by = TOP_CY + 14;
    for (let i = 0; i < 3; i++) {
      const ox = bx + i * 7, oy = by + i * 3.5;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ox, oy + 9);
      if (rnd() > 0.5) { ctx.moveTo(ox, oy + 2); ctx.lineTo(ox + 4, oy + 6); }
      else { ctx.moveTo(ox, oy + 6); ctx.lineTo(ox + 4, oy + 2); }
      ctx.stroke();
    }
    ctx.restore();
  }

  if (cracked) drawCracks(ctx, rnd);
}

function drawBiomeWallDetail(ctx, biome, rnd, side, base) {
  if (biome.id === 'tomb') {
    for (let i = 0; i < 3; i++) {
      if (rnd() > 0.55) continue;
      const x = side === 'left' ? rnd() * TILE_W / 2 : TILE_W / 2 + rnd() * TILE_W / 2;
      const y = TOP_CY + 8 + rnd() * WALL_H;
      ctx.fillStyle = rgba('#6f9447', 0.2 + rnd() * 0.2);
      ctx.beginPath();
      ctx.ellipse(x, y, 4 + rnd() * 7, 3 + rnd() * 5, 0, 0, 7);
      ctx.fill();
    }
  } else if (biome.id === 'crypt') {
    ctx.fillStyle = rgba('#d6f0ff', 0.1);
    ctx.fillRect(0, TOP_CY, TILE_W, 4);
  } else if (biome.id === 'embers') {
    if (rnd() > 0.6) {
      ctx.strokeStyle = rgba('#ff7a3a', 0.35);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      const x = side === 'left' ? 6 + rnd() * 20 : TILE_W / 2 + 6 + rnd() * 20;
      let y = TOP_CY + 10;
      ctx.moveTo(x, y);
      for (let i = 0; i < 3; i++) ctx.lineTo(x + (rnd() - 0.5) * 10, (y += 8));
      ctx.stroke();
    }
  } else if (biome.id === 'rainruins') {
    const grad = ctx.createLinearGradient(0, TOP_CY, 0, BASE_Y);
    grad.addColorStop(0, rgba('#bfe0ee', 0.1));
    grad.addColorStop(1, rgba('#bfe0ee', 0));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, TILE_W, BASE_Y);
  }
}

function drawCracks(ctx, rnd) {
  ctx.save();
  ctx.lineCap = 'round';
  for (let branch = 0; branch < 5; branch++) {
    let x = TILE_W / 2 + (rnd() - 0.5) * 26;
    let y = TOP_CY + 12 + rnd() * (WALL_H - 6);
    ctx.strokeStyle = rgba('#000000', 0.55);
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let i = 0; i < 4; i++) {
      x += (rnd() - 0.5) * 14;
      y += (rnd() - 0.35) * 10;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// --- special tiles --------------------------------------------------------

function drawStairs(ctx, biome) {
  drawFloor(ctx, biome, 0);
  const cx = TILE_W / 2, cy = FLOOR_H / 2;
  // A shaft sinking away from the viewer, with lit step noses.
  diamond(ctx, cx, cy, TILE_W * 0.86, TILE_H * 0.86);
  ctx.fillStyle = '#05070c';
  ctx.fill();
  for (let i = 0; i < 4; i++) {
    const t = i / 4;
    const w = TILE_W * (0.78 - t * 0.16);
    const h = TILE_H * (0.78 - t * 0.16);
    const y = cy - 2 + i * 3.2;
    diamond(ctx, cx, y, w, h);
    ctx.fillStyle = shade(biome.wallTop, -0.3 - t * 0.28);
    ctx.fill();
    ctx.strokeStyle = rgba(biome.accent, 0.28 - t * 0.05);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  diamond(ctx, cx, cy, TILE_W * 0.86, TILE_H * 0.86);
  ctx.strokeStyle = rgba(biome.accent, 0.5);
  ctx.lineWidth = 1.4;
  ctx.stroke();
}

function drawEntrance(ctx, biome) {
  drawFloor(ctx, biome, 1);
  const cx = TILE_W / 2, cy = FLOOR_H / 2;
  ctx.save();
  diamond(ctx, cx, cy);
  ctx.clip();
  ctx.strokeStyle = rgba(biome.accent, 0.55);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 18, 9, 0, 0, 7);
  ctx.stroke();
  ctx.strokeStyle = rgba(biome.accent, 0.3);
  ctx.beginPath();
  ctx.ellipse(cx, cy, 12, 6, 0, 0, 7);
  ctx.stroke();
  // Four runes at the compass points of the circle.
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    const x = cx + Math.cos(a) * 15, y = cy + Math.sin(a) * 7.5;
    ctx.strokeStyle = rgba(biome.accent, 0.6);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y - 3);
    ctx.lineTo(x, y + 3);
    ctx.moveTo(x, y - 2);
    ctx.lineTo(x + 2.5, y);
    ctx.stroke();
  }
  ctx.restore();
}

// --- cache ----------------------------------------------------------------

const DARK = '#04060b';

// Remembered terrain keeps its texture and silhouette but loses colour,
// warmth and most of its brightness. Baking it this way means a remembered
// wall is still a solid, occluding wall rather than a pane of blue glass.
function memoryVersion(src) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = 'rgba(64,86,116,0.55)';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = 'rgba(2,4,9,0.58)';
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

function versions(canvas) {
  return { lit: canvas, dark: silhouette(canvas, DARK), mem: memoryVersion(canvas) };
}

function buildSet(biome) {
  const floor = [], wall = [], secret = [];
  for (let v = 0; v < VARIANTS; v++) {
    floor.push(versions(bake(TILE_W, FLOOR_H, (ctx) => drawFloor(ctx, biome, v))));
    wall.push(versions(bake(TILE_W, WALL_CANVAS_H, (ctx) => drawWall(ctx, biome, v, false))));
    if (v < 2) secret.push(versions(bake(TILE_W, WALL_CANVAS_H, (ctx) => drawWall(ctx, biome, v, true))));
  }
  return {
    biome, floor, wall, secret,
    stairs: versions(bake(TILE_W, FLOOR_H, (ctx) => drawStairs(ctx, biome))),
    entrance: versions(bake(TILE_W, FLOOR_H, (ctx) => drawEntrance(ctx, biome))),
  };
}

const cache = new Map();

export function tileSet(biome) {
  if (!cache.has(biome.id)) cache.set(biome.id, buildSet(biome));
  return cache.get(biome.id);
}

// Pre-bakes every biome a level uses so the first frames do not stutter.
export function warmTileSets(biomes) {
  for (const b of biomes) tileSet(b);
}

export function clearSpriteCache() { cache.clear(); }

export { bake, silhouette, diamond, FLOOR_H, WALL_CANVAS_H };

// --- hazard floor overlays -------------------------------------------------
// Hazards that change how the floor behaves also change how it looks, so the
// player can read the mechanic straight off the ground.

const hazardCache = new Map();

function drawHazardOverlay(ctx, id) {
  const rnd = seeded(id.length * 91711 + 13);
  const cx = TILE_W / 2, cy = FLOOR_H / 2;
  diamond(ctx, cx, cy);
  ctx.save();
  ctx.clip();
  switch (id) {
    case 'ice':
      ctx.fillStyle = rgba('#bfe4f7', 0.2);
      ctx.fillRect(0, 0, TILE_W, FLOOR_H);
      ctx.strokeStyle = rgba('#ffffff', 0.28);
      ctx.lineWidth = 1;
      for (let i = 0; i < 4; i++) {
        const p = pointInDiamond(rnd, cx, cy, 0.8);
        ctx.beginPath();
        ctx.moveTo(p.x - 6, p.y);
        ctx.lineTo(p.x + 5, p.y - 2);
        ctx.lineTo(p.x + 9, p.y + 2);
        ctx.stroke();
      }
      break;
    case 'mud':
      ctx.fillStyle = rgba('#3a2c1c', 0.4);
      ctx.fillRect(0, 0, TILE_W, FLOOR_H);
      for (let i = 0; i < 5; i++) {
        const p = pointInDiamond(rnd, cx, cy, 0.7);
        ctx.fillStyle = rgba('#1d150c', 0.35);
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, 5 + rnd() * 9, 2.5 + rnd() * 4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'vines':
      ctx.strokeStyle = rgba('#4e7a35', 0.7);
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        const p = pointInDiamond(rnd, cx, cy, 0.85);
        ctx.beginPath();
        ctx.moveTo(p.x - 10, p.y);
        ctx.quadraticCurveTo(p.x, p.y - 5 + rnd() * 10, p.x + 11, p.y + 2);
        ctx.stroke();
      }
      ctx.fillStyle = rgba('#2c4020', 0.22);
      ctx.fillRect(0, 0, TILE_W, FLOOR_H);
      break;
    case 'embers':
      ctx.fillStyle = rgba('#5a1c08', 0.2);
      ctx.fillRect(0, 0, TILE_W, FLOOR_H);
      ctx.strokeStyle = rgba('#ff7a2a', 0.4);
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 2; i++) {
        let p = pointInDiamond(rnd, cx, cy, 0.8);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        for (let j = 0; j < 3; j++) {
          p = { x: p.x + (rnd() - 0.5) * 16, y: p.y + (rnd() - 0.5) * 8 };
          ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }
      break;
    case 'rain':
      ctx.fillStyle = rgba('#3f5566', 0.18);
      ctx.fillRect(0, 0, TILE_W, FLOOR_H);
      for (let i = 0; i < 3; i++) {
        const p = pointInDiamond(rnd, cx, cy, 0.7);
        ctx.fillStyle = rgba('#a8cfe4', 0.14);
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, 6 + rnd() * 8, 3 + rnd() * 3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    default: break;
  }
  ctx.restore();
}

const OVERLAY_HAZARDS = new Set(['ice', 'mud', 'vines', 'embers', 'rain']);

export function hazardOverlay(id) {
  if (!OVERLAY_HAZARDS.has(id)) return null;
  if (!hazardCache.has(id)) {
    hazardCache.set(id, bake(TILE_W, FLOOR_H, (ctx) => drawHazardOverlay(ctx, id)));
  }
  return hazardCache.get(id);
}
