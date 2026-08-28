// What changed, and when.
//
// Hand-written rather than generated from git, because a changelog is for
// players: it says what is different to play, not what moved in the source.
// Newest first.
//
// Everything before 1.2.0 predates the build stamp. Those numbers and
// timestamps have been reconstructed from the merge that shipped each one, so
// they are honest about *when* even though no build ever printed them at the
// time -- and they are marked `reconstructed` so the screen can say so rather
// than pretending.

export const RELEASES = [
  {
    version: '1.4.0',
    codename: 'Grindstone',
    // No stamp of its own yet: this is the version being played, so the
    // screen fills these in from the running build rather than guessing.
    build: null,
    date: null,
    pr: 12,
    headline: 'Walls that move, walls that let things in, and a score that is listening.',
    sections: [
      {
        title: 'Added',
        notes: [
          'Slabs. A piece of the wall that is not one, given away by the grooves worn into the floor beside it. Take hold and back away and it grinds out of its bed a tile at a time -- slowly, only as far as the grooves go, and what it was standing over is worth the work.',
          'Breaches. Holes in external walls, and in walls with nothing but rock behind them, that small things come through. A cleared corridor is not a corridor you own any more.',
          'You hear a breach before you see it: a scrabbling at the stone, pitched off the voice of whatever is forcing itself through, and then several seconds of it squeezing out of the gap while it can do nothing about you and you can do everything about it.',
          'Everything that dies now says so, in its own voice. Ten timbres, three shapes apiece, so a corridor of thralls does not go down in unison.',
          'Captives who are not raving are no longer silent. One that is afraid whimpers; one that is begging weeps, quietly enough that you have to walk past it to hear it.',
          'A person killed in the labyrinth sounds like a person, and the whole depth hears it.',
          'Stone dragged over stone makes the noise it should, for exactly as long as it is moving.',
        ],
      },
      {
        title: 'Changed',
        notes: [
          'Walking round a corner no longer lights the ground on the far side of the wall you just came round. The field of view casts its shadows from the edges of the stone, as it always did, but only shows a tile once its own centre is inside the light.',
          'A stone the size of a person is now as opaque as the wall it was cut from. What one is guarding is dark until it is out of the way, rather than plainly visible through a block of granite.',
          'Holding Act keeps your grip on a stone or a slab; a tap still latches it. A held stone no longer slips out of your hands after a single tile.',
          'With a stone in your hands you face the stone. Walking sideways or backing away from it does not spin you round any more.',
          'You walk at the stone’s pace while you have hold of it, and a slab is slower again. Shouldering one along without taking hold is slower still: there is no purchase in that, only weight.',
          'The score moves. It walks through movements with their own harmony and their own drum rather than looping one figure, it hears trouble arriving several times faster than it hears it leaving, and being chased, being hurt and putting your torch out all reach it.',
          'The Hall of Fame has a tune of its own now: one reed voice over a slow bell, played alone, and it does not resolve.',
          'Large displays get a bigger view of the labyrinth rather than a wider field of dark, a chart in the corner that scales with them, and panels that use the width they have.',
        ],
      },
    ],
  },
  {
    version: '1.3.0',
    codename: 'Wayfinding',
    // Stamped from the build that shipped it, now that it is no longer the
    // version being played. This is the second stamp 1.3.0 carried: the
    // self-updating build re-shipped it rather than taking a number of its
    // own, so that is the one a screenshot of it would show.
    build: '20260828-062938',
    date: '2026-08-28',
    pr: 8,
    headline: 'Things you could not find, reach or read.',
    sections: [
      {
        title: 'Added',
        notes: [
          'Captives you cut loose no longer vanish. They come off the wall, fold up, and drag themselves to the nearest corner, and they are still there when you come back past.',
          'Some captives ask to die, and mean it. Granting it with the sword costs nothing. Freeing them instead is a decision, and once in a while it is answered.',
          'A mercy tally, carried onto the Hall of Fame: one up for every captive freed or given what they asked for, one down for every one killed who never asked. It is the only number on that board that is not a measure of how good you were.',
          'Stones that move. Shoulder one aside and there is a pocket cut into the wall behind it. Take hold of one with Act and it comes with you when you back away, so a stone shifted into a doorway is a stone you can shift back out of it.',
          'Claw marks, footprints and dragged dirt. The labyrinth was being used before you got here, and now it looks like it -- and the marks lean, very slightly, towards what is worth finding.',
          'The Gravebound: buried standing, facing the passage. No sound, no shape, nothing at all until you are almost on top of one, and then it is out of the floor and swinging. It leaves the hole behind it.',
          'Holes in the floor with nothing underneath them. Once you have met one Gravebound, every hole is a question, and most of the answers are nothing.',
          'It installs. Chrome, Edge and the like will offer to keep Torchbound Labyrinth on the device as an application of its own -- its own icon, its own window, no address bar -- and there is an Install button beside the build number for when the browser does not say so itself. On a phone, Add to Home Screen gives the same thing.',
          'An icon of its own, at every size a browser or a home screen asks for: a square spiral with the torch burning at the middle of it. The small ones are drawn with fewer turns rather than being the big one shrunk, because a sixteen-pixel tab icon has about four pixels of detail to spend.',
          'The game plays offline. The first visit keeps a copy of it on your device, and after that it starts with no connection at all -- on a train, on a plane, on a phone with one bar.',
          'It updates itself, and no longer waits until next time to do it. Opening the game asks what the current build is, and if yours is not it, the new one comes down and the game reloads onto it right there at the menu -- a second, once, and then you are playing the version that shipped. The first load afterwards says so, with a link to what changed, and then never mentions it again.',
          'A Check for updates button beside the build number, for when you have heard something shipped and do not want to wait for the game to notice. It tells you what it found either way, including "this is the current build", which is usually the answer.',
          'A full map on M, or a tap on the minimap. Drag to pan, scroll or pinch to zoom, and a legend of everything found on the depth and how many of each.',
          'An illustrated guide before your first descent: the keys drawn as key caps with their compass bearings, or the touch pad with the diamond and stick offered side by side. It has a "do not show again" box, and Settings can bring it back.',
          'Seeds. Type or paste one in before you start and you get that labyrinth; copy yours from the pause screen and hand it to somebody else.',
          'These release notes, reachable from the build number at the foot of the home and pause screens.',
          'A Report a bug button that opens a prefilled issue with your build, seed, depth and mode already filled in.',
          'The opening guide now says what the game is and what a depth wants before it says which button does what: find the keys, open the gates, take the stairs down.',
          'A Map button in the corner beside Bestiary and Pause. The corner chart was always tappable, but only if you already knew it was.',
          'The seed field has moved below the three modes and folded itself away. It is still there, still optional, and leaving it shut still gives you a labyrinth nobody has seen.',
        ],
      },
      {
        title: 'Changed',
        notes: [
          'An update will never reload the game out from under a descent. Mid-run it comes down and then waits, and the pause menu offers to spend the run on it -- which is your decision, not the version number\'s.',
          'Relic descriptions were running to three lines apiece. They are one line now, and blunter for it -- a paragraph between you and a choice made against the clock is a paragraph nobody reads.',
          'Shadows lean further and stretch longer the further you are from your torch, corners of stonework read as corners rather than as two shades of the same wall, and the masonry is cut with a deeper bevel. All of it is either baked once per depth or the same draw with different arithmetic in it, so the cheapest quality setting does no more work than it did.',
          'Creatures are heard from half again as far, and a screaming captive from most of a depth away. A groan used to reach about as far as your torch did, so the warning and the thing it warned about arrived together.',
          'Sound carries further without getting louder. Reaching further used to mean lifting the whole curve, so a groan two tiles off would have come out louder than before; the curve steepens as it lengthens instead, and the near field is exactly where it was.',
          'A scream still calls the same creatures from the same distance -- how far it draws from is a balance question, not an audio one -- and no longer tightens the music when there is a shut gate between the two of you.',
          'The Hall of Fame is no longer exportable or importable as a file. The quickest route to the top of the board was a text editor and a re-import, which is not a route to the top of anything. Clear the hall is the only thing that can still be done to it from outside a run.',
          'The board is stored scrambled now rather than as plain text, with a checksum riding along, so a table that has been edited by hand is thrown away instead of believed. This is a speed bump and not a lock: the key ships with the game and the README says so plainly.',
        ],
      },
      {
        title: 'Fixed',
        notes: [
          'The depth summary printed a blood debt as "+-680". It shows -680, in red, like the thing it is.',
          'Pressing into a stone standing in a one-tile passage walked you sideways instead of shoving it. The nudge that lines you up with a doorway you are standing one tile short of was treating the stone as the wall it was cut from, and quietly spending the press on a sidestep.',
          'A stone could be walked into a doorway and jammed against the wall behind it, sealing off the rest of the depth with you on the wrong side and no way back. The generator now proves that no stone on a depth can be driven anywhere that strands it, by either verb, before the depth is ever handed to you.',
          'Killing a captive who was screaming was written up on the score sheet as somebody who had said nothing.',
          'A scream from a captive behind a shut gate still tightened the music, as though you had heard it.',
          'The touch buttons were sitting on top of the minimap. It now measures what the pad has reserved and stays clear of it.',
          'The controls were listed by hand in three places and all three had drifted. There is one list now, and none of them had ever mentioned the torch.',
          'Button labels were Title Case on the older screens and sentence case on the newer ones.',
          'The red line under each mode on the descent screen was doing three different jobs: a real price on Hearthlight, the word "None" on Torchbound, and a score bonus dressed as a warning on Ashenvow. It now only appears when the mode charges something the description does not already state, and Ashenvow\'s bonus is written plainly as a gain.',
          'The touch movement pad is a wider diamond now, leaning the way the corridors are actually drawn instead of sitting square. The arrows were already aimed down each corridor and still are.',
          'The home screen fits on a phone. It was carrying the whole control table and a paragraph about it, which is most of what you were scrolling past to reach the start button; it carries one line now, and gives up the flavour text and the tail of the hall as the screen gets shorter.',
          'Settings drew the controls as a plain two-column list while the opening guide drew them properly. Both are the guide\'s version now.',
          'The map takes the whole screen on a phone instead of sitting in a panel inside it. Zoom floats on the chart, and the legend folds away.',
        ],
      },
    ],
  },
  {
    version: '1.2.0',
    codename: 'Deeper Dark',
    build: '20260827-055619',
    date: '2026-08-27',
    pr: 7,
    headline: 'The labyrinth gets a second sense, a chart worth keeping, and '
      + 'a great deal more living in it.',
    sections: [
      {
        title: 'You can hear it now',
        notes: [
          'Sound travels along open ground instead of straight through stone. It fades with the distance it actually covered, loses its edge and gains echo at every corner it turns, and arrives from the mouth of the corner rather than through the wall.',
          'Every kind of creature has its own voice and its own carrying distance, and only speaks when you cannot already see it.',
          'A crossbow bolt clattering off stone is heard by anything that has not spotted you, and it walks over to look. Bolts are a way past things now, not only a way through them.',
          'Creatures see a wedge rather than a circle, each archetype its own, with a little hearing behind it. Getting round behind something is a real option.',
        ],
      },
      {
        title: 'Fire and dark',
        notes: [
          'Braziers, firepits and campfires stand in the larger halls and throw real light. About a third have gone out; you can light those, and they stay lit.',
          'Your own torch can be put out with T or Q. You go nearly blind, your hearing sharpens, and most of what hunts you loses your trail -- but the things that prefer the dark get better at finding you.',
          'Every flame flickers on its own clock, so a row of them never pulses together.',
        ],
      },
      {
        title: 'Somebody else got here first',
        notes: [
          'Captives chained to the walls, in four states you can tell apart from across the room. The ones who will talk know where something is. The ones who are raving scream, and screaming brings company.',
          'They can be killed. Doing it to one who did not ask costs you dearly and is itemised on the summary as a blood debt. One who asked, and was listened to first, is mercy instead.',
          'Map scraps name one thing each -- the stairs, the next key, a hollow wall, treasure, something to drink -- and mark it without lighting the road to it.',
          'Sacrifice altars: three offers, each pairing an answer with a price of the same size. Blood, points, an ambush, or every mark on your chart.',
        ],
      },
      {
        title: 'Seeing and being seen',
        notes: [
          'The torchbearer is rebuilt: mail, pauldrons, a fur mantle, and all eight directions now read differently. From half health down the figure hunches, limps, bleeds through and starts to sway.',
          'The minimap keeps everything you have found instead of forgetting it, shows the direction you are actually facing, marks every stair, key, gate, ladder, chest, shrine, captive and altar you have seen, and draws the sight wedge of anything you can see.',
          'Mice, spiders, bats and beetles live in the walls. Blood, bodies and bloody footprints stay where you left them.',
        ],
      },
      {
        title: 'Around the game',
        notes: [
          'The Hall of Fame holds fifty names and can be exported and imported as a CSV file.',
          'Music runs from the menu to the run and back with no seams, and has its own voice in each place.',
          'Every relic and every altar offer now costs something. Eight relics used to be free.',
          'The build number is shown at the foot of the home screen and the pause menu.',
        ],
      },
      {
        title: 'Fixed',
        notes: [
          'Changing direction while moving took up to a tile before the character turned, and an about-face never resolved at all.',
          'Pressing into the stone beside a doorway did nothing; it now steps you into the doorway.',
          'A secret closet could tunnel into the vault strip below the maze, making a vault walkable and its ladder pointless.',
        ],
      },
    ],
  },
  {
    version: '1.1.2',
    codename: 'Hearthlight',
    build: '20260826-184648',
    date: '2026-08-26',
    pr: 6,
    reconstructed: true,
    headline: 'Three things that would not let go, and a fire that could not kill.',
    sections: [
      {
        title: 'Fixed',
        notes: [
          'Burning could bring you to nothing and leave you standing there. Damage over time now ends a run the way everything else does.',
          'A sealed encounter room could stay sealed forever if the fight could not resolve. The doors open on their own after a while, without paying out the bonus.',
          'A death throe playing out could reach into the next depth after the player had already descended.',
          'The music left a noise source and an oscillator running silently in the graph after every finished run.',
        ],
      },
    ],
  },
  {
    version: '1.1.1',
    codename: 'Hearthlight',
    build: '20260826-181359',
    date: '2026-08-26',
    pr: 5,
    reconstructed: true,
    headline: 'Boss depths crashed on entry, and the test page was hiding it.',
    sections: [
      {
        title: 'Fixed',
        notes: [
          'Every boss depth threw on load and dropped you back to a blank screen.',
          'The test page had been passing because of a global it set for itself, so the suite could not see the crash the game could.',
        ],
      },
    ],
  },
  {
    version: '1.1.0',
    codename: 'Hearthlight',
    build: '20260826-175919',
    date: '2026-08-26',
    pr: 3,
    reconstructed: true,
    headline: 'Difficulty modes, room acoustics, torch-lit stonework, and menus that fit a phone.',
    sections: [
      {
        title: 'Added',
        notes: [
          'Three ways down: Hearthlight, which gives you the stair back when you fall; Torchbound, the labyrinth as carved; and Ashenvow, which starts you with less flame and more attention.',
          'Rooms sound like the rooms they are. The space you are standing in is measured a few times a second and the mixer is told about the shape of it.',
          'Stonework is lit by your torch rather than tinted by it, and every tile is baked in three states.',
          'A bestiary that fills in as you meet things.',
        ],
      },
      {
        title: 'Fixed',
        notes: [
          'Arrows and thrown things pointed the way they were fired rather than the way they were travelling.',
          'The menus did not fit on a phone.',
        ],
      },
    ],
  },
  {
    version: '1.0.0',
    codename: 'First Descent',
    build: '20260826-112007',
    date: '2026-08-26',
    pr: 1,
    reconstructed: true,
    headline: 'The first version anyone else could play.',
    sections: [
      {
        title: 'Added',
        notes: [
          'A procedurally generated Norse labyrinth that is always solvable, with keys, sealed gates, staged regions and a stair down.',
          'Tile-to-tile movement that follows the corridors instead of grinding along the walls.',
          'Hidden vaults reached by ladder, secret closets behind cracked stone, and chambers that only open once a room falls quiet.',
          'Torchlight as the only light, with three states for every tile: lit, remembered, and never seen.',
          'Relics between depths, each with a stated trade-off, and a scoring system that pays for risk.',
          'A floating touch pad, and a diamond pad turned to match the isometric view.',
        ],
      },
    ],
  },
];

// Where the source lives, so the interface can link a release to the pull
// request that shipped it and can point a bug report at the right tracker.
export const REPO = 'andyboltondev/torchbound-labyrinth';

export const RELEASE_BY_VERSION = Object.fromEntries(RELEASES.map((r) => [r.version, r]));

// The release the running build belongs to, matched on the version number
// rather than the build stamp: a rebuild of the same version is still that
// release, and CI restamps on every deploy.
export function releaseFor(version) {
  return RELEASE_BY_VERSION[version] || RELEASES[0] || null;
}
