// Risk-based scoring. Points come from what the player chose to do, not from
// grinding a checklist, and the breakdown is always explainable afterwards.

const STREAK_CAP = 4.0;

function emptyLevelScore() {
  return {
    combat: 0, streak: 0, time: 0, clear: 0,
    flawless: 0, secrets: 0, boss: 0, health: 0, penalty: 0,
    kills: 0, elites: 0, bestStreak: 0, flawlessRooms: 0, secretsFound: 0,
    penalties: 0, penaltyLabel: '',
  };
}

export class ScoreTracker {
  constructor() {
    this.total = 0;
    this.level = emptyLevelScore();
    this.streak = 0;
    this.streakTimer = 0;
    this.streakWindow = 3.5;
    this.multiplier = 1;
    this.runBest = { streak: 0, kills: 0, elites: 0, secrets: 0, bosses: 0 };
  }

  reset() {
    this.total = 0;
    this.level = emptyLevelScore();
    this.streak = 0;
    this.streakTimer = 0;
    this.runBest = { streak: 0, kills: 0, elites: 0, secrets: 0, bosses: 0 };
  }

  resetLevel() {
    this.level = emptyLevelScore();
    this.streak = 0;
    this.streakTimer = 0;
    this.multiplier = 1;
  }

  update(dt, streakWindow) {
    this.streakWindow = streakWindow;
    if (this.streak > 0) {
      this.streakTimer -= dt;
      if (this.streakTimer <= 0) { this.streak = 0; this.multiplier = 1; }
    }
  }

  // What this depth is worth so far, before it is banked on the stair. The
  // altars charge against this, so it has to be readable mid-level.
  get levelSubtotal() {
    return Math.round(
      this.level.combat + this.level.streak + this.level.flawless
      + this.level.secrets + this.level.boss + this.level.penalty);
  }

  get streakFraction() {
    return this.streak > 0 ? Math.max(0, this.streakTimer / this.streakWindow) : 0;
  }

  addKill(baseValue, opts = {}) {
    const mods = opts.mods || {};
    this.streak++;
    this.streakTimer = this.streakWindow;
    this.multiplier = Math.min(STREAK_CAP, 1 + (this.streak - 1) * 0.22);
    const scoreMult = mods.scoreMult || 1;
    const raw = baseValue * scoreMult;
    const withStreak = raw * this.multiplier;
    this.level.combat += raw;
    this.level.streak += withStreak - raw;
    this.level.kills++;
    if (opts.elite) this.level.elites++;
    this.level.bestStreak = Math.max(this.level.bestStreak, this.streak);
    this.runBest.streak = Math.max(this.runBest.streak, this.streak);
    this.runBest.kills++;
    if (opts.elite) this.runBest.elites++;
    return { points: withStreak, multiplier: this.multiplier, streak: this.streak };
  }

  addFlawless(points, mods = {}) {
    const p = points * (mods.scoreMult || 1);
    this.level.flawless += p;
    this.level.flawlessRooms++;
    return p;
  }

  addSecret(points, mods = {}) {
    const p = points * (mods.scoreMult || 1);
    this.level.secrets += p;
    this.level.secretsFound++;
    this.runBest.secrets++;
    return p;
  }

  addBoss(points, mods = {}) {
    const p = points * (mods.scoreMult || 1);
    this.level.boss += p;
    this.runBest.bosses++;
    return p;
  }

  // Points taken away for something the player chose to do. Never scaled by
  // the score multiplier: a relic that makes deeds worth more must not also
  // make a killing worth less to have done.
  addPenalty(points, label) {
    const p = Math.abs(points);
    this.level.penalty -= p;
    this.level.penalties++;
    if (label) this.level.penaltyLabel = label;
    return p;
  }

  addBonus(points, mods = {}) {
    const p = points * (mods.scoreMult || 1);
    this.level.combat += p;
    return p;
  }

  // Called on descent. Returns a fully itemised breakdown for the summary.
  finishLevel({ depth, elapsed, parTime, hp, maxHp, mods = {} }) {
    const scoreMult = mods.scoreMult || 1;
    this.level.clear = (300 + depth * 120) * scoreMult;

    // Time bonus scales smoothly: no cliff at the par time, just less reward.
    const ratio = Math.max(0, 1 - elapsed / Math.max(1, parTime));
    this.level.time = Math.round(ratio * (400 + depth * 90) * (mods.timeBonus || 1) * scoreMult);

    this.level.health = Math.round((hp / Math.max(1, maxHp)) * (150 + depth * 25) * scoreMult);

    const subtotal = Math.round(
      this.level.combat + this.level.streak + this.level.time + this.level.clear +
      this.level.flawless + this.level.secrets + this.level.boss + this.level.health
      + this.level.penalty);
    this.total += subtotal;

    const breakdown = {
      depth,
      rows: [
        { label: 'Combat', value: Math.round(this.level.combat), detail: `${this.level.kills} slain` },
        { label: 'Kill Streak', value: Math.round(this.level.streak), detail: `best x${(1 + (this.level.bestStreak - 1) * 0.22).toFixed(2).replace(/\.00$/, '')}` },
        { label: 'Time Bonus', value: this.level.time, detail: `${Math.round(elapsed)}s of ${parTime}s par` },
        { label: 'Flawless Rooms', value: Math.round(this.level.flawless), detail: `${this.level.flawlessRooms} cleared unharmed` },
        { label: 'Secrets', value: Math.round(this.level.secrets), detail: `${this.level.secretsFound} found` },
        { label: 'Depth Cleared', value: Math.round(this.level.clear), detail: '' },
        { label: 'Vigour Remaining', value: this.level.health, detail: `${Math.round(hp)} / ${Math.round(maxHp)}` },
        { label: 'Blood Debt', value: Math.round(this.level.penalty),
          detail: this.level.penaltyLabel || `${this.level.penalties} answered for` },
      ],
      subtotal,
      total: this.total,
    };
    if (this.level.boss > 0) {
      breakdown.rows.splice(5, 0,
        { label: 'Boss Slain', value: Math.round(this.level.boss), detail: '' });
    }
    breakdown.rows = breakdown.rows.filter((r) => r.value !== 0 || r.label === 'Depth Cleared');
    return breakdown;
  }
}
