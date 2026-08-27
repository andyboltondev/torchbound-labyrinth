// Procedural dungeon generation.
//
// Structure follows the staged-region model: a level is a CHAIN of zones,
// each internally connected, joined to the next by exactly one tunnel with a
// colour-coded gate on it. Because the joining tunnel is the only crossing,
// every gate is a genuine bottleneck by construction and the key for gate N
// can be placed anywhere in zones 0..N and still be guaranteed reachable.
//
//   Entrance -> [zone 0] -> Red Gate -> [zone 1] -> Blue Gate -> [zone 2] -> Stairs
//
// Everything optional (secrets, side chambers, challenge rooms) hangs off a
// zone without ever being load-bearing for progression.

import { RNG } from '../core/rng.js';
import { clamp } from '../core/util.js';
import { T, keyColour } from './tiles.js';
import { Grid, bfsField, N4, DisjointSet, rectCentre, rectContains } from './grid.js';
import { placeDecals } from './decals.js';
import { HAZARDS, BIOME_HAZARDS, BIOMES, pairAllowed, hazardBudget, biomeForDepth } from './biomes.js';
import { enemyPoolFor, bossForDepth, BEHAVIOUR } from '../game/enemyData.js';
import { validateLevel } from './validate.js';

const MIN_ZONE_SPAN = 14;

const oddUp = (v) => (v % 2 === 0 ? v + 1 : v);
const evenNear = (v) => (v % 2 === 0 ? v : v - 1);

// The grid is taller than the maze: the strip below it holds hidden vaults,
// which are carved disconnected from everything and reachable only by ladder.
const VAULT_BAND = 17;

function levelSize(depth) {
  const d = Math.min(depth, 14);
  // Levels grow steadily with depth. The growth eases very slightly on the
  // depths that add a staged region, since a new region already lengthens the
  // route on its own, but the overall trend stays upward.
  const zones = zonesForDepth(depth);
  const w = oddUp(Math.round(25 + d * 2.7 - (zones - 1) * 1.2));
  const h = oddUp(Math.round(21 + d * 2.5 - (zones - 1) * 1.1));
  return { w, h, band: VAULT_BAND };
}

// Staged regions are the single largest difficulty step in the game: each
// one adds a key hunt, a gate and roughly another region's worth of fighting
// on the same health bar. They are spaced widely on purpose, so the player
// meets a second gate with more health, more relics and a crossbow in hand.
function zonesForDepth(depth) {
  if (depth <= 2) return 1;
  if (depth <= 8) return 2;
  if (depth <= 14) return 3;
  return 4;
}

// --- zone chain -----------------------------------------------------------
// Axes strictly alternate, which guarantees each new zone still touches the
// previous boundary line, so consecutive zones are always adjacent.
function splitZoneChain(rect, count, rng) {
  const axes = [];
  let axis = (rect.x1 - rect.x0) >= (rect.y1 - rect.y0) ? 'x' : 'y';
  for (let i = 0; i < count - 1; i++) { axes.push(axis); axis = axis === 'x' ? 'y' : 'x'; }

  const zones = [];
  let cur = { ...rect };
  for (let i = 0; i < axes.length; i++) {
    const a = axes[i];
    let futureCuts = 0;
    for (let j = i; j < axes.length; j++) if (axes[j] === a) futureCuts++;

    const lo = a === 'x' ? cur.x0 : cur.y0;
    const hi = a === 'x' ? cur.x1 : cur.y1;
    if (hi - lo < MIN_ZONE_SPAN * (futureCuts + 1)) break; // no room: stop early

    const minCut = lo + MIN_ZONE_SPAN;
    const maxCut = hi - MIN_ZONE_SPAN * futureCuts;
    let b = evenNear(rng.int(minCut, Math.max(minCut, maxCut)));
    if (b <= lo + 2) b = lo + 4;
    if (b >= hi - 2) b = hi - 4;
    b = evenNear(b);

    if (a === 'x') {
      zones.push({ x0: cur.x0, y0: cur.y0, x1: b, y1: cur.y1 });
      cur = { x0: b, y0: cur.y0, x1: cur.x1, y1: cur.y1 };
    } else {
      zones.push({ x0: cur.x0, y0: cur.y0, x1: cur.x1, y1: b });
      cur = { x0: cur.x0, y0: b, x1: cur.x1, y1: cur.y1 };
    }
  }
  zones.push(cur);
  return zones;
}

// Shared edge between two zone rectangles, or null if they only touch a corner.
function sharedBoundary(a, b) {
  const overlapY = [Math.max(a.y0, b.y0), Math.min(a.y1, b.y1)];
  const overlapX = [Math.max(a.x0, b.x0), Math.min(a.x1, b.x1)];
  if (a.x1 === b.x0 && overlapY[1] - overlapY[0] >= 4)
    return { axis: 'x', at: a.x1, lo: overlapY[0], hi: overlapY[1] };
  if (b.x1 === a.x0 && overlapY[1] - overlapY[0] >= 4)
    return { axis: 'x', at: a.x0, lo: overlapY[0], hi: overlapY[1] };
  if (a.y1 === b.y0 && overlapX[1] - overlapX[0] >= 4)
    return { axis: 'y', at: a.y1, lo: overlapX[0], hi: overlapX[1] };
  if (b.y1 === a.y0 && overlapX[1] - overlapX[0] >= 4)
    return { axis: 'y', at: a.y0, lo: overlapX[0], hi: overlapX[1] };
  return null;
}

// --- carving a single zone ------------------------------------------------
// Rooms first, then a perfect maze through the leftover odd-parity lattice,
// then connectors merge everything into one region. This is what gives the
// level its "rooms joined by a labyrinth" character rather than a plain maze.

function carveZone(grid, rect, rng, regions, state, zoneId) {
  const ix0 = rect.x0 + 1, iy0 = rect.y0 + 1;
  const ix1 = rect.x1 - 1, iy1 = rect.y1 - 1;
  const rooms = [];
  const startX = oddUp(ix0), startY = oddUp(iy0);

  const inInterior = (x, y) => x >= ix0 && y >= iy0 && x <= ix1 && y <= iy1;
  const carve = (x, y, region) => { grid.set(x, y, T.FLOOR); regions[grid.idx(x, y)] = region; };

  // -- rooms
  const area = (ix1 - ix0) * (iy1 - iy0);
  const tries = Math.max(24, Math.floor(area / 18));
  for (let t = 0; t < tries; t++) {
    let rw = rng.int(1, 4) * 2 + 1;
    let rh = rng.int(1, 3) * 2 + 1;
    if (rng.bool(0.25)) rw += 2;
    if (rng.bool(0.2)) rh += 2;
    if (ix1 - rw < startX || iy1 - rh < startY) continue;
    const x = startX + rng.int(0, Math.floor((ix1 - rw - startX) / 2)) * 2;
    const y = startY + rng.int(0, Math.floor((iy1 - rh - startY) / 2)) * 2;
    const r = { x0: x, y0: y, x1: x + rw - 1, y1: y + rh - 1 };
    if (r.x1 > ix1 || r.y1 > iy1) continue;
    // Keep one solid cell between rooms so they read as separate chambers.
    let clash = false;
    for (const other of rooms) {
      if (r.x0 <= other.x1 + 1 && r.x1 >= other.x0 - 1 &&
          r.y0 <= other.y1 + 1 && r.y1 >= other.y0 - 1) { clash = true; break; }
    }
    if (clash) continue;
    const region = state.nextRegion++;
    for (let yy = r.y0; yy <= r.y1; yy++)
      for (let xx = r.x0; xx <= r.x1; xx++) carve(xx, yy, region);
    rooms.push({ ...r, region, zone: zoneId, kind: 'normal', id: state.nextRoomId++ });
  }

  // -- maze through the remaining lattice
  const WINDING = 0.42;
  const growMaze = (sx, sy) => {
    const region = state.nextRegion++;
    carve(sx, sy, region);
    const stack = [{ x: sx, y: sy }];
    let lastDir = null;
    while (stack.length) {
      const cell = stack[stack.length - 1];
      const options = [];
      for (const [dx, dy] of N4) {
        const mx = cell.x + dx, my = cell.y + dy;
        const nx = cell.x + dx * 2, ny = cell.y + dy * 2;
        if (!inInterior(nx, ny)) continue;
        if (grid.get(nx, ny) !== T.WALL || grid.get(mx, my) !== T.WALL) continue;
        options.push([dx, dy]);
      }
      if (!options.length) { stack.pop(); lastDir = null; continue; }
      let dir;
      const straight = lastDir && options.some(([dx, dy]) => dx === lastDir[0] && dy === lastDir[1]);
      if (straight && rng.next() > WINDING) dir = lastDir;
      else dir = rng.pick(options);
      carve(cell.x + dir[0], cell.y + dir[1], region);
      carve(cell.x + dir[0] * 2, cell.y + dir[1] * 2, region);
      stack.push({ x: cell.x + dir[0] * 2, y: cell.y + dir[1] * 2 });
      lastDir = dir;
    }
  };
  for (let y = startY; y <= iy1; y += 2)
    for (let x = startX; x <= ix1; x += 2)
      if (grid.get(x, y) === T.WALL) growMaze(x, y);

  // -- connectors: merge every region inside this zone into one
  const connectors = new Map(); // idx -> Set(region)
  for (let y = iy0; y <= iy1; y++) {
    for (let x = ix0; x <= ix1; x++) {
      if (grid.get(x, y) !== T.WALL) continue;
      const near = new Set();
      for (const [dx, dy] of N4) {
        const r = regions[grid.idx(x + dx, y + dy)];
        if (r >= 0 && grid.get(x + dx, y + dy) === T.FLOOR) near.add(r);
      }
      if (near.size >= 2) connectors.set(grid.idx(x, y), near);
    }
  }
  const ds = new DisjointSet();
  const keys = rng.shuffle(Array.from(connectors.keys()));
  const opened = new Set();
  for (const idx of keys) {
    const near = Array.from(connectors.get(idx));
    const already = near.every((r) => ds.connected(near[0], r));
    const x = idx % grid.w, y = (idx / grid.w) | 0;
    // Avoid two openings side by side -- reads as a hole, not a doorway.
    const crowded = N4.some(([dx, dy]) => opened.has(grid.idx(x + dx, y + dy)));
    if (!already) {
      for (let i = 1; i < near.length; i++) ds.union(near[0], near[i]);
      grid.set(x, y, T.FLOOR);
      regions[idx] = near[0];
      opened.add(idx);
    } else if (!crowded && rng.bool(0.05)) {
      // A few deliberate loops so the labyrinth is not a pure tree.
      grid.set(x, y, T.FLOOR);
      regions[idx] = near[0];
      opened.add(idx);
    }
  }

  // -- prune some dead ends; keep plenty, the spec wants them
  const roomCells = new Set();
  for (const r of rooms)
    for (let y = r.y0; y <= r.y1; y++)
      for (let x = r.x0; x <= r.x1; x++) roomCells.add(grid.idx(x, y));
  for (let pass = 0; pass < 5; pass++) {
    const removals = [];
    for (let y = iy0; y <= iy1; y++) {
      for (let x = ix0; x <= ix1; x++) {
        if (grid.get(x, y) !== T.FLOOR) continue;
        if (roomCells.has(grid.idx(x, y))) continue;
        let exits = 0;
        for (const [dx, dy] of N4) if (grid.get(x + dx, y + dy) !== T.WALL) exits++;
        if (exits === 1 && rng.bool(0.42)) removals.push([x, y]);
      }
    }
    for (const [x, y] of removals) { grid.set(x, y, T.WALL); regions[grid.idx(x, y)] = -1; }
  }

  return rooms;
}

// --- joining zones with a gate -------------------------------------------
// Bores a tunnel from the boundary line into each zone until it meets that
// zone's existing floor, then drops the gate on the single crossing cell.

function tunnelToFloor(grid, x, y, dx, dy, rect, maxLen = 12) {
  const cells = [];
  for (let i = 0; i < maxLen; i++) {
    if (x <= rect.x0 || y <= rect.y0 || x >= rect.x1 || y >= rect.y1) return null;
    const t = grid.get(x, y);
    if (t === T.FLOOR) return cells;
    if (t !== T.WALL) return null;
    cells.push({ x, y });
    x += dx; y += dy;
  }
  return null;
}

function joinZones(grid, a, b, rng, colourIndex, zoneFrom, zoneTo) {
  const bound = sharedBoundary(a, b);
  if (!bound) return null;
  const candidates = [];
  for (let v = bound.lo + 2; v <= bound.hi - 2; v++) candidates.push(v);
  rng.shuffle(candidates);
  // Prefer short tunnels: they read as a doorway rather than a bored shaft.
  const scored = [];
  for (const v of candidates) {
    const gx = bound.axis === 'x' ? bound.at : v;
    const gy = bound.axis === 'x' ? v : bound.at;
    const dx = bound.axis === 'x' ? 1 : 0;
    const dy = bound.axis === 'x' ? 0 : 1;
    const back = tunnelToFloor(grid, gx - dx, gy - dy, -dx, -dy, a);
    const fwd = tunnelToFloor(grid, gx + dx, gy + dy, dx, dy, b);
    if (!back || !fwd) continue;
    scored.push({ gx, gy, dx, dy, cells: back.concat(fwd), len: back.length + fwd.length });
    if (scored.length >= 12) break;
  }
  if (!scored.length) return null;
  scored.sort((p, q) => p.len - q.len);
  const chosen = scored[Math.min(scored.length - 1, rng.int(0, 2))];
  for (const c of chosen.cells) grid.set(c.x, c.y, T.FLOOR);
  grid.set(chosen.gx, chosen.gy, T.GATE);
  return {
    x: chosen.gx, y: chosen.gy, colourIndex, zoneFrom, zoneTo,
    // 'x' means the passage runs east-west, so the door panel faces along x.
    passage: bound.axis, open: false, id: 'gate' + colourIndex,
  };
}

// --- reachability helpers -------------------------------------------------

function makePassable(level, openGateCount) {
  const gateIdx = new Map();
  level.gates.forEach((g, i) => gateIdx.set(level.grid.idx(g.x, g.y), i));
  return (x, y, t) => {
    if (t === T.FLOOR || t === T.STAIRS || t === T.ENTRANCE) return true;
    if (t === T.GATE) {
      const i = gateIdx.get(level.grid.idx(x, y));
      return i !== undefined && i < openGateCount;
    }
    return false;
  };
}

// Picks a cell that is genuinely far away, biased toward rooms and dead ends
// so keys feel deliberately hidden rather than dropped in a corridor.
function pickFarCell(grid, dist, rng, opts = {}) {
  const { minFrac = 0.5, filter = null, preferRooms = null, avoid = [] } = opts;
  let maxD = 0;
  for (let i = 0; i < dist.length; i++) if (dist[i] > maxD) maxD = dist[i];
  if (maxD === 0) return null;
  const threshold = maxD * minFrac;
  const pool = [];
  for (let i = 0; i < dist.length; i++) {
    const d = dist[i];
    if (d < threshold) continue;
    const x = i % grid.w, y = (i / grid.w) | 0;
    if (grid.get(x, y) !== T.FLOOR) continue;
    if (filter && !filter(x, y)) continue;
    if (avoid.some((p) => Math.abs(p.x - x) + Math.abs(p.y - y) < (p.r || 6))) continue;
    let weight = 1 + (d / maxD) * 2;
    if (preferRooms && preferRooms(x, y)) weight *= 2.4;
    let exits = 0;
    for (const [dx, dy] of N4) if (grid.get(x + dx, y + dy) !== T.WALL) exits++;
    if (exits === 1) weight *= 1.9; // dead ends make satisfying stashes
    pool.push({ x, y, weight });
  }
  if (!pool.length) return null;
  return rng.weighted(pool, (p) => p.weight);
}

function zoneOf(zones, x, y) {
  for (let i = 0; i < zones.length; i++) if (rectContains(zones[i], x, y)) return i;
  return 0;
}

// --- secret walls ---------------------------------------------------------
// Two flavours: a sealed closet behind a dead end (treasure), and a genuine
// shortcut through a wall that already has floor on both sides. Neither is
// ever load-bearing -- the validator treats SECRET as solid rock.

const PERP = { '1,0': [0, 1], '-1,0': [0, 1], '0,1': [1, 0], '0,-1': [1, 0] };

// `maxY` is the first row a closet may not touch. The vaults live in a strip
// below the maze on the same grid, and a pocket two cells deep dug from the
// bottom row of the maze reached straight into it -- which quietly made a
// vault walkable and turned its ladder into scenery.
function tryCloset(grid, x, y, dir, reserved, maxY) {
  const [dx, dy] = dir;
  const [px, py] = PERP[dx + ',' + dy];
  const bx = x - dx, by = y - dy; // first cell on the far side of the wall

  // Try a roomy pocket first and fall back to smaller ones, so a cracked wall
  // can still hide something even in a tightly packed part of the maze.
  const shapes = [
    [[0, 0], [-dx, -dy], [px, py], [-px, -py]],
    [[0, 0], [-dx, -dy], [px, py]],
    [[0, 0], [-dx, -dy]],
    [[0, 0]],
  ];

  for (const shape of shapes) {
    const cells = shape.map(([ox, oy]) => ({ x: bx + ox, y: by + oy }));
    const own = new Set(cells.map((c) => grid.idx(c.x, c.y)));
    own.add(grid.idx(x, y));
    let ok = true;
    for (const c of cells) {
      if (c.x <= 1 || c.y <= 1 || c.x >= grid.w - 2 || c.y >= grid.h - 2) { ok = false; break; }
      if (maxY !== undefined && c.y >= maxY) { ok = false; break; }
      if (grid.get(c.x, c.y) !== T.WALL || reserved.has(grid.idx(c.x, c.y))) { ok = false; break; }
      // The pocket must not already touch open floor, or it is not a secret.
      for (const [nx, ny] of N4) {
        const i = grid.idx(c.x + nx, c.y + ny);
        if (own.has(i)) continue;
        if (grid.cells[i] !== T.WALL) { ok = false; break; }
      }
      if (!ok) break;
    }
    if (ok) return cells;
  }
  return null;
}

function addSecrets(level, rng, depth) {
  const { grid } = level;
  const reserved = new Set();
  const wanted = 1 + (depth >= 3 ? 1 : 0) + (rng.bool(0.3) ? 1 : 0);
  const closetSpots = [];
  const shortcutSpots = [];

  for (let y = 2; y < grid.h - 2; y++) {
    for (let x = 2; x < grid.w - 2; x++) {
      if (grid.get(x, y) !== T.WALL) continue;
      let floors = 0, dir = null;
      for (const [dx, dy] of N4) {
        if (grid.get(x + dx, y + dy) === T.FLOOR) { floors++; dir = [dx, dy]; }
      }
      if (floors === 1) closetSpots.push({ x, y, dir });
      else if (floors === 2) {
        const h = grid.get(x - 1, y) === T.FLOOR && grid.get(x + 1, y) === T.FLOOR;
        const v = grid.get(x, y - 1) === T.FLOOR && grid.get(x, y + 1) === T.FLOOR;
        if (h || v) shortcutSpots.push({ x, y, horizontal: h });
      }
    }
  }

  rng.shuffle(closetSpots);
  for (const spot of closetSpots) {
    if (level.secrets.length >= wanted) break;
    const cells = tryCloset(grid, spot.x, spot.y, spot.dir, reserved, level.mazeHeight);
    if (!cells) continue;
    for (const c of cells) { grid.set(c.x, c.y, T.FLOOR); reserved.add(grid.idx(c.x, c.y)); }
    reserved.add(grid.idx(spot.x, spot.y));
    grid.set(spot.x, spot.y, T.SECRET);
    level.secrets.push({
      x: spot.x, y: spot.y, kind: 'closet', cells,
      zone: zoneOf(level.zones, spot.x, spot.y),
      broken: false, discovered: false,
    });
  }

  // One optional shortcut, chosen only where it actually saves a long walk.
  if (shortcutSpots.length && rng.bool(0.55)) {
    const passable = makePassable(level, level.gates.length);
    rng.shuffle(shortcutSpots);
    for (const spot of shortcutSpots.slice(0, 40)) {
      const a = spot.horizontal ? { x: spot.x - 1, y: spot.y } : { x: spot.x, y: spot.y - 1 };
      const b = spot.horizontal ? { x: spot.x + 1, y: spot.y } : { x: spot.x, y: spot.y + 1 };
      const field = bfsField(grid, [a], passable);
      const d = field[grid.idx(b.x, b.y)];
      if (d >= 22) {
        grid.set(spot.x, spot.y, T.SECRET);
        level.secrets.push({
          x: spot.x, y: spot.y, kind: 'shortcut', cells: [],
          zone: zoneOf(level.zones, spot.x, spot.y), broken: false, discovered: false,
        });
        break;
      }
    }
  }
}

// --- encounters -----------------------------------------------------------

function roomFloorCells(grid, room) {
  const out = [];
  for (let y = room.y0; y <= room.y1; y++)
    for (let x = room.x0; x <= room.x1; x++)
      if (grid.get(x, y) === T.FLOOR) out.push({ x, y });
  return out;
}

function spawnGroup(level, rng, room, depth, count, opts = {}) {
  const cells = rng.shuffle(roomFloorCells(level.grid, room));
  const pool = enemyPoolFor(depth);
  const made = [];
  const zoneBias = 1 + room.zone * 0.35;
  for (let i = 0; i < count && i < cells.length; i++) {
    const entry = rng.weighted(pool, (p) => p.weight * (p.def.minDepth >= depth - 2 ? zoneBias : 1));
    const def = entry.def;
    made.push({
      defId: def.id, x: cells[i].x + 0.5, y: cells[i].y + 0.5,
      elite: opts.elite && i === 0 ? true : rng.bool(opts.eliteChance || 0),
      dormant: opts.dormant !== undefined ? opts.dormant : def.behaviour === BEHAVIOUR.AMBUSHER,
      zone: room.zone, encounter: opts.encounterId || null,
      anchor: { x: cells[i].x + 0.5, y: cells[i].y + 0.5 },
      guard: !!opts.guard,
    });
  }
  level.spawns.push(...made);
  return made;
}

function buildEncounters(level, rng, depth) {
  // Optional set pieces are kept away from the entrance so a run never
  // opens with an ambush the player had no chance to see coming.
  const farEnough = (r) => Math.hypot(
    (r.x0 + r.x1) / 2 - level.entrance.x, (r.y0 + r.y1) / 2 - level.entrance.y) > 11;
  const rooms = level.rooms.filter((r) => r.kind === 'normal' && farEnough(r));
  rng.shuffle(rooms);
  const take = () => rooms.pop();

  // 1. Guarded keys -- the key rooms become miniature set pieces.
  for (const key of level.keys) {
    if (!key.room) continue;
    const id = 'enc_key_' + key.colourIndex;
    const count = 2 + rng.int(0, 1) + Math.floor(depth / 6);
    const enemies = spawnGroup(level, rng, key.room, depth, count, {
      encounterId: id, dormant: true, guard: true,
      elite: depth >= 9 && rng.bool(0.4),
    });
    key.room.kind = 'guardedKey';
    level.encounters.push({
      id, type: 'guardedKey', room: key.room, zone: key.room.zone,
      seal: depth >= 8 && rng.bool(0.4), waves: 0, count: enemies.length,
      state: 'idle', flawless: true, scoreBonus: 250 + depth * 20,
      label: keyColour(key.colourIndex).name + ' Key -- guarded',
    });
  }

  // 2. Optional challenge room: clearly marked, clearly harder, clearly worth it.
  if (depth >= 8 && rng.bool(0.4) && rooms.length) {
    const room = take();
    const id = 'enc_challenge';
    room.kind = 'challenge';
    const enemies = spawnGroup(level, rng, room, depth, 3 + rng.int(1, 3), {
      encounterId: id, dormant: true, elite: true, eliteChance: 0.3,
    });
    level.encounters.push({
      id, type: 'challenge', room, zone: room.zone, optional: true,
      seal: true, waves: 0, count: enemies.length, state: 'idle',
      flawless: true, scoreBonus: 600 + depth * 45,
      reward: rng.pick(['chest', 'chest', 'shrine', 'arrows']),
      label: 'Trial of the Fallen',
    });
  }

  // 3. Survival room: hold the ground while waves arrive.
  if (depth >= 10 && rng.bool(0.32) && rooms.length) {
    const room = take();
    const id = 'enc_survival';
    room.kind = 'survival';
    level.encounters.push({
      id, type: 'survival', room, zone: room.zone, optional: true,
      seal: true, waves: 2 + Math.floor(depth / 6), waveSize: 3 + Math.floor(depth / 4),
      state: 'idle', flawless: true, scoreBonus: 750 + depth * 55,
      duration: 0, reward: 'chest', label: 'The Holding',
    });
  }

  // 4. A plain ambush somewhere along the route.
  if (depth >= 4 && rng.bool(0.55) && rooms.length) {
    const room = take();
    const id = 'enc_ambush';
    room.kind = 'ambush';
    const enemies = spawnGroup(level, rng, room, depth, 2 + rng.int(1, 2), {
      encounterId: id, dormant: true,
    });
    level.encounters.push({
      id, type: 'ambush', room, zone: room.zone, seal: false, waves: 0,
      count: enemies.length, state: 'idle', flawless: true,
      scoreBonus: 200 + depth * 15, label: 'Ambush',
    });
  }

  level.freeRooms = rooms;
}

// --- props, pickups and decoration ---------------------------------------

function addPostBattleChambers(level, rng) {
  for (const enc of level.encounters) {
    if (!rng.bool(0.28)) continue;
    const room = enc.room;
    if (!room) continue;
    const perimeter = [];
    for (let y = room.y0 - 1; y <= room.y1 + 1; y++) {
      for (let x = room.x0 - 1; x <= room.x1 + 1; x++) {
        if (level.grid.get(x, y) !== T.WALL) continue;
        let floors = 0, dir = null;
        for (const [dx, dy] of N4)
          if (level.grid.get(x + dx, y + dy) === T.FLOOR) { floors++; dir = [dx, dy]; }
        if (floors === 1) perimeter.push({ x, y, dir });
      }
    }
    rng.shuffle(perimeter);
    for (const spot of perimeter) {
      const cells = tryCloset(level.grid, spot.x, spot.y, spot.dir, level._reserved, level.mazeHeight);
      if (!cells) continue;
      for (const c of cells) {
        level.grid.set(c.x, c.y, T.FLOOR);
        level._reserved.add(level.grid.idx(c.x, c.y));
      }
      level._reserved.add(level.grid.idx(spot.x, spot.y));
      level.grid.set(spot.x, spot.y, T.SECRET);
      level.secrets.push({
        x: spot.x, y: spot.y, kind: 'chamber', cells,
        zone: room.zone, broken: false, discovered: false,
        hiddenUntil: enc.id, // cracks only appear once the fight is won
      });
      enc.revealSecret = level.secrets.length - 1;
      const c = cells[0];
      level.props.push({
        type: rng.pick(['shrineSmall', 'chest', 'potion', 'arrows']),
        x: c.x + 0.5, y: c.y + 0.5, hidden: true, secret: level.secrets.length - 1,
        id: 'prop_chamber_' + enc.id, amount: 2, heal: 30,
      });
      break;
    }
  }
}

function addProps(level, rng, depth, ctx) {
  const { grid } = level;
  const busy = new Set();
  const mark = (x, y, r = 1) => {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) busy.add(grid.idx(Math.round(x) + dx, Math.round(y) + dy));
  };
  mark(level.entrance.x, level.entrance.y, 2);
  mark(level.stairs.x, level.stairs.y, 2);
  for (const g of level.gates) mark(g.x, g.y, 1);
  for (const k of level.keys) mark(k.x, k.y, 1);
  for (const s of level.spawns) mark(s.x, s.y, 0);

  const candidates = [];
  for (const { x, y } of level.floorCells) {
    if (busy.has(grid.idx(x, y))) continue;
    let exits = 0;
    for (const [dx, dy] of N4) if (grid.get(x + dx, y + dy) !== T.WALL) exits++;
    candidates.push({ x, y, deadEnd: exits === 1 });
  }
  rng.shuffle(candidates);
  const takeSpot = (preferDeadEnd = false) => {
    const idx = preferDeadEnd ? candidates.findIndex((c) => c.deadEnd) : -1;
    const c = idx >= 0 ? candidates.splice(idx, 1)[0] : candidates.pop();
    if (c) mark(c.x, c.y, 1);
    return c;
  };
  const place = (type, extra = {}, preferDeadEnd = false) => {
    const c = takeSpot(preferDeadEnd);
    if (!c) return null;
    const prop = { type, x: c.x + 0.5, y: c.y + 0.5, id: type + '_' + level.props.length, ...extra };
    level.props.push(prop);
    return prop;
  };

  // Secret closets always hold something worth the swing.
  for (let i = 0; i < level.secrets.length; i++) {
    const s = level.secrets[i];
    if (s.kind !== 'closet' || !s.cells.length) continue;
    const c = s.cells[0];
    const type = rng.weighted(['chest', 'arrows', 'potion', 'shrineSmall', 'treasure'],
      (t) => (t === 'chest' ? 3 : t === 'treasure' ? 2 : 1.5));
    level.props.push({
      type, x: c.x + 0.5, y: c.y + 0.5, secret: i, hidden: true,
      id: 'prop_secret_' + i, amount: rng.int(2, 3), heal: 30 + depth,
    });
  }

  // The crossbow enters the pool at depth 3 and is guaranteed by depth 7.
  let crossbowHere = false;
  if (!ctx.hasCrossbow && depth >= 3) {
    // A ranged option should be in hand before the depths get busy, not
    // arriving as a curiosity once the run is already in trouble.
    if (rng.bool(Math.min(1, 0.55 + (depth - 3) * 0.2))) {
      crossbowHere = true;
      const room = level.freeRooms && level.freeRooms.length ? level.freeRooms.pop() : null;
      if (room) {
        const c = rng.pick(roomFloorCells(grid, room));
        level.props.push({ type: 'crossbow', x: c.x + 0.5, y: c.y + 0.5, id: 'crossbow' });
        mark(c.x, c.y, 1);
        room.kind = 'treasure';
      } else {
        place('crossbow', {}, true);
      }
    }
  }
  level.hasCrossbowPickup = crossbowHere;

  if (ctx.hasCrossbow || crossbowHere) {
    for (let i = 0; i < 2 + rng.int(0, 2); i++) place('arrows', { amount: rng.int(1, 3) });
  }
  // Supplies follow the length of the route, not just the depth: a level
  // with three staged regions is two or three times the walking and fighting
  // on the same health bar as a single-region one.
  const draughts = 1 + rng.int(0, 1) + level.zones.length;
  for (let i = 0; i < draughts; i++) place('potion', { heal: 28 + depth * 2 });

  const chestCount = 1 + (depth >= 3 ? 1 : 0) + (rng.bool(0.35) ? 1 : 0);
  for (let i = 0; i < chestCount; i++) {
    const cursed = depth >= 2 && rng.bool(0.3);
    place(cursed ? 'cursedChest' : 'chest', { opened: false }, rng.bool(0.5));
  }
  // A staged level always carries somewhere to recover partway through.
  const staged = level.zones.length >= 3;
  if (staged || rng.bool(0.45)) {
    place('shrine', {
      flavour: staged || rng.bool(0.5) ? 'heal' : 'blessing',
      used: false,
    });
  }
  if (staged && rng.bool(0.5)) place('shrine', { flavour: 'blessing', used: false });

  // Altars. Never on depth one -- the first descent is for learning what the
  // buttons do, not for being asked what a third of your blood is worth --
  // and never more than one on a level, so the choice stays a moment.
  if (depth >= 2 && rng.bool(depth >= 4 ? 0.62 : 0.4)) {
    place('altar', { used: false, seed: rng.next() }, false);
  }
  addBlocks(level, rng, depth, busy, mark);
  addCaptives(level, rng, depth, busy, mark);
  addMaps(level, rng, depth, place);
  addFires(level, rng, depth, candidates, mark);
  addDecor(level, rng, candidates);
}

// Stones somebody put here on purpose.
//
// A block sits on ordinary floor with a one-tile alcove cut into the wall
// beside it, and something worth having in the alcove. The block is solid, so
// the alcove cannot be walked into while it is there; walk into the block
// instead and it slides a tile, and the way is open.
//
// Two rules make this safe rather than a way to wedge a depth shut:
//
//   * A block is never on the route to anything the depth requires. It stands
//     where the floor is wide enough that treating the tile as wall changes
//     nothing about what is reachable -- checked here against the level as
//     generated, and asserted again in validate.js, so a block can never be
//     the reason a labyrinth cannot be finished.
//   * A block is never pushed into its own alcove. That is enforced at the
//     moment of the push (see World.tryPush), because it is the one move that
//     would seal the reward away for good.
//
// They are optional content in the same sense vaults and cracked walls are:
// the autopilot completes every depth without touching one.
function addBlocks(level, rng, depth, busy, mark) {
  const { grid } = level;
  if (level.isBoss) return;

  // What is reachable with every block standing. Compared against the same
  // flood with none, so a block that would cost the player a single tile of
  // the depth is rejected rather than shipped.
  const openFlood = () => bfsField(grid, [level.entrance], (x, y, t) =>
    t === T.FLOOR || t === T.STAIRS || t === T.ENTRANCE || t === T.GATE);
  const before = openFlood();

  const taken = new Set();
  const candidates = [];
  for (const { x, y } of level.floorCells) {
    if (busy.has(grid.idx(x, y))) continue;
    // Room for the player to stand on one side and the block to travel to the
    // other, and enough open ground around it that it is not a bottleneck.
    let open = 0;
    for (const [dx, dy] of N4) if (grid.get(x + dx, y + dy) === T.FLOOR) open++;
    if (open < 3) continue;
    // Somewhere to cut the alcove: solid rock with solid rock on three sides
    // of it, so what is carved is a dead end and never a shortcut.
    for (const [dx, dy] of N4) {
      const wx = x + dx, wy = y + dy;
      if (grid.get(wx, wy) !== T.WALL) continue;
      if (wx < 2 || wy < 2 || wx >= grid.w - 2 || wy >= grid.h - 2) continue;
      let solid = true;
      for (const [ox, oy] of N4) {
        if (ox === -dx && oy === -dy) continue;      // back towards the block
        if (grid.get(wx + ox, wy + oy) !== T.WALL) { solid = false; break; }
      }
      if (!solid) continue;
      // At least one line to be shoved along: floor behind to stand on, floor
      // ahead to travel into, neither of them the alcove.
      const lanes = N4.filter(([px, py]) => (px !== dx || py !== dy)
        && (px !== -dx || py !== -dy)
        && grid.get(x + px, y + py) === T.FLOOR
        && grid.get(x - px, y - py) === T.FLOOR);
      if (!lanes.length) continue;
      candidates.push({ x, y, alcove: { x: wx, y: wy } });
      break;
    }
  }
  rng.shuffle(candidates);

  // Never a gallery of them: one is a curiosity, three is a chore.
  const want = Math.min(candidates.length, rng.int(0, 1) + (depth >= 5 ? 1 : 0));
  for (const spot of candidates) {
    if (level.blocks.length >= want) break;
    if (taken.has(grid.idx(spot.x, spot.y))) continue;

    // Provisionally place it, then prove the depth is no smaller for it.
    const wasWall = grid.get(spot.alcove.x, spot.alcove.y);
    grid.set(spot.alcove.x, spot.alcove.y, T.FLOOR);
    const solidHere = new Set([grid.idx(spot.x, spot.y)]);
    for (const b of level.blocks) solidHere.add(grid.idx(b.x, b.y));
    const after = bfsField(grid, [level.entrance], (x, y, t) => {
      if (solidHere.has(grid.idx(x, y))) return false;
      return t === T.FLOOR || t === T.STAIRS || t === T.ENTRANCE || t === T.GATE;
    });
    let costsGround = false;
    for (let i = 0; i < before.length; i++) {
      if (before[i] < 0 || after[i] >= 0) continue;
      if (solidHere.has(i)) continue;
      costsGround = true;
      break;
    }
    if (costsGround) {
      grid.set(spot.alcove.x, spot.alcove.y, wasWall);
      continue;
    }

    level.floorCells.push({ x: spot.alcove.x, y: spot.alcove.y });
    level.blocks.push({
      id: 'block_' + level.blocks.length,
      x: spot.x, y: spot.y,
      homeX: spot.x, homeY: spot.y,
      alcove: { x: spot.alcove.x, y: spot.alcove.y },
      moved: false,
      seed: rng.next(),
    });
    level.blockPockets.push({ x: spot.alcove.x, y: spot.alcove.y });
    // What is behind it. The same pool a cracked wall pays out, because a
    // stone that has to be shoved is the same size of secret as one that has
    // to be broken, and inventing a new reward tier for it would say otherwise.
    level.props.push({
      type: rng.weighted(['treasure', 'potion', 'arrows'], (t) => (t === 'treasure' ? 2 : 1)),
      x: spot.alcove.x + 0.5, y: spot.alcove.y + 0.5,
      behindBlock: level.blocks[level.blocks.length - 1].id,
    });
    taken.add(grid.idx(spot.x, spot.y));
    mark(spot.x, spot.y, 1);
  }
}

// Somebody else got here first.
//
// Chained to the wall, and in one of four states. Most are dead. Some will
// talk, and what they know is worth more than what they are carrying. Some
// want it over with, and will say so. And some have been down here long
// enough to have stopped making sense, and scream -- which brings company.
function addCaptives(level, rng, depth, busy, mark) {
  const { grid } = level;
  // A captive needs a wall at its back, so the only candidates are floor
  // tiles with exactly one wall neighbour that is not a doorway.
  const spots = [];
  for (const { x, y } of level.floorCells) {
    if (busy.has(grid.idx(x, y))) continue;
    let wall = null, walls = 0, exits = 0;
    for (const [dx, dy] of N4) {
      if (grid.get(x + dx, y + dy) === T.WALL) { walls++; wall = [dx, dy]; }
      else exits++;
    }
    if (walls < 1 || exits < 2) continue;
    spots.push({ x, y, wall });
  }
  rng.shuffle(spots);

  // Deeper levels are longer and hold more of them, but the labyrinth is
  // never a gallery: three is plenty to make a corridor feel occupied.
  const count = Math.min(spots.length, 1 + rng.int(0, 1) + Math.min(2, Math.floor(depth / 4)));
  for (let i = 0; i < count; i++) {
    const spot = spots[i];
    if (!spot) break;
    // Most of them did not last. Of the ones that did, the deeper you are the
    // worse the state they are in.
    const alive = rng.bool(0.55);
    const madness = Math.min(0.5, 0.15 + depth * 0.025);
    const mood = !alive ? 'dead'
      : rng.bool(madness) ? 'raving'
        : rng.bool(0.3) ? 'begging' : 'afraid';
    level.props.push({
      type: 'prisoner',
      x: spot.x + 0.5 + spot.wall[0] * 0.28,
      y: spot.y + 0.5 + spot.wall[1] * 0.28,
      wallX: spot.wall[0], wallY: spot.wall[1],
      mood, seed: rng.next(), spoken: false, searched: false, freed: false,
      // Whether this one wants to die. Kept apart from the mood, which is
      // what the player *sees*: a begging captive is visibly begging from
      // across the room, but what they are begging for is the mechanical
      // question, and it is settled here rather than at the moment of the
      // swing so that the same seed always meets the same person.
      pleadToDie: mood === 'begging',
      // What they know, if they know anything. Resolved when they are spoken
      // to, so it can point at what is still unfound at that moment.
      knows: rng.weighted(['exit', 'key', 'secret', 'treasure', 'nothing'],
        (k) => (k === 'nothing' ? 1.4 : k === 'exit' ? 1.6 : 1)),
      carries: rng.bool(alive ? 0.25 : 0.45)
        ? rng.weighted(['potion', 'arrows', 'treasure'], (t) => (t === 'treasure' ? 1 : 1.6)) : null,
      id: 'prisoner_' + level.props.length,
    });
    mark(spot.x, spot.y, 1);
  }
}

// Somebody's map of somewhere. Scratched into a slate, or rolled up in a dead
// hand. Each one names one thing and marks it on the chart, and the ones
// worth finding are the ones something is standing over.
function addMaps(level, rng, depth, place) {
  const count = 1 + (rng.bool(0.4) ? 1 : 0) + (level.zones.length >= 3 ? 1 : 0);
  for (let i = 0; i < count; i++) {
    place('mapScrap', {
      shows: rng.weighted(['exit', 'key', 'secret', 'treasure', 'health'],
        (k) => (k === 'exit' ? 1.8 : k === 'key' ? 1.4 : 1)),
      read: false,
    }, rng.bool(0.5));
  }
}

// Fire in the labyrinth, in four sizes.
//
// Wall sconces are the small one and have always been here. Above them sit
// braziers, firepits and campfires, which are placed on the floor of the
// rooms big enough to swallow a torch, and which throw enough light to make a
// hall read as a hall. Some are cold: a torchbearer can light those, and once
// lit they stay lit, so a room the player has warmed stays warm on the chart.
function addFires(level, rng, depth, candidates, mark) {
  const { grid } = level;

  // Wall sconces: atmosphere, but they cast a little real light.
  for (let y = 1; y < grid.h - 1; y++) {
    for (let x = 1; x < grid.w - 1; x++) {
      if (grid.get(x, y) !== T.WALL) continue;
      let dir = null, floors = 0;
      for (const [dx, dy] of N4)
        if (grid.get(x + dx, y + dy) === T.FLOOR) { floors++; dir = [dx, dy]; }
      if (floors !== 1 || !rng.bool(0.032)) continue;
      // Roughly a third of them have gone out over the centuries.
      const lit = rng.bool(0.66);
      level.sconces.push({
        kind: 'sconce', x: x + 0.5 + dir[0] * 0.3, y: y + 0.5 + dir[1] * 0.3,
        seed: rng.next(), lit, radius: 3.6, intensity: 0.6,
        id: 'fire_s' + level.sconces.length,
      });
    }
  }

  // The bigger fires want the middle of a big room, and nothing else wants
  // to be standing there.
  const halls = level.rooms
    .filter((r) => r.kind !== 'vault')
    .map((r) => ({ room: r, area: (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1) }))
    .filter((h) => h.area >= 20)
    .sort((a, b) => b.area - a.area);

  for (const h of halls) {
    const r = h.room;
    const cx = Math.floor((r.x0 + r.x1) / 2), cy = Math.floor((r.y0 + r.y1) / 2);
    if (grid.get(cx, cy) !== T.FLOOR) continue;
    if (level._reserved.has(grid.idx(cx, cy))) continue;
    // The largest halls almost always have something burning in them; a
    // middling room is a coin toss, so the labyrinth is never uniformly lit.
    const chance = h.area >= 42 ? 0.85 : h.area >= 28 ? 0.55 : 0.3;
    if (!rng.bool(chance)) continue;
    const kind = h.area >= 42 ? rng.weighted(['firepit', 'campfire'], (k) => (k === 'firepit' ? 2 : 1))
      : rng.weighted(['brazier', 'firepit'], (k) => (k === 'brazier' ? 2 : 1));
    const size = kind === 'campfire' ? { radius: 6.4, intensity: 0.95 }
      : kind === 'firepit' ? { radius: 5.4, intensity: 0.85 }
        : { radius: 4.4, intensity: 0.7 };
    level.sconces.push({
      kind, x: cx + 0.5, y: cy + 0.5, seed: rng.next(),
      // Deeper down, more of them have gone cold.
      lit: rng.bool(Math.max(0.32, 0.78 - depth * 0.03)),
      radius: size.radius, intensity: size.intensity,
      id: 'fire_b' + level.sconces.length,
    });
    mark(cx, cy, 1);
    for (let i = candidates.length - 1; i >= 0; i--) {
      if (Math.abs(candidates[i].x - cx) <= 1 && Math.abs(candidates[i].y - cy) <= 1) {
        candidates.splice(i, 1);
      }
    }
  }
}

// Scatter decoration -- never on a cell that matters for play.
//
// Density matters more than variety here. A labyrinth of bare floor reads as
// unfinished whatever is standing in it, so most free floor gets something,
// and most of that something is small.
function addDecor(level, rng, candidates) {
  const { grid } = level;
  const add = (type, x, y, extra) => {
    level.decor.push({ type, x, y, seed: rng.next(), ...extra });
  };

  for (const c of candidates) {
    if (!rng.bool(0.19)) continue;
    add(rng.weighted(
      ['bones', 'urn', 'rubble', 'banner', 'statue', 'grass', 'debris', 'skull', 'crate', 'chain'],
      (t) => (t === 'statue' ? 0.3 : t === 'banner' ? 0.5 : t === 'crate' ? 0.7
        : t === 'chain' ? 0.6 : t === 'debris' ? 2.4 : t === 'skull' ? 1.1 : 1.4)),
    c.x + 0.5 + rng.float(-0.24, 0.24), c.y + 0.5 + rng.float(-0.24, 0.24));
  }

  // Cobwebs want corners: a floor tile with two walls meeting on it. Placed
  // separately because the scatter above would put them in the open, and a
  // cobweb in the middle of a room is strung between nothing.
  for (const { x, y } of level.floorCells) {
    if (!rng.bool(0.16)) continue;
    let wallX = 0, wallY = 0;
    if (grid.get(x - 1, y) === T.WALL) wallX = -1;
    else if (grid.get(x + 1, y) === T.WALL) wallX = 1;
    if (grid.get(x, y - 1) === T.WALL) wallY = -1;
    else if (grid.get(x, y + 1) === T.WALL) wallY = 1;
    if (!wallX || !wallY) continue;
    add('cobweb', x + 0.5 + wallX * 0.34, y + 0.5 + wallY * 0.34, { wallX, wallY });
  }
}

// Wandering population outside the scripted encounters.
function populateEnemies(level, rng, depth) {
  const { grid } = level;
  const field = bfsField(grid, [level.entrance], makePassable(level, level.gates.length));
  const pool = enemyPoolFor(depth);
  // Enemies per floor cell, climbing with depth: a bigger level is not
  // automatically a harder one unless it is also busier.
  const density = 0.009 + Math.min(depth, 16) * 0.0011;
  const target = clamp(Math.round(level.floorCells.length * density), 3, 42);
  const want = Math.max(0, target - level.spawns.length);
  const eliteChance = depth >= 4 ? Math.min(0.26, 0.02 + depth * 0.016) : 0;

  const taken = new Set(level.spawns.map((s) => grid.idx(Math.floor(s.x), Math.floor(s.y))));
  const minFromEntrance = depth <= 2 ? 7 : 9;
  const spots = level.floorCells.filter((c) => {
    const d = field[grid.idx(c.x, c.y)];
    return d >= minFromEntrance && !taken.has(grid.idx(c.x, c.y));
  });
  rng.shuffle(spots);

  for (let i = 0; i < want && spots.length; i++) {
    const c = spots.pop();
    const zone = zoneOf(level.zones, c.x, c.y);
    const zoneBias = 1 + zone * 0.4;
    const def = rng.weighted(pool, (p) => p.weight * (p.def.minDepth >= depth - 2 ? zoneBias : 1)).def;
    level.spawns.push({
      defId: def.id, x: c.x + 0.5, y: c.y + 0.5,
      elite: rng.bool(eliteChance),
      dormant: def.behaviour === BEHAVIOUR.AMBUSHER,
      zone, encounter: null, anchor: { x: c.x + 0.5, y: c.y + 0.5 }, guard: false,
    });
    // Keep a little breathing room between wandering enemies.
    for (let j = spots.length - 1; j >= 0 && j > spots.length - 40; j--) {
      if (Math.abs(spots[j].x - c.x) + Math.abs(spots[j].y - c.y) < 3) spots.splice(j, 1);
    }
  }
}

// Nothing hostile stands within striking distance of the entrance. Spawns
// that landed too close are nudged outward, and dropped only if there is
// genuinely nowhere sensible to put them.
function enforceSpawnSpacing(level, minDist = 7.5) {
  if (level.isBoss) return;
  const ex = level.entrance.x + 0.5, ey = level.entrance.y + 0.5;
  const free = level.floorCells.filter((c) =>
    Math.hypot(c.x + 0.5 - ex, c.y + 0.5 - ey) >= minDist + 1);
  const kept = [];
  for (const s of level.spawns) {
    if (Math.hypot(s.x - ex, s.y - ey) >= minDist) { kept.push(s); continue; }
    let best = null, bestD = Infinity;
    for (const c of free) {
      const d = Math.hypot(c.x + 0.5 - s.x, c.y + 0.5 - s.y);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (best && bestD <= 9) {
      s.x = best.x + 0.5; s.y = best.y + 0.5;
      s.anchor = { x: s.x, y: s.y };
      if (s.carriesKey !== undefined) {
        const key = level.keys.find((k) => k.colourIndex === s.carriesKey);
        if (key) { key.x = best.x; key.y = best.y; }
      }
      kept.push(s);
    } else if (s.carriesKey !== undefined) {
      // A key carrier must survive: dropping it would strand the key.
      kept.push(s);
    }
  }
  level.spawns = kept;
}

// --- hidden vaults ---------------------------------------------------------
// Ladders do not lead to another depth. They lead to a sealed vault belonging
// to *this* depth -- carved in the strip below the maze, connected to nothing,
// and reachable only by climbing down. Entirely optional, always worth it.

function carveVault(grid, rect, rng) {
  for (let y = rect.y0; y <= rect.y1; y++) {
    for (let x = rect.x0; x <= rect.x1; x++) grid.set(x, y, T.FLOOR);
  }
  // Pillars, so a vault reads as built rather than hollowed out.
  const px0 = rect.x0 + 2, px1 = rect.x1 - 2;
  const py0 = rect.y0 + 2, py1 = rect.y1 - 2;
  if (px1 - px0 >= 2 && py1 - py0 >= 2 && rng.bool(0.75)) {
    for (const [x, y] of [[px0, py0], [px1, py0], [px0, py1], [px1, py1]]) {
      if (rng.bool(0.85)) grid.set(x, y, T.WALL);
    }
  }
}

function addVaults(level, rng, depth, ctx) {
  const { grid } = level;
  const bandTop = level.mazeHeight;
  const bandBottom = grid.h - 3;
  if (bandBottom - bandTop < 8) return;

  // Somewhere to put the ladder down: deep in the maze, off the beaten path.
  const busy = new Set();
  const mark = (x, y, r) => {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) busy.add(grid.idx(Math.round(x) + dx, Math.round(y) + dy));
  };
  mark(level.entrance.x, level.entrance.y, 6);
  mark(level.stairs.x, level.stairs.y, 3);
  for (const g of level.gates) mark(g.x, g.y, 2);
  for (const k of level.keys) mark(k.x, k.y, 2);
  for (const p of level.props) if (!p.hidden) mark(p.x, p.y, 1);

  const spots = level.floorCells.filter((c) => {
    if (busy.has(grid.idx(c.x, c.y))) return false;
    let exits = 0;
    for (const [dx, dy] of N4) if (grid.get(c.x + dx, c.y + dy) !== T.WALL) exits++;
    return exits <= 2;
  });
  if (!spots.length) return;
  rng.shuffle(spots);

  const wanted = 1 + (depth >= 9 && rng.bool(0.4) ? 1 : 0);
  const slot = Math.floor((grid.w - 6) / wanted);
  if (slot < 10) return;

  for (let i = 0; i < wanted; i++) {
    const entry = spots.pop();
    if (!entry) break;

    const vw = rng.int(8, Math.min(14, slot - 3));
    const vh = rng.int(7, Math.min(12, bandBottom - bandTop - 1));
    const vx = 3 + i * slot + rng.int(0, Math.max(0, slot - vw - 2));
    const vy = bandTop + 1 + rng.int(0, Math.max(0, bandBottom - bandTop - vh));
    const rect = { x0: vx, y0: vy, x1: vx + vw - 1, y1: vy + vh - 1 };
    carveVault(grid, rect, rng);

    // The ladder back up sits in a corner; the player arrives standing on it.
    const exit = { x: rect.x0 + 1, y: rect.y0 + 1 };
    grid.set(exit.x, exit.y, T.FLOOR);

    const vault = {
      index: level.vaults.length, rect,
      entry: { x: entry.x, y: entry.y },
      exit,
      biomeId: level.biome.id,
      visited: false,
    };
    level.vaults.push(vault);

    level.props.push({
      type: 'ladder', dir: 'down', x: entry.x + 0.5, y: entry.y + 0.5,
      link: { x: exit.x, y: exit.y }, vault: vault.index,
      id: 'ladder_down_' + vault.index,
    });
    level.props.push({
      type: 'ladder', dir: 'up', x: exit.x + 0.5, y: exit.y + 0.5,
      link: { x: entry.x, y: entry.y }, vault: vault.index,
      id: 'ladder_up_' + vault.index,
    });

    // Register the vault as a room first: its encounter needs to point at one.
    const room = {
      x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1,
      zone: level.zones.length, kind: 'vault', id: level.rooms.length, region: -1,
    };
    level.rooms.push(room);
    level.zones.push({ x0: rect.x0 - 1, y0: rect.y0 - 1, x1: rect.x1 + 1, y1: rect.y1 + 1 });
    vault.room = room;
    fillVault(level, vault, rng, depth, ctx);
  }
}

function fillVault(level, vault, rng, depth, ctx) {
  const { grid } = level;
  const cells = [];
  for (let y = vault.rect.y0; y <= vault.rect.y1; y++) {
    for (let x = vault.rect.x0; x <= vault.rect.x1; x++) {
      if (grid.get(x, y) !== T.FLOOR) continue;
      if (Math.abs(x - vault.exit.x) + Math.abs(y - vault.exit.y) < 2) continue;
      cells.push({ x, y });
    }
  }
  rng.shuffle(cells);
  const take = () => cells.pop();

  // A vault always holds a real haul -- that is the whole reason to climb in.
  const hoard = 2 + rng.int(0, 1) + Math.floor(depth / 6);
  for (let i = 0; i < hoard; i++) {
    const c = take();
    if (!c) break;
    const type = rng.weighted(['treasure', 'chest', 'potion', 'arrows', 'shrineSmall'],
      (t) => (t === 'treasure' ? 3 : t === 'chest' ? 2.4 : 1.2));
    if (type === 'arrows' && !(ctx.hasCrossbow || level.hasCrossbowPickup)) { i--; continue; }
    level.props.push({
      type, x: c.x + 0.5, y: c.y + 0.5, id: 'vault' + vault.index + '_' + i,
      amount: rng.int(2, 3), heal: 30 + depth * 2, opened: false, used: false,
      flavour: 'heal', vault: vault.index,
    });
  }

  // And something guarding it.
  const guards = 2 + rng.int(0, 2) + Math.floor(depth / 7);
  const pool = enemyPoolFor(depth);
  const encId = 'enc_vault_' + vault.index;
  let placed = 0;
  for (const c of cells) {
    if (placed >= guards) break;
    if (Math.abs(c.x - vault.exit.x) + Math.abs(c.y - vault.exit.y) < 3) continue;
    const def = rng.weighted(pool, (p) => p.weight).def;
    level.spawns.push({
      defId: def.id, x: c.x + 0.5, y: c.y + 0.5,
      elite: depth >= 4 && rng.bool(0.16 + depth * 0.012), dormant: true,
      zone: 0, encounter: encId, anchor: { x: c.x + 0.5, y: c.y + 0.5 }, guard: true,
    });
    placed++;
  }
  if (placed) {
    level.encounters.push({
      id: encId, type: 'vault', room: vault.room,
      zone: vault.room.zone, optional: true, seal: false, waves: 0, count: placed,
      state: 'idle', flawless: true, scoreBonus: 500 + depth * 40,
      label: 'The Vault', vault: vault.index,
    });
  }
}

// --- hazards --------------------------------------------------------------
// Each zone gets its own biome dressing and hazard, subject to a level-wide
// threat budget so "fog + mud + ice + frenzy" can never all land at once.

function assignHazards(level, rng, depth) {
  let budget = hazardBudget(depth);
  const chosen = [];
  for (let i = 0; i < level.zones.length; i++) {
    const biomeId = i === 0 ? level.biome.id
      : rng.bool(0.55) ? level.biome.id : biomeForDepth(depth, rng).id;
    const options = (BIOME_HAZARDS[biomeId] || ['clear']).filter((h) => {
      const haz = HAZARDS[h];
      if (haz.threat > budget) return false;
      return chosen.every((c) => pairAllowed(c, h));
    });
    const pick = options.length ? rng.weighted(options, (h) => (h === 'clear' ? 1.1 : 2)) : 'clear';
    budget -= HAZARDS[pick].threat;
    chosen.push(pick);
    level.zoneInfo.push({
      index: i, rect: level.zones[i], biome: BIOMES[biomeId] || level.biome,
      hazard: HAZARDS[pick], hazardId: pick,
    });
  }
}

function buildZoneMap(level) {
  const { grid } = level;
  const map = new Uint8Array(grid.w * grid.h);
  for (let y = 0; y < grid.h; y++)
    for (let x = 0; x < grid.w; x++) map[grid.idx(x, y)] = zoneOf(level.zones, x, y);
  level.zoneMap = map;
}

// Stable per-tile variant index so decoration never shimmers between frames.
function buildVariants(level) {
  const { grid } = level;
  const v = new Uint8Array(grid.w * grid.h);
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      let h = (x * 73856093) ^ (y * 19349663) ^ (level.seedHash | 0);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      v[grid.idx(x, y)] = (h >>> 5) & 7;
    }
  }
  level.variants = v;
}

// --- assembly -------------------------------------------------------------

function emptyLevel(depth, seed, w, h) {
  return {
    depth, seed, seedHash: (depth * 2654435761) ^ 0,
    grid: new Grid(w, h, T.WALL),
    zones: [], zoneInfo: [], rooms: [], gates: [], keys: [], secrets: [],
    props: [], decor: [], sconces: [], spawns: [], encounters: [],
    blocks: [], blockPockets: [],
    decals: [],
    entrance: null, stairs: null, floorCells: [], freeRooms: [],
    isBoss: false, boss: null, hasCrossbowPickup: false,
    ladders: [], vaults: [], mazeHeight: h,
    _reserved: new Set(),
  };
}

function refreshFloorCells(level) {
  const { grid } = level;
  const out = [];
  for (let y = 1; y < grid.h - 1; y++)
    for (let x = 1; x < grid.w - 1; x++)
      if (grid.get(x, y) === T.FLOOR && !level._reserved.has(grid.idx(x, y)))
        out.push({ x, y });
  level.floorCells = out;
}

function roomAt(level, x, y) {
  for (const r of level.rooms) if (rectContains(r, x, y)) return r;
  return null;
}

// The gate neighbour that sits on the already-accessible side.
function gateInboundCell(level, gateIndex) {
  const g = level.gates[gateIndex];
  const dx = g.passage === 'x' ? 1 : 0;
  const dy = g.passage === 'x' ? 0 : 1;
  const a = { x: g.x - dx, y: g.y - dy };
  const b = { x: g.x + dx, y: g.y + dy };
  return zoneOf(level.zones, a.x, a.y) <= gateIndex ? a : b;
}

function buildLabyrinth(depth, rng, seed, ctx) {
  const { w, h, band } = levelSize(depth);
  const level = emptyLevel(depth, seed, w, h + band);
  level.mazeHeight = h;
  level.seedHash = (rng.initial ^ (depth * 2654435761)) | 0;
  level.biome = biomeForDepth(depth, rng);
  level.zones = splitZoneChain({ x0: 0, y0: 0, x1: w - 1, y1: h - 1 }, zonesForDepth(depth), rng);

  const regions = new Int32Array(w * h).fill(-1);
  const state = { nextRegion: 0, nextRoomId: 0 };
  level.zones.forEach((rect, i) => {
    level.rooms.push(...carveZone(level.grid, rect, rng, regions, state, i));
  });

  for (let i = 0; i < level.zones.length - 1; i++) {
    const gate = joinZones(level.grid, level.zones[i], level.zones[i + 1], rng, i, i, i + 1);
    if (!gate) return null; // caller regenerates with a fresh sub-seed
    level.gates.push(gate);
  }

  refreshFloorCells(level);
  if (level.floorCells.length < 120) return null;

  const allOpen = makePassable(level, level.gates.length);
  const inZone = (z) => (x, y) => zoneOf(level.zones, x, y) === z;
  const lastZone = level.zones.length - 1;

  // Entrance: deep inside the first zone, well away from the first gate.
  let entrance;
  if (level.gates.length) {
    const anchor = gateInboundCell(level, 0);
    const field = bfsField(level.grid, [anchor], makePassable(level, 0));
    entrance = pickFarCell(level.grid, field, rng, {
      minFrac: 0.62, filter: inZone(0), preferRooms: (x, y) => !!roomAt(level, x, y),
    });
  } else {
    entrance = rng.pick(level.floorCells);
  }
  if (!entrance) return null;
  level.entrance = { x: entrance.x, y: entrance.y };
  level.grid.set(entrance.x, entrance.y, T.ENTRANCE);

  // Stairs: the far end of the final zone.
  const stairAnchor = level.gates.length
    ? { x: level.gates[lastZone - 1].x, y: level.gates[lastZone - 1].y }
    : level.entrance;
  const stairField = bfsField(level.grid, [stairAnchor], allOpen);
  const stairs = pickFarCell(level.grid, stairField, rng, {
    minFrac: 0.55, filter: inZone(lastZone),
    preferRooms: (x, y) => !!roomAt(level, x, y),
    avoid: [{ x: level.entrance.x, y: level.entrance.y, r: 14 }],
  }) || pickFarCell(level.grid, stairField, rng, { minFrac: 0.3, filter: inZone(lastZone) });
  if (!stairs) return null;
  level.stairs = { x: stairs.x, y: stairs.y };
  level.grid.set(stairs.x, stairs.y, T.STAIRS);
  return finishLevel(level, rng, depth, ctx);
}

// Key placement, encounters, secrets and dressing -- shared by every layout.
function finishLevel(level, rng, depth, ctx) {
  const { grid } = level;

  // Keys: always inside the region the player can already reach, and far
  // enough from their gate that fetching one is exploration, not a detour.
  for (let i = 0; i < level.gates.length; i++) {
    const anchor = gateInboundCell(level, i);
    const field = bfsField(grid, [anchor], makePassable(level, i));
    // Far from the gate as a proportion of the region, and never merely
    // round the corner from it: on a small early level those are not the
    // same constraint.
    const keepBack = [
      { x: level.entrance.x, y: level.entrance.y, r: 13 },
      { x: anchor.x, y: anchor.y, r: 10 },
    ];
    const spot = pickFarCell(grid, field, rng, {
      minFrac: 0.5,
      filter: (x, y) => zoneOf(level.zones, x, y) <= i,
      preferRooms: (x, y) => !!roomAt(level, x, y),
      avoid: keepBack,
    }) || pickFarCell(grid, field, rng, {
      minFrac: 0.2,
      filter: (x, y) => zoneOf(level.zones, x, y) <= i,
      avoid: [
        { x: anchor.x, y: anchor.y, r: 8 },
        { x: level.entrance.x, y: level.entrance.y, r: 10 },
      ],
    });
    if (!spot) return null;
    const room = roomAt(level, spot.x, spot.y);
    const carried = depth >= 3 && rng.bool(0.22);
    level.keys.push({
      x: spot.x, y: spot.y, colourIndex: i, taken: false,
      room: room && room.kind === 'normal' ? room : null,
      holder: carried ? 'enemy' : null,
      zone: zoneOf(level.zones, spot.x, spot.y),
    });
  }

  buildEncounters(level, rng, depth);

  // A key carried by an enemy becomes a small hunt of its own.
  for (const key of level.keys) {
    if (key.holder !== 'enemy') continue;
    const pool = enemyPoolFor(depth).filter((p) =>
      p.def.behaviour === BEHAVIOUR.DEFENDER || p.def.behaviour === BEHAVIOUR.CHARGER);
    const def = (pool.length ? rng.weighted(pool, (p) => p.weight) : enemyPoolFor(depth)[0]).def;
    level.spawns.push({
      defId: def.id, x: key.x + 0.5, y: key.y + 0.5, elite: true, dormant: false,
      zone: key.zone, encounter: key.room ? 'enc_key_' + key.colourIndex : null,
      anchor: { x: key.x + 0.5, y: key.y + 0.5 }, guard: true,
      carriesKey: key.colourIndex,
    });
  }

  addSecrets(level, rng, depth);
  addPostBattleChambers(level, rng);
  refreshFloorCells(level);
  addProps(level, rng, depth, ctx);
  populateEnemies(level, rng, depth);
  enforceSpawnSpacing(level);
  addVaults(level, rng, depth, ctx);
  assignHazards(level, rng, depth);
  buildZoneMap(level);
  buildVariants(level);

  level.parTime = Math.round(35 + level.floorCells.length * 0.15 + depth * 5);
  level.totalSecrets = level.secrets.length;
  return level;
}

// --- boss arena -----------------------------------------------------------
// Bosses get a purpose-built stage: one entry corridor, a wide floor with room
// to dodge, and alcoves that give cover without letting the player turtle.

function buildBossArena(depth, rng, seed, ctx) {
  const w = 33, h = 33;
  const level = emptyLevel(depth, seed, w, h);
  level.seedHash = (rng.initial ^ (depth * 40503)) | 0;
  level.isBoss = true;
  const boss = bossForDepth(depth);
  level.boss = boss;
  level.biome = BIOMES[boss.biome] || BIOMES.ruins;
  level.zones = [{ x0: 0, y0: 0, x1: w - 1, y1: h - 1 }];

  const cx = (w >> 1), cy = (h >> 1);
  const rx = 12, ry = 10;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const nx = (x - cx) / rx, ny = (y - cy) / ry;
      if (nx * nx + ny * ny <= 1) level.grid.set(x, y, T.FLOOR);
    }
  }
  // Four alcoves for cover.
  for (const [ox, oy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const ax = cx + ox * (rx - 2), ay = cy + oy * (ry - 2);
    for (let y = -2; y <= 2; y++)
      for (let x = -2; x <= 2; x++)
        if (Math.abs(x) + Math.abs(y) <= 3) level.grid.set(ax + x, ay + y, T.FLOOR);
  }
  // Entry corridor from the southern rim.
  const entryX = cx + rng.int(-3, 3);
  for (let y = h - 3; y >= cy + ry - 3; y--) level.grid.set(entryX, y, T.FLOOR);
  level.entrance = { x: entryX, y: h - 3 };
  level.grid.set(level.entrance.x, level.entrance.y, T.ENTRANCE);
  level.stairs = { x: cx, y: cy - ry + 3 };
  level.grid.set(level.stairs.x, level.stairs.y, T.STAIRS);
  level.requiresBoss = true;

  level.rooms.push({
    x0: cx - rx + 2, y0: cy - ry + 2, x1: cx + rx - 2, y1: cy + ry - 2,
    zone: 0, kind: 'boss', id: 0, region: 0,
  });
  refreshFloorCells(level);

  level.spawns.push({
    defId: null, boss: boss.id, x: cx + 0.5, y: cy - 2 + 0.5, elite: false,
    dormant: false, zone: 0, encounter: 'boss', isBoss: true,
    anchor: { x: cx + 0.5, y: cy + 0.5 },
  });
  level.encounters.push({
    id: 'boss', type: 'boss', room: level.rooms[0], zone: 0, seal: true,
    waves: 0, count: 1, state: 'idle', flawless: true,
    scoreBonus: boss.score || 3000, label: boss.name,
  });

  addProps(level, rng, depth, ctx);
  // The arena seals behind you, so it has to carry its own supplies.
  for (let i = 0; i < 2; i++) {
    const spot = level.floorCells[rng.int(0, level.floorCells.length - 1)];
    if (!spot) break;
    level.props.push({
      type: 'potion', x: spot.x + 0.5, y: spot.y + 0.5,
      heal: 34 + depth * 2, id: 'boss_draught_' + i,
    });
  }
  assignHazards(level, rng, depth);
  buildZoneMap(level);
  buildVariants(level);
  level.parTime = Math.round(110 + depth * 6);
  level.totalSecrets = 0;
  return level;
}

// --- fallback -------------------------------------------------------------
// A single-zone layout with no gates. It cannot fail solvability, so the game
// always has something valid to show even if every staged attempt is rejected.

function buildFallback(depth, rng, seed, ctx) {
  const { w, h } = levelSize(Math.min(depth, 6));
  const level = emptyLevel(depth, seed, w, h);
  level.mazeHeight = h;
  level.seedHash = rng.initial | 0;
  level.biome = biomeForDepth(depth, rng);
  level.zones = [{ x0: 0, y0: 0, x1: w - 1, y1: h - 1 }];
  const regions = new Int32Array(w * h).fill(-1);
  level.rooms.push(...carveZone(level.grid, level.zones[0], rng,
    regions, { nextRegion: 0, nextRoomId: 0 }, 0));
  refreshFloorCells(level);

  const start = rng.pick(level.floorCells);
  level.entrance = { x: start.x, y: start.y };
  level.grid.set(start.x, start.y, T.ENTRANCE);
  const field = bfsField(level.grid, [level.entrance], makePassable(level, 0));
  const far = pickFarCell(level.grid, field, rng, { minFrac: 0.8 }) || rng.pick(level.floorCells);
  level.stairs = { x: far.x, y: far.y };
  level.grid.set(far.x, far.y, T.STAIRS);
  return finishLevel(level, rng, depth, ctx);
}

// --- public entry point ---------------------------------------------------

export function generateLevel(options = {}) {
  const { depth = 1, seed = 'torchbound', context = {}, maxAttempts = 30 } = options;
  const ctx = { hasCrossbow: false, ...context };
  const isBoss = depth % 5 === 0;
  const failures = [];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rng = new RNG(seed + '|depth' + depth + '|try' + attempt);
    let level = null;
    try {
      level = isBoss
        ? buildBossArena(depth, rng, seed, ctx)
        : buildLabyrinth(depth, rng, seed, ctx);
    } catch (err) {
      failures.push('exception: ' + (err && err.message));
      continue;
    }
    if (!level) { failures.push('layout rejected during carving'); continue; }
    const report = validateLevel(level);
    if (report.ok) {
      level.validation = report;
      level.attempts = attempt + 1;
      level.rejected = failures;
      // Marks on the floor, laid on after the depth has been proved sound and
      // never before it. They are decoration: nothing in validate.js knows they
      // exist, and placing them here rather than during carving is what makes
      // that guarantee structural rather than a promise.
      level.decals = placeDecals(level, rng.fork('decals'));
      return level;
    }
    failures.push(report.errors.join(' | '));
  }

  const level = buildFallback(depth, new RNG(seed + '|fallback|' + depth), seed, ctx);
  level.validation = validateLevel(level);
  level.decals = placeDecals(level, new RNG(seed + '|fallback-decals|' + depth));
  level.attempts = maxAttempts + 1;
  level.rejected = failures;
  level.usedFallback = true;
  return level;
}

export { makePassable, zoneOf, gateInboundCell, roomAt, levelSize, zonesForDepth, sharedBoundary };
