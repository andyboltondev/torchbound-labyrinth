// Difficulty modes.
//
// The spec describes one labyrinth; these are three ways to walk into it.
// Every mode is expressed as multipliers folded into the same `mods` object
// the relics write to (see relics.js), so nothing downstream needs to know a
// difficulty exists -- it reads `enemyHp`, `torchRadius` and the rest exactly
// as it already does.
//
// Two things are not multipliers and so live here as flags:
//   retry  -- a death offers the stair again instead of ending the run
//   ranked -- the run is eligible for the Hall of Fame
//
// A mode that cannot lose must not be able to win the hall, which is why
// Hearthlight is unranked. Ashenvow pays a score premium because otherwise
// the harder mode would be strictly worse for a name on the board.

export const DIFFICULTIES = {
  hearthlight: {
    id: 'hearthlight', name: 'Hearthlight', order: 0,
    tagline: 'Someone keeps a fire burning for you.',
    text: 'The dead swing softer and carry less iron under the skin. Fall, and '
      + 'the stair will take you down again, as many times as it takes.',
    cost: 'A descent that cannot be lost is not written into the Hall of Fame.',
    retry: true, ranked: false,
    mods: { enemyHp: 0.78, enemyDamage: 0.7 },
  },
  torchbound: {
    id: 'torchbound', name: 'Torchbound', order: 1,
    tagline: 'One flame. One way down.',
    text: 'The labyrinth exactly as it was carved: nothing softened, nothing '
      + 'sharpened. What the dark takes, it keeps.',
    cost: 'None. This is the measure everything else is set against.',
    retry: false, ranked: true,
    mods: {},
  },
  ashenvow: {
    id: 'ashenvow', name: 'Ashenvow', order: 2,
    tagline: 'You gave your fire away before you started.',
    text: 'A shorter torch, and everything below notices you sooner. The dead '
      + 'hit harder and take longer to put down.',
    cost: 'None you did not choose. Deeds are worth a fifth more, if you live '
      + 'to bank them.',
    retry: false, ranked: true,
    mods: {
      enemyHp: 1.16, enemyDamage: 1.2, enemyAggro: 1.15,
      torchRadius: 0.88, scoreMult: 1.2,
    },
  },
};

export const DIFFICULTY_LIST = Object.values(DIFFICULTIES).sort((a, b) => a.order - b.order);

export const DEFAULT_DIFFICULTY = 'torchbound';

export function difficultyById(id) {
  return DIFFICULTIES[id] || DIFFICULTIES[DEFAULT_DIFFICULTY];
}

// Folded in after computeMods() so relic stacking is still calculated from
// scratch every time and can never double-count the difficulty.
export function applyDifficulty(mods, difficulty) {
  if (!difficulty || !difficulty.mods) return mods;
  for (const [key, value] of Object.entries(difficulty.mods)) {
    mods[key] = (mods[key] === undefined ? 1 : mods[key]) * value;
  }
  return mods;
}
