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
| Move | `WASD` **and** arrow keys (both always active), 8-way | floating d-pad |
| Slash | `Space` / `J` | SLASH |
| Fire crossbow | `F` / `K` | FIRE (appears once you own one) |
| Action (doors, gates, stairs, chests, shrines) | `E` / `Enter` | ACT |
| Pause | `Esc` / `P` | pause button |
| Bestiary | `B` | bestiary button |

Stairs never trigger by walking onto them -- they always require an explicit
Action press, so you cannot fall into the next depth by accident.

On a touch screen the movement pad is not fixed in a corner: the whole lower
left of the glass is the movement surface, and the pad anchors wherever your
thumb lands. The action buttons stay put on the right, because those you want
in the same place every time.

### What the direction keys do

The direction keys walk **the dungeon's compass**:

| Key | Direction | How the view draws it |
| --- | --- | --- |
| `W` / `Up` | North | up and to the right |
| `D` / `Right` | East | down and to the right |
| `S` / `Down` | South | down and to the left |
| `A` / `Left` | West | up and to the left |

Corridors run along those axes, so one key walks a passage end to end. Holding
two keys gives the four diagonals: `Up`+`Right` is north-east, and so on.

North being drawn up-and-to-the-right is the isometric projection doing its
job, not a mapping error -- a 2:1 view rotates the world 45 degrees, so the
dungeon's axes land on the screen's diagonals.

Because diagonals may not cut corners, blocking a cardinal also blocks both
diagonals beside it. That gives a useful guarantee: **a cardinal key either
walks you that way or leaves you standing still.** It can never quietly send
you east when you pressed north. There are tests for this.

Two settings cover the rest, under Settings:

* **Direction keys** -- *Dungeon axes* (default) or *Screen direction*, which
  makes `Up` move straight up the display instead. Applies to the touch pad too.
* **Blocked direction** -- whether a blocked *diagonal* takes the nearest way
  round or simply stops.

---

## The loop

1. Enter a depth. Your torch is the only reliable light.
2. Explore. Lit ground becomes *remembered* ground once you leave it, and
   remembered ground fades.
3. Find the colour-coded key for the gate barring the next region.
4. Repeat through two, three or four staged regions as depths get deeper.
5. Somewhere in the maze there is a ladder. It does not lead to another
   depth -- it drops into a sealed vault belonging to *this* one, guarded and
   full of treasure, with no other way in or out.
6. Find the stairs and choose to descend.
7. Take one of three relics.
8. Every fifth depth is a boss, and a boss always pays out a relic.

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

### Movement

Everything that walks the labyrinth moves tile to tile rather than floating
freely. A step interpolates at constant speed and the next begins the instant
the last lands, so holding a direction reads as running -- but a body is never
between tiles, never wedged on a corner, and never dragged sideways along a
wall it walked into.

Input stays a free vector; only the eight grid directions are ever taken. The
mover picks the open one closest to what was asked for. Press into a wall and
nothing happens at all, and diagonals refuse to cut corners -- which is what
makes a cardinal key exact rather than approximate.

Ice does not take this away. What ice removes is your ability to *stop*:
letting go carries you on a couple of tiles, and a hard about-face has to wait
for the slide to run out. Steering still works, because controls that ignore
you read as broken rather than slippery.

### Ladders and vaults

The grid is taller than the maze. The strip below it holds vaults: small,
sealed, well-stocked chambers carved connected to nothing at all. A ladder in
the maze is the only way in, and the only way out. They are worth real points
to find, they are always guarded, and -- because the validator forbids it --
nothing you need to finish the depth is ever inside one.

Only the layer you are standing on is drawn, so a vault feels like somewhere
else rather than a room that happens to be south of the map.

### Torchlight

Symmetric recursive shadowcasting produces the visible set each frame. The same
light values feed **enemy awareness**, which is what makes a bigger torch a real
trade-off rather than a free upgrade: most creatures detect you further away
when you are lit, while things that prefer the dark see you *better* when your
flame is low.

Tiles are baked once per biome in three versions -- lit, black silhouette and a
cold, dimmed "memory" copy -- so the whole lighting and map-memory model costs
at most two `drawImage` calls per tile. The whole set bakes in about 50ms.

### Surfaces

Walls and floors are real masonry, not tinted shapes. Each face is clipped and
the drawing space skewed into the isometric plane, so courses of stone run
*with* the wall; every block gets its own tone, a lit bevel along its top and
left, a shadowed one along its bottom and right, and the odd knocked-off
corner. Fine grain is scattered over the top.

The stylised half is deliberate and lives in the edges: a firm dark seam under
each wall cap and a catch-light along its upper edges. That is what keeps
stone reading as solid objects at the edge of torchlight, where a purely
photographic treatment would dissolve into mud.

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

Current status: 540/540 levels valid, no fallbacks, ~23 ms per level.

**Gameplay integration** -- drives the real systems through scripted scenarios:
gates blocking and opening, keys dropping from carriers, stairs requiring an
explicit press, sword arcs hitting only what they face, bolts stopping at walls,
quiver caps, shield-relic probabilities measured over 200k rolls, contextual
relic offers, hazard mechanics, encounter sealing, flawless forfeiture, boss
phases and arena gating, ladders into vaults (and the vaults being unwalkable
into), memory decay, and score arithmetic.

It also pins the control mapping: each direction key is measured against the
compass direction it is supposed to walk, with the drift-free guarantee
checked against a deliberately walled-off direction, and the screen-relative
frame checked separately.

It finishes with an **autopilot completability test**: a pathfinding bot plays
24 generated levels across depths 1-14 from entrance to exit, routing to each
key, unlocking each gate, fighting its way out of rooms that seal behind it,
and taking the stairs. It is the practical counterpart to the validator -- the
validator proves a route exists, the bot walks it.

Current status: 44/44 passing.

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
