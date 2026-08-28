// Gameplay integration tests.
//
// These drive the real systems -- generation, world, player, enemies, relics,
// scoring -- through scripted scenarios and assert the rules the design calls
// non-negotiable. They run headlessly against a detached canvas, so no
// rendering or audio is required.

import { generateLevel } from '../src/gen/dungeon.js';
import { validateLevel } from '../src/gen/validate.js';
import { DECALS, decalBudget } from '../src/gen/decals.js';
import { TIERS } from '../src/core/perf.js';
import { Run } from '../src/game/run.js';
import { World } from '../src/game/world.js';
import { Enemy } from '../src/game/enemies.js';
import { RELICS, RELIC_BY_ID, computeMods, offerRelics, baseMods, MOD_BETTER } from '../src/game/relics.js';
import { T } from '../src/gen/tiles.js';
import { inputDirToGrid, screenDirToGrid, screenX, screenY } from '../src/render/iso.js';
import { CONTROLS, DEFAULT_BINDINGS as BINDINGS } from '../src/core/input.js';
import { makeSeed, normaliseSeed } from '../src/core/rng.js';
import { RELEASES } from '../src/game/releases.js';
import { VERSION } from '../src/core/version.js';
import { bfsField, N4 } from '../src/gen/grid.js';
import { RNG } from '../src/core/rng.js';
import { SoundField } from '../src/game/soundfield.js';
import { tileOpen, canStepTo } from '../src/game/gridmove.js';
import { VOICE_REACH } from '../src/game/enemyData.js';
import { HP_FLOOR, REWARDS, SACRIFICES, REWARD_BY_ID, SACRIFICE_BY_ID } from '../src/game/altars.js';
import { toCsv, parseCsv, normalise, rank, merge, scramble, unscramble, HALL_SIZE }
  from '../src/game/hall.js';
import { hazardBudget, HAZARDS } from '../src/gen/biomes.js';
import { shoveOutcome } from '../src/gen/shove.js';
import { DIFFICULTIES, DIFFICULTY_LIST } from '../src/game/difficulty.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}
function assertNear(actual, expected, tolerance, message) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message || 'value'}: ${actual} is not within ${tolerance} of ${expected}`);
  }
}

// Builds a playable world without touching the renderer.
function makeWorld(depth, seed, mutateRun) {
  const run = new Run(seed);
  run.depth = depth;
  if (mutateRun) mutateRun(run);
  run.refreshMods();
  const level = generateLevel({ depth, seed, context: run.levelContext() });
  const world = new World(run, level, new RNG(seed + ':w'));
  return { run, level, world };
}

const idle = { moveX: 0, moveY: 0, slash: false, fire: false };
function step(world, frames = 60, intent = idle) {
  for (let i = 0; i < frames; i++) world.update(1 / 60, intent);
}

// Drops the player onto a specific tile. Position is owned by the grid mover,
// so it has to be moved rather than assigned.
function place(world, x, y) {
  world.player.placeAt(x, y);
  world.player.invulnTimer = 0;
  world.flow = null;
}

// Finds a straight corridor of open floor, so movement tests are not defeated
// by the player happening to spawn facing a wall.
function findRun(level, minLen = 4) {
  for (let y = 1; y < level.grid.h - 1; y++) {
    for (let x = 1; x < level.grid.w - 1; x++) {
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        let ok = true;
        for (let i = 0; i < minLen; i++) {
          if (level.grid.get(x + dx * i, y + dy * i) !== T.FLOOR) { ok = false; break; }
        }
        if (ok) return { x, y, dx, dy };
      }
    }
  }
  return null;
}

// Forces a hazard across the whole level, exercising the real
// zone -> hazard -> modifier -> simulation path rather than poking the
// modifiers directly (the world recomputes those every frame).
function forceHazard(world, hazardId) {
  for (const zone of world.level.zoneInfo) {
    zone.hazard = HAZARDS[hazardId];
    zone.hazardId = hazardId;
  }
  world.currentHazard = null;
  world.updateHazard();
}

// --- world integrity --------------------------------------------------------

test('a world can be built and simulated at every depth band without throwing', () => {
  for (const depth of [1, 2, 3, 5, 7, 10, 13, 15, 20]) {
    const { world } = makeWorld(depth, 'integ-' + depth, (r) => { r.hasCrossbow = depth > 6; });
    const rng = new RNG('input' + depth);
    for (let i = 0; i < 240; i++) {
      const a = rng.float(0, Math.PI * 2);
      world.update(1 / 60, {
        moveX: Math.cos(a), moveY: Math.sin(a),
        slash: rng.bool(0.1), fire: rng.bool(0.05),
      });
      if (i % 40 === 0) world.interact();
    }
  }
});

test('the player never ends up inside solid rock', () => {
  const { world, level } = makeWorld(4, 'collide-1');
  const rng = new RNG('collide-input');
  for (let i = 0; i < 900; i++) {
    const a = rng.float(0, Math.PI * 2);
    world.update(1 / 60, { moveX: Math.cos(a), moveY: Math.sin(a), slash: false, fire: false });
    const tile = level.grid.get(Math.floor(world.player.x), Math.floor(world.player.y));
    assert(tile !== T.WALL && tile !== T.SECRET,
      `player entered a solid tile at ${world.player.x.toFixed(2)},${world.player.y.toFixed(2)}`);
  }
});

test('enemies never end up inside solid rock', () => {
  const { world, level } = makeWorld(8, 'enemy-collide');
  for (const e of world.enemies) { e.dormant = false; e.sealed = false; e.state = 'chase'; }
  step(world, 600, { moveX: 0.6, moveY: 0.4, slash: false, fire: false });
  for (const e of world.enemies) {
    if (e.dead) continue;
    const tile = level.grid.get(Math.floor(e.x), Math.floor(e.y));
    assert(tile !== T.WALL && tile !== T.SECRET, `${e.def.id} is inside a wall`);
  }
});

// --- controls ---------------------------------------------------------------

// Clears a square of floor and stands the level down, so a movement test
// measures the controls and nothing else. Without this the arena can overlap
// an encounter room, which seals its doorways the moment the player walks in
// -- correct behaviour, but not what is under test here.
function clearArena(world, cx, cy, radius = 3) {
  for (const enc of world.level.encounters) {
    enc.state = 'cleared';
    if (enc.sealedCells) world.releaseSeal(enc);
  }
  world.sealBlocks.clear();
  world.enemies.length = 0;
  // A raving captive screaming somewhere off-stage is a real noise source,
  // which is wonderful in play and ruinous in a controlled scenario.
  world.level.props = world.level.props.filter((p) => p.type !== 'prisoner');
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) world.grid.set(x, y, T.FLOOR);
  }
  world.flow = null;
}

// The direction keys walk the dungeon's compass: Up is north, Right is east,
// Down is south, Left is west. Corridors run along those axes, so one key
// carries you down a passage. The isometric view draws north as
// up-and-to-the-right, which is the projection doing its job.
const COMPASS = {
  Up: { key: { x: 0, y: -1 }, grid: { x: 0, y: -1 }, name: 'north' },
  Right: { key: { x: 1, y: 0 }, grid: { x: 1, y: 0 }, name: 'east' },
  Down: { key: { x: 0, y: 1 }, grid: { x: 0, y: 1 }, name: 'south' },
  Left: { key: { x: -1, y: 0 }, grid: { x: -1, y: 0 }, name: 'west' },
  'Up+Right': { key: { x: 0.7071, y: -0.7071 }, grid: { x: 1, y: -1 }, name: 'north-east' },
  'Down+Right': { key: { x: 0.7071, y: 0.7071 }, grid: { x: 1, y: 1 }, name: 'south-east' },
  'Down+Left': { key: { x: -0.7071, y: 0.7071 }, grid: { x: -1, y: 1 }, name: 'south-west' },
  'Up+Left': { key: { x: -0.7071, y: -0.7071 }, grid: { x: -1, y: -1 }, name: 'north-west' },
};

// Walks one input direction from the middle of a cleared arena.
function walkFrom(world, cx, cy, key, frame) {
  place(world, cx, cy);
  world.player.mover.heading = null;
  const grid = inputDirToGrid(key.x, key.y, frame);
  const from = { sx: screenX(world.player.x, world.player.y), sy: screenY(world.player.x, world.player.y) };
  step(world, 30, { moveX: grid.x, moveY: grid.y, slash: false, fire: false });
  const dx = screenX(world.player.x, world.player.y) - from.sx;
  const dy = screenY(world.player.x, world.player.y) - from.sy;
  const m = Math.hypot(dx, dy);
  return {
    tileDx: world.player.mover.tileX - cx,
    tileDy: world.player.mover.tileY - cy,
    ux: dx / (m || 1), uy: dy / (m || 1), moved: m,
  };
}

test('each direction key walks the dungeon compass', () => {
  const { world, level } = makeWorld(3, 'controls-1');
  const cx = Math.floor(level.grid.w / 2), cy = Math.floor(level.grid.h / 3);
  clearArena(world, cx, cy, 4);

  for (const [name, spec] of Object.entries(COMPASS)) {
    const t = walkFrom(world, cx, cy, spec.key, 'dungeon');
    assert(t.moved > 8, `${name} did not move the character at all`);
    assert(Math.sign(t.tileDx) === Math.sign(spec.grid.x)
        && Math.sign(t.tileDy) === Math.sign(spec.grid.y),
      `${name} should walk ${spec.name} (grid ${spec.grid.x},${spec.grid.y}) `
      + `but moved ${t.tileDx},${t.tileDy}`);
    if (spec.grid.x === 0) assert(t.tileDx === 0, `${name} drifted east/west while walking ${spec.name}`);
    if (spec.grid.y === 0) assert(t.tileDy === 0, `${name} drifted north/south while walking ${spec.name}`);
  }
});

test('the view frame still points the keys at the screen', () => {
  const { world, level } = makeWorld(3, 'controls-view');
  const cx = Math.floor(level.grid.w / 2), cy = Math.floor(level.grid.h / 3);
  clearArena(world, cx, cy, 4);

  const screenKeys = {
    Up: { x: 0, y: -1 }, Down: { x: 0, y: 1 }, Left: { x: -1, y: 0 }, Right: { x: 1, y: 0 },
  };
  for (const [name, key] of Object.entries(screenKeys)) {
    const t = walkFrom(world, cx, cy, key, 'view');
    assert(t.moved > 8, `${name} did not move the character at all`);
    const alignment = t.ux * key.x + t.uy * key.y;
    assert(alignment > 0.99,
      `${name} moved along screen vector (${t.ux.toFixed(2)}, ${t.uy.toFixed(2)}) `
      + `instead of (${key.x.toFixed(2)}, ${key.y.toFixed(2)})`);
  }
});

test('a blocked compass direction never deflects you sideways', () => {
  const { world, level } = makeWorld(3, 'controls-2');
  const cx = Math.floor(level.grid.w / 2), cy = Math.floor(level.grid.h / 3);
  clearArena(world, cx, cy, 4);
  level.grid.set(cx, cy - 1, T.WALL);   // wall off north

  // Diagonals cannot cut corners, so blocking north also blocks north-east
  // and north-west. Pressing Up therefore has exactly one meaning under the
  // dungeon axes: walk north, or stand still. It can never send you east.
  for (const mode of [true, false]) {
    world.strictMovement = mode;
    place(world, cx, cy);
    world.player.mover.heading = null;
    step(world, 40, { moveX: 0, moveY: -1, slash: false, fire: false });
    assert(world.player.mover.tileX === cx && world.player.mover.tileY === cy,
      `with assist ${mode ? 'off' : 'on'}, a blocked north moved the player to `
      + `${world.player.mover.tileX},${world.player.mover.tileY}`);
  }
});

test('a blocked diagonal takes the nearest way round, unless told to stop', () => {
  const { world, level } = makeWorld(3, 'controls-3');
  const cx = Math.floor(level.grid.w / 2), cy = Math.floor(level.grid.h / 3);
  clearArena(world, cx, cy, 4);
  level.grid.set(cx + 1, cy - 1, T.WALL);   // wall off north-east only

  world.strictMovement = false;
  place(world, cx, cy);
  world.player.mover.heading = null;
  step(world, 40, { moveX: 0.7071, moveY: -0.7071, slash: false, fire: false });
  const dx = world.player.mover.tileX - cx, dy = world.player.mover.tileY - cy;
  assert(dx !== 0 || dy !== 0, 'the assist found no way round a blocked diagonal');
  // North or east: either is a reasonable reading of "north-east".
  assert((dx === 0 && dy < 0) || (dx > 0 && dy === 0),
    `the assist went ${dx},${dy} instead of north or east`);

  world.strictMovement = true;
  place(world, cx, cy);
  world.player.mover.heading = null;
  step(world, 40, { moveX: 0.7071, moveY: -0.7071, slash: false, fire: false });
  assert(world.player.mover.tileX === cx && world.player.mover.tileY === cy,
    'strict mode deflected a blocked diagonal');
});

test('the character turns the moment you turn, not a tile later', () => {
  const { world, level } = makeWorld(3, 'facing-1');
  const cx = Math.floor(level.grid.w / 2), cy = Math.floor(level.grid.h / 3);
  clearArena(world, cx, cy, 6);
  place(world, cx, cy);
  world.player.mover.heading = null;

  const turns = [
    { name: 'east to north', from: { x: 1, y: 0 }, to: { x: 0, y: -1 } },
    { name: 'east to west', from: { x: 1, y: 0 }, to: { x: -1, y: 0 } },   // a full about-face
    { name: 'north to south-west', from: { x: 0, y: -1 }, to: { x: -0.7071, y: 0.7071 } },
  ];

  for (const turn of turns) {
    place(world, cx, cy);
    world.player.mover.heading = null;
    // Settle into a run in the first direction.
    step(world, 40, { moveX: turn.from.x, moveY: turn.from.y, slash: false, fire: false });
    const startTile = { x: world.player.mover.tileX, y: world.player.mover.tileY };

    // Now turn, and measure how far the feet travel before the body agrees.
    let frames = 0;
    const want = Math.atan2(turn.to.y, turn.to.x);
    const facing = () => {
      let d = Math.atan2(world.player.faceY, world.player.faceX) - want;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return Math.abs(d);
    };
    while (frames < 120 && facing() > 0.2) {
      world.update(1 / 60, { moveX: turn.to.x, moveY: turn.to.y, slash: false, fire: false });
      frames++;
    }
    const tiles = Math.abs(world.player.mover.tileX - startTile.x)
      + Math.abs(world.player.mover.tileY - startTile.y);
    assert(facing() <= 0.2,
      `${turn.name}: never came round (${(facing() * 57.3).toFixed(0)} degrees off after ${frames} frames)`);
    // The feet finish the step they are committed to; the body must not need
    // a whole tile of travel to notice.
    assert(tiles <= 1,
      `${turn.name}: took ${tiles} tiles of walking to face the right way`);
    assert(frames <= 18,
      `${turn.name}: took ${frames} frames (${(frames / 60).toFixed(2)}s) to come round`);
  }
});

test('a swing in progress still locks the facing where it was aimed', () => {
  const { world, level } = makeWorld(3, 'facing-2');
  const cx = Math.floor(level.grid.w / 2), cy = Math.floor(level.grid.h / 3);
  clearArena(world, cx, cy, 6);
  place(world, cx, cy);
  step(world, 30, { moveX: 1, moveY: 0, slash: false, fire: false });
  const aimed = { x: world.player.faceX, y: world.player.faceY };

  // Swing, and try to turn away mid-arc.
  world.update(1 / 60, { moveX: 1, moveY: 0, slash: true, fire: false });
  assert(world.player.attack, 'the swing did not start');
  for (let i = 0; i < 10; i++) {
    world.update(1 / 60, { moveX: -1, moveY: 0, slash: false, fire: false });
    if (!world.player.attack) break;
  }
  const drift = Math.hypot(world.player.faceX - aimed.x, world.player.faceY - aimed.y);
  assert(drift < 0.05, `the arc swept round with the feet (drifted ${drift.toFixed(2)})`);
});

test('a doorway one tile off the line pulls you through it', () => {
  const { world, level } = makeWorld(3, 'doorway-1');
  const cx = Math.floor(level.grid.w / 2), cy = Math.floor(level.grid.h / 3);
  clearArena(world, cx, cy, 4);
  // A wall across the north of the arena with a single gap, one tile west of
  // where the player stands. Pressing north alone should find it.
  for (let x = cx - 4; x <= cx + 4; x++) level.grid.set(x, cy - 1, T.WALL);
  level.grid.set(cx - 1, cy - 1, T.FLOOR);

  world.strictMovement = false;
  place(world, cx, cy);
  world.player.mover.heading = null;
  step(world, 60, { moveX: 0, moveY: -1, slash: false, fire: false });
  assert(world.player.mover.tileY < cy,
    `holding north beside a doorway left the player at ${world.player.mover.tileX},`
    + `${world.player.mover.tileY} instead of walking through it`);
  assert(world.player.mover.tileX === cx - 1,
    'the player went through something other than the doorway');

  // ...but only one tile of tolerance. Two tiles off is a wall, not a near miss.
  place(world, cx + 1, cy);
  world.player.mover.heading = null;
  step(world, 60, { moveX: 0, moveY: -1, slash: false, fire: false });
  assert(world.player.mover.tileY === cy,
    'the assist reached across two tiles to find a doorway');

  // Strict movement means exactly what was pressed, including the refusal.
  world.strictMovement = true;
  place(world, cx, cy);
  world.player.mover.heading = null;
  step(world, 60, { moveX: 0, moveY: -1, slash: false, fire: false });
  assert(world.player.mover.tileX === cx && world.player.mover.tileY === cy,
    'strict movement still slid the player sideways into a doorway');
});

test('a lone pillar is not mistaken for a doorway', () => {
  const { world, level } = makeWorld(3, 'doorway-2');
  const cx = Math.floor(level.grid.w / 2), cy = Math.floor(level.grid.h / 3);
  clearArena(world, cx, cy, 4);
  level.grid.set(cx, cy - 1, T.WALL);   // one block, open ground either side

  world.strictMovement = false;
  place(world, cx, cy);
  world.player.mover.heading = null;
  step(world, 60, { moveX: 0, moveY: -1, slash: false, fire: false });
  assert(world.player.mover.tileX === cx && world.player.mover.tileY === cy,
    'the assist shunted the player round an obstacle rather than through a door');
});

test('dousing the torch costs sight and buys hearing, and is reversible', () => {
  const { world } = makeWorld(4, 'torch-1');
  step(world, 10);
  const litRadius = world.torchRadius;
  const litHearing = world.hearingScale;
  assert(litRadius > 5, 'a lit torch should reach a useful distance');

  world.toggleTorch();
  step(world, 10);
  assert(!world.torchLit, 'the torch did not go out');
  assert(world.torchRadius < litRadius * 0.5,
    `dousing barely changed the torch radius (${litRadius} -> ${world.torchRadius})`);
  assert(world.hearingScale > litHearing, 'going dark did not sharpen hearing');

  world.torchToggleCooldown = 0;
  world.toggleTorch();
  step(world, 10);
  assert(world.torchLit && world.torchRadius > litRadius * 0.9,
    'relighting did not restore the torch');
});

test('a cold fire can be lit, but not by a torchbearer with no torch', () => {
  const { world, level } = makeWorld(4, 'fire-1');
  const fire = { kind: 'brazier', x: 0, y: 0, seed: 0.5, lit: false, radius: 4.4, intensity: 0.7, id: 'test_fire' };
  const cell = level.floorCells.find((c) => world.layerAt(c.y) === 0);
  fire.x = cell.x + 0.5; fire.y = cell.y + 0.5;
  level.sconces.push(fire);
  place(world, cell.x, cell.y);
  clearArena(world, cell.x, cell.y, 2);

  world.toggleTorch();          // go dark first
  step(world, 6);
  world.updateInteractTarget();
  assert(world.interactTarget && world.interactTarget.type === 'fire',
    'standing on a cold fire offered no action');
  assert(!world.interactTarget.enabled, 'a doused torchbearer was allowed to light a fire');
  world.interact();
  assert(!fire.lit, 'the fire lit itself with nothing to light it from');

  world.torchToggleCooldown = 0;
  world.toggleTorch();
  step(world, 6);
  world.updateInteractTarget();
  assert(world.interactTarget.enabled, 'a lit torch was still refused');
  world.interact();
  assert(fire.lit, 'the fire did not catch');
  // ...and it now lights the room it is standing in.
  world.refreshVisibility(0);
  assert(world.vis.lightAt(Math.floor(fire.x) + 2, Math.floor(fire.y)) > 0,
    'a lit fire threw no light');
});

test('blood is left where things bleed, and carried a few tiles on the boots', () => {
  const { world, level } = makeWorld(4, 'gore-1');
  const cx = Math.floor(level.grid.w / 2), cy = Math.floor(level.grid.h / 3);
  clearArena(world, cx, cy, 5);
  place(world, cx, cy);

  const enemy = spawnAt(world, 'draugr_thrall', cx + 1, cy);
  enemy.hp = 1;
  world.player.faceX = 1; world.player.faceY = 0;
  step(world, 40, { moveX: 0, moveY: 0, slash: true, fire: false });
  assert(world.gore.stains.length > 0, 'a kill left no blood at all');
  assert(world.gore.corpses.length === 1, 'a kill left no body');

  // Walk over the pool and away from it: the first tiles carry prints.
  world.gore.stains.length = 0;
  world.gore.pool(cx + 0.5, cy + 0.5, '#7a1f1c', 1);
  const before = world.gore.stains.length;
  world.player.mover.heading = null;
  step(world, 90, { moveX: 1, moveY: 0, slash: false, fire: false });
  const prints = world.gore.stains.filter((s) => s.print);
  assert(prints.length > 0, 'walking out of a pool of blood left no prints');
  assert(prints.length <= 6, `prints did not wear off: ${prints.length} of them`);
  assert(world.gore.stains.length > before, 'no new stains were recorded at all');
});

// --- sound -----------------------------------------------------------------

// Carves an explicit little map into a real level so the propagation rules can
// be checked against a shape rather than against whatever the generator made.
function carve(level, cells) {
  for (const [x, y] of cells) level.grid.set(x, y, T.FLOOR);
}

test('sound will not go through a wall, and pays for every corner it turns', () => {
  const { world, level } = makeWorld(3, 'sound-1');
  const cx = Math.floor(level.grid.w / 2), cy = Math.floor(level.grid.h / 3);
  // Wall off a generous block, then cut two corridors of the same length out
  // of it: one straight east, one that goes east then turns north.
  for (let y = cy - 8; y <= cy + 8; y++) {
    for (let x = cx - 2; x <= cx + 10; x++) level.grid.set(x, y, T.WALL);
  }
  const straight = [];
  for (let i = 0; i <= 8; i++) straight.push([cx + i, cy]);
  const dogleg = [];
  for (let i = 0; i <= 4; i++) dogleg.push([cx + i, cy + 4]);
  for (let i = 1; i <= 4; i++) dogleg.push([cx + 4, cy + 4 + i]);
  carve(level, straight);
  carve(level, dogleg);
  level.grid.set(cx, cy + 1, T.FLOOR);
  level.grid.set(cx, cy + 2, T.FLOOR);
  level.grid.set(cx, cy + 3, T.FLOOR);
  level.grid.set(cx, cy + 4, T.FLOOR);

  const field = new SoundField(level.grid);
  field.build(cx + 0.5, cy + 0.5, 30, () => false);

  // Straight down the corridor: nothing turned, and it is exactly as far as
  // it looks.
  const far = field.hear(cx + 8.5, cy + 0.5, 1);
  assert(far, 'a straight corridor did not carry sound at all');
  assert(far.corners === 0, `a straight corridor counted ${far.corners} corners`);
  assertNear(far.distance, 8, 0.1, 'straight corridor distance');

  // Through the stone: eight tiles across, but not reachable in eight.
  const behind = field.hear(cx + 8.5, cy + 2.5, 1);
  assert(!behind || behind.distance > 9,
    'sound reached straight through a wall');

  // Round the bend: the same walk, but it cost more and it registered.
  const bent = field.hear(cx + 4.5, cy + 8.5, 1);
  assert(bent, 'sound did not turn the corner at all');
  assert(bent.corners >= 1, 'turning a corner registered no corners');
  assert(bent.distance > 8, `a dog-leg cost ${bent.distance}, no more than a straight run`);
  assert(bent.echo > far.echo, 'a bend did not muddy the sound');
});

test('a longer tail reaches further without getting louder up close', () => {
  // The whole point of the tail argument. Scaling loudness would have done
  // the reaching, but the falloff runs to zero at the edge, so pushing the
  // edge out lifts every distance with it -- including the ones under your
  // nose. A groan two tiles away must sound exactly as it always did.
  const level = generateLevel({ depth: 3, seed: 'tail-1', context: {} });
  const start = level.floorCells.find((c) => {
    for (let d = 0; d <= 12; d++) if (level.grid.get(c.x + d, c.y) !== T.FLOOR) return false;
    return true;
  });
  assert(start, 'no straight run of floor to measure along');

  const field = new SoundField(level.grid);
  field.build(start.x + 0.5, start.y + 0.5, 12, () => false);

  const near = (tail) => field.hear(start.x + 1.5, start.y + 0.5, 1, tail);
  const plain = near(1);
  const stretched = near(2.5);
  assert(plain && stretched, 'a tile away was inaudible');
  assertNear(stretched.volume, plain.volume, 0.02,
    `a stretched tail changed the near field: ${plain.volume} -> ${stretched.volume}`);

  // ...and the far end genuinely extends. Eleven tiles out is silent on the
  // plain curve and a whisper on the stretched one.
  const outer = (tail) => field.hear(start.x + 11.5, start.y + 0.5, 1, tail);
  const plainFar = outer(1);
  const stretchedFar = outer(2.5);
  assert(stretchedFar && stretchedFar.volume > 0, 'the stretched tail did not reach');
  assert(!plainFar || stretchedFar.volume > plainFar.volume * 2,
    'the stretched tail was no louder at the edge than the plain one');

  // Distance and corner count describe the journey, not the curve, so neither
  // may move when only the tail does -- occlusion and echo hang off them.
  assertNear(stretchedFar.distance, plainFar ? plainFar.distance : stretchedFar.distance,
    0.001, 'the tail changed how far the sound had travelled');
});

test('a captive is heard from further off than a creature', () => {
  // Two knobs, deliberately different sizes: a screaming captive is a landmark
  // you hear from the far end of a depth, a groan is a warning about the next
  // room. If they ever converge the scream stops being worth crossing to.
  //
  // Measured as where each curve drops under the 0.015 cutoff world.hearSfx
  // uses, solved from the curve rather than asserted from the constants --
  // the shape is what decides it, and the shape is the thing that changed.
  const audibleTo = (loudness, tail, range = 14) => {
    const reach = range * loudness * tail;
    return reach * (1 - Math.pow(0.015, 1 / (2 * tail)));
  };
  const plain = audibleTo(1, 1);
  const voice = audibleTo(1, VOICE_REACH);
  const scream = audibleTo(1.6, 3);        // world.js: SCREAM_DRAW, SCREAM_REACH

  assert(VOICE_REACH > 1, 'creature voices carry no further than the plain curve');
  assert(voice > plain * 1.15,
    `a voice reaches ${voice.toFixed(1)} tiles against a plain ${plain.toFixed(1)}`);
  assert(scream > voice * 1.8,
    `a scream (${scream.toFixed(1)}) is not clearly further than a voice (${voice.toFixed(1)})`);
  // The straight-line cull in updateCaptives has to sit outside the reach, or
  // it silently becomes the thing deciding what is audible.
  assert(scream < 44, `a scream reaches ${scream.toFixed(1)}, past its own 44-tile cull`);
});

test('the hearing field is flooded wide enough for the longest tail', () => {
  // The one way the tail could fail silently: a sound given a long tail but no
  // ground to travel over comes out *inaudible* rather than faint, because the
  // flood never stamped the tile it was made on.
  const { world } = makeWorld(4, 'sound-tail');
  step(world, 20);
  assert(world.hearing.span >= world.hearing.range * 3 - 0.001,
    `the field floods to ${world.hearing.span} against a reference of ${world.hearing.range}`);
  // ...and the reference itself is untouched, so ordinary sounds are unmoved.
  assertNear(world.hearing.range, world.hearingRange, 0.001,
    'the flood moved the distance sounds are measured against');
});

test('hearing reaches further than the torch, and further again in the dark', () => {
  const { world } = makeWorld(4, 'sound-2');
  step(world, 20);
  const litRange = world.hearingRange;
  assert(litRange > world.torchRadius * 1.4,
    `hearing (${litRange}) barely beats the torch (${world.torchRadius})`);
  world.toggleTorch();
  step(world, 30);
  assert(world.hearingRange > litRange, 'going dark did not extend hearing');
});

test('a bolt clattering off stone pulls unaware creatures to the noise', () => {
  const { world, level } = makeWorld(4, 'sound-3', (r) => { r.hasCrossbow = true; });
  const cx = Math.floor(level.grid.w / 2), cy = Math.floor(level.grid.h / 3);
  clearArena(world, cx, cy, 1);
  // One long corridor, so the creature is well outside the torch and cannot
  // see the player however it happens to be facing.
  for (let x = cx - 16; x <= cx + 2; x++) level.grid.set(x, cy, T.FLOOR);
  world.flow = null;
  place(world, cx, cy);

  const watcher = spawnAt(world, 'draugr_thrall', cx - 12, cy);
  watcher.state = 'idle';
  step(world, 30);
  assert(watcher.state === 'idle',
    `the creature noticed the player twelve tiles off (state ${watcher.state})`);
  // Read the starting tile after it has settled: an idle creature wanders, so
  // where it was when it was placed is not where it is now.
  const homeX = watcher.mover.tileX;

  // A noise beyond it, on the far side from the player, so what it walks
  // toward is the noise and not the torch.
  const drawn = world.makeNoise(cx - 15, cy, 1.2);
  assert(drawn >= 1, 'nothing heard a noise three tiles away down a straight corridor');
  assert(watcher.state === 'seeking', 'the creature heard the noise and ignored it');
  step(world, 180);
  assert(watcher.mover.tileX < homeX,
    `the creature never went to look (${homeX} -> ${watcher.mover.tileX})`);

  // ...and it gives up rather than standing there for the rest of the level.
  step(world, 60 * 8);
  assert(watcher.state !== 'seeking', 'the creature investigated forever');
});

// --- what the labyrinth tells you, and who it tells you about --------------

test('a map scrap marks one real thing and puts an arrow on the chart', () => {
  const { world, level } = makeWorld(5, 'map-1');
  const scrap = level.props.find((p) => p.type === 'mapScrap');
  assert(scrap, 'no map was generated on a depth five level');
  assert(world.hints.length === 0, 'the level started with hints already given');

  const before = world.vis.seen.slice();
  assert(world.readMap(scrap), 'the map could not be read');
  assert(scrap.read && scrap.consumed, 'a read map is still lying there');
  assert(world.hints.length === 1, 'reading a map gave no hint');

  const hint = world.hints[0];
  const i = level.grid.idx(Math.floor(hint.x), Math.floor(hint.y));
  assert(world.vis.seen[i], 'the hint was not put on the chart');
  // Being told where a thing is must not light the road to it.
  let opened = 0;
  for (let n = 0; n < before.length; n++) if (!before[n] && world.vis.seen[n]) opened++;
  assert(opened <= 1, `reading a map revealed ${opened} tiles, not just the one`);

  // ...and it stops pointing once the player has been there.
  place(world, Math.floor(hint.x), Math.floor(hint.y));
  step(world, 10);
  assert(hint.resolved, 'the hint kept pointing after the player arrived');
});

test('a hint never points at something already taken', () => {
  const { world, level } = makeWorld(6, 'map-2');
  for (const k of level.keys) k.taken = true;
  const hint = world.revealHint('key');
  if (hint) {
    assert(hint.kind !== 'key', 'a hint pointed at a key that was already taken');
  }
});

test('killing a captive that did not ask for it costs, and mercy does not', () => {
  const { world, level, run } = makeWorld(5, 'captive-1');
  const cx = Math.floor(level.grid.w / 2), cy = Math.floor(level.grid.h / 3);
  clearArena(world, cx, cy, 4);

  // One who is frightened, and one who has had enough.
  const afraid = {
    type: 'prisoner', x: cx + 1.5, y: cy + 0.5, wallX: 0, wallY: -1, mood: 'afraid',
    seed: 0.3, spoken: false, searched: false, freed: false, knows: 'exit', carries: null,
    pleadToDie: false, id: 'captive_afraid',
  };
  const begging = {
    type: 'prisoner', x: cx + 1.5, y: cy + 2.5, wallX: 0, wallY: -1, mood: 'begging',
    seed: 0.7, spoken: false, searched: false, freed: false, knows: 'nothing', carries: null,
    pleadToDie: true, id: 'captive_begging',
  };
  level.props.push(afraid, begging);

  // Speaking to the frightened one is free, and what they know is the point.
  place(world, cx + 1, cy);
  step(world, 6);
  world.updateInteractTarget();
  assert(world.interactTarget && world.interactTarget.type === 'captive',
    'standing beside a captive offered nothing');
  world.interact();
  assert(afraid.spoken, 'the captive was not spoken to');
  assert(world.hints.length === 1, 'a captive who knows the way said nothing useful');
  assert(run.score.level.penalty === 0, 'listening to someone cost score');

  // Cutting the frightened one down: killing them without being asked.
  world.player.faceX = 0; world.player.faceY = 1;
  world.murderCaptive(afraid);
  assert(run.score.level.penalty < 0, 'murder cost nothing at all');
  const murderCost = run.score.level.penalty;

  // The one who asked. Listening first is what makes it mercy.
  place(world, cx + 1, cy + 2);
  step(world, 6);
  world.updateInteractTarget();
  world.interact();
  assert(begging.spoken, 'the begging captive was not listened to');
  const before = run.score.level.combat;
  world.murderCaptive(begging);
  assert(run.score.level.penalty === murderCost, 'mercy was charged as murder');
  assert(run.score.level.combat > before, 'mercy paid nothing');
});

test('a raving captive brings company', () => {
  const { world, level } = makeWorld(5, 'captive-2');
  const cx = Math.floor(level.grid.w / 2), cy = Math.floor(level.grid.h / 3);
  clearArena(world, cx, cy, 1);
  // The same corridor trick as the bolt test: far enough away that nothing
  // here has anything to do with the player being visible.
  for (let x = cx - 2; x <= cx + 16; x++) level.grid.set(x, cy, T.FLOOR);
  world.flow = null;
  place(world, cx, cy);
  const watcher = spawnAt(world, 'draugr_thrall', cx + 12, cy);
  watcher.state = 'idle';
  step(world, 20);
  assert(watcher.state === 'idle', `the creature already saw the player (${watcher.state})`);

  level.props.push({
    type: 'prisoner', x: cx + 14.5, y: cy + 0.5, wallX: 0, wallY: -1, mood: 'raving',
    seed: 0.1, spoken: false, searched: false, freed: false, knows: 'nothing',
    carries: null, screamTimer: 0.01, id: 'captive_raving',
  });
  step(world, 12);
  assert(watcher.state === 'seeking',
    `screaming did not draw anything (state ${watcher.state})`);
});

// --- altars ----------------------------------------------------------------

function altarAt(world, x, y, id = 'test_altar') {
  const prop = { type: 'altar', x: x + 0.5, y: y + 0.5, used: false, seed: 0.42, id };
  world.level.props.push(prop);
  return prop;
}

test('an altar never asks for something the player cannot pay', () => {
  // Swept across a wide range of states, because the whole promise of the
  // system is that every offer on the slab is payable when it is shown.
  for (const hp of [14, 30, 49, 60, 120]) {
    for (const levelScore of [0, 600, 3000]) {
      const { world, run } = makeWorld(6, 'altar-afford-' + hp + '-' + levelScore);
      run.hp = hp;
      run.score.level.combat = levelScore;
      const prop = altarAt(world, Math.floor(world.player.x), Math.floor(world.player.y));
      for (const offer of world.altarOffers(prop)) {
        const id = offer.sacrifice.id;
        if (id === 'hpFixed' || id === 'hpPercent' || id === 'hpDrop') {
          assert(run.hp - offer.amount >= HP_FLOOR,
            `${id} at ${hp}hp would leave ${run.hp - offer.amount}`);
        }
        // Losing a whole percentage of nothing is not a sacrifice.
        if (id === 'hpPercent') assert(hp >= 50, `a percentage was asked at ${hp}hp`);
        // Dropping to a number is only ever offered from real strength.
        if (id === 'hpDrop') {
          assert(hp >= (run.hp - offer.amount) * 2,
            `drop-to-a-number offered at ${hp}hp for a floor of ${run.hp - offer.amount}`);
        }
        if (id === 'scoreLevel') {
          assert(levelScore >= 1200, `a level reset was asked for ${levelScore} points`);
        }
        if (id === 'scoreFixed') {
          assert(levelScore >= 500, `a score payment was asked for ${levelScore} points`);
        }
      }
    }
  }
});

test('an altar never offers something the player has no use for', () => {
  const { world, run } = makeWorld(6, 'altar-usable');
  run.hasCrossbow = false;
  run.hp = run.maxHp;
  const prop = altarAt(world, Math.floor(world.player.x), Math.floor(world.player.y));
  for (const offer of world.altarOffers(prop)) {
    assert(offer.reward.id !== 'arrows', 'bolts were offered to somebody with no crossbow');
    assert(offer.reward.id !== 'mend' && offer.reward.id !== 'heal' && offer.reward.id !== 'restored',
      'healing was offered at full health');
  }
});

test('an altar takes exactly what it said and gives exactly what it promised', () => {
  const { world, run, level } = makeWorld(6, 'altar-trade');
  run.hp = 90;
  const prop = altarAt(world, Math.floor(world.player.x), Math.floor(world.player.y));
  const offer = {
    tier: 3,
    reward: REWARD_BY_ID.exit,
    sacrifice: SACRIFICE_BY_ID.hpFixed,
    amount: 24,
    costText: '24 vitality',
  };
  assert(world.takeOffer(prop, offer), 'the offer was refused');
  assert(run.hp === 66, `paid ${90 - run.hp} instead of 24`);
  assert(world.hints.some((h) => h.kind === 'exit'), 'the way down was not shown');
  const st = level.stairs;
  assert(world.vis.seen[level.grid.idx(st.x, st.y)], 'the stairs were not put on the chart');
  // And it is spent: an altar answers once.
  assert(prop.used, 'the altar is still live');
  assert(!world.takeOffer(prop, offer), 'a spent altar answered a second time');
});

test('every altar reward actually gives something', () => {
  for (const reward of REWARDS) {
    // The key reward needs a level that actually has a sealed gate on it, so
    // walk seeds until one turns up rather than hoping the first one does.
    let built = null;
    for (let s = 0; s < 12 && !built; s++) {
      const candidate = makeWorld(12, `reward-${reward.id}-${s}`, (r) => { r.hasCrossbow = true; });
      if (reward.id !== 'key' || candidate.level.gates.length > 0) built = candidate;
    }
    assert(built, `no level with a gate on it was found for ${reward.id}`);
    const { world, run, level } = built;
    const cx = Math.floor(level.grid.w / 2), cy = Math.floor(level.grid.h / 3);
    clearArena(world, cx, cy, 3);
    place(world, cx, cy);
    step(world, 20);
    // Put the run in a state where this reward is worth having.
    run.hp = Math.round(run.maxHp * 0.4);
    run.arrows = 0;
    assert(reward.usable(run, world), `${reward.id} is never usable, even when it should be`);

    const before = {
      hp: run.hp, arrows: run.arrows, hints: world.hints.length,
      seen: world.vis.discoveredCount,
    };
    const prop = altarAt(world, cx, cy, 'reward_' + reward.id);
    world.takeOffer(prop, {
      tier: reward.tier, reward, sacrifice: SACRIFICE_BY_ID.hpFixed,
      amount: 1, costText: '1 vitality',
    });
    const gained = run.hp > before.hp - 1                 // the price was 1
      || run.arrows > before.arrows
      || world.hints.length > before.hints
      || world.vis.discoveredCount > before.seen;
    assert(gained, `${reward.id} paid out nothing at all`);
  }
});

test('every altar sacrifice actually takes something', () => {
  for (const sacrifice of SACRIFICES) {
    const { world, run, level } = makeWorld(7, 'sac-' + sacrifice.id, (r) => { r.hasCrossbow = true; });
    const cx = Math.floor(level.grid.w / 2), cy = Math.floor(level.grid.h / 3);
    clearArena(world, cx, cy, 4);
    place(world, cx, cy);
    step(world, 30);
    run.hp = run.maxHp;
    run.score.level.combat = 4000;
    assert(sacrifice.affordable(run, world, 1),
      `${sacrifice.id} is never affordable, even from full health and a full board`);

    const before = {
      hp: run.hp, score: run.score.levelSubtotal, enemies: world.enemies.length,
      seen: world.vis.discoveredCount, hints: world.hints.length,
    };
    const prop = altarAt(world, cx, cy, 'sac_' + sacrifice.id);
    world.takeOffer(prop, {
      tier: sacrifice.tier, reward: REWARD_BY_ID.mend, sacrifice,
      amount: sacrifice.amount(run, 1), costText: sacrifice.text(run, 1),
    });
    const paid = run.hp < before.hp
      || run.score.levelSubtotal < before.score
      || world.enemies.length > before.enemies
      || world.vis.discoveredCount < before.seen;
    assert(paid, `${sacrifice.id} cost the player nothing`);
  }
});

test('an altar always pairs a reward with a price of its own size', () => {
  for (const hp of [30, 60, 140]) {
    for (const levelScore of [0, 900, 5000]) {
      const { world, run } = makeWorld(9, `pair-${hp}-${levelScore}`, (r) => { r.hasCrossbow = true; });
      run.hp = hp;
      run.arrows = 0;
      run.score.level.combat = levelScore;
      step(world, 20);
      const prop = altarAt(world, Math.floor(world.player.x), Math.floor(world.player.y));
      const offers = world.altarOffers(prop);
      const seenTiers = new Set();
      for (const offer of offers) {
        assert(offer.reward.tier === offer.sacrifice.tier,
          `a tier ${offer.reward.tier} reward was sold for a tier ${offer.sacrifice.tier} price`);
        assert(!seenTiers.has(offer.tier),
          `two offers of tier ${offer.tier} on the same slab`);
        seenTiers.add(offer.tier);
      }
    }
  }
});

test('a bigger answer costs more of the same thing', () => {
  const { world, run } = makeWorld(7, 'sac-scale');
  run.hp = 140;
  run.score.level.combat = 6000;
  const cost = (id) => SACRIFICE_BY_ID[id].amount(run, 1);
  // Health, tier by tier: a measure of blood, then a third of you, then all
  // but the last of you.
  assert(cost('hpFixed') < cost('hpPercent'),
    `tier 1 health (${cost('hpFixed')}) is not cheaper than tier 2 (${cost('hpPercent')})`);
  assert(cost('hpPercent') < cost('hpDrop'),
    `tier 2 health (${cost('hpPercent')}) is not cheaper than tier 3 (${cost('hpDrop')})`);
  // Score: a fixed toll, then the whole depth.
  assert(cost('scoreFixed') < cost('scoreLevel'),
    `tier 1 score (${cost('scoreFixed')}) is not cheaper than tier 2 (${cost('scoreLevel')})`);
  // ...and the relic that softens them softens all of them.
  for (const id of ['hpFixed', 'hpPercent', 'scoreFixed']) {
    assert(SACRIFICE_BY_ID[id].amount(run, 0.6) < SACRIFICE_BY_ID[id].amount(run, 1),
      `${id} ignores the Bloodless Bargain`);
  }
  assert(SACRIFICE_BY_ID.hpDrop.amount(run, 0.6) < SACRIFICE_BY_ID.hpDrop.amount(run, 1),
    'hpDrop ignores the Bloodless Bargain');
});

test('forgetting wipes the chart, and charting fills it without marking anything', () => {
  const { world, level } = makeWorld(6, 'altar-chart');
  step(world, 30);
  const walked = world.vis.discoveredCount;
  assert(walked > 0, 'nothing was discovered by standing still with a torch');

  const charted = world.revealLayout(false);
  assert(charted > walked * 3, `charting only added ${charted} tiles`);
  // The layout, and nothing standing in it: props are not revealed by it.
  const hidden = level.props.filter((p) => p.hidden);
  for (const p of hidden) {
    assert(!world.revealedProps.has(p.id), 'charting the layout uncovered a hidden prop');
  }
  assert(world.hints.length === 0, 'charting the layout marked things on it');

  world.forgetEverything();
  // Only what the torch is on right now survives, because it is being seen.
  assert(world.vis.discoveredCount < walked + 40,
    `forgetting left ${world.vis.discoveredCount} tiles charted`);
  assert(world.hints.length === 0, 'forgetting left the hints behind');
});

// --- the hall of fame ------------------------------------------------------

test('the hall round-trips through CSV without losing or inventing anything', () => {
  const rows = [
    { name: 'Ragnvald', score: 48200, depth: 17, bosses: 3, kills: 210, secrets: 6,
      diff: 'ashenvow', build: 'Berserker', date: '2026-08-27', seed: 'abc', version: '1.2.0' },
    { name: 'Sigrun, the Bold', score: 41750, depth: 15, bosses: 2, kills: 180, secrets: 4,
      diff: 'torchbound', build: 'Ranger', date: '2026-08-26', seed: 'd,e"f', version: '1.2.0' },
  ];
  const csv = toCsv(rows);
  const back = parseCsv(csv);
  assert(back.length === 2, `read ${back.length} rows back from two`);
  // A name with a comma in it and a seed with a quote in it are exactly the
  // two things a hand-rolled CSV writer gets wrong.
  assert(back[1].name === 'Sigrun, the Bold', `name came back as "${back[1].name}"`);
  assert(back[1].seed === 'd,e"f', `seed came back as "${back[1].seed}"`);
  assert(back[0].score === 48200 && back[0].depth === 17, 'numbers did not survive the trip');
});

test('the hall keeps fifty names, in order, and never the same run twice', () => {
  const many = [];
  for (let i = 0; i < 80; i++) {
    many.push({ name: 'Name' + i, score: i * 100, depth: 1 + (i % 20), diff: 'torchbound' });
  }
  const ranked = rank(many.map(normalise));
  assert(ranked.length === HALL_SIZE, `the hall held ${ranked.length} names`);
  assert(ranked[0].score === 7900, 'the hall is not in order');
  for (let i = 1; i < ranked.length; i++) {
    assert(ranked[i - 1].score >= ranked[i].score, 'the hall is out of order at ' + i);
  }

  // Merging a table into itself must be a no-op: every write re-reads the
  // stored board and merges into it, so a second tab must not double it.
  const twice = merge(ranked, ranked);
  assert(twice.length === ranked.length, `merging with itself grew the hall to ${twice.length}`);

  // ...but a genuinely new name gets in and pushes the last one out.
  const grown = merge(ranked, [normalise({ name: 'Newcomer', score: 99999, depth: 30, diff: 'ashenvow' })]);
  assert(grown.length === HALL_SIZE, 'the hall overflowed');
  assert(grown[0].name === 'Newcomer', 'a record score did not take first place');
});

test('a hall file written by a stranger is read without trusting it', () => {
  const hostile = [
    'name,score,depth,diff',
    ',999999,50,ashenvow',                          // no name: dropped
    'Nobody,,3,torchbound',                          // no score: dropped
    'Ghost,-500,4,torchbound',                       // a negative score is no score
    'Cheat,500,-9,torchbound',                       // a negative depth is clamped
    'A very long name indeed that goes on and on,120,4,torchbound',
    'Fine,1500,7,torchbound',
  ].join(String.fromCharCode(10));
  const rows = parseCsv(hostile);
  assert(rows.length === 3, `read ${rows.length} rows from three valid ones`);
  for (const r of rows) {
    assert(r.score > 0 && r.depth >= 1, 'a nonsense row got through unclamped');
    assert(r.name.length <= 18, `a name of ${r.name.length} characters got through`);
  }
  assert(rows.some((r) => r.name === 'Cheat' && r.depth === 1), 'a negative depth was not clamped');
});

// --- controls and seeds ----------------------------------------------------

test('the controls are described in exactly one place, and it covers them all', () => {
  // Every action that has a key binding and is used during play must appear
  // in the list the interface renders from, or a screen will quietly stop
  // mentioning it -- which is how the torch and the map went undocumented.
  const played = ['slash', 'fire', 'action', 'pause', 'bestiary', 'map', 'torch'];
  for (const action of played) {
    assert(BINDINGS[action], `${action} has no key binding`);
    assert(CONTROLS.some((c) => c.id === action),
      `${action} is bound to a key but is not in the control list`);
  }
  // Movement is described as four compass entries rather than by action name.
  for (const dir of ['north', 'east', 'south', 'west']) {
    assert(CONTROLS.some((c) => c.id === dir), `${dir} is missing from the control list`);
  }
  for (const control of CONTROLS) {
    assert(control.label && control.keys, `${control.id} is missing a label or its keys`);
  }
  // The torch answers to both T and Q: Q falls under the ring finger of a
  // hand already on WASD, and losing it is felt by anyone playing that way.
  assert(BINDINGS.torch.includes('KeyT') && BINDINGS.torch.includes('KeyQ'),
    'the torch should answer to both T and Q');

  // No key may mean two different things.
  const claimed = new Map();
  for (const [action, codes] of Object.entries(BINDINGS)) {
    for (const code of codes) {
      const already = claimed.get(code);
      assert(already === undefined || already === action,
        `${code} is bound to both ${already} and ${action}`);
      claimed.set(code, action);
    }
  }

  // Anything printed as an alternative has to actually be bound to it.
  for (const control of CONTROLS) {
    const codes = BINDINGS[control.id];
    if (!codes) continue;
    const printed = control.keys.split('/').length;
    assert(printed === codes.length,
      `${control.id} prints ${printed} key(s) as "${control.keys}" but is bound to ${codes.length}`);
  }
});

test('a seed typed by hand gives the labyrinth it names', () => {
  // Whatever the player pastes in, two people who think they typed the same
  // seed have to get the same level.
  const messy = ['  Fenrir 1234!! ', 'FENRIR--1234', 'fenrir 1234'];
  for (const text of messy) {
    assert(normaliseSeed(text) === 'fenrir-1234',
      `"${text}" normalised to "${normaliseSeed(text)}"`);
  }
  assert(normaliseSeed('') === null, 'an empty seed should ask for a new one');
  assert(normaliseSeed('!!!') === null, 'a seed of nothing but punctuation should be no seed');

  const shape = (seed) => {
    const run = new Run(seed);
    run.depth = 1;
    run.refreshMods();
    const level = generateLevel({ depth: 1, seed, context: run.levelContext() });
    return [level.floorCells.length, level.rooms.length,
      level.stairs.x, level.stairs.y, level.props.length].join(':');
  };
  assert(shape('fenrir-1234') === shape('fenrir-1234'), 'the same seed gave two labyrinths');
  assert(shape('fenrir-1234') !== shape('mimir-9999'), 'two seeds gave the same labyrinth');
  // makeSeed produces something that survives a round trip through the field.
  for (let i = 0; i < 40; i++) {
    const seed = makeSeed();
    assert(normaliseSeed(seed) === seed, `generated seed "${seed}" is not its own normal form`);
  }
});

// --- release notes ---------------------------------------------------------

test('the version being played has release notes, and they are in order', () => {
  // The one that matters: bumping version.json without writing down what
  // changed fails here rather than shipping a screen with a hole in it.
  const mine = RELEASES.find((r) => r.version === VERSION.number);
  assert(mine, `nothing is written down for the version being played (${VERSION.number})`);

  const parse = (v) => v.split('.').map(Number);
  const seen = new Set();
  for (let i = 0; i < RELEASES.length; i++) {
    const r = RELEASES[i];
    assert(/^\d+\.\d+\.\d+$/.test(r.version), `"${r.version}" is not a version number`);
    assert(!seen.has(r.version), `${r.version} is listed twice`);
    seen.add(r.version);
    if (i === 0) continue;
    const [a, b] = [parse(RELEASES[i - 1].version), parse(r.version)];
    const newer = a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];
    assert(newer, `${RELEASES[i - 1].version} is not newer than ${r.version}`);
  }
});

test('every release says something, and says when it was', () => {
  for (const r of RELEASES) {
    assert(r.headline && r.headline.length > 12, `${r.version} has no headline`);
    assert(r.sections && r.sections.length, `${r.version} lists no changes`);
    for (const section of r.sections) {
      assert(section.title, `${r.version} has a section with no title`);
      assert(section.notes && section.notes.length, `${r.version}: "${section.title}" is empty`);
      for (const note of section.notes) {
        assert(note.length > 20, `${r.version}: "${note}" is too short to mean anything`);
      }
    }
    // Everything except the version being played has to carry its own stamp;
    // that one borrows the running build, because it has not been built yet.
    if (r.version === VERSION.number) continue;
    assert(/^\d{8}-\d{6}$/.test(r.build || ''), `${r.version} has no build stamp`);
    assert(/^\d{4}-\d{2}-\d{2}$/.test(r.date || ''), `${r.version} has no date`);
    assert(Number.isInteger(r.pr) && r.pr > 0, `${r.version} names no pull request`);
  }
});

// --- keys, gates and the exit ----------------------------------------------

test('a gate stays shut without its key and opens with it', () => {
  const { world, level, run } = makeWorld(8, 'gate-1');
  assert(level.gates.length > 0, 'expected a staged level with at least one gate');
  const gate = level.gates[0];
  place(world, gate.x - (gate.passage === 'x' ? 1 : 0), gate.y - (gate.passage === 'y' ? 1 : 0));
  world.updateInteractTarget();
  assert(world.interactTarget && world.interactTarget.type === 'gate', 'no gate prompt next to a gate');
  assert(!world.interactTarget.enabled, 'gate offered itself without the key');
  world.interact();
  assert(!gate.open, 'gate opened without its key');

  run.keys.add(gate.colourIndex);
  world.updateInteractTarget();
  assert(world.interactTarget.enabled, 'gate stayed locked while holding its key');
  world.interact();
  assert(gate.open, 'gate did not open with the matching key');
});

test('a closed gate physically blocks movement and an open one does not', () => {
  const { world, level, run } = makeWorld(8, 'gate-2');
  const gate = level.gates[0];
  const along = gate.passage === 'x' ? { x: 1, y: 0 } : { x: 0, y: 1 };
  place(world, gate.x - along.x, gate.y - along.y);
  const startX = world.player.x, startY = world.player.y;
  step(world, 90, { moveX: along.x, moveY: along.y, slash: false, fire: false });
  const blockedDist = Math.hypot(world.player.x - startX, world.player.y - startY);
  assert(blockedDist < 1.2, `player walked ${blockedDist.toFixed(2)} tiles through a locked gate`);

  run.keys.add(gate.colourIndex);
  world.updateInteractTarget();
  world.interact();
  gate.openAmount = 1;
  step(world, 120, { moveX: along.x, moveY: along.y, slash: false, fire: false });
  const openDist = Math.hypot(world.player.x - startX, world.player.y - startY);
  assert(openDist > 1.5, `player only moved ${openDist.toFixed(2)} tiles through an open gate`);
});

test('walking onto a key picks it up', () => {
  const { world, level, run } = makeWorld(6, 'key-1');
  const key = level.keys.find((k) => k.holder !== 'enemy');
  assert(key, 'expected at least one key lying on the floor');
  place(world, key.x, key.y);
  step(world, 4);
  assert(key.taken, 'key was not collected');
  assert(run.keys.has(key.colourIndex), 'key was not recorded on the run');
});

test('stairs need an explicit action and never trigger by standing on them', () => {
  const { world, level } = makeWorld(3, 'stairs-1');
  place(world, level.stairs.x, level.stairs.y);
  step(world, 180);
  assert(!world.finished, 'standing on the stairs completed the level by itself');
  world.updateInteractTarget();
  assert(world.interactTarget && world.interactTarget.type === 'stairs', 'no stairs prompt');
  assert(world.interactTarget.enabled, 'stairs prompt was disabled on a normal level');
  world.interact();
  assert(world.finished, 'the action press did not use the stairs');
});

test('a key carried by an enemy drops where the enemy dies', () => {
  // Carried keys are a chance placement, so search seeds for one rather than
  // letting the test quietly skip itself.
  let world = null, level = null, carrier = null;
  for (let s = 0; s < 30 && !carrier; s++) {
    const built = makeWorld(9, 'carried-key-' + s);
    const found = built.world.enemies.find((e) => e.carriesKey !== null && e.carriesKey !== undefined);
    if (found) { world = built.world; level = built.level; carrier = found; }
  }
  assert(carrier, 'no enemy-held key generated across 30 seeds');
  const key = level.keys.find((k) => k.colourIndex === carrier.carriesKey);
  assert(key.holder === 'enemy', 'key was not marked as carried');
  carrier.takeDamage(99999, world, 'sword');
  assert(key.holder === null, 'key was not released on death');
  assert(!key.taken, 'key was consumed rather than dropped');
  const tile = level.grid.get(key.x, key.y);
  assert(tile === T.FLOOR || tile === T.ENTRANCE || tile === T.STAIRS,
    'dropped key landed on an unwalkable tile');
});

// --- combat -----------------------------------------------------------------

function spawnAt(world, defId, x, y) {
  const e = new Enemy({
    defId, x: x + 0.5, y: y + 0.5, elite: false, dormant: false,
    zone: 0, anchor: { x: x + 0.5, y: y + 0.5 },
  }, world.level.depth, world.rng);
  world.enemies.push(e);
  return e;
}

function openFloorNear(level, from) {
  for (let r = 1; r < 12; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = from.x + dx, y = from.y + dy;
        if (level.grid.get(x, y) !== T.FLOOR) continue;
        if (level.grid.get(x + 1, y) !== T.FLOOR) continue;
        return { x, y };
      }
    }
  }
  return null;
}

test('a sword swing damages and kills what it faces, and misses what it does not', () => {
  const { world, level, run } = makeWorld(1, 'combat-1');
  const spot = openFloorNear(level, level.entrance);
  assert(spot, 'no open pair of floor tiles found');
  place(world, spot.x, spot.y);
  world.player.faceX = 1; world.player.faceY = 0;

  const target = spawnAt(world, 'draugr_thrall', spot.x + 1, spot.y);
  const behind = spawnAt(world, 'draugr_thrall', spot.x - 1, spot.y);
  // Hold both still so the test measures the swing, not their wandering.
  for (const e of [target, behind]) { e.state = 'idle'; e.wanderTimer = 999; e.wanderX = 0; e.wanderY = 0; }

  const before = target.hp;
  step(world, 40, { moveX: 0, moveY: 0, slash: true, fire: false });
  assert(target.hp < before, 'the enemy in front took no damage');
  assert(behind.hp === behind.maxHp, 'an enemy behind the player was hit by a forward swing');

  let guard = 0;
  while (!target.dead && guard++ < 60) step(world, 30, { moveX: 0, moveY: 0, slash: true, fire: false });
  assert(target.dead, 'repeated swings failed to kill a basic enemy');
  assert(run.score.level.kills >= 1, 'the kill was not scored');
});

test('a kill streak raises the multiplier and expires on its own', () => {
  const { world, run } = makeWorld(1, 'streak-1');
  run.score.streakWindow = 3.5;
  run.score.addKill(100, { mods: run.mods });
  run.score.addKill(100, { mods: run.mods });
  run.score.addKill(100, { mods: run.mods });
  assert(run.score.streak === 3, 'streak did not accumulate');
  assert(run.score.multiplier > 1, 'multiplier stayed at one during a streak');
  for (let i = 0; i < 300; i++) run.score.update(1 / 60, 3.5);
  assert(run.score.streak === 0, 'streak never expired');
  assert(run.score.multiplier === 1, 'multiplier did not reset with the streak');
});

test('the crossbow fires, consumes a bolt, and cannot fire empty', () => {
  const { world, run, level } = makeWorld(4, 'bow-1', (r) => { r.hasCrossbow = true; });
  run.arrows = 2;
  const spot = openFloorNear(level, level.entrance);
  place(world, spot.x, spot.y);
  world.player.faceX = 1; world.player.faceY = 0;

  step(world, 30, { moveX: 0, moveY: 0, slash: false, fire: true });
  assert(run.arrows === 1, `firing did not spend a bolt (arrows=${run.arrows})`);
  step(world, 90, { moveX: 0, moveY: 0, slash: false, fire: true });
  assert(run.arrows === 0, 'second shot did not spend a bolt');
  step(world, 120, { moveX: 0, moveY: 0, slash: false, fire: true });
  assert(run.arrows === 0, 'the crossbow fired with an empty quiver');
});

test('bolts stop at walls rather than passing through them', () => {
  const { world, level } = makeWorld(4, 'bow-2', (r) => { r.hasCrossbow = true; r.arrows = 5; });
  // Aim into the nearest wall.
  const p = level.entrance;
  place(world, p.x, p.y);
  let dir = null;
  for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
    if (level.grid.get(p.x + dx, p.y + dy) === T.WALL) { dir = [dx, dy]; break; }
  }
  if (!dir) return 'skipped: entrance has no adjacent wall on this seed';
  world.player.faceX = dir[0]; world.player.faceY = dir[1];
  step(world, 20, { moveX: 0, moveY: 0, slash: false, fire: true });
  step(world, 60);
  for (const proj of world.projectiles) {
    const tile = level.grid.get(Math.floor(proj.x), Math.floor(proj.y));
    assert(tile !== T.WALL, 'a bolt travelled inside a wall');
  }
});

// --- relics -----------------------------------------------------------------

test('crossbow relics are never offered before the crossbow is found', () => {
  const run = new Run('relic-1');
  run.refreshMods();
  const rng = new RNG('relic-offers');
  const bowIds = new Set(RELICS.filter((r) => r.tag === 'Crossbow').map((r) => r.id));
  for (let i = 0; i < 400; i++) {
    for (const relic of offerRelics(run, rng, 3)) {
      assert(!bowIds.has(relic.id), `${relic.name} was offered without a crossbow`);
    }
  }
  run.hasCrossbow = true;
  let sawBow = false;
  for (let i = 0; i < 400 && !sawBow; i++) {
    if (offerRelics(run, rng, 3).some((r) => bowIds.has(r.id))) sawBow = true;
  }
  assert(sawBow, 'crossbow relics never appeared even once the crossbow was owned');
});

test('a relic at its stack limit stops being offered', () => {
  const run = new Run('relic-2');
  const relic = RELIC_BY_ID.cartographers_thread;
  run.takeRelic(relic);
  const rng = new RNG('relic-cap');
  for (let i = 0; i < 300; i++) {
    for (const offer of offerRelics(run, rng, 3)) {
      assert(offer.id !== relic.id, 'a maxed single-stack relic was offered again');
    }
  }
});

test('relic modifiers are recomputed, never applied twice', () => {
  const single = computeMods({ everburning_brand: 1 });
  const doubled = computeMods({ everburning_brand: 2 });
  assertNear(single.torchRadius, 1.3, 0.001, 'one Everburning Brand');
  assertNear(doubled.torchRadius, 1.6, 0.001, 'two Everburning Brands');
  // Recomputing the same set must be idempotent.
  const again = computeMods({ everburning_brand: 2 });
  assertNear(again.torchRadius, doubled.torchRadius, 0.0001, 'recompute drifted');
});

test('every relic gives something up, in numbers and not only in prose', () => {
  for (const relic of RELICS) {
    assert(relic.text && relic.text.length > 8, `${relic.id} has no description`);
    assert(relic.max >= 1, `${relic.id} has no stack limit`);
    assert(relic.cost && relic.cost.length > 3, `${relic.id} has no stated cost`);
    // A cost line that says there is no cost is not a cost line.
    assert(!/^none\b/i.test(relic.cost.trim()),
      `${relic.id} claims to be free: "${relic.cost}"`);

    // Short enough to be read in the two seconds anybody spends on a relic
    // card while the clock is running. Several of these used to run to three
    // lines apiece, which puts a paragraph between the player and a choice --
    // and a paragraph nobody reads is worse than a sentence that is blunt.
    assert(relic.text.length <= 78,
      `${relic.id} description is ${relic.text.length} characters: "${relic.text}"`);
    assert(relic.cost.length <= 78,
      `${relic.id} cost line is ${relic.cost.length} characters: "${relic.cost}"`);

    // And the prose has to be backed by the numbers. Applied at one stack and
    // at its limit, every relic must move at least one modifier in the
    // player's favour and at least one against them.
    for (const stacks of [1, relic.max]) {
      const base = baseMods();
      const mods = baseMods();
      relic.mod(mods, stacks);
      let better = [];
      let worse = [];
      for (const key of Object.keys(base)) {
        const dir = MOD_BETTER[key];
        assert(dir !== undefined, `no direction is recorded for the modifier "${key}"`);
        const from = Number(base[key]);
        const to = Number(mods[key]);
        if (to === from) continue;
        if ((to > from) === (dir > 0)) better.push(key);
        else worse.push(key);
      }
      assert(better.length > 0,
        `${relic.id} at ${stacks} does nothing for the player`);
      assert(worse.length > 0,
        `${relic.id} at ${stacks} costs the player nothing: it only improves ${better.join(', ')}`);
    }
  }
});

test('a relic stacked to its limit costs more than one taken once', () => {
  for (const relic of RELICS) {
    if (relic.max < 2) continue;
    const one = baseMods();
    const many = baseMods();
    relic.mod(one, 1);
    relic.mod(many, relic.max);
    const base = baseMods();
    let deepened = false;
    for (const key of Object.keys(base)) {
      if (MOD_BETTER[key] > 0 ? many[key] < one[key] : many[key] > one[key]) {
        // Only counts if this modifier is a cost for this relic in the first
        // place -- i.e. it already moved against the player at one stack.
        const isCost = MOD_BETTER[key] > 0 ? one[key] < base[key] : one[key] > base[key];
        if (isCost) { deepened = true; break; }
      }
    }
    assert(deepened,
      `${relic.id} stacks to ${relic.max} without the cost growing with it`);
  }
});

test('taking a relic that grants max health does not silently heal or kill', () => {
  const run = new Run('relic-3');
  run.refreshMods();
  run.hp = 40;
  run.takeRelic(RELIC_BY_ID.ironhide_wrap);
  assert(run.maxHp === 125, `max health should be 125, got ${run.maxHp}`);
  assert(run.hp === 65, `health should rise with the cap, got ${run.hp}`);
  run.takeRelic(RELIC_BY_ID.runed_boots);
  assert(run.hp > 0 && run.hp <= run.maxHp, 'losing max health left health invalid');
});

test('the shield relic outcomes are mutually exclusive and hit their target rates', () => {
  const run = new Run('shield-1');
  run.takeRelic(RELIC_BY_ID.aegis_drowned);
  const { world } = makeWorld(1, 'shield-world');
  world.run = run;
  world.player.run = run;
  const rng = new RNG('shield-rolls');
  const counts = { hit: 0, reflect: 0, block: 0, reduced: 0 };
  const N = 200000;
  for (let i = 0; i < N; i++) counts[world.player.resolveIncoming(10, rng).outcome]++;
  assertNear(counts.reflect / N, 0.01, 0.002, 'reflect rate');
  assertNear(counts.block / N, 0.05, 0.004, 'block rate');
  assertNear(counts.reduced / N, 0.20, 0.006, 'reduced-damage rate');
  assertNear((counts.hit + counts.reflect + counts.block + counts.reduced) / N, 1, 1e-9, 'outcomes total');
  // Exclusivity: a reduced hit still deals damage, a blocked one never does.
  for (let i = 0; i < 5000; i++) {
    const r = world.player.resolveIncoming(10, rng);
    if (r.outcome === 'block' || r.outcome === 'reflect') assert(r.damage === 0, 'blocked hit dealt damage');
    if (r.outcome === 'reduced') assertNear(r.damage, 5, 0.001, 'reduced damage');
    if (r.outcome === 'hit') assertNear(r.damage, 10, 0.001, 'unmitigated damage');
  }
});

test('the quiver cannot be overfilled', () => {
  const run = new Run('ammo-1');
  run.refreshMods();
  run.giveCrossbow();
  assert(run.arrows === 5, 'the crossbow did not arrive loaded');
  assert(run.giveArrows(10) === 0, 'bolts were taken past the cap');
  assert(run.arrows === run.maxArrows, 'quiver exceeded its cap');
  run.takeRelic(RELIC_BY_ID.quiver_hunt);
  assert(run.maxArrows === 8, `quiver upgrade should reach 8, got ${run.maxArrows}`);
});

// --- secrets, hazards and encounters ---------------------------------------

test('a cracked wall only breaks when the player faces it from sword range', () => {
  const { world, level } = makeWorld(4, 'secret-1');
  const secret = level.secrets.find((s) => !s.hiddenUntil);
  assert(secret, 'expected at least one immediately available secret');
  // Stand on the open side of the cracked wall.
  let open = null;
  for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
    if (level.grid.get(secret.x + dx, secret.y + dy) === T.FLOOR) { open = [dx, dy]; break; }
  }
  assert(open, 'the secret wall has no open side');
  place(world, secret.x + open[0], secret.y + open[1]);

  // Facing away: the swing must not break it.
  world.player.faceX = open[0]; world.player.faceY = open[1];
  world.updateSecretAwareness();
  assert(world.actionableSecret !== secret, 'a wall behind the player was marked breakable');
  step(world, 40, { moveX: 0, moveY: 0, slash: true, fire: false });
  assert(!secret.broken, 'the wall broke while the player faced away from it');

  // Facing it: discovered, marked actionable, and broken by a swing.
  world.player.faceX = -open[0]; world.player.faceY = -open[1];
  world.refreshVisibility(0.016);
  world.updateSecretAwareness();
  assert(secret.discovered, 'the wall was never discovered at point-blank range');
  assert(world.actionableSecret === secret, 'the facing wall was not marked breakable');
  step(world, 40, { moveX: 0, moveY: 0, slash: true, fire: false });
  assert(secret.broken, 'facing the wall and swinging did not break it');
  assert(level.grid.get(secret.x, secret.y) === T.FLOOR, 'the broken wall is still solid');
});

test('a secret pocket is unreachable until its wall is broken', () => {
  const { world, level } = makeWorld(4, 'secret-2');
  const secret = level.secrets.find((s) => s.kind === 'closet' && s.cells.length);
  if (!secret) return 'skipped: no closet secret on this seed';
  const cell = secret.cells[0];
  place(world, cell.x, cell.y);
  // Standing inside the sealed pocket, the player cannot leave it.
  const startX = world.player.x, startY = world.player.y;
  step(world, 120, { moveX: 1, moveY: 0, slash: false, fire: false });
  step(world, 120, { moveX: -1, moveY: 0, slash: false, fire: false });
  const drift = Math.hypot(world.player.x - startX, world.player.y - startY);
  assert(drift < 3.2, `the sealed pocket leaked: player drifted ${drift.toFixed(2)} tiles`);
});

test('hazards apply the mechanic their visuals promise', () => {
  // Mud slows, ice slides, vines slow the swing, embers speed enemies up.
  const { world, level } = makeWorld(6, 'hazard-1');
  const run = findRun(level, 6);
  assert(run, 'no straight corridor found to walk along');
  const move = { moveX: run.dx, moveY: run.dy, slash: false, fire: false };

  place(world, run.x, run.y);
  forceHazard(world, 'mud');
  const before = { x: world.player.x, y: world.player.y };
  step(world, 40, move);
  const muddy = Math.hypot(world.player.x - before.x, world.player.y - before.y);

  place(world, run.x, run.y);
  forceHazard(world, 'clear');
  const before2 = { x: world.player.x, y: world.player.y };
  step(world, 40, move);
  const dry = Math.hypot(world.player.x - before2.x, world.player.y - before2.y);
  assert(dry > 1, `baseline movement was only ${dry.toFixed(2)} tiles`);
  assert(muddy < dry * 0.85, `mud did not slow the player (${muddy.toFixed(2)} vs ${dry.toFixed(2)})`);
});

test('ice carries you past where you let go, and steering is delayed', () => {
  const { world, level } = makeWorld(6, 'hazard-2');
  const corridor = findRun(level, 8);
  assert(corridor, 'no straight corridor found to slide along');
  const move = { moveX: corridor.dx, moveY: corridor.dy, slash: false, fire: false };

  // On dry ground, releasing the input stops you at the next tile.
  place(world, corridor.x, corridor.y);
  forceHazard(world, 'clear');
  step(world, 30, move);
  const dryRelease = { x: world.player.mover.tileX, y: world.player.mover.tileY };
  step(world, 120, { moveX: 0, moveY: 0, slash: false, fire: false });
  const dryCoast = Math.abs(world.player.mover.tileX - dryRelease.x)
    + Math.abs(world.player.mover.tileY - dryRelease.y);

  // On ice, the slide carries you further.
  place(world, corridor.x, corridor.y);
  forceHazard(world, 'ice');
  step(world, 30, move);
  const iceRelease = { x: world.player.mover.tileX, y: world.player.mover.tileY };
  step(world, 120, { moveX: 0, moveY: 0, slash: false, fire: false });
  const iceCoast = Math.abs(world.player.mover.tileX - iceRelease.x)
    + Math.abs(world.player.mover.tileY - iceRelease.y);

  assert(dryCoast <= 1, `dry ground coasted ${dryCoast} tiles after the input stopped`);
  assert(iceCoast > dryCoast, `ice did not carry the player (${iceCoast} vs ${dryCoast} tiles)`);
});

test('hazard threat never exceeds the depth budget', () => {
  for (let depth = 1; depth <= 20; depth++) {
    for (let s = 0; s < 6; s++) {
      const level = generateLevel({ depth, seed: `budget-${depth}-${s}`, context: {} });
      const threat = level.zoneInfo.reduce((sum, z) => sum + z.hazard.threat, 0);
      assert(threat <= hazardBudget(depth),
        `depth ${depth} carried ${threat} threat against a budget of ${hazardBudget(depth)}`);
    }
  }
});

test('an encounter room triggers, seals, and reopens when cleared', () => {
  let found = null;
  for (let s = 0; s < 20 && !found; s++) {
    const built = makeWorld(8, 'encounter-' + s);
    const enc = built.level.encounters.find((e) => e.seal && e.room && e.type !== 'survival');
    if (enc) found = { ...built, enc };
  }
  if (!found) return 'skipped: no sealing encounter generated in 20 seeds';
  const { world, enc } = found;
  const cx = Math.floor((enc.room.x0 + enc.room.x1) / 2);
  const cy = Math.floor((enc.room.y0 + enc.room.y1) / 2);
  place(world, cx, cy);
  step(world, 2);
  assert(enc.state === 'active', 'entering the room did not trigger the encounter');
  assert(world.sealBlocks.size > 0, 'a sealing encounter did not seal anything');
  for (const e of world.enemies) if (e.encounter === enc.id) e.takeDamage(99999, world, 'sword');
  step(world, 4);
  assert(enc.state === 'cleared', 'the encounter did not clear when its enemies died');
  assert(world.sealBlocks.size === 0, 'the room stayed sealed after being cleared');
});

test('taking damage during an encounter forfeits the flawless bonus', () => {
  let found = null;
  for (let s = 0; s < 20 && !found; s++) {
    const built = makeWorld(8, 'flawless-' + s);
    const enc = built.level.encounters.find((e) => e.room && e.flawless);
    if (enc) found = { ...built, enc };
  }
  if (!found) return 'skipped: no flawless-eligible encounter generated';
  const { world, enc, run } = found;
  const cx = Math.floor((enc.room.x0 + enc.room.x1) / 2);
  const cy = Math.floor((enc.room.y0 + enc.room.y1) / 2);
  place(world, cx, cy);
  step(world, 2);
  assert(enc.state === 'active', 'encounter did not start');
  world.player.invulnTimer = 0;
  world.damagePlayer(5, null);
  assert(!enc.flawlessIntact, 'flawless survived taking damage');
  const before = run.score.level.flawless;
  for (const e of world.enemies) if (e.encounter === enc.id) e.takeDamage(99999, world, 'sword');
  step(world, 4);
  assert(run.score.level.flawless === before, 'a flawless bonus was paid out after taking damage');
});

// --- ladders and vaults ----------------------------------------------------

test('a ladder carries the player into a vault and back, without changing depth', () => {
  const { world, level, run } = makeWorld(6, 'vault-1');
  assert(level.vaults.length > 0, 'no vault generated on this depth');
  const vault = level.vaults[0];
  const depthBefore = run.depth;

  place(world, vault.entry.x, vault.entry.y);
  step(world, 2);
  assert(world.interactTarget && world.interactTarget.type === 'ladder',
    'standing on the ladder offered no prompt');
  assert(world.interactTarget.enabled, 'the ladder down was disabled');
  world.interact();

  assert(world.player.mover.tileX === vault.exit.x && world.player.mover.tileY === vault.exit.y,
    'climbing down did not land the player in the vault');
  assert(run.depth === depthBefore, 'a ladder changed the depth');
  assert(!world.finished, 'a ladder completed the level');

  step(world, 2);
  assert(world.interactTarget && world.interactTarget.type === 'ladder', 'no ladder back up');
  world.interact();
  assert(world.player.mover.tileX === vault.entry.x && world.player.mover.tileY === vault.entry.y,
    'climbing back up did not return the player to the labyrinth');
});

test('a vault cannot be walked into -- the ladder is the only way in', () => {
  for (let s = 0; s < 6; s++) {
    const { world, level } = makeWorld(7, 'vault-walk-' + s);
    if (!level.vaults.length) continue;
    const reach = bfsField(level.grid, [level.entrance], (x, y, t) =>
      t === T.FLOOR || t === T.STAIRS || t === T.ENTRANCE || t === T.GATE || t === T.SECRET);
    for (const vault of level.vaults) {
      const inside = reach[level.grid.idx(vault.exit.x, vault.exit.y)];
      assert(inside < 0, `vault ${vault.index} can be reached on foot`);
    }
  }
});

test('a vault holds a reward and something guarding it', () => {
  let checked = 0;
  for (let s = 0; s < 8; s++) {
    const { level } = makeWorld(8, 'vault-loot-' + s);
    for (const vault of level.vaults) {
      const loot = level.props.filter((p) => p.vault === vault.index && p.type !== 'ladder');
      const guards = level.spawns.filter((sp) => sp.encounter === 'enc_vault_' + vault.index);
      assert(loot.length > 0, `vault ${vault.index} is empty`);
      assert(guards.length > 0, `vault ${vault.index} is unguarded`);
      checked++;
    }
  }
  assert(checked > 0, 'no vaults were generated across eight seeds');
});

test('finding a vault is scored as a discovery, once', () => {
  const { world, level, run } = makeWorld(6, 'vault-score');
  assert(level.vaults.length > 0, 'no vault to find');
  const vault = level.vaults[0];
  place(world, vault.entry.x, vault.entry.y);
  step(world, 2);
  world.interact();
  const first = run.score.level.secrets;
  assert(first > 0, 'finding a vault scored nothing');
  step(world, 2);
  world.interact();              // back up
  step(world, 2);
  world.interact();              // down again
  assert(run.score.level.secrets === first, 'a vault paid out twice');
});

// --- bosses -----------------------------------------------------------------

test('every fifth depth is a boss arena whose exit stays sealed until it dies', () => {
  for (const depth of [5, 10, 15, 20]) {
    const { world, level } = makeWorld(depth, 'boss-' + depth);
    assert(level.isBoss, `depth ${depth} was not a boss level`);
    assert(world.boss, `depth ${depth} has no boss entity`);
    place(world, level.stairs.x, level.stairs.y);
    world.updateInteractTarget();
    assert(world.interactTarget && world.interactTarget.type === 'stairs', 'no stairs prompt in the arena');
    assert(!world.interactTarget.enabled, 'the exit was usable with the boss still alive');
    world.interact();
    assert(!world.finished, 'the player escaped the arena past a living boss');

    world.boss.awake = true;
    world.boss.takeDamage(999999, world, 'sword');
    assert(world.boss.dead, 'the boss survived lethal damage');
    world.updateInteractTarget();
    assert(world.interactTarget.enabled, 'the exit stayed sealed after the boss fell');
  }
});

test('a boss escalates through its phases and lands its attacks', () => {
  const { world } = makeWorld(10, 'boss-phase');
  const boss = world.boss;
  boss.awake = true;
  const attacksSeen = new Set();
  const originalWindup = boss._windupFor.bind(boss);
  boss._windupFor = (a) => { attacksSeen.add(a); return originalWindup(a); };
  for (let i = 0; i < 3000 && !boss.dead; i++) {
    world.update(1 / 60, idle);
    if (i % 500 === 499) boss.takeDamage(boss.maxHp * 0.3, world, 'sword');
  }
  assert(attacksSeen.size >= 2, `boss only ever used ${attacksSeen.size} attack(s)`);
  assert(boss.phase >= 1, 'boss never advanced a phase despite losing health');
});

test('a boss kill awards a score bonus and is recorded on the run', () => {
  const { world, run } = makeWorld(5, 'boss-score');
  world.boss.awake = true;
  world.boss.takeDamage(999999, world, 'sword');
  assert(run.score.level.boss > 0, 'no boss score was awarded');
  assert(run.bossesDefeated === 1, 'the boss kill was not recorded on the run');
});

test('a boss woken by a bolt from across the hall still announces itself', () => {
  const { world } = makeWorld(10, 'boss-wake-ranged');
  const boss = world.boss;
  assert(!boss.awake, 'the boss was already awake before anything touched it');
  const seen = [];
  world.on((type) => seen.push(type));
  // A crossbow bolt reaches far past the range that wakes it by proximity.
  boss.takeDamage(1, world, 'bolt');
  assert(boss.awake, 'a hit did not wake the boss');
  assert(seen.includes('bossAwake'),
    'the boss woke silently: no bossAwake event, so no roar and no music change');
});

// --- damage over time -------------------------------------------------------

test('burning can actually kill, and does not leave the player alive at zero', () => {
  const { world, run } = makeWorld(3, 'burn-lethal');
  const seen = [];
  world.on((type) => seen.push(type));
  run.hp = 4;                     // a little under a second of burning
  world.player.burnTimer = 10;    // set exactly as a burning enemy sets it
  for (let i = 0; i < 60 * 6 && !world.playerDead; i++) world.update(1 / 60, idle);
  assert(run.hp <= 0, 'the burn never took the last of the health');
  assert(world.playerDead, 'the player burned to zero health and kept walking');
  assert(seen.includes('playerDied'), 'no playerDied event, so the run would never end');
});

test('a death fires once, however long the world keeps running', () => {
  const { world, run } = makeWorld(3, 'burn-once');
  let deaths = 0;
  world.on((type) => { if (type === 'playerDied') deaths++; });
  run.hp = 2;
  world.player.burnTimer = 20;
  step(world, 60 * 8);
  assert(deaths === 1, `playerDied fired ${deaths} times instead of once`);
});

// --- torch, visibility and scoring -----------------------------------------

test('unexplored terrain stays hidden and torchlight is what reveals it', () => {
  const { world, level } = makeWorld(6, 'vis-1');
  const total = level.grid.w * level.grid.h;
  world.refreshVisibility(0.016);
  const seenAtStart = world.vis.discoveredCount;
  assert(seenAtStart > 6, 'the torch revealed nothing at all');
  assert(seenAtStart < total * 0.2, `the level opened with ${seenAtStart}/${total} tiles already known`);
  // Nothing outside line of sight from the player may be marked visible.
  for (let y = 0; y < level.grid.h; y++) {
    for (let x = 0; x < level.grid.w; x++) {
      if (!world.vis.isVisible(x, y)) continue;
      const d = Math.hypot(x + 0.5 - world.player.x, y + 0.5 - world.player.y);
      assert(d <= world.torchRadius + 4.5,
        `tile ${x},${y} is lit at ${d.toFixed(1)} tiles, beyond any light source`);
    }
  }
});

test('a wider torch is a real trade-off: it enlarges enemy detection too', () => {
  const { world } = makeWorld(3, 'torch-1');
  const enemy = world.enemies[0];
  world.run.relics = {};
  world.run.refreshMods();
  const plain = enemy.detectionRange(world);
  world.run.takeRelic(RELIC_BY_ID.everburning_brand);
  const withBrand = enemy.detectionRange(world);
  assert(withBrand > plain, 'the torch relic did not increase enemy awareness');
  assert(world.run.mods.torchRadius > 1, 'the torch relic did not widen the torch');
});

test('map memory decays, and fog makes it decay faster', () => {
  const { world } = makeWorld(3, 'memory-1');
  world.refreshVisibility(0.016);
  // Pick the lit tile furthest from the corner we are about to retreat to.
  let probe = -1, best = -1;
  for (let i = 0; i < world.vis.memory.length; i++) {
    if (world.vis.memory[i] < 1) continue;
    const x = i % world.grid.w, y = (i / world.grid.w) | 0;
    const d = Math.hypot(x - 1, y - 1);
    if (d > best) { best = d; probe = i; }
  }
  assert(probe >= 0, 'nothing was lit to begin with');

  world.player.x = 1.5; world.player.y = 1.5;
  forceHazard(world, 'clear');
  for (let i = 0; i < 300; i++) world.refreshVisibility(1 / 60);
  const plain = world.vis.memory[probe];
  assert(plain < 1, 'memory never faded at all');

  world.vis.memory[probe] = 1;
  forceHazard(world, 'fog');
  for (let i = 0; i < 300; i++) world.refreshVisibility(1 / 60);
  const foggy = world.vis.memory[probe];
  assert(foggy < plain, `fog did not accelerate memory loss (${foggy} vs ${plain})`);
});

test('the score breakdown adds up to the reported total', () => {
  const { world, run } = makeWorld(4, 'score-1');
  run.score.addKill(120, { mods: run.mods });
  run.score.addFlawless(300, run.mods);
  run.score.addSecret(180, run.mods);
  world.elapsed = 30;
  const breakdown = world.summary();
  const sum = breakdown.rows.reduce((acc, r) => acc + r.value, 0);
  assertNear(sum, breakdown.subtotal, 2, 'itemised rows do not match the subtotal');
  assert(breakdown.subtotal > 0, 'clearing a depth scored nothing');
  assertNear(breakdown.total, run.score.total, 0.5, 'run total does not match the tracker');
});

test('a faster clear is worth more than a slow one, but slow still scores', () => {
  const fast = makeWorld(4, 'score-fast');
  fast.world.elapsed = 10;
  const fastTotal = fast.world.summary().subtotal;
  const slow = makeWorld(4, 'score-fast');
  slow.world.elapsed = slow.level.parTime * 2;
  const slowTotal = slow.world.summary().subtotal;
  assert(fastTotal > slowTotal, 'a fast clear scored no better than a slow one');
  assert(slowTotal > 0, 'a slow clear scored nothing at all');
});

test('the Ashen Hourglass roughly doubles the time bonus', () => {
  const plain = makeWorld(4, 'hourglass');
  plain.world.elapsed = 20;
  const plainRows = plain.world.summary().rows;
  const plainTime = (plainRows.find((r) => r.label === 'Time Bonus') || { value: 0 }).value;

  const boosted = makeWorld(4, 'hourglass', (r) => { r.takeRelic(RELIC_BY_ID.ashen_hourglass); });
  boosted.world.elapsed = 20;
  const boostedRows = boosted.world.summary().rows;
  const boostedTime = (boostedRows.find((r) => r.label === 'Time Bonus') || { value: 0 }).value;
  assert(plainTime > 0, 'no time bonus was awarded at all');
  assertNear(boostedTime / plainTime, 2, 0.15, 'Ashen Hourglass time multiplier');
});

test('the cheapest tier gained no new work', () => {
  // The fidelity pass added exactly one thing that draws per frame -- the
  // marks on the floor -- and it is off on Low. Everything else it changed is
  // either baked once per biome (masonry bevel and grain) or the same number
  // of draw calls with different arithmetic in them (face lighting, actor
  // shadows). This is the assertion that keeps that true: if a later change
  // gives Low something new to do, it has to come and argue with this test.
  const low = TIERS.find((t) => t.id === 'low');
  const medium = TIERS.find((t) => t.id === 'medium');
  const high = TIERS.find((t) => t.id === 'high');
  assert(low && medium && high, 'the three tiers are not all present');

  // The renderer's gate for the decal pass, stated here so the two cannot
  // drift apart silently.
  assert(!(low.ambience > 0.2), `Low would draw floor marks at ambience ${low.ambience}`);
  assert(medium.ambience > 0.2 && high.ambience > 0.2,
    'the floor marks are switched off above the cheapest tier');

  // And the ladder still goes up: every tier is at least as capable as the one
  // below it, which is what makes stepping down a safe thing for Perf to do.
  assert(low.scale <= medium.scale && medium.scale <= high.scale, 'tier scale is out of order');
  assert(!low.bloom && high.bloom, 'bloom is no longer the top tier only');
});

// --- the buried ------------------------------------------------------------

function findBuried(prefix, want = null) {
  for (let i = 0; i < 60; i++) {
    const made = makeWorld(6, prefix + '-' + i);
    const buried = made.world.enemies.find((e) => e.entombed && (!want || want(e)));
    if (buried) return { ...made, buried };
  }
  return null;
}

test('a buried thing has no tell at all until it is stood on', () => {
  const found = findBuried('buried');
  assert(found, 'sixty depths produced nothing buried');
  const { world, buried } = found;

  assert(buried.dormant && buried.entombed, 'a buried thing is not dormant');
  // Nothing to hear.
  const before = buried.voiceTimer;
  buried.updateVoice(10, world, false);
  assert(buried.voiceTimer === before, 'a buried thing spoke');
  // Nothing to hit. A bolt down the passage goes over it.
  const hp = buried.hp;
  buried.takeDamage(999, world, 'bolt');
  assert(buried.hp === hp && !buried.dead, 'a buried thing was killed through the floor');
  // Nothing standing in the way, either: you have to be able to walk onto it.
  world._refreshOccupancy();
  assert(!world.occupied.has(world.grid.idx(buried.mover.tileX, buried.mover.tileY)),
    'a buried thing was holding its tile against the player');
});

test('walking onto one brings it up, and the floor keeps the hole', () => {
  // Not a sealed one: those are held for an encounter that has not fired yet,
  // and staying under the floor is exactly what they are supposed to do.
  const found = findBuried('unearth', (e) => !e.sealed);
  assert(found, 'nothing buried to stand on');
  const { world, buried } = found;
  const holesBefore = world.level.decals.filter((d) => d.kind === 'hole').length;

  place(world, buried.mover.tileX, buried.mover.tileY);
  step(world, 30);

  assert(!buried.entombed, 'standing on one left it buried');
  const holesAfter = world.level.decals.filter((d) => d.kind === 'hole').length;
  assert(holesAfter === holesBefore + 1, 'coming up left no hole');

  // ...and from here it is an ordinary creature: hittable, and countable.
  step(world, 60);
  const hp = buried.hp;
  buried.takeDamage(5, world, 'sword');
  assert(buried.hp < hp, 'an unearthed thing still could not be hit');
});

test('a false hole is the same mark, and never anything more', () => {
  // The decoys come through the decal table, which is what keeps them honest:
  // one sprite, one code path, and no property a player could read off the
  // screen to tell a real hole from an empty one.
  const decoy = DECALS.find((d) => d.id === 'hole');
  assert(decoy, 'the hole is not in the decal table');

  let decoys = 0;
  let buried = 0;
  for (let i = 0; i < 40; i++) {
    const level = generateLevel({ depth: 6, seed: 'decoy-' + i, context: {} });
    decoys += level.decals.filter((d) => d.kind === 'hole').length;
    buried += level.spawns.filter((sp) => sp.defId === 'gravebound').length;
    for (const d of level.decals) {
      if (d.kind !== 'hole') continue;
      // Never sitting on top of something genuinely down there, which would
      // turn the decoy into a marker for the real thing.
      for (const sp of level.spawns) {
        assert(Math.hypot(sp.x - d.x, sp.y - d.y) >= 5,
          'a false hole was placed on top of a spawn');
      }
    }
  }
  assert(buried > 0, 'forty depths spawned nothing buried at all');
  assert(decoys > 0, 'forty depths produced no false holes');
  assert(decoys < buried, `${decoys} false holes against ${buried} real ones is not rarer`);
});

// --- marks on the floor -----------------------------------------------------

test('decals are decoration and the validator has never heard of them', () => {
  // The load-bearing assertion of the whole decal system. If a mark could ever
  // change what the validator says about a depth, it would have stopped being
  // a hint and become a key -- and the guarantee that hints are optional would
  // be a comment rather than a fact.
  for (let depth = 1; depth <= 12; depth += 3) {
    const level = generateLevel({ depth, seed: 'decal-' + depth, context: {} });
    assert(Array.isArray(level.decals), `depth ${depth} generated no decal list`);
    const before = validateLevel(level);
    const stripped = { ...level, decals: [] };
    const after = validateLevel(stripped);
    assert(before.ok === after.ok, 'removing the marks changed whether the depth is valid');
    assert(before.errors.length === after.errors.length,
      'removing the marks changed what the validator complained about');
    assert(before.orphans === after.orphans, 'the marks changed the orphan sweep');
  }
});

test('marks are sparse, seeded and lie on real floor', () => {
  const a = generateLevel({ depth: 8, seed: 'decal-same', context: {} });
  const b = generateLevel({ depth: 8, seed: 'decal-same', context: {} });
  const shape = (level) => level.decals
    .map((d) => [d.kind, d.x, d.y, d.dx, d.dy].join(':')).join('|');
  assert(shape(a) === shape(b), 'the same seed laid different marks');

  assert(a.decals.length <= decalBudget(8),
    `${a.decals.length} marks on a depth budgeted ${decalBudget(8)}`);
  // Sparse means sparse: a mark on any real fraction of the floor is wallpaper.
  assert(a.decals.length < a.floorCells.length * 0.05,
    `${a.decals.length} marks over ${a.floorCells.length} floor cells is not sparse`);

  for (const d of a.decals) {
    assert(a.grid.get(Math.floor(d.x), Math.floor(d.y)) === T.FLOOR,
      `a ${d.kind} mark is inside a wall`);
    assert(d.dx !== 0 || d.dy !== 0, `a ${d.kind} mark points nowhere`);
    assert(DECALS.some((entry) => entry.id === d.kind),
      `a mark of kind "${d.kind}" is not in the table`);
  }
});

test('a new kind of mark is a table entry and nothing else', () => {
  // The extension point, asserted rather than promised: the next stage adds a
  // decoy hole through this table, and it must not need the placement pass,
  // the generator or the renderer's list-building to be touched to do it.
  for (const entry of DECALS) {
    assert(typeof entry.id === 'string' && entry.id.length > 1, 'a decal entry has no id');
    assert(typeof entry.rule === 'function', `decal "${entry.id}" has no placement rule`);
  }
  const level = generateLevel({ depth: 6, seed: 'decal-table', context: {} });
  const rng = new RNG('decal-table-probe');
  for (const entry of DECALS) {
    const placed = entry.rule(level, rng, 3) || [];
    assert(Array.isArray(placed), `decal "${entry.id}" did not return a list`);
    assert(placed.length <= 3, `decal "${entry.id}" ignored the budget it was given`);
    for (const p of placed) {
      assert(p.kind === entry.id, `decal "${entry.id}" placed a mark of kind "${p.kind}"`);
    }
  }
});

// --- pushable stones --------------------------------------------------------

function findBlockLevel(prefix, depth = 6) {
  for (let i = 0; i < 60; i++) {
    const made = makeWorld(depth, prefix + '-' + i);
    if (made.world.blocks.length) return made;
  }
  return null;
}

test('a pushable stone is never on the way to anything the depth requires', () => {
  // The whole safety argument, stated as the validator states it: model every
  // block as solid rock and the depth must lose no ground at all beyond the
  // stones themselves and the pockets they guard. That covers keys, gates,
  // vault ladders and the exit without having to reason about each.
  let seen = 0;
  for (let depth = 2; depth <= 12; depth += 2) {
    for (let i = 0; i < 12; i++) {
      const level = generateLevel({ depth, seed: 'blocks-' + depth + '-' + i, context: {} });
      const report = validateLevel(level);
      assert(report.ok, `depth ${depth} seed ${i}: ${report.errors.join('; ')}`);
      seen += level.blocks.length;
      for (const b of level.blocks) {
        assert(level.grid.get(b.x, b.y) === T.FLOOR, 'a stone is standing in a wall');
        assert(level.grid.get(b.alcove.x, b.alcove.y) === T.FLOOR,
          'a stone is guarding solid rock');
        const idx = level.grid.idx(b.x, b.y);
        assert(idx !== level.grid.idx(level.stairs.x, level.stairs.y),
          'a stone is sitting on the stair');
      }
    }
  }
  assert(seen > 0, 'sixty depths produced no pushable stones at all');
});

test('no sequence of shoves can strand a depth', () => {
  // The containment rule above is about the tile a stone stands on. This is
  // about every tile it can be driven onto, which is the question that costs
  // runs: a stone only ever moves away from whoever is pushing it, so one
  // walked into a one-tile doorway and jammed against the wall behind it
  // closes that doorway for good, with the player on whichever side they
  // happened to be standing.
  //
  // Found the hard way -- the autopilot wedged on a depth where three presses
  // of one direction sealed the only way south.
  let stones = 0;
  let checked = 0;
  for (let depth = 3; depth <= 15; depth += 3) {
    for (let i = 0; i < 8; i++) {
      const level = generateLevel({ depth, seed: 'strand-' + depth + '-' + i, context: {} });
      if (!level.blocks.length) continue;
      checked++;
      stones += level.blocks.length;
      const out = shoveOutcome(level.grid, {
        entrance: level.entrance,
        blocks: level.blocks,
        pockets: level.blockPockets,
        targets: [level.stairs].concat(level.keys).concat(level.gates),
        passable: (x, y, t) =>
          t === T.FLOOR || t === T.STAIRS || t === T.ENTRANCE || t === T.GATE,
      });
      // Unproven counts as a failure here for the same reason the generator
      // declines it: a search that ran out of room has not shown anything.
      assert(out.proven, `depth ${depth} seed ${i}: the shove search did not finish`);
      assert(out.safe, `depth ${depth} seed ${i} can be stranded -- `
        + (out.example ? out.example.steps.join('; ') : ''));
    }
  }
  assert(checked > 0, 'no depth in the sample carried a stone');
  return `${stones} stones over ${checked} depths`;
});

test('a stone shoves one tile, and never into what it is guarding', () => {
  const found = findBlockLevel('shove');
  assert(found, 'no depth with a stone on it');
  const { world } = found;
  const block = world.blocks[0];

  // Into the pocket is the one move that would seal the reward away, and it is
  // refused however hard it is pressed.
  const toPocket = { x: block.alcove.x - block.x, y: block.alcove.y - block.y };
  assert(!world._canShove(block, toPocket), 'a stone can be pushed into its own pocket');

  // Some legal direction exists, or the stone is furniture rather than a puzzle.
  const lanes = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]
    .filter((d) => world._canShove(block, d));
  assert(lanes.length > 0, 'a stone that cannot be shoved anywhere at all');

  const from = { x: block.x, y: block.y };
  world._shove(block, lanes[0]);
  assert(block.x === from.x + lanes[0].x && block.y === from.y + lanes[0].y,
    'a shove moved the stone somewhere other than one tile on');
  // Occupancy moves on the instant, because the player steps into the vacated
  // tile in the same frame.
  assert(!world.blockAt(from.x, from.y), 'the stone is still occupying the tile it left');
  assert(world.blockAt(block.x, block.y) === block, 'the stone is not where it went');
  assert(tileOpen(world, from.x, from.y), 'the tile a stone left is still closed');
});

test('shoving a stone counts once, on the same tally as a cracked wall', () => {
  const found = findBlockLevel('count');
  assert(found, 'no depth with a stone on it');
  const { world, run } = found;
  const block = world.blocks[0];
  const lane = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]
    .find((d) => world._canShove(block, d));
  assert(lane, 'nowhere to shove it');

  const before = run.score.level.secretsFound;
  world._shove(block, lane);
  assert(run.score.level.secretsFound === before + 1, 'a shove scored no secret');
  assert(block.moved, 'a shoved stone was not marked as opened');

  // ...and a second shove of the same stone is movement, not another discovery.
  const again = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]
    .find((d) => world._canShove(block, d));
  if (again) {
    world._shove(block, again);
    assert(run.score.level.secretsFound === before + 1, 'the same stone paid out twice');
  }
});

test('a stone is solid to everything that walks', () => {
  const found = findBlockLevel('solid');
  assert(found, 'no depth with a stone on it');
  const { world } = found;
  const block = world.blocks[0];
  assert(!tileOpen(world, block.x, block.y), 'a stone is walkable');
  // ...including to whatever else is down here. Enemies path with the same
  // test the player does, so nothing can walk through one or get wedged in it.
  for (const dir of [{ x: 1, y: 0 }, { x: 0, y: 1 }]) {
    assert(!canStepTo(world, block.x - dir.x, block.y - dir.y, dir),
      'something could step onto a stone');
  }
});

// --- captives ---------------------------------------------------------------

// A depth with somebody on it. Captives are placed against walls with at least
// two exits, so most seeds have one; the search widens rather than assuming.
function findCaptive(seedPrefix, want) {
  for (let i = 0; i < 40; i++) {
    const made = makeWorld(4, seedPrefix + '-' + i);
    const prop = made.level.props.find(
      (p) => p.type === 'prisoner' && p.mood !== 'dead' && (!want || want(p)));
    if (prop) return { ...made, prop };
  }
  return null;
}

test('who asked to die is settled at spawn, not at the moment of the swing', () => {
  // The flag has to be part of the level, or the same seed stops producing the
  // same person -- and the whole moral weight of this system rests on the
  // player being able to say "I met someone" rather than "the game rolled".
  const a = generateLevel({ depth: 4, seed: 'captive-seed', context: {} });
  const b = generateLevel({ depth: 4, seed: 'captive-seed', context: {} });
  const pleas = (level) => level.props
    .filter((p) => p.type === 'prisoner')
    .map((p) => (p.pleadToDie ? '1' : '0')).join('');
  assert(pleas(a) === pleas(b), `the same seed produced ${pleas(a)} and ${pleas(b)}`);
  for (const prop of a.props.filter((p) => p.type === 'prisoner')) {
    assert(typeof prop.pleadToDie === 'boolean', 'a captive has no plea either way');
    if (prop.pleadToDie) assert(prop.mood === 'begging', 'a plea nobody could see');
  }
});

test('killing one who asked costs nothing, and one who did not costs a great deal', () => {
  const asked = findCaptive('plead-yes', (p) => p.pleadToDie);
  const silent = findCaptive('plead-no', (p) => !p.pleadToDie && p.mood !== 'raving');
  assert(asked && silent, 'could not find both kinds of captive in forty seeds');

  // Measured on the depth's running subtotal, which is where a bonus or a
  // penalty actually lands -- the run total is only banked on the stair.
  const before = asked.run.score.levelSubtotal;
  asked.world.murderCaptive(asked.prop);
  assert(asked.run.score.levelSubtotal >= before,
    `ending one who asked cost ${before - asked.run.score.levelSubtotal}`);
  assert(asked.run.score.level.penalties === 0, 'granting a plea was recorded as a penalty');
  assert(asked.run.mercy === 1, `mercy read ${asked.run.mercy} after granting a plea`);

  const was = silent.run.score.levelSubtotal;
  silent.world.murderCaptive(silent.prop);
  assert(silent.run.score.levelSubtotal < was, 'killing one who never asked cost nothing');
  assert(silent.run.score.level.penalties === 1, 'a murder was not recorded as a penalty');
  assert(silent.run.mercy === -1, `mercy read ${silent.run.mercy} after a murder`);
});

test('a captive is never killed by the button that frees them', () => {
  // The Action button opens chests and lights fires. It has never taken a life
  // and it must not start: a killing should cost a deliberate, separate verb.
  for (const want of [(p) => p.pleadToDie, (p) => !p.pleadToDie && p.mood !== 'raving']) {
    const found = findCaptive('button', want);
    assert(found, 'no captive to try the button on');
    const { world, run, prop } = found;
    world.useCaptive(prop);            // listen / speak
    world.useCaptive(prop);            // and again, which frees them
    assert(prop.mood !== 'dead', 'the Action button killed a captive');
    assert(run.mercy > 0, `the button left mercy at ${run.mercy}`);
  }
});

test('a freed captive collapses, crawls somewhere sheltered and stays there', () => {
  const found = findCaptive('crawl', (p) => !p.pleadToDie && p.mood !== 'raving');
  assert(found, 'no captive to free');
  const { world, prop } = found;
  const from = { x: prop.x, y: prop.y };

  world.useCaptive(prop);
  world.useCaptive(prop);
  assert(prop.mood === 'collapsing', `freeing left them ${prop.mood}`);

  step(world, 60 * 12);
  assert(prop.mood === 'settled', `after twelve seconds they were still ${prop.mood}`);
  assert(prop.freed, 'a settled captive is not marked freed');

  // Wherever they got to, it is real ground with a wall against it -- and they
  // are not standing where the chain was unless there was nowhere better.
  assert(tileOpen(world, Math.floor(prop.x), Math.floor(prop.y)),
    'a captive crawled into a wall');
  if (prop.crawlTo) {
    assert(Math.hypot(prop.x - from.x, prop.y - from.y) > 0.3,
      'a captive with somewhere to go did not move');
  }
});

test('a freed captive obstructs nothing', () => {
  // Props are not obstacles, and this is the assertion that keeps it that way:
  // the crawl moves a prop around at runtime, long after the generator proved
  // the depth solvable, so nothing may start depending on where props sit.
  const found = findCaptive('block', (p) => !p.pleadToDie && p.mood !== 'raving');
  assert(found, 'no captive to free');
  const { world, prop } = found;
  world.useCaptive(prop);
  world.useCaptive(prop);
  step(world, 60 * 12);
  const tx = Math.floor(prop.x), ty = Math.floor(prop.y);
  assert(tileOpen(world, tx, ty), 'the tile a captive settled on stopped being walkable');
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const t = world.grid.get(tx + dx, ty + dy);
    if (t === T.FLOOR) {
      assert(canStepTo(world, tx, ty, { x: dx, y: dy }),
        'a settled captive blocked a step off their own tile');
    }
  }
});

test('the rare turn is rare, seeded, and never the thing that kills you', () => {
  // Rolled from the level's own generator: the same seed has to play out the
  // same way, or "it turned on me" becomes something nobody can share.
  const runOnce = (seed) => {
    const found = findCaptive(seed, (p) => p.pleadToDie);
    if (!found) return null;
    const { world, prop, run } = found;
    const hp = run.hp;
    world.useCaptive(prop);
    world.useCaptive(prop);
    return { spurned: !!prop.spurned, lost: hp - run.hp, mercy: run.mercy };
  };
  const first = runOnce('turn');
  const again = runOnce('turn');
  assert(first && again, 'no pleading captive to refuse');
  assert(first.spurned === again.spurned, 'the same seed turned differently');
  assert(first.mercy === 1, 'refusing a plea did not count as freeing them');
  // Whichever way it fell, it is survivable: a captive is never a death.
  assert(first.lost < 40, `the turn took ${first.lost} health`);
});

// --- difficulty -------------------------------------------------------------

test('a difficulty actually reaches the things it claims to change', () => {
  const easy = makeWorld(6, 'diff-seed', (r) => { r.difficulty = DIFFICULTIES.hearthlight; });
  const mid = makeWorld(6, 'diff-seed', (r) => { r.difficulty = DIFFICULTIES.torchbound; });
  const hard = makeWorld(6, 'diff-seed', (r) => { r.difficulty = DIFFICULTIES.ashenvow; });

  const sample = (w) => {
    const e = w.world.enemies.find((x) => x.def.id === mid.world.enemies[0].def.id);
    return e ? { hp: e.maxHp, damage: e.damage } : null;
  };
  const a = sample(easy), b = sample(mid), c = sample(hard);
  assert(a && b && c, 'the same enemy was not present in all three worlds');
  assert(a.hp < b.hp && b.hp < c.hp, `enemy health did not scale with difficulty: ${a.hp}/${b.hp}/${c.hp}`);
  assert(a.damage < b.damage && b.damage < c.damage, 'enemy damage did not scale with difficulty');

  // Torch and detection are read from the same mods bundle, so a difficulty
  // that says it dims the flame has to actually dim it.
  assert(hard.world.torch.baseRadius < mid.world.torch.baseRadius,
    'Ashenvow did not shorten the torch');
  assert(hard.run.mods.enemyAggro > mid.run.mods.enemyAggro,
    'Ashenvow did not widen enemy detection');
  assertNear(mid.run.mods.enemyHp, 1, 0.0001, 'Torchbound must be the unmodified measure');
  assertNear(mid.run.mods.torchRadius, 1, 0.0001, 'Torchbound must be the unmodified measure');
});

test('a boss obeys the difficulty too', () => {
  // Regression guard. The boss was built with a bare `run.mods` instead of
  // `this.run.mods`, so on the game page it threw and on the test page it
  // silently resolved to a stray global and passed `undefined` -- leaving
  // every boss on baseline numbers whatever difficulty was chosen.
  const at = (mode) => {
    const built = makeWorld(5, 'boss-difficulty', (r) => { r.difficulty = DIFFICULTIES[mode]; });
    assert(built.world.boss, `depth 5 produced no boss on ${mode}`);
    return { hp: built.world.boss.maxHp, damage: built.world.boss.damage };
  };
  const easy = at('hearthlight');
  const mid = at('torchbound');
  const hard = at('ashenvow');

  assert(easy.hp < mid.hp && mid.hp < hard.hp,
    `boss health did not scale with difficulty: ${easy.hp}/${mid.hp}/${hard.hp}`);
  assert(easy.damage < mid.damage && mid.damage < hard.damage,
    `boss damage did not scale with difficulty: ${easy.damage}/${mid.damage}/${hard.damage}`);
});

test('difficulty multipliers survive a relic recompute without stacking', () => {
  const run = new Run('diff-stack');
  run.difficulty = DIFFICULTIES.ashenvow;
  run.refreshMods();
  const once = run.mods.enemyHp;
  run.refreshMods();
  run.refreshMods();
  assertNear(run.mods.enemyHp, once, 0.0001, 'difficulty was applied more than once');
  assertNear(once, DIFFICULTIES.ashenvow.mods.enemyHp, 0.0001, 'difficulty multiplier was lost');
});

test('the stored hall survives a round trip and refuses a doctored one', () => {
  // The scramble is a speed bump, not a lock -- but a speed bump that loses
  // the table would be worse than none at all, so the round trip has to be
  // exact for the awkward cases: commas, quotes, and characters outside
  // Latin-1, which is where a naive Base64 of a string falls over.
  const rows = [
    normalise({ name: 'Ragnvald, the Deep', score: 4200, depth: 9, diff: 'ashenvow',
      seed: 'a"b,c', mercy: 3 }),
    normalise({ name: 'Sigrún Þorsdóttir', score: 3100, depth: 7, diff: 'torchbound',
      mercy: -2 }),
  ];
  const csv = toCsv(rows);
  const stored = scramble(csv);
  assert(stored.indexOf('Ragnvald') < 0, 'the stored table is still readable as text');
  assert(unscramble(stored) === csv, 'the table did not survive being put away and fetched back');

  const back = parseCsv(unscramble(stored));
  assert(back.length === 2, `read ${back.length} rows back from two`);
  assert(back[1].name === 'Sigrún Þorsdóttir', 'a non-Latin-1 name came back wrong');
  assert(back[0].mercy === 3 && back[1].mercy === -2,
    `mercy came back as ${back[0].mercy}/${back[1].mercy}`);

  // Anything edited by hand is discarded rather than half-believed. Flipping
  // one character of the payload has to be caught by the checksum.
  const at = Math.floor(stored.length * 0.6);
  const doctored = stored.slice(0, at)
    + (stored[at] === 'A' ? 'B' : 'A') + stored.slice(at + 1);
  assert(unscramble(doctored) === null, 'a doctored table was accepted');
  assert(unscramble('tb1:not base64 at all') === null, 'rubbish was accepted');
  assert(unscramble('') === null && unscramble(null) === null, 'an empty table was accepted');

  // A table written before any of this existed is plain CSV with no marker,
  // and must still be readable -- nobody loses the names they already had.
  assert(unscramble(csv) === null, 'plain CSV claimed to be scrambled');
  assert(parseCsv(csv).length === 2, 'the pre-scramble format stopped parsing');
});

test('a mercy tally is carried through the stored table', () => {
  // The column is new and nothing writes it yet. What matters today is that a
  // row without one reads as zero rather than as NaN or an empty string, so
  // the board built before the prisoner work does not need migrating later.
  const old = 'name,score,depth,diff\nEydis,7450,5,torchbound';
  const [row] = parseCsv(old);
  assert(row.mercy === 0, `a row with no mercy column read as ${row.mercy}`);
  assert(normalise({ name: 'x', score: 1 }).mercy === 0, 'a fresh entry had no mercy field');
});

test('only a losable descent is offered to the Hall of Fame', () => {
  for (const diff of DIFFICULTY_LIST) {
    // A mode that hands the stair back on death cannot be ranked against one
    // that does not, or the board stops meaning anything.
    assert(!(diff.retry && diff.ranked),
      `${diff.name} offers a retry and still claims a place on the board`);
  }
  assert(DIFFICULTY_LIST.some((d) => d.ranked), 'no difficulty can reach the Hall of Fame');
});

test('a difficulty card line only appears when it has something to say', () => {
  for (const diff of DIFFICULTY_LIST) {
    // The cost line is drawn in the warning colour, so a mode that charges
    // nothing must leave it null rather than filling it with "none" -- and a
    // reward belongs in `boon`, which is drawn as a gain, not in `cost`.
    if (diff.cost != null) {
      assert(typeof diff.cost === 'string' && diff.cost.trim().length > 3,
        `${diff.name} has an empty cost line`);
      assert(!/^none\b/i.test(diff.cost.trim()),
        `${diff.name} states a cost of "none": "${diff.cost}"`);
    }
    if (diff.boon != null) {
      assert(typeof diff.boon === 'string' && diff.boon.trim().length > 3,
        `${diff.name} has an empty boon line`);
    }
    // Every mode with a score premium has to say so where the player can see it.
    const paysMore = (diff.mods.scoreMult || 1) > 1;
    assert(!paysMore || (diff.boon && /\bfifth\b|\b20|\bmore\b/i.test(diff.boon)),
      `${diff.name} pays a score premium its card never mentions`);
  }
  // The baseline carries neither line: it is the thing the others are measured
  // against, not a deal with terms.
  assert(!DIFFICULTIES.torchbound.cost && !DIFFICULTIES.torchbound.boon,
    'the baseline difficulty should carry no cost or boon line');
});

// --- autopilot -------------------------------------------------------------
// A crude but honest player: it routes to the objective it actually needs
// next, swings at anything in reach, and presses Action whenever the game
// offers it something. If this can finish a level, a person can.

function objectiveFor(world) {
  const held = world.run.keys;
  // The first locked gate on the route decides what we need next.
  for (const gate of world.level.gates) {
    if (gate.open) continue;
    if (!held.has(gate.colourIndex)) {
      const key = world.level.keys.find((k) => k.colourIndex === gate.colourIndex && !k.taken);
      // A carried key is not lying where it was placed -- hunt the carrier.
      if (key && key.holder !== 'enemy') return { x: key.x, y: key.y, kind: 'key' };
      const carrier = world.enemies.find((e) => !e.dead && e.carriesKey === gate.colourIndex);
      if (carrier) return { x: Math.floor(carrier.x), y: Math.floor(carrier.y), kind: 'carrier' };
      if (key) return { x: key.x, y: key.y, kind: 'key' };
    }
    return { x: gate.x, y: gate.y, kind: 'gate' };
  }
  // A boss seals the exit behind itself, so it is the objective until it
  // falls -- walking to the stairs and waiting is not a plan.
  if (world.boss && !world.boss.dead && world.boss.awake) {
    return { x: Math.floor(world.boss.x), y: Math.floor(world.boss.y), kind: 'boss' };
  }
  return { x: world.level.stairs.x, y: world.level.stairs.y, kind: 'stairs' };
}

function passableForAuto(world) {
  return (x, y, t) => {
    if (world.sealBlocks.has(world.grid.idx(x, y))) return false;
    if (t === T.FLOOR || t === T.STAIRS || t === T.ENTRANCE) return true;
    if (t === T.GATE) {
      const g = world.gateAt(x, y);
      return !!(g && (g.open || world.run.keys.has(g.colourIndex)));
    }
    return false;
  };
}

// Inside a vault nothing on the main map is reachable on foot, so the only
// sensible objective is the ladder back out.
function vaultObjective(world) {
  const px = world.player.mover.tileX, py = world.player.mover.tileY;
  for (const vault of world.level.vaults || []) {
    if (px < vault.rect.x0 || px > vault.rect.x1) continue;
    if (py < vault.rect.y0 || py > vault.rect.y1) continue;
    return { x: vault.exit.x, y: vault.exit.y, kind: 'ladder-out' };
  }
  return null;
}

// A sealed room has to be fought out of before anything else matters.
function sealedObjective(world) {
  for (const enc of world.level.encounters) {
    if (enc.state !== 'active' || !enc.sealedCells) continue;
    if (!world.playerInRoom(enc.room, 1)) continue;
    let nearest = null, best = Infinity;
    for (const e of world.enemies) {
      if (e.dead || e.encounter !== enc.id) continue;
      const d = Math.hypot(e.x - world.player.x, e.y - world.player.y);
      if (d < best) { best = d; nearest = e; }
    }
    if (nearest) return { x: Math.floor(nearest.x), y: Math.floor(nearest.y), kind: 'fight' };
  }
  return null;
}

// Runs the level until the exit is used, the player dies, or time runs out.
export function autoplayLevel(world, maxSeconds = 240, onTick = null) {
  const dt = 1 / 60;
  let field = null;
  let refresh = 0;
  let goal = null;
  let stuckFor = 0;
  let lastPos = { x: world.player.x, y: world.player.y };
  const visited = new Set();
  const lootedVaults = new Set();
  let transitions = 0;
  let lastTile = '';

  for (let frame = 0; frame < maxSeconds * 60; frame++) {
    if (world.finished) return { ok: true, frames: frame };
    if (world.playerDead) return { ok: false, reason: 'died', frames: frame };

    refresh -= dt;
    const want = vaultObjective(world) || sealedObjective(world) || objectiveFor(world);
    if (!field || refresh <= 0 || !goal || goal.x !== want.x || goal.y !== want.y) {
      goal = want;
      field = bfsField(world.grid, [{ x: goal.x, y: goal.y }], passableForAuto(world));
      refresh = goal.kind === 'boss' || goal.kind === 'carrier' ? 0.15 : 0.4;
    }

    // Walk downhill toward the objective.
    const gx = world.player.mover.tileX, gy = world.player.mover.tileY;
    const tileKey = gx + ',' + gy;
    if (tileKey !== lastTile) { lastTile = tileKey; transitions++; visited.add(tileKey); }
    let mx = 0, my = 0;
    const here = field[world.grid.idx(gx, gy)];
    if (here > 0) {
      let best = here, bestCell = null;
      for (const [dx, dy] of N4) {
        const nx = gx + dx, ny = gy + dy;
        if (!world.grid.inBounds(nx, ny)) continue;
        const d = field[world.grid.idx(nx, ny)];
        if (d >= 0 && d < best) { best = d; bestCell = { x: nx, y: ny }; }
      }
      if (bestCell) {
        mx = bestCell.x + 0.5 - world.player.x;
        my = bestCell.y + 0.5 - world.player.y;
        const m = Math.hypot(mx, my) || 1;
        mx /= m; my /= m;
      }
    } else if (here < 0) {
      // Unreachable: something has sealed the way. Go and hit whatever is
      // holding the doors shut.
      let closest = null, cd = Infinity;
      for (const e of world.enemies) {
        if (e.dead) continue;
        const d = Math.hypot(e.x - world.player.x, e.y - world.player.y);
        if (d < cd) { cd = d; closest = e; }
      }
      if (closest) {
        mx = closest.x - world.player.x;
        my = closest.y - world.player.y;
        const m = Math.hypot(mx, my) || 1;
        mx /= m; my /= m;
      }
    }

    // Face and swing at whatever is closest.
    let slash = false;
    let nearest = null, nd = Infinity;
    for (const e of world.enemies) {
      if (e.dead || e.dormant || e.sealed) continue;
      const d = Math.hypot(e.x - world.player.x, e.y - world.player.y);
      if (d < nd) { nd = d; nearest = e; }
    }
    if (world.boss && !world.boss.dead) {
      const d = Math.hypot(world.boss.x - world.player.x, world.boss.y - world.player.y)
        - world.boss.radius;
      if (d < nd) { nd = d; nearest = world.boss; }
    }
    // Swing at anything close, but keep walking: standing still to duel every
    // wanderer would stall the run rather than test whether it can be run.
    if (nearest && nd < 1.7) slash = true;
    if (world.actionableSecret) slash = true;

    if (onTick) onTick({ frame, gx, gy, here, goal, mx, my, slash });
    world.update(dt, { moveX: mx, moveY: my, slash, fire: false });

    const prompt = world.interactTarget;
    if (prompt && prompt.enabled) {
      const diving = prompt.type === 'ladder' && prompt.prop.dir === 'down';
      const healthy = world.run.hp / world.run.maxHp > 0.6;
      // Visit each vault once, and only while in a fit state to: they are
      // optional, and a hurt player would walk past.
      if (diving && !healthy) { /* leave it for another day */ }
      else if (!diving || !lootedVaults.has(prompt.prop.vault)) {
        if (diving) lootedVaults.add(prompt.prop.vault);
        world.interact();
      }
    }

    // Detect being wedged and jiggle out of it.
    if (frame % 30 === 0) {
      const moved = Math.hypot(world.player.x - lastPos.x, world.player.y - lastPos.y);
      stuckFor = moved < 0.15 ? stuckFor + 1 : 0;
      lastPos = { x: world.player.x, y: world.player.y };
      if (stuckFor > 6) {
        const a = Math.random() * Math.PI * 2;
        for (let i = 0; i < 20; i++) {
          world.update(dt, { moveX: Math.cos(a), moveY: Math.sin(a), slash: false, fire: false });
        }
        stuckFor = 0;
        field = null;
      }
    }
  }
  return {
    ok: false,
    reason: 'timeout',
    frames: maxSeconds * 60,
    detail: `stuck at ${world.player.mover.tileX},${world.player.mover.tileY} `
      + `chasing ${goal ? goal.kind + ' ' + goal.x + ',' + goal.y : 'nothing'}; `
      + `keys ${Array.from(world.run.keys).join('') || 'none'}; `
      + `gates ${world.level.gates.map((g) => (g.open ? 'o' : 'x')).join('')}; `
      + `enemies ${world.enemies.filter((e) => !e.dead).length}; seals ${world.sealBlocks.size}; `
      + `visited ${visited.size} tiles over ${transitions} moves`,
  };
}

test('an autopilot can actually finish generated levels, keys, gates and all', () => {
  // This asserts levels are *completable*, so combat is taken out of the
  // equation -- a bot that swings at whatever is nearest is no measure of
  // whether a route through the labyrinth exists.
  const failures = [];
  let completed = 0;
  for (const depth of [1, 2, 3, 4, 6, 8, 11, 14]) {
    for (let s = 0; s < 3; s++) {
      const seed = `autoplay-${depth}-${s}`;
      const { world } = makeWorld(depth, seed);
      world.damagePlayer = () => {};
      const result = autoplayLevel(world, 340);
      if (result.ok) completed++;
      else failures.push(`depth ${depth} seed ${s}: ${result.reason} -- ${result.detail || ''}`);
    }
  }
  assert(failures.length === 0,
    `${failures.length} of ${completed + failures.length} levels could not be finished -- ${failures.join('; ')}`);
});

// --- runner -----------------------------------------------------------------

export { objectiveFor, passableForAuto };

export function runIntegrationTests() {
  const results = [];
  const started = performance.now();
  for (const t of tests) {
    const t0 = performance.now();
    try {
      const note = t.fn();
      results.push({
        name: t.name,
        status: typeof note === 'string' && note.startsWith('skipped') ? 'skip' : 'pass',
        note: typeof note === 'string' ? note : '',
        ms: performance.now() - t0,
      });
    } catch (err) {
      results.push({
        name: t.name, status: 'fail',
        note: String((err && err.message) || err),
        stack: String((err && err.stack) || ''),
        ms: performance.now() - t0,
      });
    }
  }
  return {
    results,
    totalMs: performance.now() - started,
    passed: results.filter((r) => r.status === 'pass').length,
    failed: results.filter((r) => r.status === 'fail').length,
    skipped: results.filter((r) => r.status === 'skip').length,
  };
}
