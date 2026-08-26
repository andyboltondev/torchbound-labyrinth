// Seeded procedural-generation test suite.
//
// Runs a large batch of deterministic generations across every depth band and
// asserts the design's hard guarantees. Failures here mean players could be
// handed an impossible level, so this is the suite to run before shipping.

import { generateLevel } from '../src/gen/dungeon.js';
import { validateLevel } from '../src/gen/validate.js';
import { T } from '../src/gen/tiles.js';
import { bfsField } from '../src/gen/grid.js';
import { RNG } from '../src/core/rng.js';

const CHECKS = [];
const check = (name, fn) => CHECKS.push({ name, fn });

// --- per-level assertions ---------------------------------------------------

check('validator reports no errors', (lv) => {
  const r = validateLevel(lv);
  return r.ok ? null : r.errors.join(' | ');
});

check('did not fall back to the safety layout', (lv) =>
  lv.usedFallback ? 'generation exhausted its attempts and used the fallback' : null);

check('one key per gate', (lv) =>
  lv.keys.length === lv.gates.length ? null
    : `${lv.keys.length} keys vs ${lv.gates.length} gates`);

check('gates are colour-ordered along the route', (lv) => {
  for (let i = 0; i < lv.gates.length; i++)
    if (lv.gates[i].colourIndex !== i) return `gate ${i} has colour ${lv.gates[i].colourIndex}`;
  return null;
});

check('keys are not adjacent to their own gate', (lv) => {
  for (const k of lv.keys) {
    const g = lv.gates[k.colourIndex];
    if (!g) continue;
    const d = Math.abs(g.x - k.x) + Math.abs(g.y - k.y);
    if (d < 5) return `key ${k.colourIndex} is ${d} tiles from its gate`;
  }
  return null;
});

check('exit is a meaningful walk from the entrance', (lv) => {
  const field = bfsField(lv.grid, [lv.entrance], (x, y, t) =>
    t === T.FLOOR || t === T.STAIRS || t === T.ENTRANCE || t === T.GATE);
  const d = field[lv.grid.idx(lv.stairs.x, lv.stairs.y)];
  if (d < 0) return 'exit unreachable with all gates open';
  const min = lv.isBoss ? 8 : 18;
  return d >= min ? null : `exit only ${d} steps from the entrance`;
});

check('no enemy spawns on top of the entrance', (lv) => {
  for (const s of lv.spawns) {
    const d = Math.hypot(s.x - lv.entrance.x, s.y - lv.entrance.y);
    if (!lv.isBoss && d < 6) return `spawn ${s.defId} is ${d.toFixed(1)} tiles from the entrance`;
  }
  return null;
});

check('secret pockets contain a reward', (lv) => {
  for (let i = 0; i < lv.secrets.length; i++) {
    const s = lv.secrets[i];
    if (s.kind === 'shortcut') continue;
    if (!lv.props.some((p) => p.secret === i)) return `secret ${i} (${s.kind}) is empty`;
  }
  return null;
});

check('every zone has a live hazard definition', (lv) =>
  lv.zoneInfo.length === lv.zones.length ? null
    : `${lv.zoneInfo.length} hazard zones for ${lv.zones.length} regions`);

check('boss depths produce a boss', (lv) =>
  (lv.depth % 5 === 0) === !!lv.isBoss ? null
    : `depth ${lv.depth} boss flag is ${lv.isBoss}`);

check('crossbow relics have something to attach to', (lv) =>
  (!lv.hasCrossbowPickup || lv.depth >= 3) ? null
    : `crossbow offered at depth ${lv.depth}`);

// --- runner -----------------------------------------------------------------

export function runGenerationTests({
  depths = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20],
  seedsPerDepth = 30,
  onProgress = null,
} = {}) {
  const started = performance.now();
  const results = {
    total: 0, passed: 0, failed: 0, fallbacks: 0,
    failures: [], byDepth: [], warnings: 0,
    attemptHistogram: {}, totalMs: 0,
    stats: { keyGateDist: [], secrets: 0, encounters: 0, spawns: 0, floorCells: 0 },
  };

  for (const depth of depths) {
    const row = { depth, runs: 0, passed: 0, failed: 0, fallbacks: 0, avgAttempts: 0, avgMs: 0, warnings: 0 };
    let attemptSum = 0, msSum = 0;

    for (let s = 0; s < seedsPerDepth; s++) {
      const seed = `suite-${depth}-${s}`;
      const t0 = performance.now();
      // Alternate crossbow ownership so both content pools get exercised.
      const context = { hasCrossbow: s % 2 === 0 };
      let level, thrown = null;
      try {
        level = generateLevel({ depth, seed, context });
      } catch (err) {
        thrown = err;
      }
      const ms = performance.now() - t0;
      msSum += ms;
      row.runs++; results.total++;

      if (thrown) {
        row.failed++; results.failed++;
        results.failures.push({ depth, seed, check: 'generation threw', detail: String(thrown && thrown.stack || thrown) });
        continue;
      }

      attemptSum += level.attempts || 1;
      results.attemptHistogram[level.attempts] = (results.attemptHistogram[level.attempts] || 0) + 1;
      if (level.usedFallback) { row.fallbacks++; results.fallbacks++; }

      const problems = [];
      for (const c of CHECKS) {
        let detail = null;
        try { detail = c.fn(level); } catch (err) { detail = 'check threw: ' + err.message; }
        if (detail) problems.push({ check: c.name, detail });
      }

      const v = level.validation || validateLevel(level);
      row.warnings += (v.warnings || []).length;
      results.warnings += (v.warnings || []).length;

      if (problems.length) {
        row.failed++; results.failed++;
        for (const p of problems) results.failures.push({ depth, seed, ...p });
      } else {
        row.passed++; results.passed++;
      }

      for (const k of level.keys) {
        const g = level.gates[k.colourIndex];
        if (g) results.stats.keyGateDist.push(Math.abs(g.x - k.x) + Math.abs(g.y - k.y));
      }
      results.stats.secrets += level.secrets.length;
      results.stats.encounters += level.encounters.length;
      results.stats.spawns += level.spawns.length;
      results.stats.floorCells += level.floorCells.length;

      if (onProgress && results.total % 25 === 0) onProgress(results);
    }

    row.avgAttempts = attemptSum / Math.max(1, row.runs);
    row.avgMs = msSum / Math.max(1, row.runs);
    results.byDepth.push(row);
  }

  results.totalMs = performance.now() - started;
  const d = results.stats.keyGateDist;
  results.stats.avgKeyGateDist = d.length ? d.reduce((a, b) => a + b, 0) / d.length : 0;
  results.stats.minKeyGateDist = d.length ? Math.min(...d) : 0;
  return results;
}

// Determinism: the same seed must always produce the identical level.
export function runDeterminismTest(samples = 12) {
  const problems = [];
  for (let i = 0; i < samples; i++) {
    const depth = 1 + (i % 12);
    const seed = 'determinism-' + i;
    const a = generateLevel({ depth, seed, context: { hasCrossbow: false } });
    const b = generateLevel({ depth, seed, context: { hasCrossbow: false } });
    if (a.grid.cells.length !== b.grid.cells.length) { problems.push(`${seed}: size differs`); continue; }
    for (let j = 0; j < a.grid.cells.length; j++) {
      if (a.grid.cells[j] !== b.grid.cells[j]) { problems.push(`${seed}: tile ${j} differs`); break; }
    }
    if (a.spawns.length !== b.spawns.length) problems.push(`${seed}: spawn count differs`);
    if (JSON.stringify(a.entrance) !== JSON.stringify(b.entrance)) problems.push(`${seed}: entrance differs`);
  }
  return { ok: problems.length === 0, problems };
}

// The RNG itself should be uniform enough not to bias content selection.
export function runRngTest() {
  const rng = new RNG('distribution');
  const buckets = new Array(10).fill(0);
  const N = 200000;
  for (let i = 0; i < N; i++) buckets[Math.floor(rng.next() * 10)]++;
  const expected = N / 10;
  const worst = Math.max(...buckets.map((b) => Math.abs(b - expected) / expected));
  return { ok: worst < 0.05, worst, buckets };
}
