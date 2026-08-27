// Screen manager and every full-screen interface: home, Hall of Fame,
// bestiary, settings, pause, relic choice, score summary and run end.

import { profile, DEFAULT_SETTINGS } from '../game/profile.js';
import { rank } from '../game/hall.js';
import { DIFFICULTY_LIST, difficultyById } from '../game/difficulty.js';
import { ENEMY_LIST, BOSSES, ENEMIES } from '../game/enemyData.js';
import { RELIC_BY_ID } from '../game/relics.js';
import { formatScore, depthLabel } from '../core/util.js';
import { drawEnemy, drawBoss } from '../render/actors.js';
import { BUILD_STRING, BUILD_DETAIL } from '../core/version.js';

// What each size of bargain is called. The player never sees the word "tier".
const TIER_NAME = { 1: 'A small thing', 2: 'A real price', 3: 'Everything it can ask' };

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
    // Every screen is a modal over live game state, and assistive technology
    // has no other way to know that. The title doubles as the accessible name.
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    const heading = panel.querySelector('h1, h2');
    if (heading) {
      if (!heading.id) heading.id = 'screen-title-' + name;
      panel.setAttribute('aria-labelledby', heading.id);
    } else {
      panel.setAttribute('aria-label', name);
    }
    screen.appendChild(panel);
    this.root.appendChild(screen);
    this.node = screen;
    this.current = name;
    // The score follows the screen. Told after the screen exists, so anything
    // that reads game state on the way past sees the new one.
    if (this.host.onScreen) this.host.onScreen(name, data);
    // Focus the primary control so keyboard and gamepad users are not lost.
    const focus = panel.querySelector('.btn.primary, input, .btn');
    if (focus) setTimeout(() => focus.focus({ preventScroll: true }), 40);
    return panel;
  }

  // The three states a tile can be in (section 17). Shown while the player is
  // still learning to read them, and kept in Settings as a reference.
  _visibilityLegend() {
    const wrap = el('div', 'legend');
    wrap.appendChild(el('div', 'legend-title', 'Reading the dark'));
    const row = el('div', 'legend-row');
    const item = (cls, name, text) => {
      const d = el('div', 'legend-item');
      const sw = el('i', 'legend-swatch ' + cls);
      sw.setAttribute('aria-hidden', 'true');
      d.appendChild(sw);
      const body = el('div');
      body.appendChild(el('b', null, name));
      body.appendChild(el('span', null, text));
      d.appendChild(body);
      row.appendChild(d);
    };
    item('lit', 'Torchlit', 'Where you are now. Full detail, and the only place you can be surprised in colour.');
    item('mem', 'Remembered', 'Walked already. Cold, flat and fading -- fog eats it faster.');
    item('dark', 'Unseen', 'Never lit. Drawn as nothing at all.');
    wrap.appendChild(row);
    return wrap;
  }

  // The build stamp, shown on the home screen and in the pause menu. The
  // detail line names the commit (and pull request, when the build came from
  // one) so a report of "it did this on build X" can be traced to the code.
  _buildStamp() {
    const p = el('p', 'build-stamp');
    p.appendChild(el('b', null, BUILD_STRING));
    if (BUILD_DETAIL) p.appendChild(el('small', null, BUILD_DETAIL));
    p.title = BUILD_STRING + '  ·  ' + BUILD_DETAIL;
    return p;
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
    flavour.style.margin = '16px 0 0';
    flavour.textContent = FLAVOUR[Math.floor(Math.random() * FLAVOUR.length)];
    panel.appendChild(flavour);

    const columns = el('div', 'home-split');

    const menu = el('div', 'menu');
    menu.appendChild(button('Begin the Descent', 'btn primary',
      this.click(() => this.show('difficulty'))));
    menu.appendChild(button('Bestiary', 'btn', this.click(() => this.show('bestiary', { from: 'home' }))));
    menu.appendChild(button('Settings', 'btn ghost', this.click(() => this.show('settings', { from: 'home' }))));
    columns.appendChild(menu);
    columns.appendChild(this._hallPreview());
    panel.appendChild(columns);

    const stats = el('div', 'kv');
    stats.style.justifyContent = 'center';
    stats.style.marginTop = '20px';
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
    controls.style.marginTop = '16px';
    controls.appendChild(el('p', 'hint', 'Move with WASD or the arrow keys: they walk the '
      + 'dungeon’s compass, so Up is north and the corridors run with your keys. '
      + 'Space or J to slash, F or K to loose a bolt, E to act, T to put out '
      + 'your torch or light it again, Esc to pause. '
      + 'On a touch screen the controls appear on the glass.'));
    panel.appendChild(controls);
    panel.appendChild(this._buildStamp());
    return panel;
  }

  // The five loudest names, inline. A leaderboard the player never opens is a
  // leaderboard that motivates nobody.
  _hallPreview() {
    const wrap = el('aside', 'hall-preview');
    const head = el('div', 'hall-preview-head');
    head.appendChild(el('span', 'eyebrow', 'Hall of Fame'));
    head.appendChild(el('span', 'hall-preview-sub', 'Deepest names still spoken'));
    wrap.appendChild(head);

    const board = profile.board.slice().sort((a, b) => b.score - a.score).slice(0, 5);
    const list = el('ol', 'hall-preview-list');
    if (!board.length) {
      list.appendChild(el('li', 'empty', 'No names carved yet.'));
    }
    board.forEach((entry, i) => {
      const li = el('li');
      li.appendChild(el('i', 'rank', String(i + 1)));
      const who = el('div', 'who');
      who.appendChild(el('b', null, entry.name));
      const diff = difficultyById(entry.diff);
      who.appendChild(el('small', null, 'Depth ' + entry.depth + '  ·  ' + diff.name));
      li.appendChild(who);
      li.appendChild(el('strong', null, formatScore(entry.score)));
      list.appendChild(li);
    });
    wrap.appendChild(list);
    wrap.appendChild(button('View the full hall', 'btn ghost small',
      this.click(() => this.show('hall'))));
    return wrap;
  }

  // -------------------------------------------------- difficulty choice
  screen_difficulty() {
    const panel = el('div', 'panel wide');
    panel.appendChild(el('h2', 'screen-title', 'How will you go down?'));
    panel.appendChild(el('p', 'screen-sub',
      'Chosen once, for the whole descent. The labyrinth does not renegotiate.'));

    const grid = el('div', 'difficulty-grid');
    for (const diff of DIFFICULTY_LIST) {
      const card = el('button', 'difficulty-card'
        + (profile.settings.difficulty === diff.id ? ' last-used' : ''));
      card.type = 'button';
      if (profile.settings.difficulty === diff.id) {
        card.appendChild(el('span', 'difficulty-last', 'last chosen'));
      }
      card.appendChild(el('span', 'difficulty-name', diff.name));
      card.appendChild(el('span', 'difficulty-tagline', diff.tagline));
      card.appendChild(el('span', 'difficulty-text', diff.text));
      card.appendChild(el('span', 'difficulty-cost', diff.cost));
      const marks = el('span', 'difficulty-marks');
      marks.appendChild(el('i', diff.ranked ? 'yes' : 'no',
        diff.ranked ? 'Hall of Fame' : 'Unranked'));
      if (diff.retry) marks.appendChild(el('i', 'yes', 'Stair on death'));
      card.appendChild(marks);
      card.addEventListener('click', () => {
        profile.settings.difficulty = diff.id;
        profile.saveSettings();
        if (this.host.audio) this.host.audio.play('relicTake');
        this.host.start(diff.id);
      });
      grid.appendChild(card);
    }
    panel.appendChild(grid);

    const row = el('div', 'btn-row');
    row.appendChild(button('Back', 'btn ghost', this.click(() => this.show('home'))));
    panel.appendChild(row);
    return panel;
  }

  // ----------------------------------------------------- hall of fame
  // Fifty names, scrollable, filterable by mode, and a table you can take
  // away with you. The file is the point: a hall of fame kept on one machine
  // that cannot be moved off it is a hall of fame you lose with the browser.
  screen_hall(data = {}) {
    const panel = el('div', 'panel wide');
    panel.appendChild(el('h2', 'screen-title', 'Hall of Fame'));
    panel.appendChild(el('p', 'screen-sub',
      'The fifty deepest names still spoken in the mead hall. Kept on this '
      + 'machine, in a file you can carry.'));

    const filter = data.filter || 'all';
    const modes = el('div', 'seg hall-filter');
    modes.setAttribute('role', 'group');
    modes.setAttribute('aria-label', 'Filter by mode');
    const addMode = (value, label) => {
      const b = el('button', filter === value ? 'on' : '', label);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(filter === value));
      b.addEventListener('click', this.click(() => this.show('hall', { ...data, filter: value })));
      modes.appendChild(b);
    };
    addMode('all', 'All');
    for (const d of DIFFICULTY_LIST) if (d.ranked) addMode(d.id, d.name);
    panel.appendChild(modes);

    const board = rank(profile.board).filter((e) => filter === 'all' || e.diff === filter);
    const table = el('table', 'board');
    const head = el('tr');
    for (const h of ['', 'Name', 'Path', 'Mode', 'Depth', 'Foes', 'When', 'Score']) {
      head.appendChild(el('th', null, h));
    }
    table.appendChild(head);

    board.forEach((entry, i) => {
      const tr = el('tr');
      if (data.highlight !== undefined && data.highlight === i && filter === 'all') {
        tr.className = 'you';
        tr.setAttribute('aria-current', 'true');
      }
      const diff = difficultyById(entry.diff);
      tr.appendChild(el('td', 'rank', String(i + 1)));
      tr.appendChild(el('td', null, entry.name));
      tr.appendChild(el('td', null, entry.build || 'Torchbearer'));
      tr.appendChild(el('td', 'mode ' + diff.id, diff.name));
      tr.appendChild(el('td', 'num', 'D' + entry.depth));
      tr.appendChild(el('td', 'num', String(entry.bosses || 0)));
      const when = el('td', 'num when', entry.date || '\u2014');
      if (entry.version) when.title = 'Build ' + entry.version;
      tr.appendChild(when);
      tr.appendChild(el('td', 'num', formatScore(entry.score)));
      table.appendChild(tr);
    });
    if (!board.length) {
      const tr = el('tr');
      const td = el('td', 'empty', 'No names carved here yet.');
      td.colSpan = 8;
      tr.appendChild(td);
      table.appendChild(tr);
    }
    const wrap = el('div', 'board-wrap tall');
    wrap.appendChild(table);
    panel.appendChild(wrap);

    if (data.note) panel.appendChild(el('p', 'hint hall-note', data.note));
    panel.appendChild(el('p', 'hint',
      'Hearthlight descents are not carved here: a run that cannot be lost '
      + 'cannot be ranked against one that can.'));
    panel.appendChild(this._hallFileRow(data));

    const row = el('div', 'btn-row');
    row.appendChild(button('Back', 'btn', this.click(() => this.show(data.from || 'home'))));
    panel.appendChild(row);
    return panel;
  }

  // Taking the table off this machine, and putting one back. Import merges
  // rather than replaces, and the same export read twice adds nothing the
  // second time, so there is no way to lose names by pressing the wrong one.
  _hallFileRow(data) {
    const row = el('div', 'btn-row hall-files');
    row.appendChild(button('Export CSV', 'btn ghost small', this.click(() => {
      const blob = new Blob([profile.exportHall()], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'torchbound-hall-of-fame.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    })));

    const picker = el('input');
    picker.type = 'file';
    picker.accept = '.csv,text/csv,text/plain';
    picker.hidden = true;
    picker.addEventListener('change', () => {
      const file = picker.files && picker.files[0];
      if (!file) return;
      file.text().then((text) => profile.importHall(text)).then((result) => {
        const note = result.read
          ? `Read ${result.read} name${result.read === 1 ? '' : 's'}; `
            + `${result.added} new to this hall.`
          : 'That file held no names this hall could read.';
        this.show('hall', { ...data, note, highlight: undefined });
      });
    });
    row.appendChild(picker);
    row.appendChild(button('Import CSV', 'btn ghost small', this.click(() => picker.click())));
    row.appendChild(button('Clear the hall', 'btn ghost small danger', this.click(() => {
      this.show('confirmClearHall', data);
    })));
    return row;
  }

  screen_confirmClearHall(data = {}) {
    const panel = el('div', 'panel');
    panel.appendChild(el('h2', 'screen-title', 'Strike every name?'));
    panel.appendChild(el('p', 'screen-sub',
      'Every name in the hall is scratched off, including the ones that were '
      + 'here when you arrived. Export first if you want them back.'));
    const row = el('div', 'btn-row');
    row.appendChild(button('Keep them', 'btn primary',
      this.click(() => this.show('hall', { ...data, note: undefined }))));
    row.appendChild(button('Strike them all', 'btn ghost danger', this.click(() => {
      profile.clearHall();
      this.show('hall', { ...data, note: 'The stone is bare.', highlight: undefined });
    })));
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
      const name = el('label', 'setting-label', label);
      name.htmlFor = 'setting-' + key;
      row.appendChild(name);
      const input = el('input');
      input.type = 'range';
      input.id = 'setting-' + key;
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
      const label = el('div', 'setting-label');
      label.appendChild(el('div', null, labelText));
      if (hint) label.appendChild(el('div', 'hint', hint));
      row.appendChild(label);
      const group = el('div', 'seg');
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', labelText);
      for (const opt of options) {
        const on = profile.settings[key] === opt.value;
        const b = el('button', on ? 'on' : '', opt.label);
        b.type = 'button';
        b.setAttribute('aria-pressed', String(on));
        b.addEventListener('click', () => {
          profile.settings[key] = opt.value;
          profile.saveSettings();
          for (const other of group.children) {
            other.className = '';
            other.setAttribute('aria-pressed', 'false');
          }
          b.className = 'on';
          b.setAttribute('aria-pressed', 'true');
          if (this.host.onSettingChanged) this.host.onSettingChanged(key);
          if (this.host.audio) this.host.audio.play('uiClick');
        });
        group.appendChild(b);
      }
      row.appendChild(group);
      panel.appendChild(row);
    };

    segmented('Graphics', 'graphics', [
      { value: 'auto', label: 'Auto' },
      { value: 'high', label: 'High' },
      { value: 'medium', label: 'Medium' },
      { value: 'low', label: 'Low' },
    ], 'Auto watches the frame rate and sheds effects -- bloom, torch-lit '
      + 'stonework, ambient motes -- to keep the game above 30fps. Pick a '
      + 'level by hand to pin it there instead.');

    segmented('Frame rate', 'showFps', [
      { value: false, label: 'Hidden' },
      { value: true, label: 'Shown' },
    ], 'Draws the current frame rate and quality level in the corner.');

    segmented('Room reverb', 'reverb', [
      { value: true, label: 'On' },
      { value: false, label: 'Off' },
    ], 'Sound is coloured by the space you are standing in: a passage rings, '
      + 'a hall opens out, fog swallows the tail. Turn it off for a dry mix.');

    segmented('Direction keys', 'movementFrame', [
      { value: 'dungeon', label: 'Dungeon axes' },
      { value: 'view', label: 'Screen direction' },
    ], 'Dungeon axes point the keys along the corridors: Up walks north, which '
      + 'the view draws as up-and-to-the-right. Screen direction makes Up move '
      + 'straight up the display instead.');

    segmented('Blocked direction', 'movementAssist', [
      { value: 'corridor', label: 'Take the nearest way' },
      { value: 'strict', label: 'Stop' },
    ], 'What happens when the way you pressed is a wall. Taking the nearest '
      + 'way also lines you up with doorways: press into the stone beside an '
      + 'opening and you sidestep into it rather than standing there. Stop '
      + 'means exactly what you pressed, or nothing.');

    segmented('Touch pad', 'touchPad', [
      { value: 'diamond', label: 'Diamond' },
      { value: 'stick', label: 'Floating stick' },
    ], 'The diamond is turned to match the view: its four buttons sit on the '
      + 'screen diagonals, which is where the isometric camera draws the four '
      + 'dungeon axes. The stick is a continuous pad that anchors wherever '
      + 'your thumb lands.');

    const seg = el('div', 'setting');
    seg.appendChild(el('label', 'setting-label', 'Touch controls'));
    const group = el('div', 'seg');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Touch controls');
    for (const mode of ['auto', 'always', 'never']) {
      const on = profile.settings.touchControls === mode;
      const b = el('button', on ? 'on' : '', mode);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(on));
      b.addEventListener('click', () => {
        profile.settings.touchControls = mode;
        profile.saveSettings();
        for (const other of group.children) {
          other.className = '';
          other.setAttribute('aria-pressed', 'false');
        }
        b.className = 'on';
        b.setAttribute('aria-pressed', 'true');
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
    panel.appendChild(this._visibilityLegend());

    const row = el('div', 'btn-row');
    row.appendChild(button('Back', 'btn', this.click(() => {
      if (data.from === 'pause') this.show('pause');
      else this.show(data.from || 'home');
    })));
    panel.appendChild(row);
    return panel;
  }

  // ----------------------------------------------------------- pause
  // ---------------------------------------------------------- altar
  // Three offers at most, ordered smallest first so the eye reads up to the
  // expensive one rather than being hit with it. Walking away is a button of
  // the same size as the rest: it is a real answer, not a cancel.
  screen_altar(data = {}) {
    const panel = el('div', 'panel wide');
    panel.appendChild(el('h2', 'screen-title', 'The altar wants paying'));
    panel.appendChild(el('p', 'screen-sub',
      'It will answer one question. It has already decided what each answer costs.'));

    const grid = el('div', 'offer-grid');
    const offers = (data.offers || []).slice().sort((a, b) => a.tier - b.tier);
    for (const offer of offers) {
      const card = el('button', 'offer-card tier' + offer.tier);
      card.type = 'button';
      card.appendChild(el('span', 'offer-tier', TIER_NAME[offer.tier] || ''));
      card.appendChild(el('span', 'offer-name', offer.reward.name));
      card.appendChild(el('span', 'offer-text', offer.reward.text));
      const cost = el('span', 'offer-cost');
      cost.appendChild(el('b', null, offer.sacrifice.name));
      cost.appendChild(el('span', null, offer.costText));
      card.appendChild(cost);
      card.addEventListener('click', this.click(() => {
        if (this.host.takeOffer) this.host.takeOffer(offer);
      }));
      grid.appendChild(card);
    }
    if (!offers.length) {
      grid.appendChild(el('p', 'hint', 'It looks at you and finds nothing it wants.'));
    }
    panel.appendChild(grid);

    const row = el('div', 'btn-row');
    row.appendChild(button('Walk away', 'btn primary',
      this.click(() => { if (this.host.leaveAltar) this.host.leaveAltar(); })));
    panel.appendChild(row);
    panel.appendChild(el('p', 'hint',
      'Nothing here is a trick. What it says it will take, it takes; what it '
      + 'says it will give, it gives. Whether that was worth it is your problem.'));
    return panel;
  }

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
    panel.appendChild(this._buildStamp());
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
      card.appendChild(el('span', 'relic-cost', relic.cost));
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

  // ------------------------------------------------ fallen (Hearthlight)
  // Death without the run ending. Offered only where the difficulty allows
  // it, so the roguelite promise still holds everywhere else.
  screen_fallen(data) {
    const { run } = data;
    const panel = el('div', 'panel');
    panel.appendChild(el('h2', 'screen-title', 'The torch gutters'));
    panel.appendChild(el('p', 'screen-sub',
      'You went down at Depth ' + depthLabel(run.depth) + '. The hearth is still lit above.'));
    panel.appendChild(el('p', 'flavour',
      FALLEN_LINES[Math.floor(Math.random() * FALLEN_LINES.length)]));

    const stats = el('div', 'kv');
    const add = (label, value) => {
      const d = el('div');
      d.appendChild(el('b', null, value));
      d.appendChild(document.createTextNode(label));
      stats.appendChild(d);
    };
    add('run score', formatScore(run.score.total));
    add('this depth', 'forfeit');
    add('stairs taken back', String(run.retries));
    panel.appendChild(stats);
    panel.appendChild(el('p', 'hint',
      'The depth is re-cut from fresh stone, and everything it had banked for '
      + 'you is gone. Your relics, your crossbow and the score from the depths '
      + 'above all come back down with you.'));

    const row = el('div', 'btn-row');
    row.appendChild(button('Take the stair again', 'btn primary',
      this.click(() => this.host.retry())));
    // The player died -- ending here is still a death, not an abandonment,
    // and the run-end screen should say so.
    row.appendChild(button('End the descent', 'btn ghost',
      this.click(() => this.host.quit('death'))));
    panel.appendChild(row);
    return panel;
  }

  // -------------------------------------------------------- run ending
  screen_gameover(data) {
    const { run, reason } = data;
    const score = run.score.total;
    const ranked = run.difficulty.ranked;
    const rank = ranked ? profile.rankFor(score) : null;
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
    add('mode', run.difficulty.name);
    if (run.retries) add('stairs retaken', String(run.retries));
    panel.appendChild(stats);
    panel.appendChild(this._relicList(run));

    if (rank) {
      panel.appendChild(el('p', 'flavour',
        `That is ${ordinal(rank)} place. The hall wants your name.`));
      const entry = el('div', 'name-entry');
      const input = el('input');
      input.id = 'hall-name';
      input.maxLength = 14;
      input.placeholder = 'Your name';
      input.setAttribute('aria-label', 'Your name for the Hall of Fame');
      input.autocomplete = 'nickname';
      input.enterKeyHint = 'done';
      input.value = localStorage.getItem('torchbound.lastName') || '';
      const submit = button('Carve it', 'btn primary', () => {
        const name = (input.value || 'Nameless').trim().slice(0, 14) || 'Nameless';
        try { localStorage.setItem('torchbound.lastName', name); } catch (e) { /* ignore */ }
        submit.disabled = true;
        // Carving waits for the table to be free, so it is a promise. The
        // wait is measured in tens of milliseconds and nothing else is
        // happening, but the button is locked so it cannot be pressed twice.
        profile.submit({
          name, score, depth: run.depth, bosses: run.bossesDefeated,
          kills: run.score.runBest.kills, secrets: run.score.runBest.secrets,
          build: run.build, diff: run.difficulty.id, seed: run.seed,
        }).then((placed) => {
          if (this.host.audio) this.host.audio.play('fanfare');
          this.show('hall', { highlight: placed ? placed - 1 : undefined, from: 'home' });
        });
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit.click(); });
      entry.appendChild(input);
      entry.appendChild(submit);
      panel.appendChild(entry);
      const row = el('div', 'btn-row');
      row.appendChild(button('Descend Again', 'btn', this.click(() => this.host.start())));
      row.appendChild(button('Skip the hall', 'btn ghost', this.click(() => this.show('home'))));
      panel.appendChild(row);
    } else if (!ranked) {
      const note = el('div', 'near-miss');
      note.appendChild(el('div', 'place', run.difficulty.name));
      note.appendChild(el('div', 'gap',
        'A descent with a way back is not carved into the hall. Walk down '
        + 'Torchbound or Ashenvow when you want a name on the stone.'));
      panel.appendChild(note);
      const row = el('div', 'btn-row');
      row.appendChild(button('Descend Again', 'btn primary', this.click(() => this.host.start())));
      row.appendChild(button('Change Mode', 'btn', this.click(() => this.show('difficulty'))));
      row.appendChild(button('Home', 'btn ghost', this.click(() => this.show('home'))));
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
    const spinner = el('div', 'spinner');
    spinner.setAttribute('aria-hidden', 'true');
    wrap.appendChild(spinner);
    wrap.appendChild(el('h2', 'screen-title', data.title || 'Descending'));
    wrap.appendChild(el('p', 'flavour', data.text || ''));
    panel.appendChild(wrap);
    // Three states of stone is the game's central idea and nothing else
    // explains it. Shown while it is still new, then left to Settings.
    if (data.depth !== undefined && data.depth <= 2) {
      panel.appendChild(this._visibilityLegend());
    }
    return panel;
  }
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const FALLEN_LINES = [
  'Someone up there is still feeding the fire. Go back down.',
  'The labyrinth forgets a Hearthlight death almost immediately.',
  'It re-cuts the stone while you catch your breath. It always did.',
  'You have been here before. It has not.',
];

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
