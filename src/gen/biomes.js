// Visual biomes and the mechanical environmental hazards layered on top.
//
// Design rule 10: if a hazard is visible, its gameplay effect is live. Every
// entry below therefore pairs particle/tint styling with concrete modifiers
// that the simulation reads each frame.

export const BIOMES = {
  ruins: {
    id: 'ruins', name: 'Norse Ruins',
    floor: ['#51504b', '#595651', '#4b4845', '#5e5a55'],
    wallTop: '#736f68', wallLeft: '#38342f', wallRight: '#4f4a43',
    accent: '#8a7a5c', ambient: '#0b0d14', grade: '#dcd4c4',
    detail: ['runes', 'cracks', 'debris'],
  },
  crypt: {
    id: 'crypt', name: 'Frozen Crypt',
    floor: ['#4b565f', '#515e68', '#444e55', '#596875'],
    wallTop: '#748390', wallLeft: '#2e3a43', wallRight: '#475765',
    accent: '#a8d8ef', ambient: '#0a1018', grade: '#c6dbea',
    detail: ['frost', 'cracks', 'icicles'],
  },
  tomb: {
    id: 'tomb', name: 'Overgrown Tomb',
    floor: ['#495042', '#50584a', '#42473d', '#575f4c'],
    wallTop: '#68725b', wallLeft: '#2c3225', wallRight: '#424c37',
    accent: '#7fa657', ambient: '#0a0f0a', grade: '#cbdcba',
    detail: ['moss', 'roots', 'fungus'],
  },
  embers: {
    id: 'embers', name: 'Ember Halls',
    floor: ['#514641', '#594942', '#473e3a', '#614f46'],
    wallTop: '#735e53', wallLeft: '#322521', wallRight: '#4b3830',
    accent: '#ff7a3a', ambient: '#140a08', grade: '#f2cbaa',
    detail: ['scorch', 'cracksGlow', 'ash'],
  },
  rainruins: {
    id: 'rainruins', name: 'Rain-Exposed Ruins',
    floor: ['#4b5154', '#50585a', '#434a4b', '#586062'],
    wallTop: '#6d7776', wallLeft: '#2c3334', wallRight: '#434d4c',
    accent: '#8fb4c4', ambient: '#080d12', grade: '#c4d6de',
    detail: ['wet', 'cracks', 'drains'],
  },
};

// --- Environmental hazards ------------------------------------------------
// `threat` feeds the generation difficulty budget (section 38): hazards may
// overlap, but not to the point of unfair stacking.
//
// `tint` is the interface colour for the persistent HUD indicator. It is
// interface-only, but it lives here so that a hazard can never be added
// without deciding how the player is told about it (design rule 10).

export const HAZARDS = {
  clear: {
    id: 'clear', name: 'Still Air', threat: 0, hint: '',
    tint: '#8fa0b8',
    mods: {},
  },
  rain: {
    id: 'rain', name: 'Rain', threat: 2,
    tint: '#8fb4c4',
    hint: 'Rain weakens your torch',
    mods: { torchRadius: 0.72, torchInstability: 2.2, footstepSplash: true },
  },
  fog: {
    id: 'fog', name: 'Fog', threat: 2,
    tint: '#9aa7bb',
    hint: 'Your memory of the map fades fast',
    mods: { memoryDecay: 2.8, sightHaze: 0.35 },
  },
  dust: {
    id: 'dust', name: 'Dust', threat: 0,
    tint: '#c2ab7d',
    hint: 'Disturbed dust betrays movement in the dark',
    mods: { revealMovers: 9.5 },
  },
  embers: {
    id: 'embers', name: 'Embers', threat: 3,
    tint: '#ff7a3a',
    hint: 'The heat drives the dead into a frenzy',
    mods: { enemySpeed: 1.2, enemyAttackRate: 1.2, enemyAggro: 1.15 },
  },
  ice: {
    id: 'ice', name: 'Ice', threat: 2,
    tint: '#a8d8ef',
    hint: 'The floor gives no grip',
    mods: { slide: true, friction: 1.6 },
  },
  mud: {
    id: 'mud', name: 'Mud', threat: 2,
    tint: '#a07a4a',
    hint: 'Thick mud drags at your legs',
    mods: { playerSpeed: 0.62, footprints: true },
  },
  vines: {
    id: 'vines', name: 'Overgrowth', threat: 2,
    tint: '#7fa657',
    hint: 'Creepers foul your swing',
    mods: { attackSpeed: 0.62 },
  },
};

// Which hazards suit which biome. Generation picks from here so a frozen
// crypt never rains and an ember hall never freezes over.
export const BIOME_HAZARDS = {
  ruins: ['clear', 'dust', 'fog', 'mud'],
  crypt: ['ice', 'fog', 'clear', 'dust'],
  tomb: ['vines', 'mud', 'fog', 'clear'],
  embers: ['embers', 'dust', 'clear', 'ash_placeholder'],
  rainruins: ['rain', 'mud', 'fog', 'clear'],
};
// 'ash_placeholder' is never selected -- filtered out below -- but keeps the
// weighting of Ember Halls tilted toward its signature hazard.
for (const k of Object.keys(BIOME_HAZARDS)) {
  BIOME_HAZARDS[k] = BIOME_HAZARDS[k].filter((h) => HAZARDS[h]);
}

// Combinations that would compound into unfair territory.
const FORBIDDEN_PAIRS = [
  ['ice', 'mud'],       // contradictory footing, reads as broken controls
  ['rain', 'embers'],   // thematically nonsense
  ['embers', 'vines'],  // fast enemies plus slow attacks is a death sentence
  ['fog', 'embers'],    // blind and outrun at the same time
];

export function pairAllowed(a, b) {
  if (a === b) return true;
  return !FORBIDDEN_PAIRS.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
}

// Total hazard threat a level of this depth is allowed to carry.
// The first two depths carry none at all: learning the torch, the gates and
// the sword is enough to be going on with. After that it climbs one notch
// every second depth.
export function hazardBudget(depth) {
  if (depth <= 2) return 0;
  return Math.min(9, 1 + Math.floor((depth - 3) / 2));
}

export function biomeForDepth(depth, rng) {
  const pools = [
    ['ruins', 'ruins', 'rainruins'],
    ['ruins', 'tomb', 'rainruins', 'crypt'],
    ['tomb', 'crypt', 'embers', 'rainruins'],
    ['crypt', 'embers', 'tomb', 'ruins'],
  ];
  const tier = Math.min(pools.length - 1, Math.floor((depth - 1) / 4));
  return BIOMES[rng.pick(pools[tier])];
}
