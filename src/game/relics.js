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
    boltSpeed: 1, reclaim: 0,
    secretSense: 1, revealObjectives: false, hazardFooting: false, desperation: 0,
  };
}

const T = {
  TORCH: 'Torch', SWORD: 'Sword', BOW: 'Crossbow', SHIELD: 'Defence',
  EXPLORE: 'Exploration', SCORE: 'Score', BODY: 'Body',
};

export const RELICS = [
  {
    id: 'everburning_brand', name: 'Everburning Brand', tag: T.TORCH, rarity: 1, max: 2,
    text: 'Your torch burns wider and further.',
    cost: 'The dead notice it from further away too.',
    mod: (m, n) => { m.torchRadius *= 1 + 0.3 * n; m.enemyAggro *= 1 + 0.22 * n; },
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
    cost: 'None. Living long enough to use it is the cost.',
    mod: (m) => { m.desperation = 0.6; },
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
    cost: 'None. It simply does not save you every time.',
    mod: (m) => { m.shield = true; },
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
    cost: 'None.',
    requires: (run) => run.hp < run.maxHp,
    mod: (m) => { m.healing *= 1.6; m.levelHeal *= 1.3; },
    onTake: (run) => run.heal(30, true),
  },
  {
    id: 'ember_ward', name: 'Ember Ward', tag: T.BODY, rarity: 2, max: 1,
    text: 'Mud cannot drag at you and ice cannot take your footing.',
    cost: 'None. It is simply narrow.',
    requires: (run) => run.seenHazards.has('mud') || run.seenHazards.has('ice'),
    mod: (m) => { m.hazardFooting = true; },
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
    cost: 'None.',
    mod: (m, n) => { m.secretSense *= 1 + 0.8 * n; },
  },
  {
    id: 'quiver_hunt', name: 'Quiver of the Hunt', tag: T.BOW, rarity: 1, max: 3,
    text: 'You can carry three more bolts, and you find three now.',
    cost: 'None.',
    requires: (run) => run.hasCrossbow,
    mod: (m, n) => { m.crossbowCapacity += 3 * n; },
    onTake: (run) => run.giveArrows(3),
  },
  {
    id: 'extended_limbs', name: 'Extended Limbs', tag: T.BOW, rarity: 2, max: 2,
    text: 'Longer limbs, longer reach.',
    cost: 'None.',
    requires: (run) => run.hasCrossbow,
    mod: (m, n) => { m.crossbowRangeBonus += 2.5 * n; },
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
    text: 'A bolt that kills has a 30% chance of returning to your quiver.',
    cost: 'None.',
    requires: (run) => run.hasCrossbow,
    mod: (m) => { m.reclaim = 0.3; },
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
