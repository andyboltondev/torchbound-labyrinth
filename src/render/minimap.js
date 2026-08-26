// Minimap.
//
// Two layers, for two different jobs.
//
// The *chart* is everything ever discovered, painted once per tile into a
// buffer and never rubbed out. A map you have drawn does not un-draw itself,
// and a labyrinth you cannot keep track of is not a labyrinth, it is a maze
// of identical grey rooms. Painting each tile exactly once also means the
// buffer costs a handful of fills a second rather than a few thousand.
//
// Over that goes the *live* layer: what the torch is lighting right now, what
// is moving in it, and where the things you have found are. That is the part
// that fades -- fog and the memory hazards dim it back toward the flat chart,
// so losing your memory costs you detail and never costs you the way home.

import { T, blocksSight } from '../gen/tiles.js';
import { keyColour } from '../gen/tiles.js';
import { rgba } from './palette.js';

const CELL = 3;
const REFRESH_EVERY = 5;   // frames between chart updates
const SPAN = 34;           // tiles across the widget

// The chart is deliberately cold and low-contrast. Anything the live layer
// draws on top has to read as newer than this without being garish.
const CHART = {
  floor: '#3f4a5c',
  wall: '#1b2029',
  stairs: '#3f7a52',
  secret: '#7a6134',
};

export class Minimap {
  constructor() {
    this.buffer = document.createElement('canvas');
    this.bctx = this.buffer.getContext('2d');
    this.frame = 0;
    this.level = null;
    this.painted = null;
    this.layer = 0;
    // Cast sight wedges, keyed by creature. Rebuilt with the chart rather
    // than every frame: what a creature is looking at does not change fast
    // enough to be worth a few hundred grid lookups sixty times a second.
    this.cones = new Map();
    this.coneFrame = -1;
  }

  bind(level) {
    this.level = level;
    this.buffer.width = level.grid.w * CELL;
    this.buffer.height = level.grid.h * CELL;
    this.painted = new Uint8Array(level.grid.w * level.grid.h);
    this.frame = 0;
    this.layer = 0;
    this.cones.clear();
    this.bctx.clearRect(0, 0, this.buffer.width, this.buffer.height);
  }

  // Paints tiles that have become known since the last pass. Tiles already on
  // the chart are left alone, which is both the persistence and the speed.
  updateChart(world) {
    const level = this.level;
    if (!level || !world) return;
    const grid = level.grid;
    const vis = world.vis;
    const ctx = this.bctx;

    // Vaults are a different place on the same grid, so the chart shows one
    // layer at a time and is redrawn from scratch when the player changes.
    const layer = world.playerLayer;
    if (layer !== this.layer) {
      this.layer = layer;
      this.painted.fill(0);
      ctx.clearRect(0, 0, this.buffer.width, this.buffer.height);
    }
    const band = level.mazeHeight;
    const y0 = band === undefined ? 0 : (layer === 1 ? band : 0);
    const y1 = band === undefined ? grid.h : (layer === 1 ? grid.h : band);

    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < grid.w; x++) {
        const i = grid.idx(x, y);
        if (!vis.seen[i] || this.painted[i]) continue;
        this.painted[i] = 1;
        const tile = grid.cells[i];
        let colour = CHART.wall;
        if (tile === T.FLOOR || tile === T.ENTRANCE) colour = CHART.floor;
        else if (tile === T.STAIRS) colour = CHART.stairs;
        else if (tile === T.GATE) colour = keyColour(this.gateColour(level, x, y)).hex;
        else if (tile === T.SECRET) colour = world.secretDiscoveredAt(x, y) ? CHART.secret : CHART.wall;
        ctx.fillStyle = colour;
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }
  }

  // A broken wall or an opened gate changes a tile that is already charted,
  // so those get marked for repainting rather than waiting for a full redraw
  // that will never come.
  repaint(x, y) {
    if (!this.level || !this.painted) return;
    const i = this.level.grid.idx(x, y);
    if (i >= 0 && i < this.painted.length) this.painted[i] = 0;
  }

  gateColour(level, x, y) {
    for (const g of level.gates) if (g.x === x && g.y === y) return g.colourIndex;
    return 0;
  }

  // Draws into the given 2D context in screen space.
  draw(ctx, world, x, y, size) {
    if (!this.level) return;
    this.frame++;
    if (this.frame % REFRESH_EVERY === 1) {
      this.updateChart(world);
      this.coneFrame = this.frame;
    }

    const r = 8;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, r);
    ctx.fillStyle = 'rgba(10,13,19,0.78)';
    ctx.fill();
    ctx.save();
    ctx.clip();

    const scale = size / (SPAN * CELL);
    const px = world.player.x * CELL;
    const py = world.player.y * CELL;
    ctx.translate(x + size / 2, y + size / 2);
    ctx.scale(scale, scale);
    ctx.translate(-px, -py);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.buffer, 0, 0);

    // `unit` converts a screen pixel into chart units, so markers keep the
    // same size on the glass whatever the widget is scaled to.
    const unit = 1 / scale;
    this.drawRemembered(ctx, world);
    this.drawMarkers(ctx, world, unit);
    this.drawEnemies(ctx, world, unit);
    this.drawPlayer(ctx, world, px, py, unit);
    ctx.restore();

    this.drawHintArrows(ctx, world, x, y, size);

    ctx.strokeStyle = 'rgba(90,105,128,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x + 0.5, y + 0.5, size - 1, size - 1, r);
    ctx.stroke();
    ctx.restore();
  }

  // The warm patch: floor the torch is on now, plus whatever is still fresh
  // in memory. Bounded to the window the widget can show, so its cost does
  // not grow with the size of the level.
  drawRemembered(ctx, world) {
    const grid = this.level.grid;
    const vis = world.vis;
    const cx = Math.floor(world.player.x), cy = Math.floor(world.player.y);
    const half = Math.ceil(SPAN / 2) + 1;
    const band = this.level.mazeHeight;
    const layer = world.playerLayer;
    const lo = band === undefined ? 0 : (layer === 1 ? band : 0);
    const hi = band === undefined ? grid.h : (layer === 1 ? grid.h : band);

    for (let ty = Math.max(lo, cy - half); ty < Math.min(hi, cy + half); ty++) {
      for (let tx = Math.max(0, cx - half); tx < Math.min(grid.w, cx + half); tx++) {
        const i = grid.idx(tx, ty);
        if (!vis.seen[i]) continue;
        const mem = vis.memory[i];
        if (mem <= 0.06) continue;
        const tile = grid.cells[i];
        if (tile === T.WALL || tile === T.SECRET) continue;
        ctx.globalAlpha = mem * (vis.visGen[i] === vis.gen ? 0.85 : 0.5);
        ctx.fillStyle = tile === T.STAIRS ? '#6fce87' : '#7d8ea8';
        ctx.fillRect(tx * CELL, ty * CELL, CELL, CELL);
      }
    }
    ctx.globalAlpha = 1;
  }

  // Everything worth walking back to. A marker appears the moment its tile is
  // discovered and stays for the rest of the depth, because the point of the
  // chart is not having to remember which room the ladder was in.
  drawMarkers(ctx, world, unit) {
    const level = this.level;
    const vis = world.vis;
    const grid = level.grid;
    const known = (x, y) => {
      const gx = Math.floor(x), gy = Math.floor(y);
      return grid.inBounds(gx, gy) && !!vis.seen[grid.idx(gx, gy)];
    };
    const layer = world.playerLayer;
    const onLayer = (yy) => world.layerAt(Math.floor(yy)) === layer;

    const pip = (mx, my, colour, shape, size) => {
      const s = (size || 2.4) * unit;
      ctx.fillStyle = colour;
      ctx.beginPath();
      if (shape === 'diamond') {
        ctx.moveTo(mx, my - s); ctx.lineTo(mx + s, my);
        ctx.lineTo(mx, my + s); ctx.lineTo(mx - s, my);
      } else if (shape === 'square') {
        ctx.rect(mx - s * 0.8, my - s * 0.8, s * 1.6, s * 1.6);
      } else if (shape === 'down') {
        ctx.moveTo(mx - s, my - s); ctx.lineTo(mx + s, my - s); ctx.lineTo(mx, my + s);
      } else if (shape === 'up') {
        ctx.moveTo(mx - s, my + s); ctx.lineTo(mx + s, my + s); ctx.lineTo(mx, my - s);
      } else {
        ctx.arc(mx, my, s, 0, Math.PI * 2);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(6,8,12,0.75)';
      ctx.lineWidth = 0.8 * unit;
      ctx.stroke();
    };

    const st = level.stairs;
    if (known(st.x, st.y) && onLayer(st.y)) {
      pip((st.x + 0.5) * CELL, (st.y + 0.5) * CELL, '#6fce87', 'down', 3.2);
    }

    for (const k of level.keys) {
      if (k.taken || k.holder === 'enemy') continue;
      if (!known(k.x, k.y) || !onLayer(k.y)) continue;
      pip((k.x + 0.5) * CELL, (k.y + 0.5) * CELL, keyColour(k.colourIndex).glow, 'diamond', 2.8);
    }

    for (const g of level.gates) {
      if (!known(g.x, g.y) || !onLayer(g.y)) continue;
      const col = keyColour(g.colourIndex);
      pip((g.x + 0.5) * CELL, (g.y + 0.5) * CELL,
        g.open ? rgba(col.hex, 0.45) : col.glow, 'square', 2.6);
    }

    for (const prop of level.props) {
      if (!known(prop.x, prop.y) || !onLayer(prop.y)) continue;
      if (prop.hidden && !world.revealedProps.has(prop.id)) continue;
      const m = PROP_MARKS[prop.type];
      if (!m) continue;
      const spent = prop.consumed || prop.opened || prop.used;
      if (spent && !m.keepWhenSpent) continue;
      pip(prop.x * CELL, prop.y * CELL,
        spent ? rgba(m.colour, 0.4) : m.colour, m.shape, m.size);
    }
  }

  // Creatures, and what they are watching. Only the ones the player can
  // genuinely see: a chart that showed what was round the corner would make
  // the torch pointless.
  drawEnemies(ctx, world, unit) {
    const vis = world.vis;
    const px = world.player.x, py = world.player.y;
    const bodies = world.boss && !world.boss.dead
      ? world.enemies.concat([world.boss]) : world.enemies;

    for (const e of bodies) {
      if (e.dead || e.sealed || e.dormant) continue;
      if (Math.abs(e.x - px) > SPAN / 2 || Math.abs(e.y - py) > SPAN / 2) continue;
      if (!vis.isVisible(Math.floor(e.x), Math.floor(e.y))) continue;
      const mx = e.x * CELL, my = e.y * CELL;
      const hunting = e.state && e.state !== 'idle' && e.state !== 'return';

      // The wedge it is watching, cast against the walls so it stops at stone
      // rather than shining through it. Kept faint: this is a hint about where
      // it is safe to walk, not a second map drawn over the first.
      const pts = this.coneFor(world, e);
      if (pts.length > 2) {
        ctx.fillStyle = rgba(hunting ? '#ff6a4a' : '#e8b45c', hunting ? 0.15 : 0.09);
        ctx.beginPath();
        ctx.moveTo(mx, my);
        for (const pt of pts) ctx.lineTo(pt.x * CELL, pt.y * CELL);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = rgba(hunting ? '#ff6a4a' : '#e8b45c', hunting ? 0.45 : 0.24);
        ctx.lineWidth = 0.9 * unit;
        ctx.stroke();
      }

      ctx.fillStyle = hunting ? '#ff6a4a' : '#d8b271';
      ctx.beginPath();
      ctx.arc(mx, my, (e.radius > 0.6 ? 3.4 : 2.2) * unit, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // The visible wedge, as a fan of points cast out from the creature. Cached
  // per creature and rebuilt on the same beat as the chart.
  coneFor(world, e) {
    const cached = this.cones.get(e.id);
    if (cached && cached.frame === this.coneFrame) return cached.pts;

    const cos = e.fovCos === undefined ? -1 : e.fovCos;
    const range = e.detectionRange ? e.detectionRange(world) : 6;
    const facing = Math.atan2(e.faceY, e.faceX);
    const all = cos <= -1;
    const half = all ? Math.PI : Math.acos(Math.max(-1, Math.min(1, cos)));
    const steps = all ? 28 : Math.max(7, Math.round(half * 16));
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const a = facing - half + (2 * half * i) / steps;
      pts.push(this.castSight(world, e.x, e.y, a, range));
    }
    this.cones.set(e.id, { frame: this.coneFrame, pts });
    return pts;
  }

  // Marches out from a point until it meets something that stops sight.
  castSight(world, x0, y0, angle, range) {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const step = 0.5;
    let d = step;
    while (d < range) {
      const x = x0 + dx * d, y = y0 + dy * d;
      const gx = Math.floor(x), gy = Math.floor(y);
      if (!world.grid.inBounds(gx, gy)) break;
      const tile = world.grid.get(gx, gy);
      if (blocksSight(tile)) break;
      if (tile === T.GATE) {
        const gate = world.gateAt(gx, gy);
        if (!gate || !gate.open) break;
      }
      d += step;
    }
    d = Math.min(range, Math.max(0, d - step * 0.5));
    return { x: x0 + dx * d, y: y0 + dy * d };
  }

  drawPlayer(ctx, world, px, py, unit) {
    // The chart is drawn in grid space, so the arrow points along the grid
    // heading -- not the screen one, which the isometric view skews.
    const a = Math.atan2(world.player.faceY, world.player.faceX);
    const len = 8 * unit;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(a);
    ctx.fillStyle = '#ffd98a';
    ctx.beginPath();
    ctx.moveTo(len, 0);
    ctx.lineTo(-len * 0.55, len * 0.62);
    ctx.lineTo(-len * 0.2, 0);
    ctx.lineTo(-len * 0.55, -len * 0.62);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(6,8,12,0.85)';
    ctx.lineWidth = 0.9 * unit;
    ctx.stroke();
    ctx.restore();
  }

  // Anything the player has been told about but has not reached gets an arrow
  // on the rim, pointing at it as the crow flies and coloured by whatever told
  // them about it. The arrow disappears once the thing itself is on the chart.
  drawHintArrows(ctx, world, x, y, size) {
    const hints = world.hints;
    if (!hints || !hints.length) return;
    const cx = x + size / 2, cy = y + size / 2;
    const rim = size / 2 - 8;
    const scale = size / (SPAN * CELL);
    for (const h of hints) {
      if (h.resolved) continue;
      const dx = h.x - world.player.x, dy = h.y - world.player.y;
      const d = Math.hypot(dx, dy);
      if (d < 1.5) continue;
      if (d * CELL * scale < rim - 6) continue;
      const a = Math.atan2(dy, dx);
      ctx.save();
      ctx.translate(cx + Math.cos(a) * rim, cy + Math.sin(a) * rim);
      ctx.rotate(a);
      ctx.fillStyle = h.colour || '#e8b45c';
      ctx.beginPath();
      ctx.moveTo(6, 0); ctx.lineTo(-4, 4); ctx.lineTo(-4, -4);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(6,8,12,0.8)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
  }
}

// How each kind of prop appears once found. Most things stop being worth a
// mark once they are used up; a ladder is worth remembering either way.
const PROP_MARKS = {
  ladder: { colour: '#8fd7ff', shape: 'down', size: 2.8, keepWhenSpent: true },
  chest: { colour: '#e8b45c', shape: 'square', size: 2.4 },
  cursedChest: { colour: '#c46ad8', shape: 'square', size: 2.4 },
  shrine: { colour: '#8fb7ff', shape: 'up', size: 2.6 },
  shrineSmall: { colour: '#6fce87', shape: 'up', size: 2.2 },
  potion: { colour: '#6fce87', shape: 'circle', size: 1.9 },
  arrows: { colour: '#c9a35c', shape: 'circle', size: 1.7 },
  crossbow: { colour: '#e8b45c', shape: 'diamond', size: 2.6 },
  treasure: { colour: '#e8d05c', shape: 'diamond', size: 2.2 },
};
