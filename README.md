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

## Build number

The game has no build step, so its identity is a generated source file.
`version.json` holds the semantic version; `tools/stamp_version.py` writes
`src/core/version.js` with that plus a UTC timestamp, the commit it was cut
from, the branch and -- in CI -- the pull request number.

```bash
python tools/stamp_version.py          # stamp from the working tree
python tools/stamp_version.py --check  # non-zero if it disagrees with version.json
```

The stamp at the foot of the home screen and the pause menu is a button: it
opens **What changed**, a screen with every version's notes, chosen from a
dropdown or stepped through with the arrows. `src/game/releases.js` holds them,
written by hand -- a changelog is for players, so it says what is different to
play rather than what moved in the source. Everything before 1.3.0 predates
the stamp; those numbers are reconstructed from the merge that shipped each
one and the screen says so rather than pretending. A test fails if
`version.json` is bumped without notes being written for it.

Beside it is **Report a bug**, which opens a prefilled issue on the tracker
with the build, seed, depth, mode and a coarse browser string already filled
in, against the form in `.github/ISSUE_TEMPLATE/bug_report.yml`. It opens the
form; the player reads it and files it themselves. Nothing that identifies a
person travels with it.

It shows at the foot of the home screen and the pause menu as
`Build 1.2.0-20260827-044811` with the commit under it, so a screenshot names
the code it came from. The Pages workflow re-stamps at deploy, so the live
game reports when it actually shipped; a second workflow checks on every pull
request that the version in the stamp still matches `version.json`.

## Offline play and updates

The game keeps a copy of itself on the device. `sw.js` is a service worker that
precaches every file on the first visit; after that it starts with no network
at all. There is no build step, so the file list is not written by hand in the
worker -- `tools/stamp_version.py` walks the tree at stamp time and writes
`build.json`:

```json
{ "version": "1.3.0", "build": "20260827-145548", "assets": ["./index.html", ...] }
```

A hand-kept precache list in a project with no bundler goes stale one module at
a time and takes offline play down without ever saying so, which is why
`--check` now fails if `build.json` disagrees with what is actually in `src/`.
The Pages workflow re-stamps at deploy, so the shipped manifest always matches
the shipped tree.

The cache is **named after the build**, so a new build is a new cache and there
is never a half-updated mixture of old and new modules importing each other --
the failure that turns a caching bug into a blank screen. Old caches are
deleted on activate. `build.json` is the one file never served from cache: it
is how the page finds out there is something newer.

On load, `src/core/appupdate.js` asks `build.json` what build the host is
serving and compares it against the one running. If they differ -- and only
then, and only online -- the new build is fetched and the page **reloads onto
it**, there and then, at the menu where a reload costs nothing. **Nothing is
shown and nothing waits**: the check races a 2-second timer and loses, so a
player on a bad connection is never held at a blank screen over a version they
did not ask about.

Three things make that reload safe, and none of them is optional:

* **It never lands mid-descent.** A run lives in memory and nowhere else, so a
  reload during one is a run destroyed by a version number. The caller passes
  `canReload`, and it is asked *twice* -- once before the download and again
  after it, because a player can press Begin the descent while a megabyte of
  game is coming down behind the menu.
* **The new files are down, and the old ones gone, before the page moves.**
  The page asks the worker outright (`postMessage({ type: 'refresh' })`) and
  waits for its answer. `registration.update()` cannot do this job alone: it
  compares `sw.js` byte for byte, and `sw.js` is the same file from build to
  build because the file list lives in `build.json` on purpose -- so the
  browser's honest answer is "the worker has not changed" while the game it is
  serving is a build behind. The worker precaches the new build, deletes every
  older cache, *then* replies; `caches.match` searches every cache oldest
  first, so reloading while the old one survived would land straight back on
  the build being left. Where no worker is running at all -- plain http, a
  browser without them -- there is nothing of ours in the way and the reload
  revalidates against the host, which is the same outcome by a different road.
* **A build that will not take is given up on.** A manifest naming a build the
  device cannot actually end up running -- shipped ahead of its files, a proxy
  pinning one of them -- would otherwise reload, find the same disagreement and
  reload again, forever, on a game that never draws a menu. Two attempts per
  build (`UPDATE_TRIES`), counted in storage against the build being aimed at,
  and then it goes back to being fetched quietly to land on some later load.
  The counter is cleared the moment the build it was aiming at is the one
  running. `tests/integration.js` pins all of this arithmetic.

Beside the build number, **Check for updates** asks the same question on
demand, and says every answer out loud including the dull ones -- a button that
does nothing visible on the likeliest outcome reads as broken. From the pause
menu, mid-descent, it will not reload on its own: the build is fetched, the
button becomes **Update now**, and spending the run on it is the player's call.

The first load after an update says so once, on the home screen, with a link to
**What changed** -- then never again for that build. A game that changes under
somebody without ever mentioning it is a game where every change reads as a bug
they have found. A first-ever visit is not an update and is recorded silently.

### Installing it

`manifest.webmanifest` and the precaching worker together make the game a
progressive web app, so Chrome offers to install it: its own icon, its own
window, no address bar, and on a phone the same thing through *Add to Home
Screen*. `display` is `standalone` with `display_override` reaching for
`fullscreen` first, so a browser that understands the newer field gives a game
the whole screen and one that does not still gets a sensible window.

Whether it can be installed is the browser's decision, not the page's -- it
wants the manifest, an icon big enough to draw a tile with, and a worker that
can serve the thing offline. When Chrome has satisfied itself of all three it
offers `beforeinstallprompt`, and `src/core/appupdate.js` catches that at
module load, because it fires once and early, usually before a menu has been
drawn. Holding the event is the only way to ask later, at a moment the player
chose: the **Install** button beside the build number, which is hidden until
there is something to offer and gone once it has been spent.

The icons are drawn by `tools/make_icons.py` rather than kept as binaries
nobody can edit -- a square spiral with the torch at the heart of it, in the
palette the game already uses. Re-run it after changing the mark and commit
what it writes. The small sizes are drawn with fewer turns and snapped to whole
pixels rather than being the large one scaled down: at sixteen pixels across,
antialiasing spends the gap between one turn of the spiral and the next on a
grey edge, and the whole thing closes up into a blob. `icons/` and the manifest
are precached like everything else, so an installed copy can draw its own tile
with no connection.

### During development

The worker is **off on localhost**, because `tools/serve.py` sends `no-store`
on everything precisely so an edit shows up on reload, and a worker serving the
previous copy out of its own cache would quietly undo that. Load
<http://localhost:8123/index.html?sw=1> to turn it on when the caching is what
you are working on; loading without it again unregisters the worker and deletes
its caches, so it cannot be left on by accident.

`tests.html` never registers anything -- it does not load `src/main.js`. It
does import `appupdate.js` for the update arithmetic, which touches nothing:
registering, downloading and reloading all happen behind functions only the
game calls.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Move | `WASD` **and** arrow keys (both always active), 8-way | diamond pad |
| Slash | `Space` / `J` | SLASH |
| Fire crossbow | `F` / `K` | FIRE (appears once you own one) |
| Action (doors, gates, stairs, chests, shrines, fires, captives, altars) | `E` / `Enter` | ACT |
| Douse or relight your torch | `T` / `Q` | TORCH |
| Open the map | `M` | Map button, or tap the minimap |
| Bestiary | `B` | bestiary button |
| Pause | `Esc` / `P` | pause button |

This table is generated from `CONTROLS` in `src/core/input.js`, which is also
what the settings panel and the opening guide render from -- three hand-written
copies had drifted, and none of them mentioned the torch.

Settings and the guide draw the same illustration: the movement keys as key
caps with their compass bearings (or the touch pad, whichever you are actually
playing with), then every other control as a cap beside what it does. The home
screen carries a single line naming the three you press constantly and pointing
at Settings for the rest -- the full table used to live there and was most of
the reason the home screen did not fit on a phone.

Stairs never trigger by walking onto them -- they always require an explicit
Action press, so you cannot fall into the next depth by accident.

Pressing into the stone beside a one-tile opening steps you into the opening
rather than doing nothing, so a doorway you are a tile short of does not have
to be lined up with by hand. The tolerance is exactly one tile and the wall
has to continue past the gap, so a lone pillar is still an obstacle to walk
round; *Settings > Blocked direction > Stop* opts out of it along with the
rest of the movement assist. A pushable stone is explicitly not one of the
walls this applies to: pressing into one is a shove, and letting the assist
walk you round it silently spent the press that would have moved it.

On a touch screen the default movement pad is a **diamond**: four buttons at the
corners of a shape wider than it is tall, in the same 2:1 proportion as a floor
tile, so each one sits along the direction the corridor it walks runs off
towards -- the top-right button is north, and north is drawn up and to the
right. Each button's arrow is turned to the bearing the camera actually draws
that axis at, which is 26.6 degrees off the horizontal rather than 45 (see
below); the pad's corners lean the same way but not quite that far, because a
thumb wants the buttons kept apart. The diamond is immune to the *Direction
keys* setting, because its buttons are already on the dungeon axes.

The older **floating stick** is still available under *Settings > Touch pad*:
the whole lower left of the glass becomes the movement surface and the pad
anchors wherever your thumb lands.

The action buttons stay put on the right either way, because those you want in
the same place every time. On a touch screen the HUD's own buttons grow and
take a word with them -- there is no hover there to reveal a tooltip.

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
job, not a mapping error. The tiles are 64x32, so the projection lays each
dungeon axis down at `atan(32/64)` -- 26.6 degrees off the horizontal. It is
often described as putting the axes "on the diagonals", and for placing things
that is close enough, but anything that has to *point* along an axis -- the
d-pad arrows, an aim reticle -- wants the real 26.6, not 45.

Because diagonals may not cut corners, blocking a cardinal also blocks both
diagonals beside it. That gives a useful guarantee: **a cardinal key either
walks you that way or leaves you standing still.** It can never quietly send
you east when you pressed north. There are tests for this.

Two settings cover the rest, under Settings:

* **Direction keys** -- *Dungeon axes* (default) or *Screen direction*, which
  makes `Up` move straight up the display instead. Also applies to the floating
  stick; the diamond ignores it, as above.
* **Blocked direction** -- whether a blocked *diagonal* takes the nearest way
  round or simply stops.
* **Touch pad** -- *Diamond* (default) or *Floating stick*.

---

## The map, the guide and seeds

`M` (or a tap on the corner chart) opens the full map: the whole discovered
level, drag to pan, scroll or pinch to zoom, with a legend of everything found
on this depth and how many of each. It is the same chart the corner widget
draws, at a different size -- there is no second map.

Zoom sits on the chart rather than under it, and the legend folds. Below 780px
the map screen drops its panel entirely and takes the whole display: on a phone
every row of furniture under the map is a strip of dungeon you do not get to
see, and the legend -- which exists to explain the chart -- must never be the
reason there is no room for one. It starts folded there and open on a desktop.

The first depth of a descent opens with an illustrated guide. It leads with
what the game *is* and what a single depth wants -- find the keys, open the
gates, take the stairs down, in the same three steps the HUD's objective line
walks through -- and then draws the controls: WASD and the arrow keys as key
caps with their compass bearings, or the touch pad and its four buttons with a
diamond/stick choice on the spot. It has a "do not show this again" box, and
Settings can bring it back.

The home screen is held to one viewport. Nothing on it is reached by scrolling,
because the first thing anyone looks for there is the button that starts the
game, so as the screen shrinks it gives things up in order of what they are
worth: the flavour line, then the tail of the hall preview, then the subtitle
and the last of the run statistics. Everything it gives up is reachable
somewhere else.

Every descent has a **seed**, folded away below the three modes on the
difficulty screen and shown on the pause and run-end screens with a Copy
button. Typing or pasting one in gives that labyrinth: the same seed and the
same mode generate the same level. Left shut -- which is how almost everyone
leaves it -- the labyrinth picks its own. Later depths also read what the
player is carrying, so two descents match all the way down only if they make
the same choices.

## Difficulty

Chosen once per descent, on the way in. Every mode is expressed as multipliers
folded into the same modifier bundle the relics write to, so nothing downstream
needs to know a difficulty exists.

| Mode | What changes | Hall of Fame |
| --- | --- | --- |
| **Hearthlight** | Foes have less health and hit softer. Death offers the stair again, as often as you need it. | No |
| **Torchbound** | Nothing. This is the measure everything else is set against. | Yes |
| **Ashenvow** | Shorter torch, wider enemy detection, tougher and harder-hitting foes. Deeds are worth 20% more. | Yes |

A retried depth is re-cut from a fresh seed: your relics, crossbow and the
score from the depths above come back down with you, but everything the failed
attempt had banked is forfeit.

A mode that hands the stair back on death cannot be ranked against one that
does not, so Hearthlight is unranked -- and it does not set the *deepest* or
*best score* records on the home screen either. There is a test for that.

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
             difficulty modes, scoring, physics, persistence, enemy data,
             sound propagation, sacrifice altars, gore, the hall of fame
  render/    isometric projection, baked tile sprites, lighting/FOV,
             particles, actors, props, ambience, vermin, blood and bodies,
             post-processing, the scene renderer, minimap
  audio/     synthesised sound effects, acoustic probe, procedural impulse
             responses, adaptive procedural music
  ui/        HUD, screens, touch controls, styles
tests/       seeded generation suite, gameplay integration suite
tools/       dev server (also accepts frame uploads), dev harness,
             the build stamper
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

### Hearing

Sound is the half of the labyrinth that works with the torch out, so it is a
real system rather than a mixer trick. `game/soundfield.js` runs Dijkstra
outward from the listener over the walkable grid, costing a tile per tile and
about a tile and a half per bend. Anything that makes a noise looks itself up
in that field, which answers three questions at once: how loud it arrives, how
many corners it turned, and which way it left the listener to get here.

* Volume falls with the distance the sound actually travelled, not the
  distance across, so stone genuinely blocks it.
* Every bend takes more of the top off it and pushes more of it into the
  reverb, so "round the corner" is audibly different from "over there".
* It is mixed at the mouth of the corner it came round rather than through the
  wall, because the field records the first step out of the listener.

Hearing reaches about 1.9x what the torch lights, and further again once the
torch is out. The field is built four and a half times a second and costs
0.027ms; a second field is built on demand when something loud happens, so
creatures can decide whether they heard it.

Every archetype has a voice with its own timbre, pitch and loudness -- a groan
for the barrow-dead, a snarl for the hound, wood creaking for the root horror
-- generated from one parameterised synth with three variants each. They only
speak when the player cannot already see them.

A crossbow bolt clattering off stone is heard by anything unaware within about
twelve tiles of open path, and it walks over to look. That is what makes the
field of view below into a mechanic rather than a detail.

### What can see you

Creatures see a wedge, not a circle. Each archetype has its own field of view
-- a barrow hound is nearly all-round because it hunts by nose, a bone slinger
only sees down its own arm -- with a couple of tiles of hearing behind it.
Once something is already chasing you the wedge stops mattering, so this
changes stalking and not fighting. The minimap draws each visible creature's
wedge cast against the walls, so it stops at stone.

### Fire

Four sizes: wall sconces, braziers, firepits and campfires, the larger three
placed in the middle of any room big enough to swallow a torch. All of them
cast real light through the same visibility pass the player's torch uses.
Roughly a third have gone out, and more of them the deeper you go; a cold one
can be lit with the Action button if you are still carrying a flame, and it
stays lit.

Every flame breathes on three sines at unrelated rates offset by its own seed,
so a row of braziers never pulses together.

The player's own torch can be put out. Sight collapses from seven and a half
tiles to under three, hearing sharpens by a third, vermin stop running from
you, and most of what hunts you loses the thing it was tracking -- though the
creatures that prefer the dark get *better* at finding you. Relighting is
free: the cost of the dark is the dark.

### What a fight leaves behind

Blood, bodies and boots, in `game/gore.js`. Every creature has its own colour
-- sap for the root horror, meltwater for the frost revenant, green for
whatever the mire lurker has instead, scorch marks where an ember fiend falls
-- and it stays on the floor for the rest of the depth, as does the body.
Walking through a fresh pool carries it five tiles, two prints a tile, fading
as it wears off. All of it is a fixed ring buffer, so a long fight overwrites
its own oldest splashes rather than growing.

### Altars

At most one a level and never on depth one. Three offers, each pairing a
reward with a sacrifice of the same size, so the decision is which currency
you can spare and never which offer is the good deal. Nothing is offered that
cannot be paid or would not be wanted, and walking away is a button the same
size as the rest. See `game/altars.js`; the world applies an offer, the module
decides what may be asked.

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

Some sounds carry further than others, and *how much* further is a separate
knob from how loud they are. `SoundField.hear` takes a `tail`: the falloff runs
to zero at the edge of earshot, so simply lengthening the reach would lift
every distance with it and a groan two tiles away would come out louder than it
used to. The curve steepens in proportion instead -- `(1 - d/reach)^(2·tail)`,
whose slope at zero is `-2/range` whatever the tail is -- so the near field is
untouched to within a rounding error and the whole of the extra range is spent
on the quiet end. A sound that used to stop dead at the edge now trails off
past it.

Two things use it. Creature voices get `VOICE_REACH` (1.5), because a groan is
the labyrinth telling you what is in the next room and it was only reaching
about as far as the torch lit. A raving captive's scream gets 3, so it is a
landmark you hear from the far end of a depth and decide what to do about. How
far a scream *draws creatures* from is deliberately unchanged: that is a
balance number, not an audio one, and it is a separate call.

The player's hearing field is flooded to `range × 3` -- the longest tail
anything asks for, derived from the constants rather than written down twice --
because a tile the flood never reached is silent whatever curve is applied to
it. The reference distance ordinary sounds are measured against does not move.

### The score

`audio/music.js` runs a small set of layers continuously and crossfades them;
there are no tracks to cut between. Biome picks the scale, hazard colours the
mix, threat drives intensity -- and the geometry now rebalances the layers too.
A corridor keeps the drone and the drum forward; a hall lets the pad and the
horn open out and lengthens their tails. Each biome has a written four-note
motif rather than a die rolled every fourth beat, and a bass layer sits under
the chord roots.

It starts on the first gesture of the session and does not stop again. Every
transition in the game is a crossfade of the same layers plus a different
pattern generator, across five scenes:

| Scene | Character | Shape |
| --- | --- | --- |
| Menu | Melancholy | Slow, minor, pad and drone, one distant horn line, no drum |
| Hall of Fame | Sombre | Fuller, with a rising figure and a low swell under it |
| The labyrinth | Atmospheric, adaptive | The layered score above, plus a rocky layer that fades in above 40% intensity |
| Boss hall | Energetic action | The riff machinery with everything open, drum on every beat |
| Relic table | Relaxed and upbeat | Swung sixteenths, a bouncing bass, a bright tune, snare on two and four |

The rocky layer is two detuned saws through a soft clipper. It is deliberately
not a style choice: while exploring it only arrives with the trouble, so the
guitar is something that happens to you.

Walking into a room nobody has been into yet bends the drone up a whole tone,
opens its filter and puts an unresolved suspended fourth over the pad for two
seconds. Once per room.

Room reverb can be turned off in Settings for a dry mix.

---

## Captives

The one part of the labyrinth that can be wronged. Everything else down there
is trying to kill you; these are people, which is why the choice has to cost
something and why the exception has to be real.

A captive is chained to a wall in one of four states you can tell apart from
across the room: **afraid**, **begging**, **raving**, or already dead. Whether a
begging one is actually pleading to die (`pleadToDie`) is settled at generation
from the level seed, not at the moment of the swing -- so the same seed always
meets the same person.

| What you do | To one who asked | To one who did not |
| --- | --- | --- |
| **Action** (`E` / ACT) | Cuts them loose. Not what they asked for. | Cuts them loose. |
| **Sword** | Mercy. Costs nothing, and they tell you what they knew. | A blood debt, itemised on the summary. |

Killing has never been on the Action button and is not now: taking a life
should not be something you can do with the same press that opens a chest.
Whether they asked is a fact about them rather than about whether you stopped
to listen -- charging somebody for reading a visibly begging captive correctly
would make the penalty a tax on not having pressed a button first.

**Freed captives stay.** They come off the wall, fold up, and crawl to the most
sheltered floor tile within a few paces -- corners score above flat wall, flat
wall above open ground -- and they are still there when you come back past.
Props are not obstacles, so nothing they do can block a route or wedge a
creature; there is a test that keeps it that way, because the crawl moves a
prop around long after the generator proved the depth solvable.

One in twenty who asked to die and were freed instead has a different answer to
that. It is one blow, it is survivable at any depth, and it is rolled from the
level's own generator so a seed always plays out the same way. It is
deliberately *not* a spawned enemy: turning a prop into an actor mid-level
would mean an entity the generator never validated, never counted against the
depth's budget, and never gave the autopilot a route around.

The run carries a **mercy** tally -- `freed − unjustified kills`, allowed to end
below zero -- and it is written onto the Hall of Fame entry beside the score. It
is the only number on that board that is not a measure of how good you were.

## Pushable stones

Some depths have a cut stone standing on the floor with a one-tile alcove
behind it and something worth having inside. The stone is solid to everything
that walks; walking into it is a shove rather than a step, on the same press
that walks you down a corridor, so there is no verb to learn.

A stone can also be **pulled**. Stand against one, press Action to take hold of
it, and it follows into the tile you vacate whenever you step directly away.
Any other step lets go, and so does ending up anywhere that is not beside it,
so backing out of a dead end never drags one along behind you. Both verbs move
the stone one tile along a cardinal; what differs is which side of it you are
standing on, and in a one-tile corridor only one of them is available to you.

Three rules make this safe rather than a way to wedge a depth shut:

* **A stone is never on the route to anything the depth requires.** Checked at
  generation against the level as carved, and asserted again in `validate.js`
  as containment: model every block as solid rock and the depth must lose no
  ground beyond the stones themselves and the pockets they guard. Stated that
  way it also covers key ordering, gate bottlenecks and vault ladders without
  having to reason about each separately.
* **A stone is never pushed or pulled into its own alcove.** That is the one
  move that would seal the reward away for good, and it is refused at the
  moment of the push.
* **No sequence of shoves and pulls can strand a depth.** The first rule is
  about the tile a stone starts on; this one is about every tile it can be
  driven onto, which is the question that actually costs runs. `gen/shove.js`
  searches states of *(where every stone stands, which region the player is
  in)* and asks whether any reachable state is one that no further move
  recovers from. Placement declines anything it cannot prove safe, the
  validator asserts the same, and unproven counts as unsafe in both.

  This is not made redundant by pull. A push leaves you behind the stone and a
  pull needs you in front of it, so in a one-tile passage a stone you have
  walked to the end is still a door that closed once, and both verbs have to
  be modelled rather than assuming one undoes the other.

The orphan sweep runs with blocks *passable*, because a pocket behind a stone
that moves is not stranded floor -- exactly the same two-model treatment
cracked walls already get. Shoving one for the first time scores on the same
"secrets found" tally a cracked wall pays into, so the number means one thing.
The autopilot completes every depth without touching one.

## Marks on the floor

`src/gen/decals.js` lays claw gouges near the lairs of dormant things,
footprint trails walking towards a gate or the stair, and dragged dirt beside
chests and cracked walls. They are laid on *after* the depth has been proved
sound, and `validate.js` does not know they exist -- a hint that could be
required would have stopped being a hint and become a key. There is a test that
strips every mark off a level and asserts the validator says exactly the same
thing about it.

The budget is a hard ceiling of ten, spread across the kinds. Past about that
many the marks stop reading as traces and start reading as wallpaper, and the
hint they carry is lost in the noise of the ones that carry none. They are
drawn only on tiles the player has actually lit or remembers, under everything
else on the tile, and not at all on the cheapest quality tier.

Adding a kind of mark is one entry in the table -- a rule and a sprite -- and
no change to anything that calls it. The false holes below are exactly that.

## The Gravebound

Buried standing, facing the passage, so it would be first up when the hall was
needed again. It is dormant like any ambusher and additionally is not there at
all: nothing draws it, nothing hears it, nothing can hit it through the floor,
and it does not hold its tile against you -- walking over it is how you find
one. It feels the floor rather than watching the passage, so it wants no line
of sight, has a very short reach, and dousing your torch is no defence against
the one thing underneath you.

It comes up over about half a second, cannot swing until it is out, and from
then on is an ordinary creature in every respect: being buried was a way of
arriving, not a second set of rules. It arrives through the normal spawn pool,
so it counts against the depth's enemy budget like everything else. The floor
keeps the hole.

**And some holes have nothing under them.** They come through the decal table
-- the same sprite, the same code path, no property a player could read off the
screen -- placed rarely and never near a spawn. Once you have met one
Gravebound, every hole in the floor is a question, and most of the answers are
nothing at all.

## The fidelity pass

Everything the renderer gained is either baked once per biome or the same
number of draw calls with different arithmetic in them. There is no new live
pass except the floor marks, and those are off on Low.

* **Masonry** has a two-step bevel rather than one -- a bright edge with a
  softer shoulder inside it, and the same on the dark side. One flat band of
  light on a flat band of colour reads as a drawn rectangle; two reads as a
  face with a thickness. Grain counts are up about a third. Both are bake-time
  only: a tile is drawn once into a canvas and blitted from then on, which
  makes this the cheapest detail in the game.
* **Directional light** squares the dot product before using it. Raw, it falls
  off as the cosine, which is nearly flat for the first forty degrees either
  side of square-on -- so most of a corner came out at almost the same
  brightness and stopped reading as a corner. Squaring leaves the face turned
  towards the flame where it was and darkens the one turning away.
* **Actor shadows** lean further and stretch longer with distance from the
  torch, and pinch across the light as they lengthen, which is what a long
  shadow actually does and what a plain scale-up does not. Nothing at your feet
  moves; only the far end of the curve changed.

A test asserts the Low tier gained no new work, so a later change that gives it
something to do has to come and argue with it first.

## The Hall of Fame

Fifty names, kept locally. Each row carries the name, score, depth, great foes,
kills, secrets, mercy, mode, the relic path the run took, the date, the seed
and the build it was played on. The internal shape is still a flat CSV table --
compact, and extensible one column at a time, which is how `mercy` was added
without migrating anything -- but it is no longer a format anybody is handed.

The table is stored through a **reversible scramble**: a salted xorshift
keystream over the UTF-8 bytes, with an FNV-1a checksum travelling alongside,
Base64'd and tagged `tb1:`. Anything that does not decode and check out is
discarded rather than half-believed, so a hand-edited board costs the editor
their own names and nothing else. A table written before the scramble existed
has no tag and is still read as-is, then put away in the new form on the next
write.

**This is not encryption and cannot be.** The key ships in the bundle, four
lines below the comment saying so. It is a speed bump: the board is no longer a
text field in the developer tools waiting to be typed a better score into by
anyone who opens them out of curiosity. Anybody determined enough to read this
paragraph can still beat it, and that is fine -- it is their hall.

Export and Import used to sit on the hall screen and were removed for the same
reason: the fastest route to the top of the board was a text editor and a
re-import. **Clear the hall** is the only thing that can still be done to it
from outside a run.

Writing is safe against a second tab: every write re-reads the stored table
and merges into it rather than overwriting, under an advisory timestamped lock
so a tab that dies mid-write cannot wedge the hall shut. Each run is
fingerprinted on name, score, depth, mode, date and seed, so a merge can never
land the same run twice.

There is no global board. GitHub Pages serves static files, so a player's
browser has nothing to write to and a file kept out of the repository cannot
be read by the deployed game either. The hall is yours, on your machine.

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

It also pins the difficulty modes: that each one actually reaches the enemy
health, enemy damage, torch radius and detection range it claims to change,
that its multipliers survive a relic recompute without stacking, and that no
mode offering a retry can also claim a place on the board.

It also pins the control mapping: each direction key is measured against the
compass direction it is supposed to walk, with the drift-free guarantee
checked against a deliberately walled-off direction, the screen-relative frame
checked separately, and the doorway assist checked both for finding an opening
one tile off the line and for refusing to shunt the player round a pillar.

It also pins the newer systems: that sound will not cross a wall and that a
dog-leg costs more than a straight run of the same length and says so; that a
noise pulls an unaware creature off its post and that it gives up again; that
dousing the torch costs sight and buys hearing; that a cold fire needs a lit
torch; that blood is left where things bleed and carried a few tiles on the
boots; that a map scrap marks one real thing without lighting the road to it;
that killing a captive who did not ask for it costs and that mercy does not;
that an altar never asks for something the player cannot pay, across a sweep
of health and score states; and that the hall of fame round-trips through CSV
without losing a name with a comma in it.

It also pins the update check, which is the one piece of the game that can
close the window on a player: that only a build plainly different from the
running one is worth reloading for, that every unclear answer -- offline, no
answer, an empty build string -- lands somewhere that does not reload, and
that a build which will not take is given up on after two attempts rather than
reloaded for forever.

**Balance curve** -- plays whole descents and reports clear rate, health lost
and time taken per depth. Not pass/fail: it is there to be looked at when
tuning, and to catch a depth turning into a wall.

It finishes with an **autopilot completability test**: a pathfinding bot plays
24 generated levels across depths 1-14 from entrance to exit, routing to each
key, unlocking each gate, fighting its way out of rooms that seal behind it,
and taking the stairs. It is the practical counterpart to the validator -- the
validator proves a route exists, the bot walks it.

Current status: 110/110 passing.

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
