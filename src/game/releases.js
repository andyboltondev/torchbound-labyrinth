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
    version: '1.3.0',
    codename: 'Wayfinding',
    // No stamp of its own yet: this is the version being played, so the
    // screen fills these in from the running build rather than guessing.
    build: null,
    date: null,
    pr: 8,
    headline: 'Things you could not find, reach or read.',
    sections: [
      {
        title: 'Added',
        notes: [
          'A full map on M, or a tap on the minimap. Drag to pan, scroll or pinch to zoom, and a legend of everything found on the depth and how many of each.',
          'An illustrated guide before your first descent: the keys drawn as key caps with their compass bearings, or the touch pad with the diamond and stick offered side by side. It has a "do not show again" box, and Settings can bring it back.',
          'Seeds. Type or paste one in before you start and you get that labyrinth; copy yours from the pause screen and hand it to somebody else.',
          'These release notes, reachable from the build number at the foot of the home and pause screens.',
          'A Report a bug button that opens a prefilled issue with your build, seed, depth and mode already filled in.',
        ],
      },
      {
        title: 'Fixed',
        notes: [
          'The touch buttons were sitting on top of the minimap. It now measures what the pad has reserved and stays clear of it.',
          'The controls were listed by hand in three places and all three had drifted. There is one list now, and none of them had ever mentioned the torch.',
          'Button labels were Title Case on the older screens and sentence case on the newer ones.',
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
