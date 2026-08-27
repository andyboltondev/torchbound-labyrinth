// Screen manager and every full-screen interface: home, Hall of Fame,
// bestiary, settings, pause, relic choice, score summary and run end.

import { profile, DEFAULT_SETTINGS } from '../game/profile.js';
import { rank } from '../game/hall.js';
import { CONTROLS } from '../core/input.js';
import { makeSeed, normaliseSeed } from '../core/rng.js';
import { DIFFICULTY_LIST, difficultyById } from '../game/difficulty.js';
import { ENEMY_LIST, BOSSES, ENEMIES } from '../game/enemyData.js';
import { RELIC_BY_ID } from '../game/relics.js';
import { formatScore, depthLabel } from '../core/util.js';
import { drawEnemy, drawBoss } from '../render/actors.js';
import { BUILD_STRING, BUILD_DETAIL, VERSION } from '../core/version.js';
import { RELEASES, REPO } from '../game/releases.js';

// What each size of bargain is called. The player never sees the word "tier".
const TIER_NAME = { 1: 'A small thing', 2: 'A real price', 3: 'Everything it can ask' };

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

// The distance between two live pointers, for pinch zoom.
// Falls back to selecting the seed when the clipboard is not available --
// over plain http, or in a webview that refuses it -- so the player can still
// copy it by hand rather than being told nothing happened.
const selectSeed = (node) => {
  const range = document.createRange();
  range.selectNodeContents(node);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
};

// A short, honest description of what the game is running in. Read off the
// user agent, which is a blunt instrument, so it says what it can recognise
// and shrugs rather than guessing. Nothing here identifies a person.
const describeBrowser = () => {
  const ua = navigator.userAgent || '';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
      : /Firefox\//.test(ua) ? 'Firefox'
        : /Chrome\//.test(ua) ? 'Chrome'
          : /Safari\//.test(ua) ? 'Safari' : 'an unknown browser';
  const os = /Windows/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
      : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
        : /Mac OS X/.test(ua) ? 'macOS'
          : /Linux/.test(ua) ? 'Linux' : 'an unknown system';
  const screen = window.innerWidth + 'x' + window.innerHeight;
  return browser + ' on ' + os + ', ' + screen;
};

const pinchSpan = (pointers) => {
  const [a, b] = Array.from(pointers.values());
  return Math.hypot(a.x - b.x, a.y - b.y);
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
  _buildStamp(from) {
    const wrap = el('div', 'build-stamp');
    const open = el('button', 'build-stamp-btn');
    open.type = 'button';
    open.appendChild(el('b', null, BUILD_STRING));
    if (BUILD_DETAIL) open.appendChild(el('small', null, BUILD_DETAIL));
    open.title = 'What changed in this version';
    open.addEventListener('click', this.click(() => this.show('releases', { from })));
    wrap.appendChild(open);
    const links = el('div', 'build-stamp-links');
    links.appendChild(button('What changed', 'btn ghost small',
      this.click(() => this.show('releases', { from }))));
    links.appendChild(this._bugReportButton(from === 'pause' ? this.host.run : null));
    wrap.appendChild(links);
    return wrap;
  }

  // The one rendering of the controls, built from the binding table in
  // input.js and used by the home screen, the settings panel and the opening
  // guide. Three places used to list them by hand and all three had drifted:
  // none of them mentioned the torch or the map.
  _controlsGrid(opts = {}) {
    const wrap = el('div', 'controls-block');
    const touch = opts.touch !== undefined ? opts.touch : this.host.touchEnabled;
    const grid = el('div', 'controls-grid');
    for (const control of CONTROLS) {
      const d = el('div', 'control-row');
      const label = el('span', 'control-label');
      label.appendChild(document.createTextNode(control.label));
      if (control.note && opts.notes !== false) {
        label.appendChild(el('small', 'control-note', control.note));
      }
      d.appendChild(label);
      const keys = el('b', 'control-keys');
      keys.appendChild(el('span', 'control-key', control.keys));
      if (touch && control.touch) {
        keys.appendChild(el('span', 'control-touch', control.touch));
      }
      d.appendChild(keys);
      grid.appendChild(d);
    }
    wrap.appendChild(grid);
    return wrap;
  }

  // The seed, wherever the player might want to write it down or hand it on.
  // A button rather than a label: the whole value of a seed is that it can be
  // given to somebody else, and selecting text off a game screen is a chore.
  _seedChip(run) {
    if (!run || !run.seed) return el('span');
    const wrap = el('div', 'seed-chip');
    wrap.appendChild(el('span', 'seed-chip-label', 'Seed'));
    const value = el('code', 'seed-chip-value', run.seed);
    wrap.appendChild(value);
    const copy = button('Copy', 'btn ghost small', this.click(() => {
      const done = () => {
        copy.textContent = 'Copied';
        setTimeout(() => { copy.textContent = 'Copy'; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(run.seed).then(done, () => selectSeed(value));
      } else {
        selectSeed(value);
      }
    }));
    wrap.appendChild(copy);
    return wrap;
  }

  // Opens a prefilled bug report on the tracker. Everything it fills in is
  // game state -- the build, the seed, the depth, the mode, and a coarse
  // browser string -- so the player never has to go and find any of it, and
  // nothing personal travels with it. It opens the form rather than filing
  // anything: the player reads it and presses the button themselves.
  _bugReportButton(run, label = 'Report a bug') {
    return button(label, 'btn ghost small', this.click(() => {
      const params = new URLSearchParams({
        template: 'bug_report.yml',
        labels: 'bug',
        build: BUILD_STRING + (BUILD_DETAIL ? '  (' + BUILD_DETAIL + ')' : ''),
        device: describeBrowser(),
      });
      if (run) {
        if (run.seed) params.set('seed', run.seed);
        params.set('where', 'Depth ' + run.depth
          + (run.difficulty ? ', ' + run.difficulty.name : ''));
      } else {
        params.set('where', 'In the menus');
      }
      const url = 'https://github.com/' + REPO + '/issues/new?' + params.toString();
      window.open(url, '_blank', 'noopener');
    }));
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
    menu.appendChild(button('Begin the descent', 'btn primary',
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
    controls.style.marginTop = '18px';
    controls.appendChild(el('p', 'hint', 'The keys walk the dungeon’s compass, so Up '
      + 'is north and the corridors run with your keys. On a touch screen the '
      + 'controls appear on the glass instead.'));
    controls.appendChild(this._controlsGrid({ notes: false }));
    panel.appendChild(controls);
    panel.appendChild(this._buildStamp('home'));
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

    // The seed. Left blank the labyrinth picks its own; typed or pasted in,
    // two people get the same one.
    const seedRow = el('div', 'seed-row');
    seedRow.appendChild(el('label', 'seed-label', 'Seed'));
    const seedInput = el('input', 'seed-input');
    seedInput.id = 'run-seed';
    seedInput.maxLength = 32;
    seedInput.placeholder = 'leave blank for a new one';
    seedInput.setAttribute('aria-label', 'Seed for this descent');
    seedInput.spellcheck = false;
    seedInput.autocomplete = 'off';
    seedRow.appendChild(seedInput);
    seedRow.appendChild(button('Roll', 'btn ghost small', this.click(() => {
      seedInput.value = makeSeed();
    })));
    panel.appendChild(seedRow);
    panel.appendChild(el('p', 'hint seed-note',
      'The same seed and the same mode give the same labyrinth. Later depths '
      + 'also take account of what you are carrying, so two descents match all '
      + 'the way down only if they make the same choices.'));

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
        this.host.start(diff.id, normaliseSeed(seedInput.value));
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
    row.appendChild(button('Back', 'btn primary', this.click(() => this.show(data.from || 'home'))));
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
    row.appendChild(button('Back', 'btn primary', this.click(() => {
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
    controls.appendChild(this._controlsGrid());
    const guideRow = el('div', 'btn-row');
    guideRow.style.justifyContent = 'flex-start';
    guideRow.appendChild(button(
      profile.settings.showGuide === false ? 'Show the opening guide again' : 'See the opening guide',
      'btn ghost small', this.click(() => {
        profile.settings.showGuide = true;
        profile.saveSettings();
        this.show('guide', { from: data.from, standalone: true });
      })));
    guideRow.appendChild(button('What changed', 'btn ghost small',
      this.click(() => this.show('releases', { from: 'settings', settingsFrom: data.from }))));
    guideRow.appendChild(this._bugReportButton(
      data.from === 'pause' ? this.host.run : null));
    controls.appendChild(guideRow);
    panel.appendChild(controls);
    panel.appendChild(this._visibilityLegend());

    const row = el('div', 'btn-row');
    row.appendChild(button('Back', 'btn primary', this.click(() => {
      if (data.from === 'pause') this.show('pause');
      else this.show(data.from || 'home');
    })));
    panel.appendChild(row);
    return panel;
  }

  // ----------------------------------------------------------- pause
  // -------------------------------------------------- release notes
  // Every version, newest first, chosen from a dropdown or stepped through
  // with the arrows either side of it. What changed to *play*, not what moved
  // in the source -- so it is written by hand rather than generated.
  screen_releases(data = {}) {
    const chosen = data.version || VERSION.number;
    const index = Math.max(0, RELEASES.findIndex((r) => r.version === chosen));
    const release = RELEASES[index] || RELEASES[0];
    const panel = el('div', 'panel wide releases-panel');
    panel.appendChild(el('h2', 'screen-title', 'What changed'));
    panel.appendChild(el('p', 'screen-sub',
      'Every version of the labyrinth so far, newest first.'));

    if (!release) {
      panel.appendChild(el('p', 'hint', 'No releases recorded yet.'));
      panel.appendChild(this._backRow(data));
      return panel;
    }

    // Picker: a select, because the list will keep growing, with a step
    // either side so it can also be walked without opening anything.
    const picker = el('div', 'release-picker');
    const go = (to) => this.show('releases', { ...data, version: to });
    const prev = button('\u2039', 'btn ghost small',
      this.click(() => go(RELEASES[index + 1].version)));
    prev.disabled = index >= RELEASES.length - 1;
    prev.setAttribute('aria-label', 'Older release');
    picker.appendChild(prev);

    const select = el('select', 'release-select');
    select.setAttribute('aria-label', 'Choose a release');
    for (const r of RELEASES) {
      const opt = el('option', null,
        r.version + (r.codename ? '  \u2014  ' + r.codename : '')
        + (r.version === VERSION.number ? '   (you are playing this)' : ''));
      opt.value = r.version;
      if (r.version === release.version) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => go(select.value));
    picker.appendChild(select);

    const next = button('\u203a', 'btn ghost small',
      this.click(() => go(RELEASES[index - 1].version)));
    next.disabled = index <= 0;
    next.setAttribute('aria-label', 'Newer release');
    picker.appendChild(next);
    panel.appendChild(picker);

    panel.appendChild(this._releaseBody(release));
    panel.appendChild(this._backRow(data));
    return panel;
  }

  _releaseBody(release) {
    const wrap = el('div', 'release');
    const head = el('div', 'release-head');
    // The version being played has no stamp of its own in the table, because
    // it does not have one until it is built. Borrow the real one.
    const running = release.version === VERSION.number;
    const build = release.build || (running ? VERSION.build : null);
    const stamp = el('div', 'release-stamp');
    stamp.appendChild(el('b', null, build
      ? 'Build ' + release.version + '-' + build
      : 'Version ' + release.version));
    const when = release.date || (build
      ? build.slice(0, 4) + '-' + build.slice(4, 6) + '-' + build.slice(6, 8) : '');
    const meta = el('small');
    meta.textContent = [when, release.pr ? 'pull request #' + release.pr : '']
      .filter(Boolean).join('  ·  ');
    stamp.appendChild(meta);
    head.appendChild(stamp);
    if (running) head.appendChild(el('span', 'release-current', 'You are playing this'));
    wrap.appendChild(head);

    if (release.reconstructed) {
      // Say so rather than pretending. These predate the build stamp.
      wrap.appendChild(el('p', 'hint release-note',
        'This one shipped before the game started stamping its own builds. '
        + 'The number and the time are reconstructed from the commit that '
        + 'released it, so no copy of this version ever printed them.'));
    }
    if (release.headline) wrap.appendChild(el('p', 'release-headline', release.headline));

    for (const section of release.sections || []) {
      wrap.appendChild(el('h3', 'release-section', section.title));
      const list = el('ul', 'release-list');
      for (const note of section.notes) list.appendChild(el('li', null, note));
      wrap.appendChild(list);
    }
    return wrap;
  }

  _backRow(data) {
    const row = el('div', 'btn-row');
    row.appendChild(button('Back', 'btn primary', this.click(() => {
      if (data.from === 'pause') this.show('pause');
      else if (data.from === 'settings') this.show('settings', { from: data.settingsFrom || 'home' });
      else this.show(data.from || 'home');
    })));
    return row;
  }

  // ----------------------------------------------------------- guide
  // Shown once, before the first depth. Illustrated rather than listed,
  // because a wall of key names is the thing a new player skips. Which half
  // it shows follows how they are actually going to play: keys, or glass.
  screen_guide(data = {}) {
    const touch = data.touch !== undefined ? data.touch : this.host.touchEnabled;
    const panel = el('div', 'panel wide guide-panel');
    panel.appendChild(el('h2', 'screen-title', 'Before you go down'));
    panel.appendChild(el('p', 'screen-sub', touch
      ? 'Everything happens on the glass. The pad walks the dungeon\u2019s compass.'
      : 'WASD and the arrow keys both work, always, and they walk the '
        + 'dungeon\u2019s compass \u2014 Up is north.'));

    panel.appendChild(touch ? this._guideTouch() : this._guideKeys());

    const grid = el('div', 'guide-actions');
    for (const control of CONTROLS) {
      if (control.group === 'move') continue;
      const row = el('div', 'guide-action');
      row.appendChild(el('span', 'guide-cap', touch && control.touch ? control.touch : control.keys));
      const body = el('span', 'guide-action-body');
      body.appendChild(el('b', null, control.label));
      if (control.note) body.appendChild(el('small', null, control.note));
      row.appendChild(body);
      grid.appendChild(row);
    }
    panel.appendChild(grid);

    if (touch) {
      panel.appendChild(this._guidePadChoice(data));
      panel.appendChild(el('p', 'hint',
        'The diamond is turned to match the view: its four buttons sit where '
        + 'the camera draws the four dungeon axes. The stick anchors wherever '
        + 'your thumb lands. You can change this later in Settings.'));
    } else {
      panel.appendChild(el('p', 'hint',
        'All of this can be changed later in Settings, along with what a '
        + 'blocked direction does and which way the keys point.'));
    }

    const again = el('label', 'guide-again');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = profile.settings.showGuide === false;
    box.addEventListener('change', () => {
      profile.settings.showGuide = !box.checked;
      profile.saveSettings();
    });
    again.appendChild(box);
    again.appendChild(el('span', null, 'Do not show this again'));
    panel.appendChild(again);
    panel.appendChild(el('p', 'hint guide-reset-note', 'Settings can bring it back.'));

    const row = el('div', 'btn-row');
    row.appendChild(button(data.standalone ? 'Back' : 'Take up the torch', 'btn primary',
      this.click(() => {
        if (data.standalone) this.show('settings', { from: data.from });
        else if (this.host.closeGuide) this.host.closeGuide();
      })));
    panel.appendChild(row);
    return panel;
  }

  _guidePadChoice(data) {
    const seg = el('div', 'setting guide-pad-choice');
    seg.appendChild(el('label', 'setting-label', 'Movement pad'));
    const group = el('div', 'seg');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Movement pad');
    for (const [value, label] of [['diamond', 'Diamond'], ['stick', 'Floating stick']]) {
      const b = el('button', profile.settings.touchPad === value ? 'on' : '', label);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(profile.settings.touchPad === value));
      b.addEventListener('click', this.click(() => {
        profile.settings.touchPad = value;
        profile.saveSettings();
        if (this.host.onTouchModeChange) this.host.onTouchModeChange();
        this.show('guide', data);
      }));
      group.appendChild(b);
    }
    seg.appendChild(group);
    return seg;
  }

  // Two key clusters drawn as key caps, side by side, with the compass
  // bearing on each one. Seeing WASD and the arrows next to each other is the
  // fastest way to say "both of these, all the time".
  _guideKeys() {
    const wrap = el('div', 'guide-keys');
    const cluster = (title, caps) => {
      const box = el('div', 'keycluster');
      box.appendChild(el('div', 'keycluster-title', title));
      const pad = el('div', 'keypad');
      for (const cap of caps) {
        const k = el('div', 'keycap ' + cap.at);
        k.appendChild(el('b', null, cap.key));
        k.appendChild(el('i', null, cap.dir));
        pad.appendChild(k);
      }
      box.appendChild(pad);
      return box;
    };
    wrap.appendChild(cluster('WASD', [
      { key: 'W', dir: 'north', at: 'up' },
      { key: 'A', dir: 'west', at: 'left' },
      { key: 'S', dir: 'south', at: 'down' },
      { key: 'D', dir: 'east', at: 'right' },
    ]));
    wrap.appendChild(cluster('Arrow keys', [
      { key: '\u2191', dir: 'north', at: 'up' },
      { key: '\u2190', dir: 'west', at: 'left' },
      { key: '\u2193', dir: 'south', at: 'down' },
      { key: '\u2192', dir: 'east', at: 'right' },
    ]));
    wrap.appendChild(el('p', 'hint guide-compass-note',
      'Press two together to walk a diagonal. The view is isometric, so north '
      + 'is drawn up and to the right \u2014 the keys follow the corridors, not '
      + 'the screen.'));
    return wrap;
  }

  // The glass, laid out as it actually is: movement under the left thumb,
  // the four action buttons under the right.
  _guideTouch() {
    const wrap = el('div', 'guide-touch');
    const stick = profile.settings.touchPad === 'stick';
    const left = el('div', 'guide-glass-half');
    left.appendChild(el('div', 'keycluster-title', stick ? 'Floating stick' : 'Diamond pad'));
    const pad = el('div', 'guide-pad' + (stick ? ' stick' : ''));
    if (stick) {
      pad.appendChild(el('i', 'guide-stick-base'));
      pad.appendChild(el('i', 'guide-stick-nub'));
      pad.appendChild(el('span', 'guide-pad-note', 'Drag anywhere on the left'));
    } else {
      for (const [cls, label] of [['n', 'N'], ['e', 'E'], ['s', 'S'], ['w', 'W']]) {
        pad.appendChild(el('i', 'guide-dbtn ' + cls, label));
      }
    }
    left.appendChild(pad);
    wrap.appendChild(left);

    const right = el('div', 'guide-glass-half');
    right.appendChild(el('div', 'keycluster-title', 'Action buttons'));
    const btns = el('div', 'guide-buttons');
    for (const [cls, label] of [['torch', 'TORCH'], ['action', 'ACT'], ['fire', 'FIRE'], ['slash', 'SLASH']]) {
      btns.appendChild(el('i', 'guide-tbtn ' + cls, label));
    }
    right.appendChild(btns);
    wrap.appendChild(right);
    return wrap;
  }

  // ------------------------------------------------------------- map
  // The whole chart, zoomable and pannable, with a legend of everything found
  // on this depth. Drawn on demand rather than every frame: the game is
  // stopped while it is open, so nothing on it moves unless the player does
  // something to it.
  screen_map(data = {}) {
    const world = data.world;
    const minimap = data.minimap;
    const panel = el('div', 'panel wide map-panel');
    panel.appendChild(el('h2', 'screen-title', 'The chart'));
    panel.appendChild(el('p', 'screen-sub',
      'Everything you have walked, and everything you have laid eyes on. '
      + 'Drag to move it, scroll or pinch to close in.'));

    const stage = el('div', 'map-stage');
    const canvas = el('canvas', 'map-canvas');
    stage.appendChild(canvas);
    panel.appendChild(stage);

    const view = { zoom: 1, panX: 0, panY: 0 };
    const ctx = canvas.getContext('2d');
    const redraw = () => {
      if (!world || !minimap) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = stage.clientWidth || 480;
      const h = stage.clientHeight || 300;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(8,10,15,0.9)';
      ctx.fillRect(0, 0, w, h);
      minimap.drawFull(ctx, world, { x: 0, y: 0, w, h }, view);
    };

    // Zoom about the middle, which is where the eye already is.
    const setZoom = (next) => {
      const clamped = Math.max(1, Math.min(6, next));
      if (clamped === view.zoom) return;
      const ratio = clamped / view.zoom;
      view.panX *= ratio;
      view.panY *= ratio;
      view.zoom = clamped;
      redraw();
    };
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      setZoom(view.zoom * (e.deltaY < 0 ? 1.18 : 1 / 1.18));
    }, { passive: false });

    // One pointer drags; two pinch.
    const pointers = new Map();
    let pinchFrom = 0;
    stage.addEventListener('pointerdown', (e) => {
      stage.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) pinchFrom = pinchSpan(pointers);
    });
    const release = (e) => {
      pointers.delete(e.pointerId);
      pinchFrom = 0;
    };
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);
    stage.addEventListener('pointermove', (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      if (pointers.size === 1) {
        view.panX += e.clientX - prev.x;
        view.panY += e.clientY - prev.y;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        redraw();
        return;
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const span = pinchSpan(pointers);
      if (pinchFrom > 8 && span > 8) {
        setZoom(view.zoom * (span / pinchFrom));
        pinchFrom = span;
      }
    });

    const zoomRow = el('div', 'map-zoom');
    zoomRow.appendChild(button('\u2212', 'btn ghost small', this.click(() => setZoom(view.zoom / 1.4))));
    zoomRow.appendChild(button('Fit', 'btn ghost small', this.click(() => {
      view.zoom = 1; view.panX = 0; view.panY = 0; redraw();
    })));
    zoomRow.appendChild(button('+', 'btn ghost small', this.click(() => setZoom(view.zoom * 1.4))));
    panel.appendChild(zoomRow);

    panel.appendChild(this._mapLegend(world, minimap));

    const row = el('div', 'btn-row');
    row.appendChild(button('Back', 'btn primary', this.click(() => {
      if (this.host.closeMap) this.host.closeMap();
    })));
    panel.appendChild(row);

    // The stage has no size until it is in the document.
    setTimeout(redraw, 0);
    this._onResize = redraw;
    return panel;
  }

  // Only what has been found. A legend that lists what you have not
  // discovered yet is a spoiler with a key beside it.
  _mapLegend(world, minimap) {
    const wrap = el('div', 'map-legend');
    wrap.appendChild(el('div', 'legend-title', 'What you have found'));
    const rows = (world && minimap) ? minimap.legend(world) : [];
    if (!rows.length) {
      wrap.appendChild(el('p', 'hint', 'Nothing yet. The chart fills in as you walk.'));
      return wrap;
    }
    const list = el('div', 'map-legend-grid');
    for (const row of rows) {
      const item = el('div', 'map-legend-item');
      const swatch = el('canvas', 'map-swatch');
      swatch.width = 18; swatch.height = 18;
      minimap.drawSwatch(swatch.getContext('2d'), 9, 9, row.colour, row.shape, 5);
      item.appendChild(swatch);
      item.appendChild(el('span', 'map-legend-name', row.name));
      if (row.count > 1) item.appendChild(el('i', 'map-legend-count', '\u00d7' + row.count));
      list.appendChild(item);
    }
    wrap.appendChild(list);
    return wrap;
  }

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

    if (run) panel.appendChild(this._seedChip(run));
    if (run) panel.appendChild(this._relicList(run));

    const menu = el('div', 'menu');
    menu.appendChild(button('Resume', 'btn primary', this.click(() => this.host.resume())));
    menu.appendChild(button('Bestiary', 'btn', this.click(() => this.show('bestiary', { from: 'pause' }))));
    menu.appendChild(button('Settings', 'btn', this.click(() => this.show('settings', { from: 'pause' }))));
    menu.appendChild(button('Abandon the descent', 'btn ghost', this.click(() => this.show('confirmQuit'))));
    panel.appendChild(menu);
    panel.appendChild(this._buildStamp('pause'));
    return panel;
  }

  screen_confirmQuit() {
    const panel = el('div', 'panel');
    panel.appendChild(el('h2', 'screen-title', 'Abandon the descent?'));
    panel.appendChild(el('p', 'screen-sub',
      'Your score so far will still be offered to the Hall of Fame. The run itself ends here.'));
    const row = el('div', 'btn-row');
    row.appendChild(button('Keep going', 'btn primary', this.click(() => this.show('pause'))));
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
    row.appendChild(button('Claim a relic', 'btn primary', this.click(() => this.host.afterSummary())));
    panel.appendChild(row);
    return panel;
  }

  // ------------------------------------------------------ relic choice
  screen_relics(data) {
    const { offers, run, guaranteed } = data;
    const panel = el('div', 'panel wide');
    panel.appendChild(el('h2', 'screen-title', guaranteed ? 'Spoils of the great foe' : 'Choose a relic'));
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
    panel.appendChild(this._seedChip(run));
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
      row.appendChild(button('Descend again', 'btn', this.click(() => this.host.start())));
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
      row.appendChild(button('Descend again', 'btn primary', this.click(() => this.host.start())));
      row.appendChild(button('Change mode', 'btn', this.click(() => this.show('difficulty'))));
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
      row.appendChild(button('Descend again', 'btn primary', this.click(() => this.host.start())));
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
