// Level validation. Every generated level passes through here before it is
// ever shown to the player; a failure means the level is thrown away and
// regenerated. These checks encode the non-negotiable rules from the design:
//
//   * the exit is always reachable
//   * every required key is obtainable BEFORE its own gate
//   * no mandatory route depends on breaking a secret wall
//   * gates genuinely block the corridor they sit in
//   * nothing important is stranded in unreachable geometry
//
// It is also the assertion layer the seeded generation test-suite drives.

import { T } from './tiles.js';
import { bfsField, N4 } from './grid.js';
import { HAZARDS, hazardBudget, pairAllowed } from './biomes.js';

function standableAt(grid, x, y) {
  const t = grid.get(Math.floor(x), Math.floor(y));
  return t === T.FLOOR || t === T.STAIRS || t === T.ENTRANCE;
}

function gateLookup(level) {
  const map = new Map();
  level.gates.forEach((g, i) => map.set(level.grid.idx(g.x, g.y), i));
  return map;
}

// `openColours` is a Set of colour indices the player is assumed to hold.
// `secretsSolid` models the honest case: cracked walls are not a route.
// `blocksSolid` models the same honesty about pushable stones: they are in the
// way until somebody shoves them, so anything the depth *requires* has to be
// reachable without shoving one. Set it false for the orphan sweep, where a
// pocket behind a block is genuinely reachable and is not stranded floor.
function passableFactory(level, gateMap, openColours, secretsSolid = true, forceClosed = -1,
  blocksSolid = true) {
  const blocked = new Set();
  if (blocksSolid) for (const b of level.blocks || []) blocked.add(level.grid.idx(b.x, b.y));
  return (x, y, t) => {
    if (blocked.size && blocked.has(level.grid.idx(x, y))) return false;
    if (t === T.FLOOR || t === T.STAIRS || t === T.ENTRANCE) return true;
    if (t === T.SECRET) return !secretsSolid;
    if (t === T.GATE) {
      const gi = gateMap.get(level.grid.idx(x, y));
      if (gi === undefined) return false;
      if (gi === forceClosed) return false;
      return openColours.has(level.gates[gi].colourIndex);
    }
    return false;
  };
}

// Ladders are edges in the reachability graph: reaching one end makes the
// other end reachable. Flood, seed any newly-reachable ladder exits, repeat.
function floodWithLadders(level, sources, passable) {
  const seeds = sources.slice();
  let field = bfsField(level.grid, seeds, passable);
  for (let pass = 0; pass < 6; pass++) {
    let grew = false;
    for (const v of level.vaults || []) {
      const entry = level.grid.idx(v.entry.x, v.entry.y);
      const exit = level.grid.idx(v.exit.x, v.exit.y);
      if (field[entry] >= 0 && field[exit] < 0) { seeds.push(v.exit); grew = true; }
      if (field[exit] >= 0 && field[entry] < 0) { seeds.push(v.entry); grew = true; }
    }
    if (!grew) break;
    field = bfsField(level.grid, seeds, passable);
  }
  return field;
}

export function validateLevel(level) {
  const errors = [];
  const warnings = [];
  const grid = level.grid;
  const idx = (p) => grid.idx(p.x, p.y);
  const gateMap = gateLookup(level);

  // --- 0. structural sanity ------------------------------------------------
  if (!level.entrance) errors.push('no entrance');
  if (!level.stairs) errors.push('no stairs');
  if (errors.length) return { ok: false, errors, warnings };

  if (grid.get(level.entrance.x, level.entrance.y) !== T.ENTRANCE)
    errors.push('entrance tile is not an entrance');
  if (grid.get(level.stairs.x, level.stairs.y) !== T.STAIRS)
    errors.push('stairs tile is not stairs');
  if (level.keys.length !== level.gates.length)
    errors.push(`key/gate mismatch: ${level.keys.length} keys for ${level.gates.length} gates`);

  // --- 1. gate geometry ----------------------------------------------------
  // A door has to block a corridor, which means exactly two opposite open
  // neighbours, aligned with the passage it claims to sit in.
  for (const g of level.gates) {
    const open = [];
    for (const [dx, dy] of N4) {
      const t = grid.get(g.x + dx, g.y + dy);
      if (t !== T.WALL && t !== T.SECRET && t !== T.RUBBLE) open.push([dx, dy]);
    }
    if (open.length !== 2) {
      errors.push(`gate ${g.id} has ${open.length} open sides (needs exactly 2)`);
      continue;
    }
    const [a, b] = open;
    if (a[0] + b[0] !== 0 || a[1] + b[1] !== 0) {
      errors.push(`gate ${g.id} open sides are not opposite -- it does not block the corridor`);
      continue;
    }
    const axis = a[0] !== 0 ? 'x' : 'y';
    if (axis !== g.passage)
      errors.push(`gate ${g.id} passage axis ${g.passage} does not match its geometry (${axis})`);
  }

  // --- 2. key logic --------------------------------------------------------
  // Repeatedly flood from the entrance, banking any key we can now touch,
  // until nothing new becomes reachable. Secret walls stay solid throughout.
  const held = new Set();
  const collectedAt = new Map();
  let round = 0;
  let field = null;
  for (; round < level.gates.length + 2; round++) {
    field = bfsField(grid, [level.entrance], passableFactory(level, gateMap, held, true));
    let gained = false;
    for (const key of level.keys) {
      if (held.has(key.colourIndex)) continue;
      if (field[idx(key)] >= 0) {
        held.add(key.colourIndex);
        collectedAt.set(key.colourIndex, round);
        gained = true;
      }
    }
    if (!gained) break;
  }

  for (const key of level.keys) {
    if (!held.has(key.colourIndex))
      errors.push(`key ${key.colourIndex} is unreachable -- level is unsolvable`);
  }
  if (!field || field[idx(level.stairs)] < 0)
    errors.push('stairs are not reachable even with every obtainable key');

  // --- 3. a key must never sit behind its own gate -------------------------
  for (let i = 0; i < level.keys.length; i++) {
    const key = level.keys[i];
    const others = new Set(level.gates.map((g) => g.colourIndex));
    others.delete(key.colourIndex);
    const f = bfsField(grid, [level.entrance],
      passableFactory(level, gateMap, others, true, i));
    if (f[idx(key)] < 0)
      errors.push(`key ${key.colourIndex} is locked behind the gate it opens`);
  }

  // --- 4. every gate is a real bottleneck ---------------------------------
  // Close one gate, open all the others, and the exit must become
  // unreachable. If it does not, the gate is decorative and the key is busywork.
  const allColours = new Set(level.gates.map((g) => g.colourIndex));
  for (let i = 0; i < level.gates.length; i++) {
    const f = bfsField(grid, [level.entrance],
      passableFactory(level, gateMap, allColours, true, i));
    if (f[idx(level.stairs)] >= 0)
      errors.push(`gate ${level.gates[i].id} can be bypassed -- it blocks nothing`);
  }

  // --- 5. secrets are optional, always ------------------------------------
  // Breaking every cracked wall in the level must not open a route past a
  // gate, and no mandatory object may live inside a secret pocket.
  for (let i = 0; i < level.gates.length; i++) {
    const f = bfsField(grid, [level.entrance],
      passableFactory(level, gateMap, allColours, false, i));
    if (f[idx(level.stairs)] >= 0)
      errors.push(`secret walls bypass gate ${level.gates[i].id}`);
  }
  const honest = bfsField(grid, [level.entrance], passableFactory(level, gateMap, allColours, true));
  for (const key of level.keys) {
    if (honest[idx(key)] < 0) errors.push(`key ${key.colourIndex} requires breaking a secret wall`);
  }
  if (honest[idx(level.stairs)] < 0) errors.push('stairs require breaking a secret wall');

  // --- 6. no orphaned geometry --------------------------------------------
  // Floor the player can never stand on is a generation bug, so allow only
  // cells that open up once secrets are broken.
  const generous = floodWithLadders(level, [level.entrance],
    passableFactory(level, gateMap, allColours, false, -1, false));
  let orphans = 0;
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      const t = grid.get(x, y);
      if (t !== T.FLOOR && t !== T.STAIRS && t !== T.ENTRANCE) continue;
      if (generous[grid.idx(x, y)] < 0) orphans++;
    }
  }
  if (orphans > 0) errors.push(`${orphans} floor cells are unreachable by any means`);

  // --- 6b. ladders lead somewhere, and never gate progression --------------
  for (const vault of level.vaults || []) {
    if (!standableAt(grid, vault.entry.x, vault.entry.y))
      errors.push(`vault ${vault.index} ladder is not on walkable ground`);
    if (!standableAt(grid, vault.exit.x, vault.exit.y))
      errors.push(`vault ${vault.index} has no walkable landing`);
    if (honest[grid.idx(vault.entry.x, vault.entry.y)] < 0)
      errors.push(`vault ${vault.index} ladder cannot be reached`);
    // A vault is optional by definition, so nothing needed to finish the
    // depth may live inside one.
    const inside = (p) => p.x >= vault.rect.x0 && p.x <= vault.rect.x1
      && p.y >= vault.rect.y0 && p.y <= vault.rect.y1;
    if (inside(level.stairs)) errors.push(`the exit is inside vault ${vault.index}`);
    for (const key of level.keys) {
      if (inside(key)) errors.push(`key ${key.colourIndex} is inside vault ${vault.index}`);
    }
  }

  // --- 6c. a pushable block never stands between you and the way on --------
  //
  // Same discipline as a cracked wall: optional content is optional, and the
  // way to be sure is to model it as never having been dealt with. If the
  // depth is still completable with every block treated as solid stone, then
  // no route through one is mandatory -- and the pocket each block guards is
  // a reward rather than a lock.
  const blocks = level.blocks || [];
  if (blocks.length) {
    const blockAt = new Set(blocks.map((b) => grid.idx(b.x, b.y)));
    const pocketAt = new Set((level.blockPockets || []).map((p) => grid.idx(p.x, p.y)));

    // Nothing the depth requires may live on a block or inside its pocket.
    const named = [['the entrance', level.entrance], ['the exit', level.stairs]]
      .concat(level.keys.map((k) => ['key ' + k.colourIndex, k]))
      .concat(level.gates.map((g) => ['gate ' + g.id, g]));
    for (const [what, at] of named) {
      const i = grid.idx(Math.floor(at.x), Math.floor(at.y));
      if (blockAt.has(i)) errors.push(what + ' is underneath a pushable block');
      if (pocketAt.has(i)) errors.push(what + ' is inside a block pocket');
    }

    // ...and with every block left where it stands, the depth loses no ground
    // at all beyond the blocks themselves and what they are guarding. Stated
    // as containment rather than as "the stairs are still reachable", because
    // that also covers key ordering, gate bottlenecks and vault ladders
    // without having to reason about each of them separately.
    const shovable = floodWithLadders(level, [level.entrance],
      passableFactory(level, gateMap, allColours, true, -1, false));
    const asFound = floodWithLadders(level, [level.entrance],
      passableFactory(level, gateMap, allColours, true, -1, true));
    let lost = 0;
    for (let i = 0; i < shovable.length; i++) {
      if (shovable[i] < 0 || asFound[i] >= 0) continue;
      if (blockAt.has(i) || pocketAt.has(i)) continue;
      lost++;
    }
    if (lost > 0) errors.push(`${lost} floor cells are cut off by a pushable block`);

    for (const b of blocks) {
      if (!standableAt(grid, b.x + 0.5, b.y + 0.5))
        errors.push(`block ${b.id} is not standing on floor`);
      if (!standableAt(grid, b.alcove.x + 0.5, b.alcove.y + 0.5))
        errors.push(`block ${b.id} guards solid rock`);
    }
  }

  // --- 7. entities stand on real ground ------------------------------------
  const standable = (x, y) => standableAt(grid, x, y);
  for (const s of level.spawns) {
    if (!standable(s.x, s.y)) errors.push(`spawn ${s.defId || s.boss} is inside a wall`);
  }
  for (const p of level.props) {
    if (!standable(p.x, p.y)) errors.push(`prop ${p.type} is inside a wall`);
    // The generous flood shoves blocks and breaks secrets, so a prop behind
    // either is not stranded -- it is earned.
    if (!p.hidden && generous[grid.idx(Math.floor(p.x), Math.floor(p.y))] < 0)
      errors.push(`prop ${p.type} is stranded`);
  }
  for (const k of level.keys) {
    if (!standable(k.x + 0.5, k.y + 0.5)) errors.push(`key ${k.colourIndex} is inside a wall`);
  }

  // --- 8. hazards stay inside their difficulty budget ----------------------
  let threat = 0;
  const active = [];
  for (const z of level.zoneInfo) {
    if (!z.hazard || !HAZARDS[z.hazardId]) { errors.push('zone has an unknown hazard'); continue; }
    threat += z.hazard.threat;
    active.push(z.hazardId);
    // Nothing that alters movement may be able to seal the player in.
    if (z.hazard.mods && z.hazard.mods.blocks) errors.push('a hazard blocks movement');
  }
  const budget = hazardBudget(level.depth);
  if (threat > budget) errors.push(`hazard threat ${threat} exceeds the depth budget ${budget}`);
  for (let i = 0; i < active.length; i++)
    for (let j = i + 1; j < active.length; j++)
      if (!pairAllowed(active[i], active[j]))
        errors.push(`unfair hazard combination: ${active[i]} + ${active[j]}`);

  // --- 9. boss arenas stay completable -------------------------------------
  if (level.isBoss) {
    const bossSpawn = level.spawns.find((s) => s.isBoss);
    if (!bossSpawn) errors.push('boss level has no boss');
    else if (generous[grid.idx(Math.floor(bossSpawn.x), Math.floor(bossSpawn.y))] < 0)
      errors.push('boss is walled off from the arena');
    const arenaFloor = level.floorCells.length;
    if (arenaFloor < 140) errors.push(`boss arena is too small (${arenaFloor} cells)`);
  }

  // --- warnings: quality, not correctness ----------------------------------
  for (const key of level.keys) {
    const gate = level.gates[key.colourIndex];
    if (!gate) continue;
    const manhattan = Math.abs(gate.x - key.x) + Math.abs(gate.y - key.y);
    if (manhattan < 8) warnings.push(`key ${key.colourIndex} spawned close to its gate (${manhattan} tiles)`);
  }
  if (level.floorCells.length < 180) warnings.push('level is unusually cramped');

  return { ok: errors.length === 0, errors, warnings, orphans, threat, budget };
}
