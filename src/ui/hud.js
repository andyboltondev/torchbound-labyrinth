// Heads-up display. Only information the player needs mid-fight, updated
// from world state each frame but written to the DOM only when it changes.

import { keyColour } from '../gen/tiles.js';
import { depthLabel, formatScore } from '../core/util.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.root = $('hud');
    this.healthFill = $('healthFill');
    this.healthText = $('healthText');
    this.healthBar = this.healthFill.parentElement;
    this.depthChip = $('depthChip');
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

  announceHazard(hazard) {
    if (!hazard || hazard.id === 'clear') { this.hazardBanner.hidden = true; return; }
    this.hazardName.textContent = hazard.name;
    this.hazardHint.textContent = hazard.hint || '';
    this.hazardBanner.hidden = false;
    this._hazardTimer = 4.5;
  }

  update(world, run, dt) {
    const c = this._cache;

    const hpFrac = Math.max(0, run.hp / Math.max(1, run.maxHp));
    if (c.hpFrac !== hpFrac) {
      this.healthFill.style.transform = `scaleX(${hpFrac})`;
      this.healthText.textContent = `${Math.ceil(run.hp)} / ${Math.round(run.maxHp)}`;
      this.healthBar.classList.toggle('low', hpFrac < 0.3);
      c.hpFrac = hpFrac;
    }

    const depth = 'Depth ' + depthLabel(run.depth) + (world.level.isBoss ? '  \u2022  Boss' : '');
    if (c.depth !== depth) { this.depthChip.textContent = depth; c.depth = depth; }

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
      this.bossFill.style.transform = `scaleX(${Math.max(0, world.boss.hp / world.boss.maxHp)})`;
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
