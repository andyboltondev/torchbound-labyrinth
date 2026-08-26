// Run state: the things that persist from depth to depth within one descent.

import { computeMods, describeBuild, offerRelics, RELIC_BY_ID } from './relics.js';
import { ScoreTracker } from './scoring.js';
import { profile } from './profile.js';
import { RNG, makeSeed } from '../core/rng.js';

const BASE_MAX_HP = 100;
const BASE_ARROWS = 5;
const BASE_BOLT_DAMAGE = 24;
const BASE_BOLT_RANGE = 5;
const DEPTH_VIGOUR = 6;   // max health gained for each depth survived

export class Run {
  constructor(seed) {
    this.seed = seed || makeSeed();
    this.rng = new RNG(this.seed + ':run');
    this.depth = 1;
    this.relics = {};
    this.mods = computeMods(this.relics);
    // Health earned during the run: shrine blessings and depths survived.
    // Held separately from relic modifiers so recomputing those cannot wipe it.
    this.bonusHp = 0;
    this.maxHp = BASE_MAX_HP;
    this.hp = BASE_MAX_HP;
    this.hasCrossbow = false;
    this.arrows = 0;
    this.keys = new Set();
    this.score = new ScoreTracker();
    this.seenHazards = new Set();
    this.bossesDefeated = 0;
    this.blessings = 0;
    this.buildAffinity = {};
    this.newDiscoveries = [];
    this.startedAt = Date.now();
    this.relicHistory = [];
  }

  get maxArrows() { return BASE_ARROWS + this.mods.crossbowCapacity; }
  get build() { return describeBuild(this.relics); }

  refreshMods() {
    const previousMax = this.maxHp;
    this.mods = computeMods(this.relics);
    this.maxHp = Math.max(30, BASE_MAX_HP + this.bonusHp + this.mods.maxHpBonus);
    // Gaining max health should not silently heal; losing it should not kill.
    if (this.maxHp > previousMax) this.hp += this.maxHp - previousMax;
    this.hp = Math.max(1, Math.min(this.hp, this.maxHp));
    this.arrows = Math.min(this.arrows, this.maxArrows);
    this.buildAffinity = {};
    for (const [id, n] of Object.entries(this.relics)) {
      const relic = RELIC_BY_ID[id];
      if (relic) this.buildAffinity[relic.tag] = (this.buildAffinity[relic.tag] || 0) + n;
    }
  }

  takeRelic(relic) {
    this.relics[relic.id] = (this.relics[relic.id] || 0) + 1;
    this.relicHistory.push(relic.id);
    this.refreshMods();
    if (relic.onTake) relic.onTake(this);
    return relic;
  }

  offer(count = 3) { return offerRelics(this, this.rng, count); }

  heal(amount, ignoreMultiplier = false) {
    const scaled = ignoreMultiplier ? amount : amount * this.mods.healing;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + scaled);
    return Math.round(this.hp - before);
  }

  damageOverTime(amount) {
    this.hp = Math.max(0, this.hp - amount);
  }

  giveCrossbow() {
    if (this.hasCrossbow) return false;
    this.hasCrossbow = true;
    this.arrows = Math.min(this.maxArrows, BASE_ARROWS);
    return true;
  }

  // Returns how many were actually taken -- the quiver has a hard cap.
  giveArrows(n) {
    if (!this.hasCrossbow) return 0;
    const before = this.arrows;
    this.arrows = Math.min(this.maxArrows, this.arrows + n);
    return this.arrows - before;
  }

  spendArrow() {
    if (this.arrows <= 0) return false;
    this.arrows--;
    return true;
  }

  boltDamage() {
    return BASE_BOLT_DAMAGE * this.mods.crossbowDamage * (1 + this.depth * 0.05);
  }

  boltRange() {
    return BASE_BOLT_RANGE + this.mods.crossbowRangeBonus;
  }

  addBlessing() {
    this.blessings++;
    // A blessing is a small permanent lift, deliberately modest. It goes into
    // bonusHp so that taking a relic later does not quietly undo it.
    this.bonusHp += 8;
    this.maxHp += 8;
    this.hp = Math.min(this.maxHp, this.hp + 8);
  }

  discover(id) {
    if (profile.discover(id)) this.newDiscoveries.push(id);
  }
  discoverBoss(id) {
    if (profile.discoverBoss(id)) this.newDiscoveries.push(id);
  }

  // Called on descent, after the relic choice.
  descend() {
    this.depth++;
    this.keys.clear();
    this.score.resetLevel();
    // Surviving a depth hardens you. Without this the player's survivability
    // is flat while enemy count and damage both climb, so every run ends at
    // the same depth for the same arithmetic reason rather than a mistake.
    // Relics stay build-defining; this is the baseline that keeps pace.
    this.bonusHp += DEPTH_VIGOUR;
    this.maxHp += DEPTH_VIGOUR;
    this.hp += DEPTH_VIGOUR;

    // Climbing down is the one guaranteed breather.
    const rest = Math.round(this.maxHp * 0.25 * this.mods.levelHeal);
    if (rest > 0) this.heal(rest, true);
  }

  isBossDepth(depth = this.depth) { return depth % 5 === 0; }

  levelContext() {
    return { hasCrossbow: this.hasCrossbow, relics: this.relics, depth: this.depth };
  }
}
