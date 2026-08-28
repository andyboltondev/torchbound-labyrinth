// Application entry point: boots the systems, owns the state machine, and
// wires world events through to the interface, audio and music layers.

import { GameLoop } from './core/loop.js';
import { Perf } from './core/perf.js';
import { Input } from './core/input.js';
import { inputDirToGrid } from './render/iso.js';
import { Renderer } from './render/renderer.js';
import { Minimap } from './render/minimap.js';
import { warmTileSets } from './render/sprites.js';
import { generateLevel } from './gen/dungeon.js';
import { Run } from './game/run.js';
import { World } from './game/world.js';
import { profile } from './game/profile.js';
import { startUpdateCheck, noteFirstVisit } from './core/appupdate.js';
import { AudioEngine } from './audio/audio.js';
import { Music } from './audio/music.js';
import { Hud } from './ui/hud.js';
import { Screens, DESCENT_FLAVOUR } from './ui/screens.js';
import { TouchControls, isTouchDevice } from './ui/touch.js';
import { makeSeed } from './core/rng.js';
import { clamp } from './core/util.js';

const STATE = { MENU: 'menu', PLAYING: 'playing', PAUSED: 'paused', BUSY: 'busy' };

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.renderer = new Renderer(this.canvas);
    this.minimap = new Minimap();
    this.input = new Input();
    this.hud = new Hud();
    this.audio = new AudioEngine(profile.settings);
    this.music = new Music(this.audio);
    this.touch = new TouchControls(this.input);
    this.screens = new Screens({
      audio: this.audio,
      start: (difficultyId, seed) => this.startRun(seed || null, difficultyId),
      retry: () => this.retryDepth(),
      resume: () => this.resume(),
      quit: (reason) => this.endRun(reason || 'quit'),
      chooseRelic: (relic) => this.chooseRelic(relic),
      takeOffer: (offer) => this.takeOffer(offer),
      leaveAltar: () => this.leaveAltar(),
      closeMap: () => this.closeMap(),
      closeGuide: () => this.closeGuide(),
      afterSummary: () => this.showRelicChoice(),
      onTouchModeChange: () => this.refreshTouchMode(),
      onSettingChanged: (key) => this.applySettings(key),
      onScreen: (name) => this.scoreFor(name),
      runInProgress: () => this.runInProgress(),
      get run() { return window.__game ? window.__game.run : null; },
    });
    this.state = STATE.MENU;
    this.run = null;
    this.world = null;
    this.combatHeat = 0;
    this.perf = new Perf();
    this.perf.setMode(profile.settings.graphics || 'auto');
    this.renderer.tier = this.perf.tier;
    this.spaceTimer = 0;
    this.loop = new GameLoop((dt) => this.update(dt), (alpha, dt) => this.render(alpha, dt));

    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.onResize(), 200));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === STATE.PLAYING) this.pause();
    });
    // Tapping the corner chart opens the full one. It is drawn on the canvas
    // rather than in the document, so the hit test is done by hand.
    this.canvas.addEventListener('pointerdown', (e) => {
      if (this.state !== STATE.PLAYING) return;
      const box = this.minimapBox();
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      if (x < box.x || x > box.x + box.size || y < box.y || y > box.y + box.size) return;
      e.preventDefault();
      this.openMap();
    });
    // The corner chart is a small target that has to be found before it can be
    // tapped, and on a phone there is no `M` to fall back on. The button says
    // the map is there; the chart itself stays tappable for anyone who has
    // already learned it.
    document.getElementById('btnMap').addEventListener('click', () => this.openMap());
    document.getElementById('btnPause').addEventListener('click', () => this.pause());
    document.getElementById('btnBestiary').addEventListener('click', () => {
      if (this.state === STATE.PLAYING) this.pause();
      this.screens.show('bestiary', { from: 'pause' });
    });
  }

  boot() {
    window.__game = this;
    this.onResize();
    // Styles may still be loading on the first tick; measure again once the
    // page has settled so the canvas never sticks at its default size.
    requestAnimationFrame(() => this.onResize());
    window.addEventListener('load', () => this.onResize());
    this.refreshTouchMode();
    // Cache the game for offline play, and ask whether a newer build has
    // shipped. Fire-and-forget on purpose: the menu is drawn on the next line
    // whatever the network is doing, because a player with no signal is not
    // waiting on us to finish a conversation they did not ask for.
    //
    // If a newer build has shipped it is fetched and the page reloads onto it,
    // here at the menu where a reload costs nothing but the second it takes.
    // `canReload` is what keeps it that way: it is asked again once the files
    // are down, and a descent begun in the meantime is a run that a version
    // number does not get to end.
    startUpdateCheck({ canReload: () => !this.runInProgress() });
    // Ordered before the menu is built, because the menu asks whether this
    // build is new to the device and a first visit has to have answered
    // "no, it is simply the first" before it is asked.
    noteFirstVisit();
    this.screens.show('home');
    this.loop.start();
    // The audio context can only start from a gesture, so arm it on the first.
    const arm = () => {
      this.audio.init();
      this.audio.setReverbEnabled(profile.settings.reverb !== false);
      this.audio.resume();
      // The score starts here and does not stop again for the life of the
      // page. Everything after this is a crossfade between scenes, which is
      // what makes the menu flow into a descent and back out of it.
      this.music.start();
      this.music.setScene(this.state === STATE.PLAYING ? 'explore' : 'menu');
      this.music.setIntensity(0.12, false);
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('keydown', arm);
    };
    window.addEventListener('pointerdown', arm);
    window.addEventListener('keydown', arm);

    // The simulation is stopped while the map is up, so the ordinary input
    // pump is not running and cannot close it. Esc and M both do, from here.
    window.addEventListener('keydown', (e) => {
      if (this.screens.current !== 'map') return;
      if (e.code !== 'Escape' && e.code !== 'KeyM') return;
      e.preventDefault();
      this.closeMap();
    });
  }

  onResize() {
    this.renderer.resize();
    this.refreshTouchMode();
    this._mapBox = null;
    if (this.screens.current === 'map' && this.screens._onResize) this.screens._onResize();
  }

  applySettings(key) {
    if (key === 'touchControls' || key === 'touchPad') this.refreshTouchMode();
    if (key === 'graphics') {
      this.perf.setMode(profile.settings.graphics);
      this.renderer.tier = this.perf.tier;
    }
    if (key === 'reverb' && this.audio.ready) {
      this.audio.setReverbEnabled(profile.settings.reverb !== false);
    }
    if (this.world) this.world.strictMovement = profile.settings.movementAssist === 'strict';
  }

  refreshTouchMode() {
    const mode = profile.settings.touchControls;
    const on = mode === 'always' || (mode === 'auto' && isTouchDevice());
    this.touch.setPad(profile.settings.touchPad || 'diamond');
    this.touch.setVisible(on && this.state === STATE.PLAYING);
    this.hud.setTouchMode(on);
    this.touchEnabled = on;
    // Measured after the pad has been shown or hidden, so the minimap knows
    // how much of the corner is spoken for.
    this.mapReserve = on ? this.touch.reserve() : 0;
    this._mapBox = null;
  }

  // ---------------------------------------------------------- run flow

  // Whether there is a descent underway that a reload would throw away. A run
  // lives in memory and nowhere else, so this is the question the update check
  // asks before it reloads onto a new build. A finished run is not one: it is
  // a score screen, and the score is already banked in the profile.
  runInProgress() {
    return !!this.run && !this.runEnded;
  }

  startRun(seed, difficultyId) {
    this.audio.init();
    this.audio.setReverbEnabled(profile.settings.reverb !== false);
    this.audio.resume();
    const chosen = difficultyId || profile.settings.difficulty || 'torchbound';
    this.run = new Run(seed || makeSeed(), chosen);
    this.run.refreshMods();
    this.runEnded = false;
    this.screens.hide();
    this.loadLevel();
  }

  loadLevel() {
    this.state = STATE.BUSY;
    this.hud.hide();
    this.touch.setVisible(false);
    const depth = this.run.depth;
    const isBoss = this.run.isBossDepth(depth);
    this.screens.show('loading', {
      depth,
      title: isBoss ? 'Something waits below' : 'Depth ' + depth,
      text: isBoss ? 'The stair opens into a hall that is already occupied.'
        : DESCENT_FLAVOUR[(depth - 1) % DESCENT_FLAVOUR.length],
    });

    // Give the browser a frame to paint the loading screen before generating.
    setTimeout(() => {
      const level = generateLevel({
        depth,
        seed: this.run.levelSeed(),
        context: this.run.levelContext(),
      });
      if (this.world) this.world.dispose();
      warmTileSets(level.zoneInfo.map((z) => z.biome).concat([level.biome]));
      this.world = new World(this.run, level, this.run.rng.fork('level' + depth));
      this.world.strictMovement = profile.settings.movementAssist === 'strict';
      this.world.on((type, data) => this.onWorldEvent(type, data));
      // The world settles its opening hazard inside its own constructor, so
      // the first zone's effect would otherwise never reach the interface.
      this.hud.announceHazard(this.world.currentHazard);
      this.minimap.bind(level);
      this.renderer.cameraReady = false;
      this.renderer.onLevel(level);
      this.combatHeat = 0;
      this.perf.reset();

      this.screens.hide();
      this.hud.show();
      this.state = STATE.PLAYING;
      this.refreshTouchMode();
      this.touch.setCrossbow(this.run.hasCrossbow);
      this.input.releaseAll();
      this.input.clearEdges();

      if (this.audio.ready) {
        this.music.start();
        const zone = level.zoneInfo[0];
        this.music.setBiome(zone ? zone.biome.id : level.biome.id, zone ? zone.hazardId : 'clear');
        this.music.setScene(level.isBoss ? 'boss' : 'explore');
        this.music.setIntensity(level.isBoss ? 0.75 : 0.14, level.isBoss);
        this.audio.play('levelStart');
      }
      this.hud.toast('Depth ' + depth + (level.isBoss ? '  \u2014  ' + level.boss.name : ''));
      if (level.gates.length) {
        this.hud.toast(level.gates.length + ' sealed gate' + (level.gates.length > 1 ? 's' : '') + ' ahead');
      }
      // The opening guide, on the first depth of a descent, until the player
      // says otherwise. It stops the world rather than talking over it.
      if (depth === 1 && profile.settings.showGuide !== false) this.openGuide();
      else if (depth === 1 && profile.stats.runs === 0) {
        setTimeout(() => this.hud.toast('Your torch is the only light. Find the stairs.'), 1400);
      }
    }, 60);
  }

  pause() {
    if (this.state !== STATE.PLAYING) return;
    this.state = STATE.PAUSED;
    this.input.releaseAll();
    this.touch.setVisible(false);
    if (this.audio.ready) this.audio.master.gain.value = profile.settings.master * 0.35;
    this.screens.show('pause');
  }

  resume() {
    if (this.state !== STATE.PAUSED) return;
    this.screens.hide();
    this.state = STATE.PLAYING;
    this.input.clearEdges();
    this.refreshTouchMode();
    if (this.audio.ready) this.audio.master.gain.value = profile.settings.master;
  }

  descend() {
    this.state = STATE.BUSY;
    this.hud.hide();
    this.touch.setVisible(false);
    const breakdown = this.world.summary();
    if (this.audio.ready) {
      // The depth is behind them. Let the score say so before the relics do.
      this.music.setScene('relics');
      this.music.setIntensity(0.35, false);
    }
    this.screens.show('summary', {
      breakdown,
      run: this.run,
      nextIsBoss: this.run.isBossDepth(this.run.depth + 1),
    });
  }

  // Every screen that is not a depth gets the scene that belongs to it.
  // Anything shown over live play -- the pause menu, an altar, the bestiary
  // opened mid-run -- is left alone: the labyrinth is still the labyrinth.
  scoreFor(screen) {
    if (!this.audio.ready || !this.music.running) return;
    if (this.state === STATE.PLAYING || this.state === STATE.PAUSED) return;
    if (screen === 'relics' || screen === 'summary') this.music.setScene('relics');
    else if (screen === 'hall' || screen === 'gameover' || screen === 'fallen') {
      this.music.setScene('hall');
    } else if (screen === 'home' || screen === 'difficulty'
               || screen === 'settings' || screen === 'bestiary') {
      this.music.setScene('menu');
      this.music.setIntensity(0.1, false);
    }
  }

  showRelicChoice() {
    const guaranteed = this.world && this.world.level.isBoss;
    const offers = this.run.offer(3);
    this.screens.show('relics', { offers, run: this.run, guaranteed });
  }

  chooseRelic(relic) {
    if (relic) {
      this.run.takeRelic(relic);
      this.hud.toast(relic.name + ' claimed', 'good');
    }
    this.run.descend();
    this.loadLevel();
  }

  openGuide() {
    if (this.state !== STATE.PLAYING) return;
    this.state = STATE.PAUSED;
    this.input.releaseAll();
    this.touch.setVisible(false);
    if (this.audio.ready) this.audio.master.gain.value = profile.settings.master * 0.55;
    this.screens.show('guide', { touch: this.touchEnabled });
  }

  closeGuide() {
    if (this.state !== STATE.PAUSED) return;
    this.screens.hide();
    this.state = STATE.PLAYING;
    this.input.clearEdges();
    this.refreshTouchMode();
    if (this.audio.ready) this.audio.master.gain.value = profile.settings.master;
    this.hud.toast('Your torch is the only light. Find the stairs.');
  }

  // The chart, full size. Stops the world the same way an altar does: the
  // simulation is untouched and resuming puts the player back where they were.
  openMap() {
    if (this.state !== STATE.PLAYING || !this.world) return;
    this.state = STATE.PAUSED;
    this.input.releaseAll();
    this.touch.setVisible(false);
    if (this.audio.ready) this.audio.master.gain.value = profile.settings.master * 0.55;
    this.screens.show('map', { world: this.world, minimap: this.minimap });
  }

  closeMap() {
    if (this.state !== STATE.PAUSED) return;
    this.screens.hide();
    this.state = STATE.PLAYING;
    this.input.clearEdges();
    this.refreshTouchMode();
    if (this.audio.ready) this.audio.master.gain.value = profile.settings.master;
  }

  // An altar stops the world while the choice is being made. It is the same
  // shape as a pause: the simulation is untouched, and resuming puts the
  // player back exactly where they were standing.
  openAltar(prop, offers) {
    if (this.state !== STATE.PLAYING) return;
    this.state = STATE.PAUSED;
    this.altarProp = prop;
    this.input.releaseAll();
    this.touch.setVisible(false);
    if (this.audio.ready) this.audio.master.gain.value = profile.settings.master * 0.55;
    this.screens.show('altar', { offers });
  }

  takeOffer(offer) {
    const prop = this.altarProp;
    this.leaveAltar();
    if (prop && this.world) this.world.takeOffer(prop, offer);
  }

  leaveAltar() {
    this.altarProp = null;
    if (this.state !== STATE.PAUSED) return;
    this.screens.hide();
    this.state = STATE.PLAYING;
    this.input.clearEdges();
    this.refreshTouchMode();
    if (this.audio.ready) this.audio.master.gain.value = profile.settings.master;
  }

  // Hearthlight only. The run total survives; this depth's earnings do not.
  retryDepth() {
    if (this.audio.ready) this.audio.master.gain.value = profile.settings.master;
    this.run.retryDepth();
    this.screens.hide();
    this.loadLevel();
  }

  endRun(reason) {
    // Banking the level score and recording the run are both one-way. Two
    // routes reach this (abandoning, and dying), so make a second call inert
    // rather than paying the score out twice.
    if (this.runEnded || !this.run) return;
    this.runEnded = true;
    this.state = STATE.BUSY;
    this.hud.hide();
    this.touch.setVisible(false);
    if (this.audio.ready) {
      this.music.setScene('hall');
      this.music.setIntensity(0.2, false);
      this.audio.master.gain.value = profile.settings.master;
    }
    // A run that ends mid-depth still banks what was earned on the way down.
    if (this.world && !this.world.finished) {
      this.run.score.finishLevel({
        depth: this.run.depth,
        elapsed: this.world.elapsed,
        parTime: this.world.level.parTime,
        hp: Math.max(0, this.run.hp),
        maxHp: this.run.maxHp,
        mods: this.run.mods,
      });
    }
    profile.recordRun({
      score: this.run.score.total,
      depth: this.run.depth,
      kills: this.run.score.runBest.kills,
      ranked: this.run.difficulty.ranked,
    });
    this.screens.show('gameover', { run: this.run, reason });
  }

  // Where the minimap goes, and how big it is allowed to be. It sits above
  // whatever the touch pad has reserved rather than at a fixed offset, and
  // shrinks rather than climbing into the vitals when there is not room for
  // both. Cached, because it only changes when the viewport or the touch mode
  // does, and it is read every frame.
  minimapBox() {
    const w = this.renderer.width, h = this.renderer.height;
    if (this._mapBox && this._mapBoxKey === w + 'x' + h + ':' + this.mapReserve) return this._mapBox;
    const pad = 14;
    const topSafe = 118;              // clear of the vitals and the score block
    const reserve = this.mapReserve || 0;
    // The chart grows with the display. The ceiling used to be 172px, which on
    // a phone is a fifth of the screen and on a large monitor is a stamp --
    // the same number cannot serve both, so it scales and stops at a size that
    // is still a corner rather than a second view.
    const ceiling = clamp(Math.round(Math.min(w, h) * 0.24), 172, 260);
    let size = Math.round(clamp(Math.min(w, h) * 0.2, 96, ceiling));
    size = Math.round(clamp(Math.min(size, h - reserve - pad * 2 - topSafe), 68, ceiling));
    this._mapBoxKey = w + 'x' + h + ':' + this.mapReserve;
    this._mapBox = { x: w - size - pad, y: h - size - pad - reserve, size };
    return this._mapBox;
  }

  // ------------------------------------------------------- world events
  onWorldEvent(type, data) {
    switch (type) {
      case 'sfx': this.audio.play(data.name, data); break;
      case 'hitstop': this.loop.hitStop(data.seconds || 0.05); break;
      case 'hazard':
        this.hud.announceHazard(data.hazard);
        if (this.audio.ready && data.biome) this.music.setBiome(data.biome.id, data.hazard.id);
        break;
      case 'kill':
        this.combatHeat = Math.min(1, this.combatHeat + 0.32);
        this.musicPush(0.16);
        break;
      case 'alert':
        this.combatHeat = Math.min(1, this.combatHeat + 0.12);
        this.musicPush(0.22);
        break;
      case 'breach': {
        // Something is coming through a wall. The score should say so before
        // the player has worked out where the noise came from -- but the words
        // only if it is close enough to matter, or every breach on the depth
        // narrates itself from across the level.
        this.musicPush(0.3);
        const p = this.world.player;
        const near = Math.hypot(data.enemy.x - p.x, data.enemy.y - p.y) < 13;
        if (near) this.hud.toast('Something is forcing its way in', 'bad');
        break;
      }
      case 'emerged': this.musicPush(0.18); break;
      case 'blockHeld':
        // Said out loud once, because the difference between having hold of a
        // stone and standing next to one is invisible and changes how you walk.
        this.hud.toast(data.held
          ? (data.block.kind === 'slab'
            ? 'You have hold of the slab  —  back away and it comes'
            : 'You have hold of the stone  —  back away and it comes')
          : 'You let go', data.held ? 'good' : '');
        break;
      case 'secretFound': this.hud.toast('Cracked stone -- strike it', 'good'); break;
      case 'secretBroken':
        this.hud.toast('Secret discovered', 'good');
        // The chart paints each tile once, so a wall that stops being a wall
        // has to ask for its square back.
        if (data.secret) this.minimap.repaint(data.secret.x, data.secret.y);
        break;
      case 'crossbow':
        this.touch.setCrossbow(true);
        this.hud.toast('Crossbow recovered  \u2014  F or K to loose', 'good');
        break;
      case 'torch':
        this.touch.setTorch(data.lit);
        this.hud.toast(data.lit ? 'Torch lit' : 'Torch out  —  you can hear better in the dark',
          data.lit ? 'good' : '');
        break;
      case 'fireLit': this.hud.toast('The fire catches', 'good'); break;
      case 'altarOpen': this.openAltar(data.prop, data.offers); break;
      case 'altarUsed':
        this.hud.toast(data.gave ? 'The altar answers: ' + data.gave : 'The altar takes and says nothing',
          data.gave ? 'good' : 'bad');
        break;
      case 'forgot':
        // The chart is painted once per tile and never rubbed out, so it has
        // to be told when there is suddenly nothing to remember.
        this.minimap.bind(this.world.level);
        this.hud.toast('You do not remember any of this', 'bad');
        break;
      case 'charted': this.hud.toast('The passages draw themselves', 'good'); break;
      case 'hint':
        this.hud.toast('You are shown ' + data.hint.label, 'good');
        break;
      case 'mapRead':
        if (!data.hint) this.hud.toast('The map tells you nothing new');
        break;
      case 'scream':
        this.combatHeat = Math.min(1, this.combatHeat + 0.2);
        this.musicPush(0.26);
        break;
      case 'captive':
        if (data.action === 'murdered') this.hud.toast('That will be answered for', 'bad');
        else if (data.action === 'mercy') this.hud.toast('You gave them what they asked for', 'good');
        else if (data.action === 'freed') this.hud.toast('You cut them loose', 'good');
        else if (data.action === 'spurned') this.hud.toast('They did not want their chains back', 'bad');
        break;
      case 'distraction':
        this.hud.toast(data.count === 1 ? 'Something goes to look' : data.count + ' go to look', 'good');
        break;
      case 'unearthed':
        this.combatHeat = Math.min(1, this.combatHeat + 0.35);
        this.renderer.addShake(5);
        this.hud.toast('Something was under the floor', 'bad');
        break;
      case 'blockOpened':
        this.hud.toast('The stone was hiding something', 'good');
        break;
      case 'blockPushed':
        // The chart draws blocks as solid ground, so the two tiles either side
        // of a shove have to be repainted or the stone leaves a ghost of
        // itself behind on the map.
        if (data.block) {
          this.minimap.repaint(data.block.fromX, data.block.fromY);
          this.minimap.repaint(data.block.x, data.block.y);
        }
        break;
      case 'gateOpened':
        this.hud.toast('Gate opened', 'good');
        if (data.gate) this.minimap.repaint(data.gate.x, data.gate.y);
        break;
      case 'ladder':
        // The camera has to cut, not pan: the vault is nowhere near the maze.
        this.renderer.cameraReady = false;
        this.renderer.addShake(4);
        this.hud.toast(data.dir === 'down' ? 'A vault beneath the labyrinth' : 'Back in the labyrinth',
          data.dir === 'down' ? 'good' : '');
        break;
      case 'encounterStart':
        this.combatHeat = 1;
        if (data.encounter.label) this.hud.toast(data.encounter.label, 'bad');
        break;
      case 'encounterClear': this.hud.toast('Room cleared', 'good'); break;
      case 'wave': this.hud.toast('Wave ' + data.index + ' of ' + data.total, 'bad'); break;
      case 'bossAwake':
        this.hud.toast(data.boss.def.name + ' stirs', 'bad');
        if (this.audio.ready) {
          this.music.setScene('boss');
          this.music.setIntensity(1, true);
        }
        break;
      case 'chamber':
        // A brief tonal lift as a room nobody has been in opens up.
        if (this.audio.ready) this.music.chamberShift(Math.min(1.4, data.area / 30));
        break;
      case 'bossPhase': this.hud.toast('It changes', 'bad'); break;
      case 'bossKilled':
        this.hud.toast(data.boss.def.name + ' falls', 'good');
        if (this.audio.ready) {
          this.music.setScene('explore');
          this.music.setIntensity(0.25, false);
        }
        break;
      case 'descend': this.descend(); break;
      case 'playerDied':
        this.state = STATE.BUSY;
        this.hud.hide();
        this.touch.setVisible(false);
        setTimeout(() => {
          // Hearthlight keeps the run alive and offers the stair again.
          if (this.run.difficulty.retry) this.screens.show('fallen', { run: this.run });
          else this.endRun('death');
        }, 1500);
        break;
      default: break;
    }
  }

  // --------------------------------------------------------- game loop
  update(dt) {
    if (this.state !== STATE.PLAYING || !this.world) return;

    if (this.input.consume('pause')) { this.pause(); return; }
    if (this.input.consume('bestiary')) {
      this.pause();
      this.screens.show('bestiary', { from: 'pause' });
      return;
    }

    const axis = this.input.axis();
    // The diamond pad speaks in dungeon axes whatever the key setting says.
    const frame = this.input.frameFor(profile.settings.movementFrame);
    const dir = inputDirToGrid(axis.x, axis.y, frame);
    const intent = {
      moveX: dir.x,
      moveY: dir.y,
      slash: this.input.held('slash'),
      fire: this.input.held('fire'),
      // Held rather than edge-triggered, because a grip on a stone lasts as
      // long as the key does.
      action: this.input.held('action'),
    };
    if (this.input.consume('action')) {
      this.world.interact({ held: this.input.held('action') });
    }
    if (this.input.consume('torch')) this.world.toggleTorch();
    if (this.input.consume('map')) { this.openMap(); return; }

    this.world.update(dt, intent);

    if (this.world.shakeRequest > 0) {
      this.renderer.addShake(this.world.shakeRequest * profile.settings.screenShake);
      this.world.shakeRequest = 0;
    }
    this.combatHeat = Math.max(0, this.combatHeat - dt * 0.22);
    this.updateAudioSpace(dt);
    this.updateMusic(dt);
  }

  // A brief push on the score, spent by an event rather than by a state. The
  // smoothing that keeps the music from twitching also makes it deaf to
  // anything that happens in less than a second, and most of what happens in
  // this game happens in less than a second.
  musicPush(amount) {
    if (this.audio.ready && this.music.running) this.music.push(amount);
  }

  // Tells the mixer where the listener is and what shape of room they are
  // standing in. The listener moves every frame; the room only needs
  // re-evaluating a few times a second.
  updateAudioSpace(dt) {
    if (!this.audio.ready) return;
    const world = this.world;
    this.audio.setListener(world.player.x, world.player.y);
    this.spaceTimer -= dt;
    if (this.spaceTimer > 0) return;
    this.spaceTimer = 0.25;
    this.audio.setSpace(world.acoustics, world.acousticProfile, world.acousticMods());
    if (this.music.running) this.music.setSpace(world.acoustics);
  }

  updateMusic(dt) {
    if (!this.audio.ready || !this.music.running) return;
    this.musicTimer = (this.musicTimer || 0) - dt;
    if (this.musicTimer > 0) return;
    this.musicTimer = 0.5;

    const world = this.world;
    const px = world.player.x, py = world.player.y;
    // How much of the labyrinth is currently interested in you, and how close
    // the nearest of it is. Counting alone was too flat: three creatures
    // milling about a room away and three closing on you are the same number
    // and very much not the same situation.
    let aware = 0, chasing = 0, nearest = Infinity;
    for (const e of world.enemies) {
      if (e.dead || e.dormant) continue;
      if (e.state === 'idle') continue;
      const d = Math.hypot(e.x - px, e.y - py);
      if (d > 14) continue;
      aware++;
      if (e.state === 'chase' || e.state === 'strike') { chasing++; nearest = Math.min(nearest, d); }
    }
    const bossFight = !!(world.boss && world.boss.awake && !world.boss.dead);
    const hpFrac = this.run.hp / Math.max(1, this.run.maxHp);

    let intensity = 0.1;
    intensity += Math.min(0.3, aware * 0.07);
    intensity += Math.min(0.34, chasing * 0.14);
    // Proximity: something eight tiles away and coming is worth more than the
    // same thing at the edge of hearing.
    if (nearest < 10) intensity += (1 - nearest / 10) * 0.22;
    intensity += this.combatHeat * 0.3;
    // Being hurt, being nearly dead, and being in the dark all belong in the
    // score. Dousing the torch is the loudest thing the player can do to the
    // music without touching a creature, and it should sound like a decision.
    if (hpFrac < 0.45) intensity += (0.45 - hpFrac) * 0.5;
    if (!world.torchLit) intensity += 0.1;
    // A room that has sealed itself around a fight.
    if (world.sealBlocks.size > 0) intensity += 0.12;
    if (world.hazardMods && world.hazardMods.enemyAggro > 1) intensity += 0.04;
    if (bossFight) intensity = Math.max(intensity, 0.9);
    this.music.setIntensity(clamp(intensity, 0, 1), bossFight);
  }

  render(alpha, dt) {
    // Measured on the real elapsed frame time, then handed to the renderer as
    // a budget: 30fps is the floor, and effects are shed to defend it.
    this.renderer.tier = this.perf.frame(dt);
    if ((this.state === STATE.PLAYING || this.state === STATE.PAUSED) && this.world) {
      if (this.state === STATE.PLAYING) this.renderer.updateCamera(this.world, dt);
      this.renderer.render(this.world, this.state === STATE.PLAYING ? dt : 0);
      if (this.state === STATE.PLAYING) {
        const box = this.minimapBox();
        this.minimap.draw(this.renderer.ctx, this.world, box.x, box.y, box.size);
        this.hud.update(this.world, this.run, dt);
        if (profile.settings.showFps) this.hud.drawFps(this.renderer, this.perf);
      }
    } else {
      const ctx = this.renderer.ctx;
      ctx.setTransform(this.renderer.dpr, 0, 0, this.renderer.dpr, 0, 0);
      ctx.fillStyle = '#07080d';
      ctx.fillRect(0, 0, this.renderer.width, this.renderer.height);
      this.drawMenuBackdrop(ctx, dt);
    }
  }

  // A slow drifting ember field behind the menus, so the home screen is not
  // a flat rectangle of nothing.
  drawMenuBackdrop(ctx, dt) {
    this.backdropT = (this.backdropT || 0) + dt;
    const t = this.backdropT;
    const w = this.renderer.width, h = this.renderer.height;
    // The wash is fixed to the viewport, so it only needs rebuilding when the
    // viewport changes rather than on every frame the menu sits there.
    if (!this._backdrop || this._backdropW !== w || this._backdropH !== h) {
      this._backdrop = ctx.createRadialGradient(
        w * 0.5, h * 0.34, 0, w * 0.5, h * 0.34, Math.max(w, h) * 0.72);
      this._backdrop.addColorStop(0, 'rgba(62,34,12,0.5)');
      this._backdrop.addColorStop(1, 'rgba(6,7,11,0)');
      this._backdropW = w; this._backdropH = h;
    }
    ctx.fillStyle = this._backdrop;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 46; i++) {
      const seed = i * 71.3;
      const x = ((seed * 13.7 + Math.sin(t * 0.4 + i) * 40) % (w + 60)) - 30;
      const y = h - (((seed * 7.1 + t * 26) % (h + 120)) - 60);
      const a = 0.1 + Math.abs(Math.sin(t * 1.4 + i)) * 0.28;
      ctx.fillStyle = 'rgba(255,150,70,' + a.toFixed(3) + ')';
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.restore();
  }
}

const game = new Game();
game.boot();
