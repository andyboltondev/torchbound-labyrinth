// Minimap. Shows only what has actually been discovered, and fades with the
// same memory values as the world itself, so fog degrades the map too.

import { T } from '../gen/tiles.js';
import { keyColour } from '../gen/tiles.js';
import { rgba } from './palette.js';

const CELL = 3;
const REFRESH_EVERY = 5; // frames

export class Minimap {
  constructor() {
    this.buffer = document.createElement('canvas');
    this.bctx = this.buffer.getContext('2d');
    this.frame = 0;
    this.level = null;
  }

  bind(level) {
    this.level = level;
    this.buffer.width = level.grid.w * CELL;
    this.buffer.height = level.grid.h * CELL;
    this.frame = 0;
    this.redraw(null);
  }

  redraw(world) {
    const level = this.level;
    if (!level) return;
    const ctx = this.bctx;
    ctx.clearRect(0, 0, this.buffer.width, this.buffer.height);
    if (!world) return;
    const vis = world.vis;
    const grid = level.grid;
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        const i = grid.idx(x, y);
        if (!vis.seen[i]) continue;
        const mem = vis.memory[i];
        if (mem <= 0.04) continue;
        const tile = grid.cells[i];
        let colour = null;
        if (tile === T.FLOOR || tile === T.ENTRANCE) colour = '#5d6b80';
        else if (tile === T.STAIRS) colour = '#6fce87';
        else if (tile === T.GATE) colour = keyColour(this.gateColour(level, x, y)).hex;
        else if (tile === T.SECRET) colour = world.secretDiscoveredAt(x, y) ? '#e8b45c' : '#20262f';
        else colour = '#20262f';
        ctx.globalAlpha = 0.25 + mem * 0.75;
        ctx.fillStyle = colour;
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }
    ctx.globalAlpha = 1;

    // Keys the player has actually laid eyes on.
    for (const k of level.keys) {
      if (k.taken) continue;
      const i = grid.idx(k.x, k.y);
      if (!vis.seen[i] || vis.memory[i] <= 0.04) continue;
      ctx.fillStyle = keyColour(k.colourIndex).hex;
      ctx.fillRect(k.x * CELL - 1, k.y * CELL - 1, CELL + 2, CELL + 2);
    }
  }

  gateColour(level, x, y) {
    for (const g of level.gates) if (g.x === x && g.y === y) return g.colourIndex;
    return 0;
  }

  // Draws into the given 2D context in screen space.
  draw(ctx, world, x, y, size) {
    if (!this.level) return;
    this.frame++;
    if (this.frame % REFRESH_EVERY === 1) this.redraw(world);

    const r = 8;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, r);
    ctx.fillStyle = 'rgba(10,13,19,0.78)';
    ctx.fill();
    ctx.save();
    ctx.clip();

    // Centre on the player, scaled so a useful neighbourhood is visible.
    const span = 34; // tiles across the widget
    const scale = size / (span * CELL);
    const px = world.player.x * CELL;
    const py = world.player.y * CELL;
    ctx.translate(x + size / 2, y + size / 2);
    ctx.scale(scale, scale);
    ctx.translate(-px, -py);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.buffer, 0, 0);

    // Player marker with a facing wedge.
    const a = Math.atan2(world.player.faceX + world.player.faceY,
      world.player.faceX - world.player.faceY);
    ctx.fillStyle = '#e8b45c';
    ctx.beginPath();
    ctx.arc(px, py, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,180,92,0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + Math.cos(a) * 9, py + Math.sin(a) * 9);
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = 'rgba(90,105,128,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x + 0.5, y + 0.5, size - 1, size - 1, r);
    ctx.stroke();
    ctx.restore();
  }
}
