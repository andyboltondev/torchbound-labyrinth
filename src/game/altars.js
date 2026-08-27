// Sacrifice altars.
//
// A place to buy an answer with something you would rather keep. Three rules
// hold the whole system together:
//
//   1. The reward and the price are always the same size. An altar never
//      offers a small answer for a large price or the other way round, so
//      the decision is about *which* currency you can spare, never about
//      spotting the good deal.
//   2. Nothing is offered that the player cannot pay or would not want. No
//      bolts without a crossbow, no healing at full health, no reset of a
//      level score that has not been earned yet, and no drop-to-a-number
//      unless there is comfortably enough to drop from.
//   3. Walking away is always on the table and always free.
//
// Definitions here are pure data and pure functions of the run; applying them
// is the world's job, because that is where the map, the enemies and the
// score actually live.

// The floor the health sacrifices will not take you below. Anything that
// would leave the player on the edge of dying to the next hit is not a
// bargain, it is a trap.
export const HP_FLOOR = 12;

export const REWARDS = [
  {
    id: 'arrows', tier: 1, name: 'A full quiver',
    text: 'Every bolt you have spent, returned.',
    usable: (run) => run.hasCrossbow && run.arrows < run.maxArrows,
  },
  {
    id: 'mend', tier: 1, name: 'Mended',
    text: 'A third of what you have lost comes back.',
    usable: (run) => run.hp < run.maxHp * 0.92,
  },
  {
    id: 'key', tier: 2, name: 'The next key',
    text: 'Where the key to the next sealed gate is lying.',
    // Not worth paying for twice: an altar will not sell an answer the
    // player has already been given by a map or a captive.
    usable: (run, world) => !!world.hintTarget('key') && !world.alreadyHinted('key'),
  },
  {
    id: 'heal', tier: 2, name: 'Made whole',
    text: 'Two thirds of what you have lost comes back.',
    usable: (run) => run.hp < run.maxHp * 0.8,
  },
  {
    id: 'chart', tier: 2, name: 'The shape of it',
    text: 'The walls and passages of this depth, drawn out. Nothing that is '
      + 'standing in them, and not the way down.',
    usable: (run, world) => world.vis.discoveredCount < world.grid.w * world.grid.h * 0.5,
  },
  {
    id: 'exit', tier: 3, name: 'The way down',
    text: 'Where the stairs are, marked and pointed at until you reach them.',
    usable: (run, world) => !!world.hintTarget('exit') && !world.alreadyHinted('exit'),
  },
  {
    id: 'restored', tier: 3, name: 'Restored',
    text: 'Whole again, and the quiver with you.',
    usable: (run) => run.hp < run.maxHp * 0.7,
  },
];

export const SACRIFICES = [
  {
    id: 'hpFixed', tier: 1, name: 'A measure of blood',
    amount: (run, scale) => Math.round(18 * scale * (1 + run.depth * 0.04)),
    text: (run, scale) => Math.round(18 * scale * (1 + run.depth * 0.04)) + ' vitality',
    // Never offered unless there is room to pay it and still stand up.
    affordable: (run, world, scale) =>
      run.hp - Math.round(18 * scale * (1 + run.depth * 0.04)) >= HP_FLOOR,
  },
  {
    id: 'scoreFixed', tier: 1, name: 'A deed unsung',
    amount: (run, scale) => Math.round(450 * scale * (1 + run.depth * 0.1)),
    text: (run, scale) => Math.round(450 * scale * (1 + run.depth * 0.1)) + ' points',
    affordable: (run) => run.score.levelSubtotal >= 500,
  },
  {
    id: 'hpPercent', tier: 2, name: 'A third of you',
    // A proportion, so it costs the healthy more than the desperate -- and
    // the design rule stands: never offered below fifty vitality at all.
    amount: (run, scale) => Math.round(run.hp * 0.35 * scale),
    text: (run, scale) => Math.round(35 * scale) + '% of your vitality ('
      + Math.round(run.hp * 0.35 * scale) + ')',
    affordable: (run, world, scale) =>
      run.hp >= 50 && run.hp - Math.round(run.hp * 0.35 * scale) >= HP_FLOOR,
  },
  {
    id: 'scoreLevel', tier: 2, name: 'Everything since the stair',
    amount: (run) => run.score.levelSubtotal,
    text: (run) => 'this depth\u2019s whole score (' + Math.round(run.score.levelSubtotal) + ')',
    // Only worth asking for once there is something to take.
    affordable: (run) => run.score.levelSubtotal >= 1200,
  },
  {
    id: 'ambushSmall', tier: 2, name: 'Company',
    amount: () => 0,
    text: () => 'whatever is listening comes to find you',
    affordable: () => true,
  },
  {
    id: 'hpDrop', tier: 3, name: 'All but a little',
    // Drop to a number rather than lose one. Requires at least double, so
    // this is always a choice made from strength.
    amount: (run, scale) => Math.max(0, run.hp - Math.round(25 / Math.max(0.5, scale))),
    text: (run, scale) => 'all but ' + Math.round(25 / Math.max(0.5, scale)) + ' vitality',
    affordable: (run, world, scale) => run.hp >= Math.round(25 / Math.max(0.5, scale)) * 2,
  },
  {
    id: 'ambush', tier: 3, name: 'The hall wakes',
    amount: () => 0,
    text: () => 'an unknown number of them, here, now',
    affordable: () => true,
  },
  {
    id: 'amnesia', tier: 3, name: 'Everything you have seen',
    amount: () => 0,
    text: () => 'the whole chart, and every mark on it',
    // Pointless when there is nothing charted to lose, and cruel when the
    // reward is the chart itself.
    affordable: (run, world) => world.vis.discoveredCount > 120,
  },
];

export const REWARD_BY_ID = Object.fromEntries(REWARDS.map((r) => [r.id, r]));
export const SACRIFICE_BY_ID = Object.fromEntries(SACRIFICES.map((s) => [s.id, s]));

// Builds the offers a particular altar puts in front of a particular run.
//
// Tiers are walked from the top down and each contributes at most one offer,
// so the three choices are always genuinely different sizes rather than three
// shades of the same bargain. A tier with nothing payable in it is skipped
// rather than padded.
export function buildOffers(run, world, rng, count = 3) {
  const mods = run.mods;
  const sacrificeScale = mods.sacrificeScale || 1;
  const offers = [];

  for (let tier = 3; tier >= 1 && offers.length < count; tier--) {
    const rewards = REWARDS.filter((r) => r.tier === tier && r.usable(run, world)
      && !offers.some((o) => o.reward.id === r.id));
    const costs = SACRIFICES.filter((s) => s.tier === tier
      && s.affordable(run, world, sacrificeScale)
      && !offers.some((o) => o.sacrifice.id === s.id));
    if (!rewards.length || !costs.length) continue;
    const reward = rng.pick(rewards);
    const sacrifice = rng.pick(costs);
    offers.push({
      tier,
      reward,
      sacrifice,
      amount: sacrifice.amount(run, sacrificeScale),
      costText: sacrifice.text(run, sacrificeScale),
    });
  }
  return offers;
}
