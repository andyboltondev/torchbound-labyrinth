// Balance measurement.
//
// Plays whole descents rather than isolated levels: one Run, carrying health,
// relics and the crossbow from depth to depth, until it dies or runs out of
// patience. That is the only way to see whether the curve actually starts
// gentle and tightens, because a level's difficulty depends on what the
// player arrived with.
//
// The pilot is deliberately mediocre -- it walks its route, swings at what is
// in reach, and takes whatever the level offers. It is a yardstick, not a good
// player. What matters is how the numbers move between depths.

import { generateLevel } from '../src/gen/dungeon.js';
import { Run } from '../src/game/run.js';
import { World } from '../src/game/world.js';
import { RNG } from '../src/core/rng.js';
import { autoplayLevel } from './integration.js';

// Picks a relic the way a reasonable player might: patch health when hurt,
// otherwise take whatever looks strongest.
function chooseRelic(run, offers) {
  if (!offers.length) return null;
  const hurt = run.hp / run.maxHp < 0.55;
  if (hurt) {
    const healer = offers.find((r) => r.id === 'draught_hall' || r.id === 'ironhide_wrap'
      || r.id === 'grave_ward' || r.id === 'aegis_drowned');
    if (healer) return healer;
  }
  return offers[0];
}

export function runDescent(seed, { maxDepth = 20, secondsPerLevel = 300 } = {}) {
  const run = new Run(seed);
  run.refreshMods();
  const depths = [];

  for (let depth = 1; depth <= maxDepth; depth++) {
    run.depth = depth;
    const level = generateLevel({ depth, seed, context: run.levelContext() });
    const world = new World(run, level, new RNG(seed + ':w' + depth));
    const hpBefore = run.hp;
    const maxHpBefore = run.maxHp;

    const result = autoplayLevel(world, secondsPerLevel);
    const record = {
      depth,
      outcome: world.playerDead ? 'died' : result.ok ? 'cleared' : 'stalled',
      seconds: +(result.frames / 60).toFixed(1),
      parTime: level.parTime,
      hpBefore: Math.round(hpBefore),
      hpAfter: Math.round(Math.max(0, run.hp)),
      maxHp: Math.round(maxHpBefore),
      hpLost: Math.round(Math.max(0, hpBefore - run.hp)),
      damageTaken: Math.round(world.damageTakenThisLevel),
      kills: world.run.score.level.kills,
      enemies: level.spawns.length,
      floorCells: level.floorCells.length,
      grid: level.grid.w + 'x' + level.mazeHeight,
      zones: level.zones.length,
      gates: level.gates.length,
      hazards: level.zoneInfo.map((z) => z.hazardId).join('+'),
      threat: level.zoneInfo.reduce((sum, z) => sum + z.hazard.threat, 0),
      isBoss: !!level.isBoss,
      relics: Object.keys(run.relics).length,
      hasCrossbow: run.hasCrossbow,
      score: Math.round(run.score.total),
    };
    depths.push(record);

    if (world.playerDead) break;
    if (!result.ok) break;

    // Bank the depth, take a relic, carry on down.
    run.score.finishLevel({
      depth, elapsed: world.elapsed, parTime: level.parTime,
      hp: run.hp, maxHp: run.maxHp, mods: run.mods,
    });
    const relic = chooseRelic(run, run.offer(3));
    if (relic) run.takeRelic(relic);
    run.descend();
  }

  const last = depths[depths.length - 1];
  return {
    seed,
    depths,
    reached: last ? last.depth : 0,
    outcome: last ? last.outcome : 'none',
    score: run.score.total,
    build: run.build,
  };
}

// Runs many descents and aggregates them into a difficulty curve.
export function runBalancePass({ seeds = 24, maxDepth = 20, secondsPerLevel = 300 } = {}) {
  const started = performance.now();
  const runs = [];
  for (let i = 0; i < seeds; i++) runs.push(runDescent('balance-' + i, { maxDepth, secondsPerLevel }));

  const byDepth = new Map();
  for (const run of runs) {
    for (const d of run.depths) {
      if (!byDepth.has(d.depth)) {
        byDepth.set(d.depth, {
          depth: d.depth, attempts: 0, cleared: 0, died: 0, stalled: 0,
          seconds: 0, parTime: 0, hpLost: 0, hpAfterPct: 0, kills: 0,
          enemies: 0, floorCells: 0, threat: 0, grid: d.grid, isBoss: d.isBoss,
        });
      }
      const row = byDepth.get(d.depth);
      row.attempts++;
      row[d.outcome]++;
      row.seconds += d.seconds;
      row.parTime += d.parTime;
      row.hpLost += d.hpLost;
      row.hpAfterPct += d.hpAfter / Math.max(1, d.maxHp);
      row.kills += d.kills;
      row.enemies += d.enemies;
      row.floorCells += d.floorCells;
      row.threat += d.threat;
      row.grid = d.grid;
    }
  }

  const curve = Array.from(byDepth.values()).sort((a, b) => a.depth - b.depth).map((r) => ({
    depth: r.depth,
    boss: r.isBoss,
    grid: r.grid,
    reached: r.attempts,
    clearRate: +(r.cleared / r.attempts).toFixed(2),
    deaths: r.died,
    stalls: r.stalled,
    avgSeconds: +(r.seconds / r.attempts).toFixed(1),
    parTime: Math.round(r.parTime / r.attempts),
    avgHpLost: Math.round(r.hpLost / r.attempts),
    endHpPct: +(r.hpAfterPct / r.attempts).toFixed(2),
    avgKills: +(r.kills / r.attempts).toFixed(1),
    enemies: Math.round(r.enemies / r.attempts),
    floor: Math.round(r.floorCells / r.attempts),
    threat: +(r.threat / r.attempts).toFixed(1),
  }));

  const reached = runs.map((r) => r.reached);
  reached.sort((a, b) => a - b);
  return {
    runs: runs.length,
    totalMs: Math.round(performance.now() - started),
    curve,
    deepest: Math.max(...reached),
    medianDepth: reached[Math.floor(reached.length / 2)],
    meanDepth: +(reached.reduce((a, b) => a + b, 0) / reached.length).toFixed(1),
    deaths: runs.filter((r) => r.outcome === 'died').length,
    stalls: runs.filter((r) => r.outcome === 'stalled').length,
    deathDepths: runs.filter((r) => r.outcome === 'died').map((r) => r.reached).sort((a, b) => a - b),
  };
}
