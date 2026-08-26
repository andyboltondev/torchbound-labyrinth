// Gameplay integration tests.
//
// These drive the real systems -- generation, world, player, enemies, relics,
// scoring -- through scripted scenarios and assert the rules the design calls
// non-negotiable. They run headlessly against a detached canvas, so no
// rendering or audio is required.

import { generateLevel } from '../src/gen/dungeon.js';
import { Run } from '../src/game/run.js';
import { World } from '../src/game/world.js';
import { Enemy } from '../src/game/enemies.js';
import { RELICS, RELIC_BY_ID, computeMods, offerRelics } from '../src/game/relics.js';
import { T } from '../src/gen/tiles.js';
import { bfsField, N4 } from '../src/gen/grid.js';
import { RNG } from '../src/core/rng.js';
import { hazardBudget, HAZARDS } from '../src/gen/biomes.js';

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
  const { world, level } = makeWorld(9, 'carried-key');
  const carrier = world.enemies.find((e) => e.carriesKey !== null && e.carriesKey !== undefined);
  if (!carrier) return 'skipped: this seed placed no enemy-held key';
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

test('every relic states a real trade-off or explicitly states it has none', () => {
  for (const relic of RELICS) {
    assert(relic.text && relic.text.length > 8, `${relic.id} has no description`);
    assert(relic.cost && relic.cost.length > 3, `${relic.id} has no stated cost`);
    assert(relic.max >= 1, `${relic.id} has no stack limit`);
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
      if (key) return { x: key.x, y: key.y, kind: 'key' };
      // Carried by an enemy: go to the carrier.
      const carrier = world.enemies.find((e) => !e.dead && e.carriesKey === gate.colourIndex);
      if (carrier) return { x: Math.floor(carrier.x), y: Math.floor(carrier.y), kind: 'carrier' };
    }
    return { x: gate.x, y: gate.y, kind: 'gate' };
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
  let transitions = 0;
  let lastTile = '';

  for (let frame = 0; frame < maxSeconds * 60; frame++) {
    if (world.finished) return { ok: true, frames: frame };
    if (world.playerDead) return { ok: false, reason: 'died', frames: frame };

    refresh -= dt;
    const want = sealedObjective(world) || objectiveFor(world);
    if (!field || refresh <= 0 || !goal || goal.x !== want.x || goal.y !== want.y) {
      goal = want;
      field = bfsField(world.grid, [{ x: goal.x, y: goal.y }], passableForAuto(world));
      refresh = 0.4;
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
    // Swing at anything close, but keep walking: standing still to duel every
    // wanderer would stall the run rather than test whether it can be run.
    if (nearest && nd < 1.7) slash = true;
    if (world.actionableSecret) slash = true;
    if (goal && goal.kind === 'fight' && nearest) {
      mx = nearest.x - world.player.x;
      my = nearest.y - world.player.y;
      const m = Math.hypot(mx, my) || 1;
      mx /= m; my /= m;
    }

    if (onTick) onTick({ frame, gx, gy, here, goal, mx, my, slash });
    world.update(dt, { moveX: mx, moveY: my, slash, fire: false });
    if (world.interactTarget && world.interactTarget.enabled) world.interact();

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
