// Torch visibility, field of view and map memory.
//
// Three states exist for every tile (section 17):
//   visible    -- inside the torch's field of view right now, full detail
//   remembered -- explored, fading; drawn cold and flat from `memory`
//   unknown    -- never seen, drawn as nothing at all
//
// The same light values drive enemy awareness, which is what makes a bigger
// torch a genuine trade-off rather than a pure upgrade.

import { blocksSight } from '../gen/tiles.js';
import { clamp } from '../core/util.js';

const MULT = [
  [1, 0, 0, -1, -1, 0, 0, 1],
  [0, 1, -1, 0, 0, -1, 1, 0],
  [0, 1, 1, 0, 0, -1, -1, 0],
  [1, 0, 0, 1, -1, 0, 0, -1],
];

// Tile -> does it stop light, as a flat lookup so the inner cast loop is an
// array read rather than a Set probe. Mirrors BLOCKS_SIGHT in gen/tiles.js.
const BLOCKS = (() => {
  const a = new Uint8Array(16);
  for (let t = 0; t < a.length; t++) a[t] = blocksSight(t) ? 1 : 0;
  return a;
})();

export class Torch {
  constructor() {
    this.baseRadius = 7.5;
    this.radius = 7.5;
    this.instability = 1.0;   // rain and hazards push this up
    this.t = 0;
    this.flicker = 1;
    this.gutter = 0;          // brief deep dips, used by rain
    this.gutterTimer = 2 + Math.random() * 3;
  }

  update(dt, hazardMods = {}) {
    this.t += dt;
    const inst = this.instability * (hazardMods.torchInstability || 1);
    // Layered sines read as a living flame; pure noise reads as a broken screen.
    const f =
      Math.sin(this.t * 11.3) * 0.020 +
      Math.sin(this.t * 6.7 + 1.3) * 0.028 +
      Math.sin(this.t * 3.1 + 0.7) * 0.030 +
      Math.sin(this.t * 21.7 + 2.1) * 0.010;
    this.gutterTimer -= dt;
    if (this.gutterTimer <= 0) {
      this.gutterTimer = (2.5 + Math.random() * 4) / Math.max(1, inst * 0.8);
      this.gutter = 0.1 + Math.random() * 0.12 * inst;
    }
    this.gutter = Math.max(0, this.gutter - dt * 0.9);
    // Kept deliberately shallow: atmosphere must not cost readability.
    this.flicker = clamp(1 + f * inst - this.gutter, 0.78, 1.07);
  }

  effectiveRadius(hazardMods = {}) {
    return this.baseRadius * (hazardMods.torchRadius || 1) * (0.94 + this.flicker * 0.06);
  }
}

export class Visibility {
  constructor(grid) {
    this.grid = grid;
    const n = grid.w * grid.h;
    this.light = new Float32Array(n);
    this.memory = new Float32Array(n);
    this.seen = new Uint8Array(n);
    this.visGen = new Uint32Array(n);
    this.gen = 1;
    this.discoveredCount = 0;
    // Tile indices that block sight without being masonry in the grid: the
    // pushable stones and the grinding slabs. A stone the size of a person is
    // as opaque as the wall it was cut from, which is what makes what it is
    // guarding a secret rather than a thing you can already see.
    this.opaque = null;
  }

  blocksAt(x, y) {
    const i = this.grid.idx(x, y);
    if (BLOCKS[this.grid.cells[i]]) return true;
    return this.opaque !== null && this.opaque.has(i);
  }

  isVisible(x, y) {
    if (!this.grid.inBounds(x, y)) return false;
    return this.visGen[this.grid.idx(x, y)] === this.gen;
  }

  lightAt(x, y) {
    if (!this.grid.inBounds(x, y)) return 0;
    const i = this.grid.idx(x, y);
    return this.visGen[i] === this.gen ? this.light[i] : 0;
  }

  memoryAt(x, y) {
    if (!this.grid.inBounds(x, y)) return 0;
    return this.memory[this.grid.idx(x, y)];
  }

  // `sources` is [{x, y, radius, intensity}]; the first is the player's torch.
  // Secondary sources (wall sconces) only contribute once the player can
  // actually see them -- otherwise a brazier would reveal rooms through solid
  // rock, and unexplored terrain must stay unexplored (design rule 8).
  update(sources, dt, memoryDecay = 0.05, opaque = null) {
    this.opaque = opaque && opaque.size ? opaque : null;
    this.gen++;
    if (sources.length) this._cast(sources[0]);
    for (let i = 1; i < sources.length; i++) {
      const src = sources[i];
      const gx = Math.floor(src.x), gy = Math.floor(src.y);
      if (!this.grid.inBounds(gx, gy)) continue;
      if (this.visGen[this.grid.idx(gx, gy)] !== this.gen) continue;
      this._cast(src);
    }

    const n = this.memory.length;
    for (let i = 0; i < n; i++) {
      if (this.visGen[i] === this.gen) {
        if (!this.seen[i]) { this.seen[i] = 1; this.discoveredCount++; }
        this.memory[i] = 1;
      } else if (this.memory[i] > 0) {
        this.memory[i] = Math.max(0, this.memory[i] - dt * memoryDecay);
      }
    }
  }

  _mark(x, y, dist, src) {
    const i = this.grid.idx(x, y);
    const t = clamp(1 - dist / src.radius, 0, 1);
    // Smooth, slightly biased toward the centre so the pool of light has a core.
    const value = (0.12 + 0.88 * (t * t * (3 - 2 * t))) * (src.intensity === undefined ? 1 : src.intensity);
    if (this.visGen[i] !== this.gen) { this.visGen[i] = this.gen; this.light[i] = value; }
    else if (value > this.light[i]) this.light[i] = value;
  }

  _cast(src) {
    const cx = Math.floor(src.x), cy = Math.floor(src.y);
    if (!this.grid.inBounds(cx, cy)) return;
    this._mark(cx, cy, 0, src);
    for (let oct = 0; oct < 8; oct++) {
      this._castOctant(cx, cy, 1, 1.0, 0.0, src.radius,
        MULT[0][oct], MULT[1][oct], MULT[2][oct], MULT[3][oct], src);
    }
  }

  // Was the tile one step nearer the light, along this octant, both lit this
  // pass and open? Used to decide whether a piece of masonry is a wall the
  // player is looking at or a wall they are looking *past*.
  _facesLight(cx, cy, dx, dy, xx, xy, yx, yy) {
    for (let k = 0; k < 2; k++) {
      const ldx = k === 0 ? dx : dx + 1;
      const ldy = k === 0 ? dy + 1 : dy;
      if (ldx > 0) continue;                      // belongs to the next octant
      const nx = cx + ldx * xx + ldy * xy;
      const ny = cy + ldx * yx + ldy * yy;
      if (!this.grid.inBounds(nx, ny)) continue;
      const i = this.grid.idx(nx, ny);
      if (this.visGen[i] !== this.gen) continue;
      if (this.blocksAt(nx, ny)) continue;
      return true;
    }
    return false;
  }

  _castOctant(cx, cy, row, start, end, radius, xx, xy, yx, yy, src) {
    if (start < end) return;
    const r2 = radius * radius;
    let blocked = false;
    let newStart = start;
    for (let distance = row; distance <= radius && !blocked; distance++) {
      const dy = -distance;
      for (let dx = -distance; dx <= 0; dx++) {
        const currentX = cx + dx * xx + dy * xy;
        const currentY = cy + dx * yx + dy * yy;
        const leftSlope = (dx - 0.5) / (dy + 0.5);
        const rightSlope = (dx + 0.5) / (dy - 0.5);
        if (!this.grid.inBounds(currentX, currentY) || start < rightSlope) continue;
        if (end > leftSlope) break;

        const solid = this.blocksAt(currentX, currentY);
        const d2 = dx * dx + dy * dy;
        if (d2 <= r2) {
          // Shadows are cast from the *edges* of a blocker, which is right --
          // but marking from the edges too is what made walking round a corner
          // light up ground on the far side of the wall you just came round.
          // A tile is only shown when its own centre is inside the cone.
          const centre = dx / dy;
          // Masonry is the exception: a wall face fronting ground that is lit
          // is a wall the player can see, whatever its centre says, and
          // dropping those punches holes in the architecture.
          if ((centre <= start && centre >= end)
              || (solid && this._facesLight(cx, cy, dx, dy, xx, xy, yx, yy))) {
            this._mark(currentX, currentY, Math.sqrt(d2), src);
          }
        }

        if (blocked) {
          if (solid) { newStart = rightSlope; continue; }
          blocked = false;
          start = newStart;
        } else if (solid && distance < radius) {
          blocked = true;
          this._castOctant(cx, cy, distance + 1, start, leftSlope, radius, xx, xy, yx, yy, src);
          newStart = rightSlope;
        }
      }
    }
  }
}
