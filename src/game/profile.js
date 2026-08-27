// Persistent, cross-run data: the Hall of Fame, bestiary discoveries and
// settings. Deliberately small -- the run itself keeps roguelite consequences.

import { load, save } from '../core/storage.js';
import { readHall, writeAll, submitEntry, rank, HALL_SIZE } from './hall.js';

const SEED_BOARD = [
  { name: 'Ragnvald', score: 48200, depth: 17, bosses: 3, build: 'Berserker', diff: 'ashenvow' },
  { name: 'Sigrun', score: 41750, depth: 15, bosses: 2, build: 'Ranger', diff: 'torchbound' },
  { name: 'Halfdan', score: 36400, depth: 14, bosses: 2, build: 'Warrior', diff: 'ashenvow' },
  { name: 'Astrid', score: 31900, depth: 12, bosses: 2, build: 'Explorer', diff: 'torchbound' },
  { name: 'Ulfar', score: 27300, depth: 11, bosses: 2, build: 'Survivor', diff: 'torchbound' },
  { name: 'Thyra', score: 22850, depth: 10, bosses: 2, build: 'Score Hunter', diff: 'ashenvow' },
  { name: 'Bjarke', score: 18600, depth: 9, bosses: 1, build: 'Warrior', diff: 'torchbound' },
  { name: 'Ingrid', score: 14250, depth: 7, bosses: 1, build: 'Firekeeper', diff: 'torchbound' },
  { name: 'Gorm', score: 10900, depth: 6, bosses: 1, build: 'Bulwark', diff: 'torchbound' },
  { name: 'Eydis', score: 7450, depth: 5, bosses: 1, build: 'Torchbearer', diff: 'torchbound' },
];

export const DEFAULT_SETTINGS = {
  difficulty: 'torchbound',     // hearthlight | torchbound | ashenvow
  touchPad: 'diamond',          // diamond | stick
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
  // The opening guide. Dismissed with its own checkbox, brought back here.
  showGuide: true,
};

export class Profile {
  constructor() {
    // The hall is a CSV table now. A profile from before that reads its old
    // JSON list once and is written straight back out in the new format, so
    // nobody loses the names they had.
    const stored = readHall();
    if (stored) {
      this.board = stored;
    } else {
      const legacy = load('hallOfFame', null);
      this.board = writeAll(legacy && legacy.length ? legacy : SEED_BOARD.slice());
    }
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

  // Where would this score land? Returns a 1-based rank, or null if it does
  // not make the hall at all.
  rankFor(score) {
    const sorted = rank(this.board);
    for (let i = 0; i < sorted.length; i++) if (score > sorted[i].score) return i + 1;
    return sorted.length < HALL_SIZE ? sorted.length + 1 : null;
  }

  // How far short a non-qualifying run fell, so the near-miss still lands.
  shortfall(score) {
    const sorted = rank(this.board);
    const last = sorted[HALL_SIZE - 1] || sorted[sorted.length - 1];
    if (!last) return { place: 1, gap: 0 };
    const place = sorted.filter((e) => e.score >= score).length + 1;
    return { place, gap: Math.max(0, last.score - score + 1) };
  }

  // Carving a name re-reads the stored table and merges into it, so a run
  // finished in one tab cannot wipe out one finished in another.
  async submit(entry) {
    const result = await submitEntry(entry, this.board);
    if (result) {
      this.board = result.rows;
      return result.rank;
    }
    return null;
  }

  clearHall() { this.board = writeAll([]); return this.board; }

  // An unranked run still happened -- it just does not set records. Letting
  // Hearthlight write "deepest" or "best score" would leave the home screen
  // boasting numbers the Hall of Fame refuses to recognise.
  recordRun({ score, depth, kills, ranked = true }) {
    this.stats.runs++;
    this.stats.kills += kills || 0;
    if (ranked) {
      this.stats.deepest = Math.max(this.stats.deepest, depth);
      this.stats.bestScore = Math.max(this.stats.bestScore, score);
    }
    save('stats', this.stats);
  }
}

export const profile = new Profile();
