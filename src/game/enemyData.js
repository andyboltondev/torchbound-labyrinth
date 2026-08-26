// Pure data: enemy archetypes, elite modifiers and boss definitions.
// Deliberately free of DOM/canvas references so the generation test harness
// can import it headlessly.

// Behaviour archetypes (section 28). The AI in enemies.js switches on these.
export const BEHAVIOUR = {
  CHARGER: 'charger',       // spots you, closes hard, commits to the attack
  PURSUER: 'pursuer',       // relentless once alerted, slow to give up
  SKIRMISHER: 'skirmisher', // strikes then backs off to a preferred range
  DEFENDER: 'defender',     // holds an area, only leaves it a short way
  AMBUSHER: 'ambusher',     // dormant until the player is close, then erupts
  RANGED: 'ranged',         // fires from distance, repositions when crowded
};

export const ENEMIES = {
  draugr_thrall: {
    id: 'draugr_thrall', name: 'Draugr Thrall', behaviour: BEHAVIOUR.CHARGER,
    hp: 22, damage: 7, speed: 2.35, attackCooldown: 1.1, attackRange: 0.95,
    detect: 6.0, torchSensitivity: 1.55, prefersDark: false,
    fov: 130, // barrow-dead, and slow to turn its head
    score: 60, minDepth: 1, radius: 0.34, height: 1.0,
    material: 'flesh',
    blood: '#6e1c1a', // old blood, and not much of it
    voice: { timbre: 'groan', pitch: 92, loudness: 1, every: 6.5 },
    palette: { body: '#6c6455', trim: '#3b352c', eye: '#c8e37a' },
    lore: 'Barrow-bound dead, roused by torchlight. They remember only the order to guard.',
    threat: 'Closes distance in a straight line and commits to a heavy overhead swing.',
  },
  barrow_hound: {
    id: 'barrow_hound', name: 'Barrow Hound', behaviour: BEHAVIOUR.PURSUER,
    hp: 14, damage: 5, speed: 3.35, attackCooldown: 0.75, attackRange: 0.85,
    detect: 7.5, torchSensitivity: 1.8, prefersDark: false,
    fov: 230, // it hunts by nose, so behind it is barely behind it
    score: 55, minDepth: 1, radius: 0.3, height: 0.65,
    material: 'flesh',
    blood: '#7a1f1c',
    voice: { timbre: 'snarl', pitch: 210, loudness: 1.25, every: 4.5 },
    palette: { body: '#4e4038', trim: '#241d19', eye: '#ff8b4a' },
    lore: 'Hunting dogs interred alongside their jarl. Death only sharpened the nose.',
    threat: 'Very fast. Will follow you across the level once it has your scent.',
  },
  rune_shade: {
    id: 'rune_shade', name: 'Rune Shade', behaviour: BEHAVIOUR.SKIRMISHER,
    hp: 20, damage: 8, speed: 2.9, attackCooldown: 1.35, attackRange: 1.05,
    detect: 5.5, torchSensitivity: 0.9, prefersDark: true,
    fov: 160, // a duellist watches its own guard
    score: 90, minDepth: 2, radius: 0.32, height: 1.05,
    material: 'ethereal',
    blood: '#2f4a78', // not blood: the ink the oath was cut in
    voice: { timbre: 'whisper', pitch: 640, loudness: 0.7, every: 5.5 },
    palette: { body: '#3d4a63', trim: '#7fa0d8', eye: '#bfe1ff' },
    lore: 'A carved oath that outlived the one who swore it. It fights like a duellist.',
    threat: 'Strikes and immediately withdraws. Punishes greedy follow-up swings.',
  },
  crypt_warden: {
    id: 'crypt_warden', name: 'Crypt Warden', behaviour: BEHAVIOUR.DEFENDER,
    hp: 46, damage: 11, speed: 1.75, attackCooldown: 1.5, attackRange: 1.15,
    detect: 5.0, torchSensitivity: 1.25, prefersDark: false,
    fov: 150, // set to watch one thing, and watching it
    score: 130, minDepth: 2, radius: 0.4, height: 1.2,
    material: 'armour',
    blood: '#661a18',
    voice: { timbre: 'clank', pitch: 150, loudness: 1.35, every: 5 },
    palette: { body: '#5a5b52', trim: '#8d7a48', eye: '#ffd27a' },
    lore: 'Sworn to a door, a chest or a name. It will not chase you far, and it does not need to.',
    threat: 'Heavy armour and a wide guard. Rarely leaves the room it was set to hold.',
  },
  mire_lurker: {
    id: 'mire_lurker', name: 'Mire Lurker', behaviour: BEHAVIOUR.AMBUSHER,
    hp: 26, damage: 12, speed: 2.6, attackCooldown: 1.2, attackRange: 1.0,
    detect: 2.6, torchSensitivity: 1.0, prefersDark: true,
    fov: 360, // it reads the silt, not the light
    score: 120, minDepth: 3, radius: 0.36, height: 0.9,
    material: 'flesh',
    blood: '#4a7a2e', // whatever it has instead, it is green
    voice: { timbre: 'hiss', pitch: 320, loudness: 0.55, every: 8 },
    palette: { body: '#3c4a3a', trim: '#1e2a1d', eye: '#a8ff6a' },
    lore: 'It lies in the silt with its mouth open and waits for warmth to pass.',
    threat: 'Invisible until you are almost on top of it. The opening strike hits hard.',
  },
  bone_slinger: {
    id: 'bone_slinger', name: 'Bone Slinger', behaviour: BEHAVIOUR.RANGED,
    hp: 18, damage: 9, speed: 2.0, attackCooldown: 2.0, attackRange: 6.5,
    detect: 8.0, torchSensitivity: 1.7, prefersDark: false,
    fov: 120, // busy picking a target down its own arm
    score: 110, minDepth: 3, radius: 0.32, height: 1.0,
    material: 'bone',
    blood: '#6a6152', // bone dust
    voice: { timbre: 'clatter', pitch: 420, loudness: 0.95, every: 5.5 },
    palette: { body: '#7a7160', trim: '#493f33', eye: '#ffb35c' },
    lore: 'Grave-robbers who were caught, and now throw the same bones they came to steal.',
    threat: 'Keeps its distance and lobs bone shards. Backs away as you approach.',
  },
  frost_revenant: {
    id: 'frost_revenant', name: 'Frost Revenant', behaviour: BEHAVIOUR.PURSUER,
    hp: 38, damage: 10, speed: 2.5, attackCooldown: 1.15, attackRange: 1.0,
    detect: 7.0, torchSensitivity: 1.4, prefersDark: false, chills: true,
    fov: 170,
    score: 160, minDepth: 5, radius: 0.37, height: 1.15,
    material: 'ice',
    blood: '#3f6478', // meltwater and something darker
    voice: { timbre: 'moan', pitch: 118, loudness: 1.1, every: 6 },
    palette: { body: '#5b7185', trim: '#a9dcf2', eye: '#dffaff' },
    lore: 'Frozen mid-stride a thousand winters ago, and still finishing the step.',
    threat: 'Its touch numbs the legs. You move slower for a few seconds after a hit.',
  },
  ember_fiend: {
    id: 'ember_fiend', name: 'Ember Fiend', behaviour: BEHAVIOUR.CHARGER,
    hp: 30, damage: 13, speed: 3.1, attackCooldown: 0.95, attackRange: 1.0,
    detect: 8.5, torchSensitivity: 1.1, prefersDark: false, burns: true,
    fov: 150,
    score: 170, minDepth: 6, radius: 0.35, height: 1.05,
    material: 'ember',
    blood: '#3a2118', // it scorches the floor rather than staining it
    voice: { timbre: 'crackle', pitch: 260, loudness: 1.15, every: 4.5 },
    palette: { body: '#6b3324', trim: '#ff6a2a', eye: '#ffe08a' },
    lore: 'Something that crawled out of the forge-pit wearing a smith for a skin.',
    threat: 'Fast and hot. Leaves burning ground where it falls.',
  },
  root_horror: {
    id: 'root_horror', name: 'Root Horror', behaviour: BEHAVIOUR.DEFENDER,
    hp: 74, damage: 16, speed: 1.5, attackCooldown: 1.8, attackRange: 1.35,
    detect: 5.5, torchSensitivity: 1.2, prefersDark: false,
    fov: 360, // rooted, and facing every way at once
    score: 240, minDepth: 7, radius: 0.48, height: 1.4,
    material: 'wood',
    blood: '#3f6b23', // sap
    voice: { timbre: 'creak', pitch: 72, loudness: 1.45, every: 6.5 },
    palette: { body: '#40492f', trim: '#6d8447', eye: '#c9ff8f' },
    lore: 'The tomb tried to grow over a warrior. Neither of them won.',
    threat: 'Slow, enormously tough, and its reach is longer than it looks.',
  },
  valkyr_wraith: {
    id: 'valkyr_wraith', name: 'Valkyr Wraith', behaviour: BEHAVIOUR.SKIRMISHER,
    hp: 52, damage: 15, speed: 3.4, attackCooldown: 1.05, attackRange: 1.2,
    detect: 9.0, torchSensitivity: 1.3, prefersDark: false,
    fov: 200, // a chooser of the slain misses very little
    score: 300, minDepth: 9, radius: 0.36, height: 1.25,
    material: 'ethereal',
    blood: '#4a3f70',
    voice: { timbre: 'wail', pitch: 520, loudness: 1.3, every: 5 },
    palette: { body: '#4a4560', trim: '#cbb9ff', eye: '#ffffff' },
    lore: 'A chooser of the slain who lost the road home, and now chooses in the dark.',
    threat: 'Extremely mobile. Darts in, strikes twice, and is gone before you turn.',
  },
};

// What a creature sees when its definition does not say. A 150-degree wedge:
// wide enough that walking straight at one is always noticed, narrow enough
// that its back is a genuine blind spot worth working around.
export const DEFAULT_FOV = 150;

// How far anything hears a footfall behind it, in tiles. Creeping past a
// creature means staying outside this as well as outside its wedge.
export const REAR_SENSE = 2.2;

export const ENEMY_LIST = Object.values(ENEMIES);

// What a body leaves on the floor when the material lookup has nothing to
// say. Most things down here bleed red; a few very much do not.
export const DEFAULT_BLOOD = '#7a1f1c';

// How far the player's ears reach, as a multiple of what the torch lights.
// Sound outruns the light -- that is the whole point of having it -- but not
// so far that the labyrinth stops being dark and starts being a radar screen.
export const HEARING_REACH = 1.9;

// What a creature sounds like when nothing in its definition says. Nothing
// uses this today; it exists so a new archetype is quiet rather than silent.
export const DEFAULT_VOICE = { timbre: 'groan', pitch: 140, loudness: 0.9, every: 7 };

export const ELITE_MOD = {
  hp: 2.15, damage: 1.4, speed: 1.08, score: 2.6, radius: 1.18,
  prefix: 'Jarl-Blooded',
};

// Weighted pool for a depth: recently unlocked archetypes are common, older
// ones thin out but never vanish entirely.
export function enemyPoolFor(depth) {
  return ENEMY_LIST.filter((e) => e.minDepth <= depth).map((e) => {
    const age = depth - e.minDepth;
    return { def: e, weight: 1 + Math.max(0, 4 - age * 0.45) };
  });
}

// --- Bosses ---------------------------------------------------------------
export const BOSSES = [
  {
    id: 'jarl_of_ash', name: 'Bjorn, the Jarl of Ash', biome: 'embers',
    hp: 250, damage: 12, speed: 2.1, radius: 0.85, score: 3000,
    material: 'ember',
    blood: '#3a2118',
    palette: { body: '#5c2f20', trim: '#ff7a30', eye: '#ffe9a8' },
    phases: 2, attacks: ['charge', 'slam', 'summon'],
    lore: 'He burned his own hall rather than yield it, and he is still standing in the embers.',
    threat: 'A telegraphed charge, a shockwave slam, and thralls dragged out of the ash.',
  },
  {
    id: 'hrimthurs', name: 'Hrimthurs, the Frost-Bound', biome: 'crypt',
    hp: 430, damage: 15, speed: 1.9, radius: 0.95, score: 4200,
    material: 'ice',
    blood: '#3f6478',
    palette: { body: '#4b6274', trim: '#b6e6ff', eye: '#ffffff' },
    phases: 2, attacks: ['shards', 'slam', 'summon'],
    lore: 'A giant chained beneath the crypt so that the winter would have somewhere to sleep.',
    threat: 'Expanding rings of ice shards, and ground that freezes where you stand.',
  },
  {
    id: 'root_crowned', name: 'The Root-Crowned', biome: 'tomb',
    hp: 620, damage: 18, speed: 1.7, radius: 1.0, score: 5400,
    material: 'wood',
    blood: '#3f6b23',
    palette: { body: '#3b4a2c', trim: '#8fbf59', eye: '#e6ff9c' },
    phases: 3, attacks: ['lash', 'summon', 'slam'],
    lore: 'The tomb grew itself a king, because it had no other use for the bones.',
    threat: 'Lashing vines pin you in place while saplings close the distance.',
  },
  {
    id: 'nidhogg_brood', name: 'The Nidhogg-Brood', biome: 'ruins',
    hp: 840, damage: 21, speed: 2.3, radius: 1.05, score: 7000,
    material: 'flesh',
    blood: '#5e1030',
    palette: { body: '#3a2a3d', trim: '#c04a7a', eye: '#ffd0e6' },
    phases: 3, attacks: ['charge', 'shards', 'summon', 'slam'],
    lore: 'Something gnawing at a root that holds up rather more than this labyrinth.',
    threat: 'Every attack in the labyrinth at once, and it stops telegraphing in phase three.',
  },
];

export function bossForDepth(depth) {
  const tier = Math.max(0, Math.floor(depth / 5) - 1);
  const base = BOSSES[Math.min(tier, BOSSES.length - 1)];
  const overflow = Math.max(0, tier - (BOSSES.length - 1));
  if (!overflow) return { ...base, scaledHp: base.hp, scaledDamage: base.damage };
  // Past the authored set, bosses keep scaling so deep runs stay dangerous.
  return {
    ...base,
    name: base.name + ' Ascendant',
    scaledHp: Math.round(base.hp * (1 + overflow * 0.55)),
    scaledDamage: Math.round(base.damage * (1 + overflow * 0.22)),
    score: Math.round(base.score * (1 + overflow * 0.5)),
  };
}
