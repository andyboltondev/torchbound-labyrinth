// Screen manager and every full-screen interface: home, Hall of Fame,
// bestiary, settings, pause, relic choice, score summary and run end.

import { profile, DEFAULT_SETTINGS } from '../game/profile.js';
import { ENEMY_LIST, BOSSES, ENEMIES } from '../game/enemyData.js';
import { RELIC_BY_ID } from '../game/relics.js';
import { formatScore, depthLabel } from '../core/util.js';
import { drawEnemy, drawBoss } from '../render/actors.js';

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

const button = (label, cls = 'btn', onClick) => {
  const b = el('button', cls, label);
  if (onClick) b.addEventListener('click', onClick);
  return b;
};

export class Screens {
  constructor(host) {
    this.root = document.getElementById('screens');
    this.host = host;          // { audio, start, resume, quit, chooseRelic, ... }
    this.current = null;
    this.node = null;
  }

  hide() {
    if (this.node) { this.node.remove(); this.node = null; }
    this.current = null;
  }

  show(name, data = {}) {
    this.hide();
    const builder = this['screen_' + name];
    if (!builder) return;
    const screen = el('div', 'screen active');
    const panel = builder.call(this, data);
    screen.appendChild(panel);
    this.root.appendChild(screen);
    this.node = screen;
    this.current = name;
    // Focus the primary control so keyboard and gamepad users are not lost.
    const focus = panel.querySelector('.btn.primary, input, .btn');
    if (focus) setTimeout(() => focus.focus({ preventScroll: true }), 40);
    return panel;
  }

  click(fn) {
    return (e) => {
      if (this.host.audio) this.host.audio.play('uiClick');
      fn(e);
    };
  }

  // ------------------------------------------------------------- home
  screen_home() {
    const panel = el('div', 'panel');
    panel.appendChild(el('h1', 'title', 'Torchbound'));
    panel.appendChild(el('h1', 'title', 'Labyrinth'));
    panel.appendChild(el('p', 'subtitle', 'A descent into the Norse under-halls'));

    const flavour = el('p', 'flavour');
    flavour.style.textAlign = 'center';
    flavour.style.marginTop = '22px';
    flavour.textContent = FLAVOUR[Math.floor(Math.random() * FLAVOUR.length)];
    panel.appendChild(flavour);

    const menu = el('div', 'menu');
    menu.appendChild(button('Begin the Descent', 'btn primary', this.click(() => this.host.start())));
    menu.appendChild(button('Hall of Fame', 'btn', this.click(() => this.show('hall'))));
    menu.appendChild(button('Bestiary', 'btn', this.click(() => this.show('bestiary', { from: 'home' }))));
    menu.appendChild(button('Settings', 'btn ghost', this.click(() => this.show('settings', { from: 'home' }))));
    panel.appendChild(menu);

    const stats = el('div', 'kv');
    stats.style.justifyContent = 'center';
    stats.style.marginTop = '24px';
    const add = (label, value) => {
      const d = el('div');
      d.appendChild(el('b', null, value));
      d.appendChild(document.createTextNode(label));
      stats.appendChild(d);
    };
    add('runs', String(profile.stats.runs));
    add('deepest', profile.stats.deepest ? 'Depth ' + profile.stats.deepest : '--');
    add('best score', formatScore(profile.stats.bestScore));
    add('creatures known', profile.bestiary.size + ' / ' + ENEMY_LIST.length);
    panel.appendChild(stats);

    const controls = el('div');
    controls.style.marginTop = '22px';
    controls.appendChild(el('p', 'hint', 'Move with WASD or the arrow keys: they walk the '
      + 'dungeon’s compass, so Up is north and the corridors run with your keys. '
      + 'Space or J to slash, F or K to loose a bolt, E to act, Esc to pause. '
      + 'On a touch screen the controls appear on the glass.'));
    panel.appendChild(controls);
    return panel;
  }

  // ----------------------------------------------------- hall of fame
  screen_hall(data = {}) {
    const panel = el('div', 'panel');
    panel.appendChild(el('h2', 'screen-title', 'Hall of Fame'));
    panel.appendChild(el('p', 'screen-sub', 'The ten deepest names still spoken in the mead hall.'));

    const table = el('table', 'board');
    const head = el('tr');
    for (const h of ['', 'Name', 'Build', 'Depth', 'Bosses', 'Score']) head.appendChild(el('th', null, h));
    table.appendChild(head);

    const board = profile.board.slice().sort((a, b) => b.score - a.score).slice(0, 10);
    board.forEach((entry, i) => {
      const tr = el('tr');
      if (data.highlight !== undefined && data.highlight === i) tr.className = 'you';
      tr.appendChild(el('td', 'rank', String(i + 1)));
      tr.appendChild(el('td', null, entry.name));
      tr.appendChild(el('td', null, entry.build || 'Torchbearer'));
      tr.appendChild(el('td', 'num', 'D' + entry.depth));
      tr.appendChild(el('td', 'num', String(entry.bosses || 0)));
      tr.appendChild(el('td', 'num', formatScore(entry.score)));
      table.appendChild(tr);
    });
    panel.appendChild(table);

    const row = el('div', 'btn-row');
    row.appendChild(button('Back', 'btn', this.click(() => this.show(data.from || 'home'))));
    panel.appendChild(row);
    return panel;
  }

  // -------------------------------------------------------- bestiary
  screen_bestiary(data = {}) {
    const panel = el('div', 'panel wide');
    panel.appendChild(el('h2', 'screen-title', 'Bestiary'));
    panel.appendChild(el('p', 'screen-sub',
      `What you have met and lived to describe. ${profile.bestiary.size} of ${ENEMY_LIST.length} creatures, ${profile.bosses.size} of ${BOSSES.length} great foes.`));

    const grid = el('div', 'beast-grid');
    for (const def of ENEMY_LIST) {
      grid.appendChild(this._beastCard(def, profile.bestiary.has(def.id), false));
    }
    panel.appendChild(grid);

    panel.appendChild(el('h2', 'screen-title', 'Great Foes'));
    const bossGrid = el('div', 'beast-grid');
    for (const def of BOSSES) {
      bossGrid.appendChild(this._beastCard(def, profile.bosses.has(def.id), true));
    }
    panel.appendChild(bossGrid);

    const row = el('div', 'btn-row');
    row.appendChild(button('Back', 'btn', this.click(() => {
      if (data.from === 'pause') this.show('pause');
      else this.show(data.from || 'home');
    })));
    panel.appendChild(row);
    return panel;
  }

  _beastCard(def, known, isBoss) {
    const card = el('div', 'beast ' + (known ? 'known' : 'unknown'));
    const canvas = el('canvas');
    const size = 84;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr; canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.translate(size / 2, size - 12);
    if (known) {
      const fake = {
        x: 0, y: 0, def, elite: false, scale: isBoss ? 0.95 : 1.25,
        faceX: 0.6, faceY: 0.8, animTime: 1.2, speedNow: 0, windup: 0,
        hurtFlash: 0, hp: 1, maxHp: 1, seed: 0.4, alertPulse: 0,
        dormant: false, carriesKey: null, telegraph: 0, telegraphRadius: 0,
      };
      try {
        if (isBoss) drawBoss(ctx, fake, 1.4);
        else drawEnemy(ctx, fake, 1.4);
      } catch (err) { /* a portrait is not worth breaking the screen for */ }
    } else {
      ctx.fillStyle = 'rgba(120,135,158,.22)';
      ctx.beginPath();
      ctx.ellipse(0, -26, 15, 26, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(120,135,158,.5)';
      ctx.font = '700 26px "Palatino Linotype", Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText('?', 0, -18);
    }
    card.appendChild(canvas);
    card.appendChild(el('div', 'bname', known ? def.name : 'Unrecorded'));
    card.appendChild(el('div', 'bkind', known
      ? (isBoss ? 'Great Foe' : def.behaviour)
      : (isBoss ? 'Great Foe' : 'Unknown')));
    if (known) {
      const stats = el('div', 'beast-stats');
      const stat = (label, value) => {
        const d = el('div');
        d.appendChild(el('b', null, String(value)));
        d.appendChild(document.createTextNode(' ' + label));
        stats.appendChild(d);
      };
      stat('hp', isBoss ? def.hp : def.hp);
      stat('dmg', def.damage);
      if (!isBoss) stat('sight', def.detect.toFixed(1));
      card.appendChild(stats);
      card.appendChild(el('div', 'blore', def.lore));
      card.appendChild(el('div', 'bthreat', def.threat));
    } else {
      card.appendChild(el('div', 'blore', 'You have not met this one. Or you did not survive the meeting.'));
    }
    return card;
  }

  // -------------------------------------------------------- settings
  screen_settings(data = {}) {
    const panel = el('div', 'panel');
    panel.appendChild(el('h2', 'screen-title', 'Settings'));
    panel.appendChild(el('p', 'screen-sub', 'Saved on this device.'));

    const slider = (label, key, min = 0, max = 1, step = 0.05, format = (v) => Math.round(v * 100) + '%') => {
      const row = el('div', 'setting');
      row.appendChild(el('label', null, label));
      const input = el('input');
      input.type = 'range';
      input.min = min; input.max = max; input.step = step;
      input.value = profile.settings[key];
      const value = el('span', 'value', format(profile.settings[key]));
      input.addEventListener('input', () => {
        profile.settings[key] = parseFloat(input.value);
        value.textContent = format(profile.settings[key]);
        profile.saveSettings();
        if (this.host.audio) this.host.audio.applySettings();
      });
      input.addEventListener('change', () => {
        if (this.host.audio) this.host.audio.play('uiClick');
      });
      row.appendChild(input);
      row.appendChild(value);
      panel.appendChild(row);
    };

    slider('Master volume', 'master');
    slider('Music', 'music');
    slider('Sound effects', 'sfx');
    slider('Screen shake', 'screenShake', 0, 1.5, 0.1, (v) => Math.round(v * 100) + '%');

    const segmented = (labelText, key, options, hint) => {
      const row = el('div', 'setting');
      const label = el('div');
      label.style.flex = '1 1 auto';
      label.appendChild(el('div', null, labelText));
      if (hint) {
        const h = el('div', 'hint', hint);
        h.style.marginTop = '2px';
        label.appendChild(h);
      }
      row.appendChild(label);
      const group = el('div', 'seg');
      for (const opt of options) {
        const b = el('button', profile.settings[key] === opt.value ? 'on' : '', opt.label);
        b.addEventListener('click', () => {
          profile.settings[key] = opt.value;
          profile.saveSettings();
          for (const other of group.children) other.className = '';
          b.className = 'on';
          if (this.host.onSettingChanged) this.host.onSettingChanged(key);
          if (this.host.audio) this.host.audio.play('uiClick');
        });
        group.appendChild(b);
      }
      row.appendChild(group);
      panel.appendChild(row);
    };

    segmented('Direction keys', 'movementFrame', [
      { value: 'dungeon', label: 'Dungeon axes' },
      { value: 'view', label: 'Screen direction' },
    ], 'Dungeon axes point the keys along the corridors: Up walks north, which '
      + 'the view draws as up-and-to-the-right. Screen direction makes Up move '
      + 'straight up the display instead.');

    segmented('Blocked direction', 'movementAssist', [
      { value: 'corridor', label: 'Take the nearest way' },
      { value: 'strict', label: 'Stop' },
    ], 'What happens when the way you pressed is a wall. Under the dungeon '
      + 'axes a blocked cardinal always stops you either way, so this only '
      + 'changes diagonal presses.');

    const seg = el('div', 'setting');
    seg.appendChild(el('label', null, 'Touch controls'));
    const group = el('div', 'seg');
    for (const mode of ['auto', 'always', 'never']) {
      const b = el('button', profile.settings.touchControls === mode ? 'on' : '', mode);
      b.addEventListener('click', () => {
        profile.settings.touchControls = mode;
        profile.saveSettings();
        for (const other of group.children) other.className = '';
        b.className = 'on';
        if (this.host.onTouchModeChange) this.host.onTouchModeChange();
        if (this.host.audio) this.host.audio.play('uiClick');
      });
      group.appendChild(b);
    }
    seg.appendChild(group);
    panel.appendChild(seg);

    const controls = el('div');
    controls.style.marginTop = '22px';
    controls.appendChild(el('h2', 'screen-title', 'Controls'));
    const grid = el('div', 'controls-grid');
    const pairs = [
      ['Move north', 'W / Up'], ['Move east', 'D / Right'],
      ['Move south', 'S / Down'], ['Move west', 'A / Left'],
      ['Slash', 'Space / J'], ['Fire crossbow', 'F / K'],
      ['Action', 'E / Enter'], ['Pause', 'Esc / P'], ['Bestiary', 'B'],
    ];
    for (const [a, b] of pairs) {
      const d = el('div');
      d.appendChild(document.createTextNode(a));
      d.appendChild(el('b', null, b));
      grid.appendChild(d);
    }
    controls.appendChild(grid);
    panel.appendChild(controls);

    const row = el('div', 'btn-row');
    row.appendChild(button('Back', 'btn', this.click(() => {
      if (data.from === 'pause') this.show('pause');
      else this.show(data.from || 'home');
    })));
    panel.appendChild(row);
    return panel;
  }

  // ----------------------------------------------------------- pause
  screen_pause(data = {}) {
    const run = this.host.run;
    const panel = el('div', 'panel');
    panel.appendChild(el('h2', 'screen-title', 'Paused'));
    panel.appendChild(el('p', 'screen-sub',
      run ? `Depth ${depthLabel(run.depth)}  \u2014  ${run.build}` : ''));

    if (run) panel.appendChild(this._relicList(run));

    const menu = el('div', 'menu');
    menu.appendChild(button('Resume', 'btn primary', this.click(() => this.host.resume())));
    menu.appendChild(button('Bestiary', 'btn', this.click(() => this.show('bestiary', { from: 'pause' }))));
    menu.appendChild(button('Settings', 'btn', this.click(() => this.show('settings', { from: 'pause' }))));
    menu.appendChild(button('Abandon Run', 'btn ghost', this.click(() => this.show('confirmQuit'))));
    panel.appendChild(menu);
    return panel;
  }

  screen_confirmQuit() {
    const panel = el('div', 'panel');
    panel.appendChild(el('h2', 'screen-title', 'Abandon the descent?'));
    panel.appendChild(el('p', 'screen-sub',
      'Your score so far will still be offered to the Hall of Fame. The run itself ends here.'));
    const row = el('div', 'btn-row');
    row.appendChild(button('Keep Going', 'btn primary', this.click(() => this.show('pause'))));
    row.appendChild(button('Abandon', 'btn ghost', this.click(() => this.host.quit())));
    panel.appendChild(row);
    return panel;
  }

  _relicList(run) {
    const wrap = el('div');
    const ids = Object.keys(run.relics).filter((id) => run.relics[id] > 0);
    if (!ids.length) {
      wrap.appendChild(el('p', 'hint', 'No relics yet. Clear a depth to claim one.'));
      return wrap;
    }
    const list = el('div', 'relic-list');
    for (const id of ids) {
      const relic = RELIC_BY_ID[id];
      if (!relic) continue;
      const pill = el('span', 'relic-pill');
      pill.appendChild(el('b', null, relic.name));
      if (run.relics[id] > 1) pill.appendChild(document.createTextNode(' x' + run.relics[id]));
      pill.title = relic.text + ' -- ' + relic.cost;
      list.appendChild(pill);
    }
    wrap.appendChild(list);
    return wrap;
  }

  // ------------------------------------------------------ level summary
  screen_summary(data) {
    const { breakdown, run, nextIsBoss } = data;
    const panel = el('div', 'panel');
    panel.appendChild(el('h2', 'screen-title', 'Depth ' + depthLabel(breakdown.depth) + ' cleared'));
    panel.appendChild(el('p', 'screen-sub', nextIsBoss
      ? 'Something below is awake, and it knows the stair.'
      : 'The stair goes deeper.'));

    const rows = el('div', 'summary-rows');
    breakdown.rows.forEach((r, i) => {
      const row = el('div', 'summary-row');
      row.style.animationDelay = (i * 70) + 'ms';
      row.appendChild(el('span', 'label', r.label));
      row.appendChild(el('span', 'detail', r.detail || ''));
      row.appendChild(el('span', 'value', '+' + formatScore(r.value)));
      rows.appendChild(row);
    });
    panel.appendChild(rows);

    const total = el('div', 'summary-total');
    total.appendChild(el('span', 'label', 'Depth total'));
    total.appendChild(el('span', 'value', formatScore(breakdown.subtotal)));
    panel.appendChild(total);

    const running = el('p', 'hint');
    running.style.textAlign = 'right';
    running.textContent = 'Run total  ' + formatScore(breakdown.total);
    panel.appendChild(running);

    const row = el('div', 'btn-row');
    row.appendChild(button('Claim a Relic', 'btn primary', this.click(() => this.host.afterSummary())));
    panel.appendChild(row);
    return panel;
  }

  // ------------------------------------------------------ relic choice
  screen_relics(data) {
    const { offers, run, guaranteed } = data;
    const panel = el('div', 'panel wide');
    panel.appendChild(el('h2', 'screen-title', guaranteed ? 'Spoils of the Great Foe' : 'Choose a Relic'));
    panel.appendChild(el('p', 'screen-sub',
      'One only. What you take shapes the rest of the descent.'));

    const grid = el('div', 'relic-grid');
    if (!offers.length) {
      panel.appendChild(el('p', 'hint', 'Nothing here can serve you further. The labyrinth offers only the stair.'));
    }
    for (const relic of offers) {
      const card = el('button', 'relic-card');
      const owned = run.relics[relic.id] || 0;
      if (owned) card.appendChild(el('span', 'relic-owned', 'owned x' + owned));
      card.appendChild(el('span', 'relic-tag', relic.tag));
      card.appendChild(el('span', 'relic-name', relic.name));
      card.appendChild(el('span', 'relic-text', relic.text));
      if (relic.cost && relic.cost !== 'None.') card.appendChild(el('span', 'relic-cost', relic.cost));
      card.addEventListener('click', () => {
        if (this.host.audio) this.host.audio.play('relicTake');
        this.host.chooseRelic(relic);
      });
      grid.appendChild(card);
    }
    panel.appendChild(grid);

    const skip = el('div', 'btn-row');
    skip.appendChild(button(offers.length ? 'Take nothing' : 'Descend', 'btn ghost',
      this.click(() => this.host.chooseRelic(null))));
    panel.appendChild(skip);

    const build = el('p', 'hint');
    build.style.marginTop = '16px';
    build.textContent = 'Current path: ' + run.build;
    panel.appendChild(build);
    panel.appendChild(this._relicList(run));
    return panel;
  }

  // -------------------------------------------------------- run ending
  screen_gameover(data) {
    const { run, reason } = data;
    const score = run.score.total;
    const rank = profile.rankFor(score);
    const panel = el('div', 'panel');

    panel.appendChild(el('h2', 'screen-title',
      reason === 'quit' ? 'The descent abandoned' : 'The torch goes out'));
    panel.appendChild(el('p', 'screen-sub',
      reason === 'quit'
        ? 'You climbed back into the light while you still could.'
        : DEATH_LINES[Math.floor(Math.random() * DEATH_LINES.length)]));

    const stats = el('div', 'kv');
    const add = (label, value) => {
      const d = el('div');
      d.appendChild(el('b', null, value));
      d.appendChild(document.createTextNode(label));
      stats.appendChild(d);
    };
    add('final score', formatScore(score));
    add('depth reached', 'Depth ' + run.depth);
    add('great foes slain', String(run.bossesDefeated));
    add('creatures slain', String(run.score.runBest.kills));
    add('best streak', String(run.score.runBest.streak));
    add('path', run.build);
    panel.appendChild(stats);
    panel.appendChild(this._relicList(run));

    if (rank) {
      panel.appendChild(el('p', 'flavour',
        `That is ${ordinal(rank)} place. The hall wants your name.`));
      const entry = el('div', 'name-entry');
      const input = el('input');
      input.maxLength = 14;
      input.placeholder = 'Your name';
      input.value = localStorage.getItem('torchbound.lastName') || '';
      const submit = button('Carve it', 'btn primary', () => {
        const name = (input.value || 'Nameless').trim().slice(0, 14) || 'Nameless';
        try { localStorage.setItem('torchbound.lastName', name); } catch (e) { /* ignore */ }
        const placed = profile.submit({
          name, score, depth: run.depth, bosses: run.bossesDefeated, build: run.build,
        });
        if (this.host.audio) this.host.audio.play('fanfare');
        this.show('hall', { highlight: placed - 1, from: 'home' });
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit.click(); });
      entry.appendChild(input);
      entry.appendChild(submit);
      panel.appendChild(entry);
      const row = el('div', 'btn-row');
      row.appendChild(button('Skip', 'btn ghost', this.click(() => this.show('home'))));
      panel.appendChild(row);
    } else {
      const miss = profile.shortfall(score);
      const near = el('div', 'near-miss');
      near.appendChild(el('div', 'place', ordinal(miss.place)));
      near.appendChild(el('div', 'gap',
        `You were ${formatScore(miss.gap)} points from the Hall of Fame.`));
      panel.appendChild(near);
      const row = el('div', 'btn-row');
      row.appendChild(button('Descend Again', 'btn primary', this.click(() => this.host.start())));
      row.appendChild(button('Hall of Fame', 'btn', this.click(() => this.show('hall'))));
      row.appendChild(button('Home', 'btn ghost', this.click(() => this.show('home'))));
      panel.appendChild(row);
    }
    return panel;
  }

  // ---------------------------------------------------------- loading
  screen_loading(data = {}) {
    const panel = el('div', 'panel');
    panel.style.textAlign = 'center';
    const wrap = el('div', 'loading');
    wrap.appendChild(el('div', 'spinner'));
    wrap.appendChild(el('h2', 'screen-title', data.title || 'Descending'));
    wrap.appendChild(el('p', 'flavour', data.text || ''));
    panel.appendChild(wrap);
    return panel;
  }
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const DEATH_LINES = [
  'The dark did not need long.',
  'Somewhere above, the stair is still waiting.',
  'You are counted among the barrow now.',
  'The labyrinth keeps what it takes.',
  'Your fire is out. The hall goes on burning.',
];

const FLAVOUR = [
  'The stair goes down. It has always gone down.',
  'Carry fire. Everything below remembers the light.',
  'They buried a hall here, and the hall did not agree to stay buried.',
  'Nine depths, they said. They were counting wrong.',
  'What the torch shows you is a kindness. What it hides is the truth.',
];

export const DESCENT_FLAVOUR = [
  'Deeper. The air changes.',
  'The carvings here are older, and angrier.',
  'Something moved before your torch reached it.',
  'The stone is warm. That is not a good sign.',
  'You can hear water, a long way down.',
  'The runes stop being warnings and start being names.',
];
