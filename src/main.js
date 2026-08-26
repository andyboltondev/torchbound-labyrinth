// Application entry point: boots the systems, owns the state machine, and
// wires world events through to the interface, audio and music layers.

import { GameLoop } from './core/loop.js';
import { Input } from './core/input.js';
import { screenDirToGrid } from './render/iso.js';
import { Renderer } from './render/renderer.js';
import { Minimap } from './render/minimap.js';
import { warmTileSets } from './render/sprites.js';
import { generateLevel } from './gen/dungeon.js';
import { Run } from './game/run.js';
import { World } from './game/world.js';
import { profile } from './game/profile.js';
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
      start: () => this.startRun(),
      resume: () => this.resume(),
      quit: () => this.endRun('quit'),
      chooseRelic: (relic) => this.chooseRelic(relic),
      afterSummary: () => this.showRelicChoice(),
      onTouchModeChange: () => this.refreshTouchMode(),
      get run() { return window.__game ? window.__game.run : null; },
    });
    this.state = STATE.MENU;
    this.run = null;
    this.world = null;
    this.combatHeat = 0;
    this.loop = new GameLoop((dt) => this.update(dt), (alpha, dt) => this.render(alpha, dt));

    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.onResize(), 200));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === STATE.PLAYING) this.pause();
    });
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
    this.screens.show('home');
    this.loop.start();
    // The audio context can only start from a gesture, so arm it on the first.
    const arm = () => {
      this.audio.init();
      this.audio.resume();
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('keydown', arm);
    };
    window.addEventListener('pointerdown', arm);
    window.addEventListener('keydown', arm);
  }

  onResize() {
    this.renderer.resize();
    this.refreshTouchMode();
  }

  refreshTouchMode() {
    const mode = profile.settings.touchControls;
    const on = mode === 'always' || (mode === 'auto' && isTouchDevice());
    this.touch.setVisible(on && this.state === STATE.PLAYING);
    this.hud.setTouchMode(on);
    this.touchEnabled = on;
  }

  // ---------------------------------------------------------- run flow
  startRun(seed) {
    this.audio.init();
    this.audio.resume();
    this.run = new Run(seed || makeSeed());
    this.run.refreshMods();
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
      title: isBoss ? 'Something waits below' : 'Depth ' + depth,
      text: isBoss ? 'The stair opens into a hall that is already occupied.'
        : DESCENT_FLAVOUR[(depth - 1) % DESCENT_FLAVOUR.length],
    });

    // Give the browser a frame to paint the loading screen before generating.
    setTimeout(() => {
      const level = generateLevel({
        depth,
        seed: this.run.seed,
        context: this.run.levelContext(),
      });
      if (this.world) this.world.dispose();
      warmTileSets(level.zoneInfo.map((z) => z.biome).concat([level.biome]));
      this.world = new World(this.run, level, this.run.rng.fork('level' + depth));
      this.world.on((type, data) => this.onWorldEvent(type, data));
      this.minimap.bind(level);
      this.renderer.cameraReady = false;
      this.combatHeat = 0;

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
        this.music.setIntensity(level.isBoss ? 0.75 : 0.14, level.isBoss);
        this.audio.play('levelStart');
      }
      this.hud.toast('Depth ' + depth + (level.isBoss ? '  \u2014  ' + level.boss.name : ''));
      if (level.gates.length) {
        this.hud.toast(level.gates.length + ' sealed gate' + (level.gates.length > 1 ? 's' : '') + ' ahead');
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
    if (this.audio.ready) this.music.setIntensity(0.1, false);
    this.screens.show('summary', {
      breakdown,
      run: this.run,
      nextIsBoss: this.run.isBossDepth(this.run.depth + 1),
    });
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

  endRun(reason) {
    this.state = STATE.BUSY;
    this.hud.hide();
    this.touch.setVisible(false);
    if (this.audio.ready) {
      this.music.stop();
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
    });
    this.screens.show('gameover', { run: this.run, reason });
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
      case 'kill': this.combatHeat = Math.min(1, this.combatHeat + 0.32); break;
      case 'alert': this.combatHeat = Math.min(1, this.combatHeat + 0.12); break;
      case 'secretFound': this.hud.toast('Cracked stone -- strike it', 'good'); break;
      case 'secretBroken': this.hud.toast('Secret discovered', 'good'); break;
      case 'crossbow':
        this.touch.setCrossbow(true);
        this.hud.toast('Crossbow recovered  \u2014  F or K to loose', 'good');
        break;
      case 'gateOpened': this.hud.toast('Gate opened', 'good'); break;
      case 'encounterStart':
        this.combatHeat = 1;
        if (data.encounter.label) this.hud.toast(data.encounter.label, 'bad');
        break;
      case 'encounterClear': this.hud.toast('Room cleared', 'good'); break;
      case 'wave': this.hud.toast('Wave ' + data.index + ' of ' + data.total, 'bad'); break;
      case 'bossAwake':
        this.hud.toast(data.boss.def.name + ' stirs', 'bad');
        if (this.audio.ready) this.music.setIntensity(1, true);
        break;
      case 'bossPhase': this.hud.toast('It changes', 'bad'); break;
      case 'bossKilled':
        this.hud.toast(data.boss.def.name + ' falls', 'good');
        if (this.audio.ready) this.music.setIntensity(0.25, false);
        break;
      case 'descend': this.descend(); break;
      case 'playerDied':
        this.state = STATE.BUSY;
        this.hud.hide();
        this.touch.setVisible(false);
        setTimeout(() => this.endRun('death'), 1500);
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
    const dir = screenDirToGrid(axis.x, axis.y);
    const intent = {
      moveX: dir.x,
      moveY: dir.y,
      slash: this.input.held('slash'),
      fire: this.input.held('fire'),
    };
    if (this.input.consume('action')) this.world.interact();

    this.world.update(dt, intent);

    if (this.world.shakeRequest > 0) {
      this.renderer.addShake(this.world.shakeRequest * profile.settings.screenShake);
      this.world.shakeRequest = 0;
    }
    this.combatHeat = Math.max(0, this.combatHeat - dt * 0.22);
    this.updateMusic(dt);
  }

  updateMusic(dt) {
    if (!this.audio.ready || !this.music.running) return;
    this.musicTimer = (this.musicTimer || 0) - dt;
    if (this.musicTimer > 0) return;
    this.musicTimer = 0.5;

    const world = this.world;
    let aware = 0;
    for (const e of world.enemies) {
      if (e.dead || e.dormant) continue;
      if (e.state !== 'idle' && Math.hypot(e.x - world.player.x, e.y - world.player.y) < 12) aware++;
    }
    const bossFight = !!(world.boss && world.boss.awake && !world.boss.dead);
    const hpFrac = this.run.hp / Math.max(1, this.run.maxHp);
    let intensity = 0.12 + Math.min(0.45, aware * 0.13) + this.combatHeat * 0.34;
    if (hpFrac < 0.3) intensity += 0.14;
    if (bossFight) intensity = Math.max(intensity, 0.9);
    this.music.setIntensity(clamp(intensity, 0, 1), bossFight);
  }

  render(alpha, dt) {
    if ((this.state === STATE.PLAYING || this.state === STATE.PAUSED) && this.world) {
      if (this.state === STATE.PLAYING) this.renderer.updateCamera(this.world, dt);
      this.renderer.render(this.world, this.state === STATE.PLAYING ? dt : 0);
      if (this.state === STATE.PLAYING) {
        const size = Math.round(clamp(Math.min(this.renderer.width, this.renderer.height) * 0.2, 96, 172));
        const pad = 14;
        this.minimap.draw(this.renderer.ctx, this.world,
          this.renderer.width - size - pad,
          this.renderer.height - size - pad - (this.touchEnabled ? 104 : 0), size);
        this.hud.update(this.world, this.run, dt);
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
    const g = ctx.createRadialGradient(w * 0.5, h * 0.34, 0, w * 0.5, h * 0.34, Math.max(w, h) * 0.72);
    g.addColorStop(0, 'rgba(62,34,12,0.5)');
    g.addColorStop(1, 'rgba(6,7,11,0)');
    ctx.fillStyle = g;
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
