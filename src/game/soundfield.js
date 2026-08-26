// How sound gets from one place in the labyrinth to another.
//
// Not by flying through the walls. A noise spreads along the same open ground
// a body would walk, losing energy with every tile it covers and losing more
// at every bend it has to turn -- which is why you can hear something round a
// corner, hear that it is round a corner, and still not know how far along.
//
// The field is built outward from whoever is listening rather than from each
// thing making a noise, because there is one listener and a great many
// noises. One pass answers every source in earshot at once.
//
// Two uses, same class:
//   * the player's ears, rebuilt a few times a second and consulted by every
//     creature that makes a sound;
//   * a creature's ears, built on demand at the moment something loud
//     happens, which is rare enough to afford.

import { blocksSight } from '../gen/tiles.js';
import { T } from '../gen/tiles.js';

// A bend costs about as much as walking another tile and a half. High enough
// that a straight corridor is obviously different from a dog-leg, low enough
// that two turns does not mean silence.
const CORNER_COST = 1.5;
const DIAGONAL = Math.SQRT2;

const N8 = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];

export class SoundField {
  constructor(grid) {
    this.grid = grid;
    const n = grid.w * grid.h;
    this.cost = new Float32Array(n);     // attenuation distance, in tiles
    this.corners = new Uint8Array(n);    // bends the sound had to turn
    // Which way the sound left the listener to get here. A noise round a
    // corner should seem to come from the mouth of the corner, not through
    // the wall, and this is what lets the mixer place it there.
    this.firstDir = new Int8Array(n);
    this.stamp = new Uint32Array(n);
    this.gen = 0;
    this.range = 0;
    this.originX = 0;
    this.originY = 0;
    this._heap = [];
  }

  // Dijkstra outward from (x, y) until `range` tiles of attenuation are used
  // up. `blocked(gx, gy)` lets the caller close doors the grid thinks are open.
  build(x, y, range, blocked) {
    const grid = this.grid;
    const gx = Math.floor(x), gy = Math.floor(y);
    this.gen++;
    this.range = range;
    this.originX = x;
    this.originY = y;
    if (!grid.inBounds(gx, gy)) return;

    const heap = this._heap;
    heap.length = 0;
    const start = grid.idx(gx, gy);
    this.cost[start] = 0;
    this.corners[start] = 0;
    this.firstDir[start] = -1;
    this.stamp[start] = this.gen;
    // Entries are [cost, index, dirIndex]; -1 means "no direction yet", so the
    // first step out of the origin is never charged for turning.
    push(heap, [0, start, -1]);

    while (heap.length) {
      const node = pop(heap);
      const cost = node[0], i = node[1], dir = node[2];
      if (cost > this.cost[i] + 1e-6) continue;
      const cx = i % grid.w, cy = (i / grid.w) | 0;

      for (let d = 0; d < 8; d++) {
        const [dx, dy] = N8[d];
        const nx = cx + dx, ny = cy + dy;
        if (!grid.inBounds(nx, ny)) continue;
        if (!this._open(nx, ny, blocked)) continue;
        // Sound will not squeeze diagonally through a gap a body could not.
        if (dx !== 0 && dy !== 0) {
          if (!this._open(cx + dx, cy, blocked) && !this._open(cx, cy + dy, blocked)) continue;
        }
        const turn = dir < 0 ? 0 : turnCost(dir, d);
        const next = cost + (dx !== 0 && dy !== 0 ? DIAGONAL : 1) + turn;
        if (next > range) continue;
        const ni = grid.idx(nx, ny);
        if (this.stamp[ni] === this.gen && this.cost[ni] <= next + 1e-6) continue;
        this.stamp[ni] = this.gen;
        this.cost[ni] = next;
        this.corners[ni] = Math.min(255, this.corners[i] + (turn > 0 ? 1 : 0));
        this.firstDir[ni] = dir < 0 ? d : this.firstDir[i];
        push(heap, [next, ni, d]);
      }
    }
  }

  _open(gx, gy, blocked) {
    const tile = this.grid.get(gx, gy);
    if (blocksSight(tile)) return false;
    if (tile === T.GATE && blocked && blocked(gx, gy)) return false;
    if (blocked && blocked(gx, gy)) return false;
    return true;
  }

  // What a noise made at (x, y) sounds like from the origin of the field.
  // `loudness` scales the range the source carries, so a hound is heard
  // further than a beetle from the same spot.
  //
  // Returns null when nothing reaches at all -- solid rock in the way, or
  // simply too far round too many corners.
  hear(x, y, loudness = 1) {
    const gx = Math.floor(x), gy = Math.floor(y);
    if (!this.grid.inBounds(gx, gy)) return null;
    const i = this.grid.idx(gx, gy);
    if (this.stamp[i] !== this.gen) return null;
    const reach = this.range * loudness;
    const d = this.cost[i];
    if (d > reach) return null;
    // Fades off rather than cutting: the last tile of earshot should be a
    // suggestion of a sound, not a sound that stops.
    const k = 1 - d / reach;
    const dir = this.firstDir[i];
    const step = dir >= 0 ? N8[dir] : [0, 0];
    const m = Math.hypot(step[0], step[1]) || 1;
    return {
      volume: k * k,
      distance: d,
      // Where it seems to come from: the direction it arrived from, at the
      // distance it actually travelled rather than the distance across.
      dirX: step[0] / m,
      dirY: step[1] / m,
      corners: this.corners[i],
      // Each bend smears the sound a little more. Straight on is dry.
      echo: Math.min(1, this.corners[i] * 0.34),
      direct: this.corners[i] === 0,
    };
  }

  // Everything in earshot, for the systems that need to react rather than
  // just listen: creatures deciding whether they heard the arrow.
  reaches(x, y, loudness = 1) {
    const h = this.hear(x, y, loudness);
    return h ? h.volume : 0;
  }
}

// How much a change of heading costs. Carrying straight on is free, a
// forty-five degree bend is half a corner, anything sharper is a full one.
function turnCost(fromDir, toDir) {
  let delta = Math.abs(fromDir - toDir);
  if (delta > 4) delta = 8 - delta;
  if (delta === 0) return 0;
  if (delta === 1) return CORNER_COST * 0.5;
  return CORNER_COST;
}

// A plain binary heap. The field never holds more than a few hundred nodes,
// so this is comfortably faster than sorting and allocates nothing per call.
function push(heap, node) {
  heap.push(node);
  let i = heap.length - 1;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (heap[parent][0] <= heap[i][0]) break;
    const tmp = heap[parent]; heap[parent] = heap[i]; heap[i] = tmp;
    i = parent;
  }
}

function pop(heap) {
  const top = heap[0];
  const last = heap.pop();
  if (heap.length) {
    heap[0] = last;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let best = i;
      if (l < heap.length && heap[l][0] < heap[best][0]) best = l;
      if (r < heap.length && heap[r][0] < heap[best][0]) best = r;
      if (best === i) break;
      const tmp = heap[best]; heap[best] = heap[i]; heap[i] = tmp;
      i = best;
    }
  }
  return top;
}
