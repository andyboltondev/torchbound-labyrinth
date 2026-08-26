// Flat-array grid plus the graph queries the generator and validator share.

import { T, isWalkableTile } from './tiles.js';

export class Grid {
  constructor(w, h, fill = T.WALL) {
    this.w = w; this.h = h;
    this.cells = new Uint8Array(w * h).fill(fill);
  }

  idx(x, y) { return y * this.w + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  get(x, y) { return this.inBounds(x, y) ? this.cells[y * this.w + x] : T.WALL; }
  set(x, y, v) { if (this.inBounds(x, y)) this.cells[y * this.w + x] = v; }

  clone() {
    const g = new Grid(this.w, this.h);
    g.cells.set(this.cells);
    return g;
  }

  forEach(fn) {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        fn(x, y, this.cells[y * this.w + x]);
  }

  count(predicate) {
    let n = 0;
    for (let i = 0; i < this.cells.length; i++) if (predicate(this.cells[i])) n++;
    return n;
  }
}

export const N4 = [[1, 0], [0, 1], [-1, 0], [0, -1]];
export const N8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

// Breadth-first distance field over passable cells. `passable(x, y, tile)`
// decides traversal, which lets callers model "gates closed", "gates open",
// or "ignore secret walls" without duplicating the search.
export function bfsField(grid, sources, passable) {
  const dist = new Int32Array(grid.w * grid.h).fill(-1);
  const queue = [];
  let head = 0;
  for (const s of sources) {
    if (!grid.inBounds(s.x, s.y)) continue;
    const i = grid.idx(s.x, s.y);
    if (dist[i] !== -1) continue;
    dist[i] = 0;
    queue.push(i);
  }
  while (head < queue.length) {
    const i = queue[head++];
    const x = i % grid.w, y = (i / grid.w) | 0;
    const d = dist[i];
    for (const [dx, dy] of N4) {
      const nx = x + dx, ny = y + dy;
      if (!grid.inBounds(nx, ny)) continue;
      const ni = ny * grid.w + nx;
      if (dist[ni] !== -1) continue;
      if (!passable(nx, ny, grid.cells[ni])) continue;
      dist[ni] = d + 1;
      queue.push(ni);
    }
  }
  return dist;
}

export const defaultPassable = (x, y, t) => isWalkableTile(t);

// All cells reachable from `sources`, as a Set of indices.
export function reachableSet(grid, sources, passable = defaultPassable) {
  const dist = bfsField(grid, sources, passable);
  const set = new Set();
  for (let i = 0; i < dist.length; i++) if (dist[i] >= 0) set.add(i);
  return set;
}

// Path reconstruction from a distance field, walking downhill to a source.
export function pathFromField(grid, dist, from) {
  const path = [];
  let x = from.x, y = from.y;
  let guard = grid.w * grid.h;
  while (guard-- > 0) {
    path.push({ x, y });
    const d = dist[grid.idx(x, y)];
    if (d <= 0) break;
    let best = null, bestD = d;
    for (const [dx, dy] of N4) {
      const nx = x + dx, ny = y + dy;
      if (!grid.inBounds(nx, ny)) continue;
      const nd = dist[grid.idx(nx, ny)];
      if (nd >= 0 && nd < bestD) { bestD = nd; best = { x: nx, y: ny }; }
    }
    if (!best) break;
    x = best.x; y = best.y;
  }
  return path;
}

// Union-find used by the room/corridor connector pass.
export class DisjointSet {
  constructor() { this.parent = new Map(); }
  find(a) {
    if (!this.parent.has(a)) { this.parent.set(a, a); return a; }
    let root = a;
    while (this.parent.get(root) !== root) root = this.parent.get(root);
    while (this.parent.get(a) !== root) { const n = this.parent.get(a); this.parent.set(a, root); a = n; }
    return root;
  }
  union(a, b) {
    const ra = this.find(a), rb = this.find(b);
    if (ra === rb) return false;
    this.parent.set(ra, rb);
    return true;
  }
  connected(a, b) { return this.find(a) === this.find(b); }
}

export function rectCells(rect) {
  const out = [];
  for (let y = rect.y0; y <= rect.y1; y++)
    for (let x = rect.x0; x <= rect.x1; x++) out.push({ x, y });
  return out;
}

export function rectCentre(rect) {
  return { x: (rect.x0 + rect.x1) >> 1, y: (rect.y0 + rect.y1) >> 1 };
}

export function rectContains(rect, x, y) {
  return x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1;
}
