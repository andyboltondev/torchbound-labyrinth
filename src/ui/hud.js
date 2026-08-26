// Heads-up display. Only information the player needs mid-fight, updated
// from world state each frame but written to the DOM only when it changes.

import { keyColour } from '../gen/tiles.js';
import { depthLabel, formatScore } from '../core/util.js';

function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.root = $('hud');
    this.healthFill = $('healthFill');
    this.healthText = $('healthText');
    this.healthBar = this.healthFill.parentElement;
    this.healthMeter = $('healthMeter');
    this.depthChip = $('depthChip');
    this.timeChip = $('timeChip');
    this.timeText = $('timeText');
    this.timeParText = $('timeParText');
    this.hazardChip = $('hazardChip');
    this.hazardDot = $('hazardDot');
    this.hazardChipName = $('hazardChipName');
    this.hazardChipHint = $('hazardChipHint');
    this.objective = $('objective');
    this.objectiveDot = $('objectiveDot');
    this.objectiveText = $('objectiveText');
    this.ammoChip = $('ammoChip');
    this.ammoText = $('ammoText');
    this.keysChip = $('keysChip');
    this.scoreText = $('scoreText');
    this.streakBlock = $('streakBlock');
    this.streakText = $('streakText');
    this.streakFill = $('streakFill');
    this.hazardBanner = $('hazardBanner');
    this.hazardName = $('hazardName');
    this.hazardHint = $('hazardHint');
    this.bossBar = $('bossBar');
    this.bossMeter = $('bossMeter');
    this.bossName = $('bossName');
    this.bossFill = $('bossFill');
    this.actionPrompt = $('actionPrompt');
    this.actionKey = $('actionKey');
    this.actionLabel = $('actionLabel');
    this.actionHint = $('actionHint');
    this.toastStack = $('toastStack');
    this.touchMode = false;
    this._cache = {};
    this._hazardTimer = 0;
  }

  show() { this.root.hidden = false; }
  hide() { this.root.hidden = true; }

  // A frame-rate readout, drawn straight onto the canvas so it costs nothing
  // in layout and reflects what the renderer actually managed.
  drawFps(renderer, perf) {
    const ctx = renderer.ctx;
    ctx.save();
    ctx.setTransform(renderer.dpr, 0, 0, renderer.dpr, 0, 0);
    ctx.font = '600 12px "Trebuchet MS", system-ui, sans-serif';
    ctx.textAlign = 'left';
    const fps = Math.round(perf.fps);
    ctx.fillStyle = fps >= 55 ? 'rgba(111,206,135,0.9)'
      : fps >= 30 ? 'rgba(232,180,92,0.9)' : 'rgba(194,69,47,0.95)';
    const text = fps + ' fps  ' + perf.tier.name.toLowerCase();
    ctx.fillText(text, 14, renderer.height - 12);
    ctx.restore();
  }

  setTouchMode(on) {
    this.touchMode = on;
    this.actionKey.textContent = on ? 'ACT' : 'E';
  }

  toast(text, kind = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = text;
    this.toastStack.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .4s, transform .4s';
      el.style.opacity = '0';
      el.style.transform = 'translateY(-8px)';
      setTimeout(() => el.remove(), 420);
    }, 2200);
    // Never let toasts stack up into a wall of text.
    while (this.toastStack.children.length > 4) this.toastStack.firstChild.remove();
  }

  // The banner is the announcement -- it fires once and slides away. The chip
  // is the reminder, and it stays for as long as the hazard is actually
  // acting on the player: a rule you cannot see is a rule you cannot play to.
  announceHazard(hazard) {
    if (!hazard || hazard.id === 'clear') {
      this.hazardBanner.hidden = true;
      this.hazardChip.hidden = true;
      return;
    }
    this.hazardName.textContent = hazard.name;
    this.hazardHint.textContent = hazard.hint || '';
    this.hazardBanner.hidden = false;
    this._hazardTimer = 4.5;

    this.hazardChipName.textContent = hazard.name;
    this.hazardChipHint.textContent = hazard.hint || '';
    this.hazardDot.style.color = hazard.tint || '#8fa0b8';
    this.hazardChip.title = hazard.hint || hazard.name;
    this.hazardChip.hidden = false;
  }

  update(world, run, dt) {
    const c = this._cache;

    const hpFrac = Math.max(0, run.hp / Math.max(1, run.maxHp));
    if (c.hpFrac !== hpFrac) {
      const hp = Math.ceil(run.hp);
      const maxHp = Math.round(run.maxHp);
      this.healthFill.style.transform = `scaleX(${hpFrac})`;
      this.healthText.textContent = `${hp} / ${maxHp}`;
      this.healthBar.classList.toggle('low', hpFrac < 0.3);
      this.healthMeter.setAttribute('aria-valuemax', String(maxHp));
      this.healthMeter.setAttribute('aria-valuenow', String(hp));
      this.healthMeter.setAttribute('aria-valuetext', `${hp} of ${maxHp} vitality`);
      c.hpFrac = hpFrac;
    }

    const depth = 'Depth ' + depthLabel(run.depth) + (world.level.isBoss ? '  \u2022  Boss' : '');
    if (c.depth !== depth) { this.depthChip.textContent = depth; c.depth = depth; }

    // Elapsed against par. The time bonus is a real decision only if the
    // player can see the clock they are being paid against.
    const par = world.level.parTime || 0;
    if (par > 0) {
      const elapsed = clock(world.elapsed);
      if (c.time !== elapsed) {
        this.timeChip.hidden = false;
        this.timeText.textContent = elapsed;
        c.time = elapsed;
      }
      if (c.par !== par) {
        this.timeParText.textContent = ' / ' + clock(par);
        c.par = par;
      }
      const over = world.elapsed > par;
      if (c.timeOver !== over) {
        this.timeChip.classList.toggle('over', over);
        this.timeChip.title = over
          ? 'Past par. The time bonus for this depth is spent.'
          : 'Reach the stair inside par for the largest time bonus.';
        c.timeOver = over;
      }
    } else if (!this.timeChip.hidden) {
      this.timeChip.hidden = true;
    }

    const objective = world.currentObjective();
    if (c.objective !== objective.text) {
      c.objective = objective.text;
      this.objective.hidden = false;
      this.objectiveText.textContent = objective.text;
      this.objectiveDot.style.color = objective.colour;
    }

    if (run.hasCrossbow) {
      this.ammoChip.hidden = false;
      const ammo = `${run.arrows} / ${run.maxArrows}`;
      if (c.ammo !== ammo) { this.ammoText.textContent = ammo; c.ammo = ammo; }
    } else if (!this.ammoChip.hidden) {
      this.ammoChip.hidden = true;
    }

    // Keys held, shown as coloured pips so the matching gate is obvious.
    const keySig = Array.from(run.keys).sort().join(',');
    if (c.keys !== keySig) {
      c.keys = keySig;
      this.keysChip.innerHTML = '';
      if (run.keys.size) {
        this.keysChip.hidden = false;
        for (const idx of Array.from(run.keys).sort()) {
          const pip = document.createElement('i');
          pip.className = 'key-pip';
          pip.style.color = keyColour(idx).hex;
          pip.title = keyColour(idx).name + ' Key';
          pip.setAttribute('role', 'listitem');
          pip.setAttribute('aria-label', keyColour(idx).name + ' key');
          this.keysChip.appendChild(pip);
        }
      } else {
        this.keysChip.hidden = true;
      }
    }

    const score = formatScore(run.score.total + this._levelPoints(run));
    if (c.score !== score) { this.scoreText.textContent = score; c.score = score; }

    const streak = run.score.streak;
    if (streak >= 2) {
      this.streakBlock.hidden = false;
      const label = 'x' + run.score.multiplier.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
      if (c.streak !== label) { this.streakText.textContent = label + '  ' + streak + ' kills'; c.streak = label; }
      this.streakFill.style.transform = `scaleX(${run.score.streakFraction})`;
    } else if (!this.streakBlock.hidden) {
      this.streakBlock.hidden = true;
      c.streak = null;
    }

    if (this._hazardTimer > 0) {
      this._hazardTimer -= dt;
      if (this._hazardTimer <= 0) this.hazardBanner.hidden = true;
    }

    if (world.boss && !world.boss.dead && world.boss.awake) {
      this.bossBar.hidden = false;
      if (c.bossName !== world.boss.def.name) {
        this.bossName.textContent = world.boss.def.name;
        c.bossName = world.boss.def.name;
      }
      const frac = Math.max(0, world.boss.hp / world.boss.maxHp);
      this.bossFill.style.transform = `scaleX(${frac})`;
      this.bossMeter.setAttribute('aria-valuenow', String(Math.round(frac * 100)));
      this.bossMeter.setAttribute('aria-label', world.boss.def.name);
    } else if (!this.bossBar.hidden) {
      this.bossBar.hidden = true;
      c.bossName = null;
    }

    const target = world.interactTarget;
    const sig = target ? target.label + '|' + target.enabled + '|' + (target.hint || '') : '';
    if (c.prompt !== sig) {
      c.prompt = sig;
      if (!target) this.actionPrompt.hidden = true;
      else {
        this.actionPrompt.hidden = false;
        this.actionPrompt.classList.toggle('disabled', !target.enabled);
        this.actionLabel.textContent = target.label;
        this.actionHint.textContent = target.hint || '';
      }
    }
  }

  _levelPoints(run) {
    const l = run.score.level;
    return l.combat + l.streak + l.flawless + l.secrets + l.boss;
  }
}
