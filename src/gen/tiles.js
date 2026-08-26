// Tile vocabulary for the dungeon grid. Kept as small integers so the grid is
// a flat typed array and the validator can flood-fill it cheaply.

export const T = {
  WALL: 0,
  FLOOR: 1,
  GATE: 2,       // locked, colour-coded; blocks until the matching key is held
  STAIRS: 3,     // exit -- requires an explicit Action press
  SECRET: 4,     // breakable cracked wall hiding an optional area
  ENTRANCE: 5,
  RUBBLE: 6,     // decorative impassable pile (blocks movement and sight)
};

// Anything the player may stand on without needing a key.
export const WALKABLE = new Set([T.FLOOR, T.STAIRS, T.ENTRANCE]);
export const BLOCKS_SIGHT = new Set([T.WALL, T.SECRET, T.RUBBLE]);

export function isWalkableTile(t) { return WALKABLE.has(t); }
export function blocksSight(t) { return BLOCKS_SIGHT.has(t); }

// Gate / key colours. Index order is progression order: gate 0 is the first
// barrier the player meets. Each carries a rune so the pairing stays readable
// for colour-blind players and under heavy atmospheric tinting.
export const KEY_COLOURS = [
  { id: 'red',   name: 'Red',   hex: '#e05a3c', glow: '#ff9a72', rune: 'fehu' },
  { id: 'blue',  name: 'Blue',  hex: '#4d86d6', glow: '#93c4ff', rune: 'isa' },
  { id: 'green', name: 'Green', hex: '#4fae62', glow: '#98e8a6', rune: 'berkano' },
  { id: 'amber', name: 'Amber', hex: '#d9a441', glow: '#ffdc8a', rune: 'sowilo' },
];

export function keyColour(index) {
  return KEY_COLOURS[index % KEY_COLOURS.length];
}
