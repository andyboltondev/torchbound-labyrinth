# Torchbound Labyrinth

A procedural Norse dungeon crawler that runs in the browser. Slightly top-down
2.5D isometric, built around limited torchlight, staged keyed regions, tactical
combat and run-shaping relic choices.

No build step, no dependencies, no installation. It is plain ES modules,
Canvas 2D and the Web Audio API.

---

## Running it

The game needs to be served over HTTP (ES modules will not load from `file://`).
Any static server works. A small development server is included:

```bash
python tools/serve.py 8123
```

Then open <http://localhost:8123/index.html>.

Any equivalent works too, for example `npx serve` or `python -m http.server`.

---

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Move | `WASD` **and** arrow keys (both always active) | analogue d-pad |
| Slash | `Space` / `J` | SLASH |
| Fire crossbow | `F` / `K` | FIRE (appears once you own one) |
| Action (doors, gates, stairs, chests, shrines) | `E` / `Enter` | ACT |
| Pause | `Esc` / `P` | pause button |
| Bestiary | `B` | bestiary button |

Stairs never trigger by walking onto them -- they always require an explicit
Action press, so you cannot fall into the next depth by accident.

---

## The loop

1. Enter a depth. Your torch is the only reliable light.
2. Explore. Lit ground becomes *remembered* ground once you leave it, and
   remembered ground fades.
3. Find the colour-coded key for the gate barring the next region.
4. Repeat through two, three or four staged regions as depths get deeper.
5. Find the stairs and choose to descend.
6. Take one of three relics.
7. Every fifth depth is a boss, and a boss always pays out a relic.

---

## Architecture

Systems are deliberately independent; the world talks to the interface and
audio through an event bus rather than by reaching into them.

```
src/
  core/      rng, fixed-timestep loop, input, storage, events, math
  gen/       tiles, biomes/hazards, grid queries, the generator, the validator
  game/      run state, world runtime, player, enemy AI, bosses, relics,
             scoring, physics, persistence, enemy data
  render/    isometric projection, baked tile sprites, lighting/FOV,
             particles, actors, props, the scene renderer, minimap
  audio/     synthesised sound effects, adaptive procedural music
  ui/        HUD, screens, touch controls, styles
tests/       seeded generation suite, gameplay integration suite
tools/       dev server (also accepts frame uploads), dev harness
```

### Generation and the solvability guarantee

A level is a **chain of zones**. Each zone is carved independently (rooms, then
a maze through the leftover lattice, then connectors merge it into one region),
and consecutive zones are joined by exactly one tunnel with a gate on it.

Because that tunnel is the only crossing, every gate is a genuine bottleneck by
construction, and a key placed anywhere in zones `0..N` is guaranteed reachable
before gate `N`.

Nothing ships unvalidated. `src/gen/validate.js` runs on every generated level
and rejects it if any of these fail:

* the exit is reachable under key logic
* every key is obtainable **before** its own gate (checked by forcing that gate
  shut and re-flooding)
* every gate actually blocks -- closing one alone must cut off the exit
* no mandatory route depends on breaking a secret wall, and breaking every
  secret wall must not bypass a gate
* gates have exactly two opposite open sides, aligned with their corridor
* no orphaned floor, nothing stranded, nothing spawned inside rock
* hazard threat stays inside the depth budget, with no unfair combinations

If a level fails, it is thrown away and regenerated. A guaranteed-valid
single-zone fallback exists so the game can never present a broken map.

### Torchlight

Symmetric recursive shadowcasting produces the visible set each frame. The same
light values feed **enemy awareness**, which is what makes a bigger torch a real
trade-off rather than a free upgrade: most creatures detect you further away
when you are lit, while things that prefer the dark see you *better* when your
flame is low.

Tiles are baked once per biome in three versions -- lit, black silhouette and a
cold, dimmed "memory" copy -- so the whole lighting and map-memory model costs
at most two `drawImage` calls per tile.

### Readability

Walls are cut away automatically when they would cover the player, an enemy, a
key, a gate, a discovered cracked wall, a pickup or the exit. The test is a real
screen-space overlap, so only what is genuinely in the way fades.

---

## Tests

Open <http://localhost:8123/tests.html>.

**Procedural generation** -- batch-generates seeded levels across every depth
band and asserts the guarantees above, plus determinism (same seed, same level)
and RNG uniformity. It also renders sample layouts.

Current status: 720/720 levels valid, no fallbacks, ~14 ms per level.

**Gameplay integration** -- drives the real systems through scripted scenarios:
gates blocking and opening, keys dropping from carriers, stairs requiring an
explicit press, sword arcs hitting only what they face, bolts stopping at walls,
quiver caps, shield-relic probabilities measured over 200k rolls, contextual
relic offers, hazard mechanics, encounter sealing, flawless forfeiture, boss
phases and arena gating, memory decay, and score arithmetic.

Current status: 35/35 passing.

---

## Design notes worth knowing

* **Relics are contextual.** Crossbow relics never enter the pool until you own
  a crossbow; Ember Ward only appears once you have met ice or mud; a healing
  relic will not be offered at full health. Offers also spread across categories
  so a choice is a real decision.
* **Modifiers are recomputed, never accumulated.** Taking a relic rebuilds the
  whole modifier set from the relic list, so stacking cannot double-count.
* **The shield relic's outcomes are mutually exclusive** by construction: one
  roll against cumulative thresholds (1% ricochet, 5% blocked, 20% blunted).
* **Hazards are never cosmetic.** If you can see rain, your torch is weaker. If
  you can see fog, your map memory is draining faster. A generation budget stops
  them stacking into something unfair.
* **Difficulty comes from systems**, not health bars: new archetypes, elites,
  more staged regions, nastier hazard pairings and denser encounters.

---

## Repository

This is intended to live in a **private** GitHub repository. The local repo is
initialised and committed; publishing it is a manual step:

```bash
gh repo create torchbound-labyrinth --private --source=. --remote=origin --push
```
