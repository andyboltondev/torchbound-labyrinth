// Acoustic probe.
//
// The dungeon already knows what the player can see; this works out what the
// player should be able to *hear*. Eight rays are cast from the listener and
// the geometry they find is reduced to a handful of numbers the mixer can act
// on: how big the space is, how corridor-like it is, and how close the nearest
// wall is. A sword swung in a hall and the same swing in a passage are then
// genuinely different sounds rather than the same sample twice.

import { blocksSight } from '../gen/tiles.js';
import { clamp } from '../core/util.js';

const MAX = 13;

// E, W, S, N first: the cardinals are read back out for the span maths.
const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

const DIAG = Math.SQRT2;

export const DEFAULT_SPACE = {
  size: 0.35, corridor: 0.3, tight: 0.4, openness: 0.4,
  spanX: 4, spanY: 4, minSpan: 4, maxSpan: 4, nearWall: 2, ceiling: 0.5,
};

function ray(grid, x, y, dx, dy, extra) {
  let d = 0;
  for (let i = 1; i <= MAX; i++) {
    const gx = x + dx * i, gy = y + dy * i;
    if (!grid.inBounds(gx, gy)) return d;
    if (blocksSight(grid.get(gx, gy))) return d;
    if (extra && extra(gx, gy)) return d;
    d = i;
  }
  return MAX;
}

// `extra` marks cells that are solid to sound but not to the tile grid --
// a sealed encounter, a closed gate.
export function probeAcoustics(grid, px, py, extra = null) {
  const x = Math.floor(px), y = Math.floor(py);
  if (!grid.inBounds(x, y)) return { ...DEFAULT_SPACE };

  const d = new Array(8);
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    const dir = DIRS[i];
    const raw = ray(grid, x, y, dir[0], dir[1], extra);
    d[i] = i < 4 ? raw : raw * DIAG;
    sum += d[i];
  }
  const mean = sum / 8;

  const spanX = d[0] + d[1] + 1;
  const spanY = d[2] + d[3] + 1;
  const minSpan = Math.min(spanX, spanY);
  const maxSpan = Math.max(spanX, spanY);
  const nearWall = Math.min(d[0], d[1], d[2], d[3]);

  // One tile of clearance either side is a passage; five or more is a room.
  const tight = clamp(1 - (minSpan - 1) / 5.5, 0, 1);
  // Corridor-like means narrow *and* long. A small square chamber is neither.
  const corridor = tight * clamp((maxSpan - 2.5) / 7, 0, 1);
  // Raw volume, then pulled back down by how narrow the space is, so a long
  // passage does not reverberate like the hall it happens to run alongside.
  const size = clamp((mean - 1.1) / 8, 0, 1) * (1 - 0.5 * tight);
  // Vaults and halls read as taller; passages are low and close.
  const ceiling = clamp(0.25 + size * 0.9 - tight * 0.3, 0, 1);

  return {
    size, corridor, tight, openness: clamp(mean / MAX, 0, 1),
    spanX, spanY, minSpan, maxSpan, nearWall, ceiling,
  };
}

// Which impulse response this geometry wants. Kept as a small set of named
// spaces so the change on crossing a threshold is something you can hear.
export function spaceProfile(s) {
  // Volume wins first: a boss arena is a cavern whatever shape it happens to
  // be. Then narrowness, because a passage rings however long it is. Only
  // then does raw size choose between a hall and an ordinary chamber.
  if (s.size > 0.66) return 'cavern';
  if (s.corridor > 0.4) return s.maxSpan >= 11 ? 'gallery' : 'corridor';
  if (s.size > 0.36) return 'hall';
  if (s.minSpan <= 3 && s.maxSpan <= 5) return 'closet';
  return 'chamber';
}

// Blend two probes so walking a doorway is a slide, not a jump.
export function blendSpace(a, b, t) {
  const out = {};
  for (const key of Object.keys(DEFAULT_SPACE)) {
    out[key] = a[key] + (b[key] - a[key]) * t;
  }
  return out;
}
