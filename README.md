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
             particles, actors, props, ambience, post-processing,
             the scene renderer, minimap
  audio/     synthesised sound effects, acoustic probe, procedural impulse
             responses, adaptive procedural music
  ui/        HUD, screens, touch controls, styles
tests/       seeded generation suite, gameplay integration suite
tools/       dev server (also accepts frame uploads), dev harness
```

`core/perf.js` is the one module every expensive part of the renderer answers
to; see [Performance](#performance).

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

### Difficulty and pacing

The descent is meant to open gently and tighten steadily, so the shape is
measured rather than guessed. `tests.html` runs whole descents -- one run
carrying health, relics and the crossbow from depth to depth -- and reports a
curve. The pilot is deliberately mediocre: it walks its route, swings at what
is in reach and never dodges. It is a yardstick, not a good player.

What the shape looks for:

* **Depths 1-2** teach. One region, no gates, no hazards, a handful of foes on
  a small map. Losing more than a scratch here means something is wrong.
* **Depth 3** introduces the whole key-and-gate idea, and is the first real
  bite.
* **Depth 5** is the first boss.
* **Beyond that** the clear rate should fall smoothly. A cliff means one depth
  is introducing too much at once.

Two rules came out of measuring it:

**One new idea per depth.** Every wall found during tuning was a depth where
several things arrived together -- hazards *and* a new staged region *and*
elite guards. Content is now introduced on separate depths on purpose, which
is why the thresholds in `buildEncounters` look arbitrary. They are not.

**A staged region is the biggest step in the game.** Each one adds a key hunt,
a gate and roughly another region of fighting on the same health bar, and it
dwarfs anything else. Regions are therefore spaced widely (1 up to depth 2, 2
up to depth 8, 3 up to depth 14, 4 beyond) so a second gate is met with more
health, more relics and a crossbow in hand.

Levels grow with depth throughout, from roughly 29x25 at depth 1 to 55x49 by
depth 14, with enemy counts set as a density over floor area so a bigger level
is not automatically a busier one.

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

### Lighting the stone

The baked lit/dark pair above only ever knows how *much* light reaches a tile.
Direction is added on top: each wall carries a warm quad per visible face,
blended additively in proportion to how squarely that face is turned toward the
torch. The left face of a block looks along +y and the right face along +x, so
the term is simply the dot product of the face normal with the direction to the
flame -- and it is modulated by the torch's own flicker, so the walls breathe
with it. Floors take the same warmth, plus a baked contact shadow keyed on
which of their four neighbours are solid (sixteen combinations, one blit).

Actor shadows lean away from the torch and lengthen with distance from it,
which is most of what sells a light source somebody is carrying.

Bloom is assembled out of the two things Canvas 2D accelerates: scaling and
blend modes. The frame is scaled down (that is the blur), multiplied by itself
three times (that is the threshold -- raising it to the fourth power leaves the
flame, the sparks and the rune glow while throwing away lit stonework bright
enough to fog the whole screen), softened, and added back.

### Ambience

`render/ambience.js` is a world-space layer of things that are alive rather
than mechanical -- distinct from the hazard weather, which is screen-space and
tied to a rule. Motes turn in the torchlight, water finds its way through a
crypt ceiling and rings where it lands, embers lift off hot ground and burn out
on the way up, spores drift over a tomb, rain stipples standing water, and the
wall sconces cast pools of light that flicker on their own clocks.

The mote field is deterministic -- positions come from a hash wrapped around
the player -- so it allocates nothing and parallaxes correctly because it lives
in grid space.

### Performance

30fps is the floor and 60fps is the target. A quality controller measures the
real frame interval and compares it against **the display's own cadence**
rather than an absolute millisecond figure: frames arrive on vsync boundaries,
so on a 60Hz screen no amount of optimisation gets the average below 16.7ms,
and a fixed target would mean quality could drop but never climb back. The
controller tracks the best interval the display has managed and treats landing
on it as headroom.

Three tiers, also selectable by hand in Settings:

| Tier | What it adds | 1280x800 | 2560x1600 |
| --- | --- | --- | --- |
| Low | the original renderer, sparse ambience | 0.9ms | 1.2ms |
| Medium | torch-lit stonework, contact and soft shadows, sconce pools | 1.4ms | 1.6ms |
| High | bloom, colour grade, full ambience and weather | 2.7ms | 3.2ms |

Measured with a pipeline flush (`getImageData`) after each batch, so the
figures include GPU work rather than just command submission.

### Readability

Walls are cut away automatically when they would cover the player, an enemy, a
key, a gate, a discovered cracked wall, a pickup or the exit. The test is a real
screen-space overlap, so only what is genuinely in the way fades.

## Sound

Nothing is downloaded. Every effect is built from oscillators and filtered
noise at the moment it plays, which means it can be parameterised by where it
happened and what kind of place it happened in.

### The room

Eight rays are cast from the listener a few times a second and the geometry
they find is reduced to three numbers: how big the space is, how corridor-like
it is, and how close the nearest wall is. That picks one of six impulse
responses, each generated as an array of numbers at runtime:

| Space | Length | Character |
| --- | --- | --- |
| closet | 0.42s | dense, dark, gone almost at once |
| corridor | 1.0s | barely diffuse -- mostly a slap repeating every 19ms |
| gallery | 1.7s | a long hall you can see the end of; slower slapback |
| chamber | 1.1s | ordinary room |
| hall | 2.1s | later buildup, more air |
| cavern | 3.4s | boss arenas |

Two convolvers run in parallel so the impulse can change without a click: the
idle one is loaded with the new room and the pair is crossfaded over a second.
Around that, wet level, send and a damping filter move continuously with the
geometry -- and with the hazard, because fog and mud swallow reflections while
ice and bare crypt stone keep them bright.

A passage genuinely rings rather than merely being shorter. Its impulse is
deliberately undiffused, so what comes back is the same sound bouncing between
two flat faces; autocorrelation of the generated impulse peaks at exactly its
19ms tap spacing, where the chamber shows no structure at all. The same sword
swing measures a 430ms tail in a closet, 900ms in a corridor, 1730ms in a hall
and 2530ms in the boss arena.

### The sword

The whoosh leaves the blade before anything is hit, so all it can know is
whether the arc has room to finish -- a swing into a wall is shorter and
duller than the same swing across a hall, and in a tight space it answers
itself almost at once.

What happens next depends on what the blade found:

- **nothing** -- the whoosh and the room, and no impact at all
- **stone** -- a bright transient, a long metal ring, a dull thud through the
  wall and a little falling grit, plus sparks and a short jarring hitstop
- **an enemy** -- an impact chosen by that creature's material: flesh, bone,
  armour, ethereal, ice, ember or wood. The same lookup picks the colour of
  what the hit throws, so a Bone Slinger sheds pale chips and a Frost Revenant
  sheds ice.

Footsteps are chosen by surface -- stone, cold crypt flagstone, wet, mud, ice,
ash, moss -- with the hazard winning over the biome, because the hazard is the
thing that also changed how walking *feels*. Every repeat is varied in pitch
and level so a run down a corridor is not a machine gun.

### Position

Sounds carry a position. They are panned across the isometric view (screen
left/right is `dx - dy`), attenuated and dulled with distance, muffled further
when something is in the way, and pushed further into the reverb the further
off they are -- a door heard across a hall is nearly all room.

### The score

`audio/music.js` runs a small set of layers continuously and crossfades them;
there are no tracks to cut between. Biome picks the scale, hazard colours the
mix, threat drives intensity -- and the geometry now rebalances the layers too.
A corridor keeps the drone and the drum forward; a hall lets the pad and the
horn open out and lengthens their tails. Each biome has a written four-note
motif rather than a die rolled every fourth beat, and a bass layer sits under
the chord roots.

Room reverb can be turned off in Settings for a dry mix.

---

## Tests

Open <http://localhost:8123/tests.html>.

**Procedural generation** -- batch-generates seeded levels across every depth
band and asserts the guarantees above, plus determinism (same seed, same level)
and RNG uniformity. It also renders sample layouts.

Current status: 630/630 levels valid, no fallbacks, no warnings, ~15 ms per level.

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

**Balance curve** -- plays whole descents and reports clear rate, health lost
and time taken per depth. Not pass/fail: it is there to be looked at when
tuning, and to catch a depth turning into a wall.

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
