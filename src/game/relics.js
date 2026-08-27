// Relics.
//
// Two rules shape this file. First, every modifier is recomputed from the
// full relic list rather than applied incrementally, so stacking can never
// double-count. Second, a relic is only ever offered when it can actually do
// something for the player right now -- crossbow upgrades stay out of the
// pool until the crossbow is in hand (design rules 12 and 13).

export function baseMods() {
  return {
    torchRadius: 1, torchInstability: 1, memoryDecay: 1,
    swordDamage: 1, swordRange: 1, attackSpeed: 1,
    moveSpeed: 1, maxHpBonus: 0, damageTaken: 1,
    healing: 1, levelHeal: 1, lifesteal: 0, lifestealAmount: 0,
    shield: false, streakWindow: 3.5,
    enemyAggro: 1, enemySpeed: 1, enemyHp: 1, enemyDamage: 1,
    timeBonus: 1, scoreMult: 1,
    crossbowDamage: 1, crossbowRangeBonus: 0, crossbowCapacity: 0,
    boltSpeed: 1, boltRate: 1, reclaim: 0,
    secretSense: 1, revealObjectives: false, hazardFooting: false, desperation: 0,
    // How far the player's ears reach, how far their own noise carries, and
    // whether they can see what they hear.
    hearing: 1, playerNoise: 1, sonar: false,
    // How steeply an altar charges, and how much it gives back.
    sacrificeScale: 1, rewardScale: 1,
  };
}

// Which way is up for every modifier: +1 where a bigger number helps the
// player, -1 where it hurts them. Authored here, next to the relics, because
// it is what makes "every relic costs something" a rule the tests can check
// rather than a promise in the prose -- a relic that only moves numbers in
// its own favour fails, whatever its cost line says.
export const MOD_BETTER = {
  torchRadius: 1, torchInstability: -1, memoryDecay: -1,
  swordDamage: 1, swordRange: 1, attackSpeed: 1,
  moveSpeed: 1, maxHpBonus: 1, damageTaken: -1,
  healing: 1, levelHeal: 1, lifesteal: 1, lifestealAmount: 1,
  shield: 1, streakWindow: 1,
  enemyAggro: -1, enemySpeed: -1, enemyHp: -1, enemyDamage: -1,
  timeBonus: 1, scoreMult: 1,
  crossbowDamage: 1, crossbowRangeBonus: 1, crossbowCapacity: 1,
  boltSpeed: 1, boltRate: 1, reclaim: 1,
  secretSense: 1, revealObjectives: 1, hazardFooting: 1, desperation: 1,
  hearing: 1, playerNoise: -1, sonar: 1,
  sacrificeScale: -1, rewardScale: 1,
};

const T = {
  TORCH: 'Torch', SWORD: 'Sword', BOW: 'Crossbow', SHIELD: 'Defence',
  EXPLORE: 'Exploration', SCORE: 'Score', BODY: 'Body', SOUND: 'Hearing',
  ALTAR: 'Bargains',
};

export const RELICS = [
  {
    id: 'everburning_brand', name: 'Everburning Brand', tag: T.TORCH, rarity: 1, max: 2,
    text: 'Your torch burns wider and further.',
    cost: 'The dead notice it from further away too.',
    mod: (m, n) => { m.torchRadius *= 1 + 0.3 * n; m.enemyAggro *= 1 + 0.22 * n; },
  },
  {
    id: 'bloodless_bargain', name: 'Bloodless Bargain', tag: T.ALTAR, rarity: 2, max: 1,
    text: 'Altars ask a good deal less of you.',
    cost: 'A cheap offering is remembered. You recover far less on the stair, '
      + 'so what the altar spared you is taken back on the way down.',
    mod: (m) => { m.sacrificeScale *= 0.6; m.levelHeal *= 0.5; },
  },
  {
    id: 'gilded_debt', name: 'Gilded Debt', tag: T.ALTAR, rarity: 3, max: 1,
    text: 'What an altar gives you, it gives generously: healing runs deeper, '
      + 'a chart comes with its keys, and the way down comes with the treasure.',
    cost: 'And it charges accordingly.',
    mod: (m) => { m.rewardScale *= 1.5; m.sacrificeScale *= 1.3; },
  },
  {
    id: 'deep_ear', name: 'Ear of the Deep', tag: T.SOUND, rarity: 2, max: 2,
    text: 'You hear the labyrinth much further off, and round more corners.',
    cost: 'Listening that hard means standing still enough to be found. '
      + 'Your own footfalls carry as far as what you are listening to.',
    mod: (m, n) => { m.hearing *= 1 + 0.45 * n; m.playerNoise *= 1 + 0.3 * n; },
  },
  {
    id: 'wolfskin_soles', name: 'Wolfskin Soles', tag: T.SOUND, rarity: 2, max: 1,
    text: 'You walk quietly. Things have to see you to find you.',
    cost: 'Soft soles are slow soles.',
    mod: (m) => { m.playerNoise *= 0.45; m.moveSpeed *= 0.9; },
  },
  {
    id: 'whisper_stone', name: 'Whisper-Stone', tag: T.SOUND, rarity: 3, max: 1,
    text: 'What you hear, you also see: a pulse on the map where the sound '
      + 'came from, and how far round the corners it had to come.',
    cost: 'The stone hums. Everything down here can hear it too.',
    mod: (m) => { m.sonar = true; m.playerNoise *= 1.35; },
  },
  {
    id: 'cartographers_thread', name: "Cartographer's Thread", tag: T.EXPLORE, rarity: 2, max: 1,
    text: 'What you have seen stays with you far longer.',
    cost: 'Your torch burns lower.',
    mod: (m) => { m.memoryDecay *= 0.3; m.torchRadius *= 0.82; },
  },
  {
    id: 'torchbearers_pact', name: "Torchbearer's Pact", tag: T.TORCH, rarity: 2, max: 1,
    text: 'The flame holds steady. Rain barely touches it.',
    cost: 'A steady flame is a beacon.',
    mod: (m) => { m.torchInstability *= 0.3; m.torchRadius *= 1.08; m.enemyAggro *= 1.15; },
  },
  {
    id: 'sanguine_edge', name: 'Sanguine Edge', tag: T.SWORD, rarity: 2, max: 1,
    text: 'Sword kills have a 30% chance to return blood to you.',
    cost: 'Every other source of healing works far less well.',
    mod: (m) => { m.lifesteal = 0.3; m.lifestealAmount = 9; m.healing *= 0.55; },
  },
  {
    id: 'glassblade_oath', name: 'Glassblade Oath', tag: T.SWORD, rarity: 2, max: 1,
    text: 'Your sword bites far deeper.',
    cost: 'So does everything that hits you.',
    mod: (m) => { m.swordDamage *= 1.55; m.damageTaken *= 1.4; },
  },
  {
    id: 'whetstone_vigil', name: 'Whetstone of Vigil', tag: T.SWORD, rarity: 1, max: 2,
    text: 'You swing noticeably faster.',
    cost: 'Each blow lands a little lighter.',
    mod: (m, n) => { m.attackSpeed *= 1 + 0.26 * n; m.swordDamage *= Math.pow(0.9, n); },
  },
  {
    id: 'wolfs_hunger', name: "Wolf's Hunger", tag: T.SWORD, rarity: 2, max: 1,
    text: 'Below a third of your health, your blows land with real fury.',
    cost: 'You fight past your own guard. Everything lands harder on you, '
      + 'whatever your health -- including on the way down to the third that '
      + 'pays out.',
    mod: (m) => { m.desperation = 0.75; m.damageTaken *= 1.12; },
  },
  {
    id: 'bell_of_the_hunt', name: 'Bell of the Hunt', tag: T.SCORE, rarity: 2, max: 1,
    text: 'Your kill streak holds for much longer.',
    cost: 'The labyrinth answers in kind: everything moves faster.',
    mod: (m) => { m.streakWindow += 2.5; m.enemySpeed *= 1.15; },
  },
  {
    id: 'ashen_hourglass', name: 'Ashen Hourglass', tag: T.SCORE, rarity: 2, max: 1,
    text: 'Time bonuses are worth roughly double.',
    cost: 'You recover far less between depths.',
    mod: (m) => { m.timeBonus *= 2; m.levelHeal *= 0.4; },
  },
  {
    id: 'skalds_tally', name: "Skald's Tally", tag: T.SCORE, rarity: 1, max: 2,
    text: 'Every deed is worth more when it is sung about.',
    cost: 'Songs are for the bold. You take more punishment.',
    mod: (m, n) => { m.scoreMult *= 1 + 0.22 * n; m.damageTaken *= 1 + 0.13 * n; },
  },
  {
    id: 'aegis_drowned', name: 'Aegis of the Drowned', tag: T.SHIELD, rarity: 3, max: 1,
    text: 'A drowned shield turns blows aside: 1% ricochets back, 5% blocked outright, 20% blunted.',
    cost: 'It came up full of water and it never dried. You walk and swing '
      + 'slower carrying it.',
    mod: (m) => { m.shield = true; m.moveSpeed *= 0.93; m.attackSpeed *= 0.9; },
  },
  {
    id: 'grave_ward', name: 'Grave-Ward Charm', tag: T.SHIELD, rarity: 1, max: 2,
    text: 'Wounds bite less deeply.',
    cost: 'Caution is worth fewer points.',
    mod: (m, n) => { m.damageTaken *= Math.pow(0.86, n); m.scoreMult *= Math.pow(0.94, n); },
  },
  {
    id: 'ironhide_wrap', name: 'Ironhide Wrap', tag: T.BODY, rarity: 1, max: 3,
    text: 'Bound hide and bone. You can take more.',
    cost: 'And you carry it, so you move a little slower.',
    mod: (m, n) => { m.maxHpBonus += 25 * n; m.moveSpeed *= Math.pow(0.94, n); },
  },
  {
    id: 'runed_boots', name: 'Runed Boots', tag: T.BODY, rarity: 1, max: 2,
    text: 'You move markedly faster.',
    cost: 'Lighter boots, lighter bones.',
    requires: (run) => run.maxHp > 55,
    mod: (m, n) => { m.moveSpeed *= 1 + 0.14 * n; m.maxHpBonus -= 8 * n; },
  },
  {
    id: 'draught_hall', name: 'Draught of the Hall', tag: T.BODY, rarity: 1, max: 1,
    text: 'Mends you now, and makes every later remedy work better.',
    cost: 'It is strong drink. Your hand is less steady on the brand, and the '
      + 'flame gutters for it.',
    requires: (run) => run.hp < run.maxHp,
    mod: (m) => { m.healing *= 1.7; m.levelHeal *= 1.3; m.torchInstability *= 1.4; },
    onTake: (run) => run.heal(30, true),
  },
  {
    id: 'ember_ward', name: 'Ember Ward', tag: T.BODY, rarity: 2, max: 1,
    text: 'Mud cannot drag at you and ice cannot take your footing.',
    cost: 'It runs hot in the hand, and the dark notices heat.',
    requires: (run) => run.seenHazards.has('mud') || run.seenHazards.has('ice'),
    mod: (m) => { m.hazardFooting = true; m.enemyAggro *= 1.16; },
  },
  {
    id: 'seers_eye', name: "Seer's Eye", tag: T.EXPLORE, rarity: 2, max: 1,
    text: 'Keys and stairs mark themselves on your map as each level begins.',
    cost: 'The vision costs you some of your flame.',
    mod: (m) => { m.revealObjectives = true; m.torchRadius *= 0.9; },
  },
  {
    id: 'bone_reader', name: 'Bone Reader', tag: T.EXPLORE, rarity: 1, max: 2,
    text: 'You notice cracked stone from much further away.',
    cost: 'Your ear is on the wall rather than on the passage. You hear much '
      + 'less of what is coming.',
    mod: (m, n) => { m.secretSense *= 1 + 0.9 * n; m.hearing *= Math.pow(0.78, n); },
  },
  {
    id: 'quiver_hunt', name: 'Quiver of the Hunt', tag: T.BOW, rarity: 1, max: 3,
    text: 'You can carry three more bolts, and you find three now.',
    cost: 'A full quiver is a heavy one, and it rattles. You are slower, and '
      + 'easier to hear behind you.',
    requires: (run) => run.hasCrossbow,
    mod: (m, n) => {
      m.crossbowCapacity += 3 * n;
      m.moveSpeed *= Math.pow(0.98, n);
      m.playerNoise *= 1 + 0.15 * n;
    },
    onTake: (run) => run.giveArrows(3),
  },
  {
    id: 'extended_limbs', name: 'Extended Limbs', tag: T.BOW, rarity: 2, max: 2,
    text: 'Longer limbs, longer reach.',
    cost: 'A heavier draw. You are markedly slower to get the next bolt away.',
    requires: (run) => run.hasCrossbow,
    mod: (m, n) => { m.crossbowRangeBonus += 3 * n; m.boltRate *= Math.pow(0.85, n); },
  },
  {
    id: 'heavy_bolt', name: 'Heavy Bolt', tag: T.BOW, rarity: 2, max: 2,
    text: 'Bolts hit far harder.',
    cost: 'They fly slower, so leading a moving target matters.',
    requires: (run) => run.hasCrossbow,
    mod: (m, n) => { m.crossbowDamage *= 1 + 0.45 * n; m.boltSpeed *= Math.pow(0.84, n); },
  },
  {
    id: 'reclaimer', name: 'Reclaimer', tag: T.BOW, rarity: 3, max: 1,
    text: 'A bolt that kills has a 35% chance of returning to your quiver.',
    cost: 'A bolt pulled back out of something never flies quite the same '
      + 'again. All of yours hit softer.',
    requires: (run) => run.hasCrossbow,
    mod: (m) => { m.reclaim = 0.35; m.crossbowDamage *= 0.85; },
  },
];

export const RELIC_BY_ID = Object.fromEntries(RELICS.map((r) => [r.id, r]));
export const RELIC_TAGS = T;

// --- modifier resolution --------------------------------------------------

export function computeMods(relicCounts) {
  const m = baseMods();
  for (const [id, count] of Object.entries(relicCounts)) {
    const relic = RELIC_BY_ID[id];
    if (!relic || count <= 0) continue;
    relic.mod(m, count);
  }
  // Guard rails so no stack can produce a nonsensical value.
  m.torchRadius = Math.max(0.45, m.torchRadius);
  m.moveSpeed = Math.max(0.5, m.moveSpeed);
  m.attackSpeed = Math.max(0.5, m.attackSpeed);
  m.damageTaken = Math.max(0.35, m.damageTaken);
  return m;
}

// --- offers ---------------------------------------------------------------
// Filters first, then weights. Anything that cannot function, is already
// maxed, or would be a dead pick is simply never shown.

export function eligibleRelics(run) {
  return RELICS.filter((r) => {
    const owned = run.relics[r.id] || 0;
    if (owned >= r.max) return false;
    if (r.requires && !r.requires(run)) return false;
    return true;
  });
}

export function offerRelics(run, rng, count = 3) {
  const pool = eligibleRelics(run);
  const picks = [];
  const chosen = new Set();
  // Spread the offer across categories so a choice is a real decision rather
  // than three flavours of the same build.
  const tagsUsed = new Set();
  for (let attempt = 0; attempt < 60 && picks.length < count; attempt++) {
    const candidates = pool.filter((r) => !chosen.has(r.id) &&
      (attempt > 24 || !tagsUsed.has(r.tag)));
    if (!candidates.length) break;
    const relic = rng.weighted(candidates, (r) => {
      let w = r.rarity === 1 ? 3.2 : r.rarity === 2 ? 1.8 : 0.8;
      // A relic that matches the build the player is already assembling is
      // slightly more likely, so builds actually come together.
      if (run.buildAffinity && run.buildAffinity[r.tag]) w *= 1 + run.buildAffinity[r.tag] * 0.35;
      if ((run.relics[r.id] || 0) > 0) w *= 0.8;
      return w;
    });
    picks.push(relic);
    chosen.add(relic.id);
    tagsUsed.add(relic.tag);
  }
  return picks;
}

export function describeBuild(relicCounts) {
  const tally = {};
  for (const [id, n] of Object.entries(relicCounts)) {
    const r = RELIC_BY_ID[id];
    if (!r || n <= 0) continue;
    tally[r.tag] = (tally[r.tag] || 0) + n;
  }
  const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return 'Torchbearer';
  const [top, count] = ranked[0];
  if (count < 2) return 'Torchbearer';
  const names = {
    Sword: 'Warrior', Crossbow: 'Ranger', Exploration: 'Explorer',
    Defence: 'Survivor', Score: 'Score Hunter', Torch: 'Firekeeper', Body: 'Bulwark',
  };
  const second = ranked[1];
  if (second && second[1] >= count) return `${names[top] || top} / ${names[second[0]] || second[0]}`;
  if (tally.Sword >= 2 && tally.Score >= 1) return 'Berserker';
  return names[top] || top;
}
