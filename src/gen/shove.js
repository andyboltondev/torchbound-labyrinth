// Where a stone can end up, and whether the depth survives it.
//
// A pushable stone only ever moves away from whoever is pushing it: there is
// no verb that draws one back towards you. Every shove is therefore one-way,
// which makes a stone standing in a one-tile doorway a door that closes once.
//
// The generator already proves a stone is harmless *where it starts* -- treat
// its tile as wall and the depth loses no ground. That says nothing about the
// tiles it can be shoved onto. A stone walked three tiles down a corridor and
// jammed against the far wall can cut a depth in half with the player on the
// wrong side of it, and no amount of pushing will open it again.
//
// So the question here is not "is this stone in the way", it is "can any
// sequence of legal shoves put it somewhere the depth cannot recover from".
//
// The search runs over states of (where every stone stands, which region the
// player is standing in). A shove needs the player directly behind the stone
// and in the same region as that tile; afterwards the stone has moved one
// tile on and the player stands where it was. A state is ACCEPTABLE when
// everything the depth requires is still reachable on foot, and STRANDED when
// it can be reached from the start but no sequence of further shoves gets
// back to an acceptable one. A stranded state is a run that has to be
// abandoned, so one reachable stranded state condemns the placement.

import { N4 } from './grid.js';

// Enough for the two or three stones a depth ever carries. A search that runs
// past it is reported as unproven rather than as safe, so the generator
// declines the placement instead of shipping something it did not check.
const STATE_CAP = 600;

export function shoveOutcome(grid, { entrance, blocks, pockets, targets, passable }) {
  const stones = (blocks || []).map((b) => grid.idx(b.x, b.y));
  if (!stones.length) return { safe: true, proven: true, example: null };

  const n = grid.w * grid.h;
  const open = new Uint8Array(n);
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      const i = y * grid.w + x;
      open[i] = passable(x, y, grid.cells[i]) ? 1 : 0;
    }
  }
  const pocket = new Uint8Array(n);
  for (const p of pockets || []) pocket[grid.idx(p.x, p.y)] = 1;
  const need = (targets || []).map((t) => grid.idx(Math.floor(t.x), Math.floor(t.y)));

  // One reusable visited buffer stamped with a rising epoch: there are
  // hundreds of floods and allocating a Set for each is most of the cost.
  const seen = new Int32Array(n);
  const work = new Int32Array(n);
  let epoch = 0;

  // Floods on foot from `from` with `closed` treated as stone. Reports the
  // lowest tile index touched -- a stable name for the region, so two states
  // that leave the player anywhere in the same region collapse into one --
  // and whether everything required is inside it.
  const flood = (from, closed) => {
    const mine = ++epoch;
    let top = 0, min = from;
    seen[from] = mine; work[top++] = from;
    while (top) {
      const i = work[--top];
      if (i < min) min = i;
      const x = i % grid.w, y = (i - x) / grid.w;
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= grid.w || ny >= grid.h) continue;
        const ni = ny * grid.w + nx;
        if (seen[ni] === mine || !open[ni] || closed.indexOf(ni) >= 0) continue;
        seen[ni] = mine; work[top++] = ni;
      }
    }
    let ok = true;
    for (const t of need) if (seen[t] !== mine) { ok = false; break; }
    return { min, ok, mine };
  };

  const states = new Map();
  const queue = [];
  const add = (bl, player) => {
    const { min, ok } = flood(player, bl);
    const key = bl.join(',') + '#' + min;
    const found = states.get(key);
    if (found) return found;
    const state = { bl, player, key, ok, prev: [], from: null, via: null, root: false };
    states.set(key, state);
    queue.push(state);
    return state;
  };

  const root = add(stones.slice(), grid.idx(Math.floor(entrance.x), Math.floor(entrance.y)));
  root.root = true;

  let capped = false;
  while (queue.length) {
    const s = queue.shift();
    if (states.size > STATE_CAP) { capped = true; break; }
    // Re-flood so membership can be answered off the stamp rather than off a
    // stored set: every question asked while expanding this state is about
    // the same region.
    const { mine } = flood(s.player, s.bl);
    for (let bi = 0; bi < s.bl.length; bi++) {
      const i = s.bl[bi], bx = i % grid.w, by = (i - bx) / grid.w;
      for (const [dx, dy] of N4) {
        const tx = bx + dx, ty = by + dy;
        if (!grid.inBounds(tx, ty)) continue;
        const ti = ty * grid.w + tx;
        // Where it would go has to be ordinary open ground, empty of other
        // stones, and never the pocket it is guarding -- that last refusal is
        // the one World.tryPush makes, and it has to be modelled here or the
        // search would credit the player with a move the game forbids.
        if (!open[ti] || pocket[ti] || s.bl.indexOf(ti) >= 0) continue;
        // ...and the player has to be able to stand behind it and press.
        const pi = (by - dy) * grid.w + (bx - dx);
        if (!grid.inBounds(bx - dx, by - dy) || !open[pi]) continue;
        if (s.bl.indexOf(pi) >= 0 || seen[pi] !== mine) continue;
        const bl = s.bl.slice();
        bl[bi] = ti;
        const next = add(bl, i);
        next.prev.push(s);
        if (!next.from && !next.root && next !== s) {
          next.from = s;
          next.via = { bx, by, dx, dy };
        }
      }
    }
  }

  // Walk backwards from every acceptable state. Anything the walk does not
  // reach cannot get back to one, and is stranded for good.
  const rescued = new Set();
  const back = [];
  for (const s of states.values()) if (s.ok) { rescued.add(s.key); back.push(s); }
  while (back.length) {
    const s = back.pop();
    for (const other of s.prev) {
      if (rescued.has(other.key)) continue;
      rescued.add(other.key);
      back.push(other);
    }
  }
  let stranded = null;
  for (const s of states.values()) if (!rescued.has(s.key)) { stranded = s; break; }

  return {
    safe: !stranded,
    proven: !capped,
    states: states.size,
    example: stranded ? describe(grid, stranded) : null,
  };
}

// A stranded state is only useful if it can be reproduced, so it is reported
// as the shoves that reach it rather than as a set of coordinates.
function describe(grid, state) {
  const tile = (i) => (i % grid.w) + ',' + ((i - (i % grid.w)) / grid.w);
  const steps = [];
  let hops = 0;
  for (let cur = state; cur && cur.from && hops++ < 64; cur = cur.from) {
    const { bx, by, dx, dy } = cur.via;
    const way = dx === 1 ? 'east' : dx === -1 ? 'west' : dy === 1 ? 'south' : 'north';
    steps.unshift(`stand at ${bx - dx},${by - dy} and shove ${bx},${by} ${way}`);
  }
  return { stones: state.bl.map(tile), player: tile(state.player), steps };
}
