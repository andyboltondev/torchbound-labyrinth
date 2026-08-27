// Seeded deterministic pseudo-random number generation.
// Every procedural system draws from an RNG instance so that a seed fully
// reproduces a run -- this is what makes the generation test-suite possible.

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class RNG {
  constructor(seed = Date.now()) {
    this.seed(seed);
  }

  seed(seed) {
    if (typeof seed === 'string') seed = hashString(seed);
    this.s = (seed >>> 0) || 0x9e3779b9;
    this.initial = this.s;
    return this;
  }

  // mulberry32 -- small, fast, good enough distribution for game content.
  next() {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  float(min = 0, max = 1) { return min + this.next() * (max - min); }

  // Integer in [min, max] inclusive.
  int(min, max) {
    if (max === undefined) { max = min - 1; min = 0; }
    return Math.floor(this.float(min, max + 1));
  }

  bool(chance = 0.5) { return this.next() < chance; }

  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }

  // Weighted pick. `weightOf` maps an entry to a positive number.
  weighted(arr, weightOf) {
    let total = 0;
    for (const item of arr) total += Math.max(0, weightOf(item));
    if (total <= 0) return this.pick(arr);
    let roll = this.next() * total;
    for (const item of arr) {
      roll -= Math.max(0, weightOf(item));
      if (roll <= 0) return item;
    }
    return arr[arr.length - 1];
  }

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Derives an independent stream so one subsystem consuming extra numbers
  // cannot shift the output of another.
  fork(tag) {
    return new RNG(hashString(tag + ':' + this.s + ':' + this.int(0, 1e9)));
  }
}

// Convenience: a run seed that is short enough for a human to retype.
// Tidies a seed somebody typed or pasted into the shape the generator wants.
// Deliberately forgiving: trailing spaces, capitals and the odd stray
// character are the player's tools slipping, not the player meaning something
// different, and two people who think they typed the same seed must get the
// same labyrinth.
export function normaliseSeed(text) {
  const cleaned = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
  return cleaned || null;
}

export function makeSeed(rng = Math.random) {
  const words = 'fenrir jotun mimir vidar skadi bragi hodr njord ratatosk hugin munin draupnir gungnir sleipnir yggdrasil valhalla bifrost'.split(' ');
  const w = words[Math.floor(rng() * words.length)];
  return w + '-' + Math.floor(rng() * 9000 + 1000);
}
