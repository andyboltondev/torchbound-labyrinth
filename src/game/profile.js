// Persistent, cross-run data: the Hall of Fame, bestiary discoveries and
// settings. Deliberately small -- the run itself keeps roguelite consequences.

import { load, save } from '../core/storage.js';

const SEED_BOARD = [
  { name: 'Ragnvald', score: 48200, depth: 17, bosses: 3, build: 'Berserker' },
  { name: 'Sigrun', score: 41750, depth: 15, bosses: 2, build: 'Ranger' },
  { name: 'Halfdan', score: 36400, depth: 14, bosses: 2, build: 'Warrior' },
  { name: 'Astrid', score: 31900, depth: 12, bosses: 2, build: 'Explorer' },
  { name: 'Ulfar', score: 27300, depth: 11, bosses: 2, build: 'Survivor' },
  { name: 'Thyra', score: 22850, depth: 10, bosses: 2, build: 'Score Hunter' },
  { name: 'Bjarke', score: 18600, depth: 9, bosses: 1, build: 'Warrior' },
  { name: 'Ingrid', score: 14250, depth: 7, bosses: 1, build: 'Firekeeper' },
  { name: 'Gorm', score: 10900, depth: 6, bosses: 1, build: 'Bulwark' },
  { name: 'Eydis', score: 7450, depth: 5, bosses: 1, build: 'Torchbearer' },
];

export const DEFAULT_SETTINGS = {
  master: 0.8,
  music: 0.55,
  sfx: 0.85,
  touchControls: 'auto',        // auto | always | never
  movementFrame: 'dungeon',     // dungeon | view
  movementAssist: 'corridor',   // corridor | strict
  screenShake: 1,
  showDamage: true,
  graphics: 'auto',             // auto | low | medium | high
  reverb: true,
  showFps: false,
};

export class Profile {
  constructor() {
    this.board = load('hallOfFame', null) || SEED_BOARD.slice();
    this.bestiary = new Set(load('bestiary', []));
    this.bosses = new Set(load('bestiaryBosses', []));
    this.settings = { ...DEFAULT_SETTINGS, ...(load('settings', {}) || {}) };
    this.stats = load('stats', { runs: 0, deepest: 0, bestScore: 0, kills: 0 });
  }

  saveSettings() { save('settings', this.settings); }

  discover(id) {
    if (this.bestiary.has(id)) return false;
    this.bestiary.add(id);
    save('bestiary', Array.from(this.bestiary));
    return true;
  }

  discoverBoss(id) {
    if (this.bosses.has(id)) return false;
    this.bosses.add(id);
    save('bestiaryBosses', Array.from(this.bosses));
    return true;
  }

  // Where would this score land? Returns 1-based rank, or null if outside the top ten.
  rankFor(score) {
    const sorted = this.board.slice().sort((a, b) => b.score - a.score);
    for (let i = 0; i < sorted.length; i++) if (score > sorted[i].score) return i + 1;
    return sorted.length < 10 ? sorted.length + 1 : null;
  }

  // How far short a non-qualifying run fell, so the near-miss still lands.
  shortfall(score) {
    const sorted = this.board.slice().sort((a, b) => b.score - a.score);
    const tenth = sorted[9] || sorted[sorted.length - 1];
    if (!tenth) return { place: 1, gap: 0 };
    const place = sorted.filter((e) => e.score >= score).length + 1;
    return { place, gap: Math.max(0, tenth.score - score + 1) };
  }

  submit(entry) {
    this.board.push(entry);
    this.board.sort((a, b) => b.score - a.score);
    this.board = this.board.slice(0, 10);
    save('hallOfFame', this.board);
    return this.board.findIndex((e) => e === entry) + 1;
  }

  recordRun({ score, depth, kills }) {
    this.stats.runs++;
    this.stats.deepest = Math.max(this.stats.deepest, depth);
    this.stats.bestScore = Math.max(this.stats.bestScore, score);
    this.stats.kills += kills || 0;
    save('stats', this.stats);
  }
}

export const profile = new Profile();
