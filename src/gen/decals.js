// Marks somebody or something left behind.
//
// The labyrinth is stone, and stone with nothing on it reads as unfinished
// rather than as empty. These are the scratches, tracks and disturbed dust
// that say a place has been used -- and, because they are placed *at* things
// rather than sprinkled, they lean very slightly towards what is worth
// finding: claw marks near a lair, footprints heading for a door, scuffed dirt
// where something was dragged out of a chest.
//
// Three rules hold this apart from everything else in gen/:
//
//   * Decals are decoration and nothing else. `validate.js` does not know they
//     exist and must never learn: nothing about solvability, reachability or
//     the mandatory route may ever depend on one. A hint that could be
//     *required* stops being a hint and becomes a key.
//   * They only ever read what has already been placed. A rule may look at the
//     spawns, the gates, the props and the grid; it may not move any of them.
//   * The table is the extension point. Adding a kind of mark is one entry
//     here -- a rule and a sprite -- and no change to anything that calls this.
//
// Placement is seeded like everything else, so a labyrinth looks the same way
// twice.

import { T } from './tiles.js';
import { N4 } from './grid.js';

// A hard ceiling, deliberately low. The point is that a corridor occasionally
// has something on it, not that every corridor does: past about this many the
// marks stop reading as traces and start reading as wallpaper, and the hint
// they carry is lost in the noise of the ones that carry none.
export function decalBudget(depth) {
  return Math.min(10, 4 + Math.floor(depth / 3));
}

function floorAt(grid, x, y) {
  return grid.get(x, y) === T.FLOOR;
}

// Which way the wall lies at a tile, if it lies against one at all. Used to
// lay a mark flat against the stone rather than across the middle of the floor.
function wallSide(grid, x, y) {
  for (const [dx, dy] of N4) {
    if (grid.get(x + dx, y + dy) === T.WALL) return { x: dx, y: dy };
  }
  return null;
}

// Tiles within `reach` of a point, floor only, nearest first.
function nearbyFloor(grid, at, reach) {
  const out = [];
  const cx = Math.floor(at.x), cy = Math.floor(at.y);
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const d = Math.hypot(dx, dy);
      if (d > reach || d < 1) continue;
      const x = cx + dx, y = cy + dy;
      if (!floorAt(grid, x, y)) continue;
      out.push({ x, y, d });
    }
  }
  out.sort((a, b) => a.d - b.d);
  return out;
}

// --- the table --------------------------------------------------------------
//
// `rule(level, rng, take)` returns placements. `take(n)` is how many of the
// budget this rule is allowed to spend, so no single kind of mark can crowd
// out the others on a busy depth.

export const DECALS = [
  {
    id: 'hole',
    // A hole in the floor with nothing underneath it.
    //
    // The same mark a Gravebound leaves when it comes up (see World.onUnearthed
    // -- deliberately the same sprite, drawn from the same table entry), and
    // there is no way to tell one from the other without walking over to find
    // out. That is the whole of what it is for: once you have met one buried
    // thing, every hole in the floor is a question, and most of the answers
    // are nothing at all.
    //
    // Rarer than the real ones, and never near a spawn -- a decoy sitting next
    // to something that is genuinely down there would teach the wrong lesson.
    rule(level, rng, take) {
      if (take < 1 || level.depth < 3) return [];
      if (!rng.bool(0.3)) return [];
      const away = (c) => !level.spawns.some(
        (sp) => Math.hypot(sp.x - c.x, sp.y - c.y) < 6);
      const open = level.floorCells.filter((c) => {
        let exits = 0;
        for (const [dx, dy] of N4) if (floorAt(level.grid, c.x + dx, c.y + dy)) exits++;
        return exits >= 2 && away(c);
      });
      if (!open.length) return [];
      const at = open[rng.int(0, open.length - 1)];
      return [{
        kind: 'hole', x: at.x + 0.5, y: at.y + 0.5, dx: 1, dy: 0,
        seed: rng.next(), fresh: false,
      }];
    },
  },
  {
    id: 'claw',
    // Something with claws sleeps here. Laid against the wall nearest a
    // dormant spawn and angled towards it, so the mark points the way it came
    // from -- which is the way you are about to walk.
    rule(level, rng, take) {
      const dens = level.spawns.filter((s) => s.dormant && !s.isBoss);
      const out = [];
      for (const den of rng.shuffle(dens.slice())) {
        if (out.length >= take) break;
        const spot = nearbyFloor(level.grid, den, 4)
          .find((c) => wallSide(level.grid, c.x, c.y));
        if (!spot) continue;
        const wall = wallSide(level.grid, spot.x, spot.y);
        out.push({
          kind: 'claw', x: spot.x + 0.5, y: spot.y + 0.5,
          // Towards the thing, not towards the wall: the mark is evidence of
          // something coming out, so it points where it went.
          dx: Math.sign(den.x - spot.x) || wall.y,
          dy: Math.sign(den.y - spot.y) || wall.x,
          seed: rng.next(),
        });
      }
      return out;
    },
  },
  {
    id: 'tracks',
    // A trail of prints, three or four long, walking towards a gate or the
    // stair. Whoever left them was going somewhere, and it is somewhere you
    // want to go too.
    rule(level, rng, take) {
      const goals = level.gates.map((g) => ({ x: g.x, y: g.y }))
        .concat([{ x: level.stairs.x, y: level.stairs.y }]);
      const out = [];
      for (const goal of rng.shuffle(goals.slice())) {
        if (out.length >= take) break;
        const start = nearbyFloor(level.grid, goal, 7).filter((c) => c.d > 3);
        if (!start.length) continue;
        const from = start[rng.int(0, start.length - 1)];
        const dx = Math.sign(goal.x - from.x);
        const dy = Math.sign(goal.y - from.y);
        if (!dx && !dy) continue;
        const run = [];
        for (let i = 0; i < 4; i++) {
          const x = from.x + dx * i, y = from.y + dy * i;
          if (!floorAt(level.grid, x, y)) break;
          run.push({
            kind: 'tracks', x: x + 0.5, y: y + 0.5, dx, dy,
            step: i, seed: rng.next(),
          });
        }
        // Two prints are a smudge. Three is somebody walking.
        if (run.length >= 3) out.push(...run.slice(0, take - out.length));
      }
      return out;
    },
  },
  {
    id: 'dust',
    // Floor that has been swept by something being dragged across it. Placed
    // beside chests and cracked walls, where something was got at.
    rule(level, rng, take) {
      const spots = level.props
        .filter((p) => p.type === 'chest' || p.type === 'cursedChest')
        .map((p) => ({ x: p.x, y: p.y }))
        .concat((level.secrets || []).map((sec) => ({ x: sec.x, y: sec.y })));
      const out = [];
      for (const at of rng.shuffle(spots)) {
        if (out.length >= take) break;
        const spot = nearbyFloor(level.grid, at, 2)[0];
        if (!spot) continue;
        out.push({
          kind: 'dust', x: spot.x + 0.5, y: spot.y + 0.5,
          dx: Math.sign(at.x - spot.x), dy: Math.sign(at.y - spot.y),
          seed: rng.next(),
        });
      }
      return out;
    },
  },
];

// Everything the depth is going to be marked with, in one pass, spread across
// the kinds so no single one takes the whole budget.
export function placeDecals(level, rng) {
  const budget = decalBudget(level.depth);
  const share = Math.max(1, Math.round(budget / DECALS.length));
  const out = [];
  for (const decal of DECALS) {
    if (out.length >= budget) break;
    const room = Math.min(share, budget - out.length);
    for (const placed of decal.rule(level, rng, room) || []) {
      if (out.length >= budget) break;
      out.push(placed);
    }
  }
  return out;
}
