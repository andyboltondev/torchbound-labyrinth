// Scene renderer.
//
// Draw order is a painter's algorithm over grid depth (x + y). Floors go down
// first for every discovered cell -- including under walls -- so that when a
// wall fades out to keep the action visible, there is real ground behind it
// rather than a hole (design rule 6).

import {
  TILE_W, TILE_H, HALF_W, HALF_H, WALL_H, screenX, screenY, toGrid,
} from './iso.js';
import { T } from '../gen/tiles.js';
import { tileSet, VARIANTS, hazardOverlay, warmLightSprites, contactShadow } from './sprites.js';
import { Ambience } from './ambience.js';
import { Critters } from './critters.js';
import { drawStains, drawCorpses } from './gore.js';
import { PostFX } from './postfx.js';
import { TIERS } from '../core/perf.js';
import { rgba, shade } from './palette.js';
import { drawPlayer, drawEnemy, drawBoss, drawFlame, setShadowLight } from './actors.js';
import { drawGate, drawKeyItem, drawProp, drawDecor, drawSconce, drawPushBlock, drawDecal }
  from './props.js';
import { clamp, damp } from '../core/util.js';

const FADE_ALPHA = 0.38;
const MEMORY_MIN = 0.12;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.dpr = 1;
    this.width = 0;
    this.height = 0;
    this.zoom = 1;
    this.camera = { x: 0, y: 0 };
    this.shake = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.fadeSet = new Set();
    this.renderList = [];
    this.weatherT = 0;
    this.quality = 1;
    this.tier = TIERS[TIERS.length - 1];
    this.ambience = new Ambience();
    this.critters = new Critters();
    this.post = new PostFX();
    this.warm = null;
    this.resize();
  }

  resize() {
    // The canvas is always full-viewport, so measure the viewport rather than
    // the element: on first boot the stylesheet may not have applied yet and
    // the element would still report the 300x150 canvas default.
    const rect = this.canvas.getBoundingClientRect();
    const useRect = rect.width > 320 && rect.height > 240;
    const w = Math.max(320, Math.round(useRect ? rect.width : window.innerWidth));
    const h = Math.max(240, Math.round(useRect ? rect.height : window.innerHeight));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.width = w;
    this.height = h;
    // Zoom is chosen so the whole torch pool fits across the narrow axis with
    // a little margin: any further out and a phone screen stops being
    // readable, any further in and the pool no longer fits.
    this.zoom = clamp(Math.min(w / 640, h / 520), 0.62, 1.3);
  }

  addShake(amount) { this.shake = Math.min(18, this.shake + amount); }

  onLevel(level) {
    this.ambience.bind(level);
    this.critters.bind();
    this.weatherT = 0;
  }

  // Which sides of this floor tile have something solid standing on them.
  // Bits: 1 west, 2 north, 4 east, 8 south -- the order `contactShadow` bakes.
  aoMask(grid, x, y) {
    const solid = (gx, gy) => {
      if (!grid.inBounds(gx, gy)) return true;
      const t = grid.get(gx, gy);
      return t === T.WALL || t === T.SECRET || t === T.RUBBLE || t === T.GATE;
    };
    return (solid(x - 1, y) ? 1 : 0) | (solid(x, y - 1) ? 2 : 0)
      | (solid(x + 1, y) ? 4 : 0) | (solid(x, y + 1) ? 8 : 0);
  }

  updateCamera(world, dt) {
    const p = world.player;
    const target = { x: screenX(p.x, p.y), y: screenY(p.x, p.y) - 14 };
    if (!this.cameraReady) {
      this.camera.x = target.x; this.camera.y = target.y;
      this.cameraReady = true;
    } else {
      this.camera.x = damp(this.camera.x, target.x, 9, dt);
      this.camera.y = damp(this.camera.y, target.y, 9, dt);
    }
    this.shake = Math.max(0, this.shake - dt * 42);
    const s = this.shake;
    this.shakeX = (Math.random() - 0.5) * s;
    this.shakeY = (Math.random() - 0.5) * s * 0.6;
  }

  // Grid-space bounding box of everything currently on screen.
  // Restricts the drawn area to the layer the player occupies, so the maze
  // never hangs in the air next to a vault.
  layerBounds(world, bounds) {
    const band = world.level.mazeHeight;
    if (band === undefined) return bounds;
    if (world.playerLayer === 1) return { ...bounds, y0: Math.max(bounds.y0, band) };
    return { ...bounds, y1: Math.min(bounds.y1, band - 1) };
  }

  visibleBounds(level) {
    const halfW = this.width / (2 * this.zoom);
    const halfH = this.height / (2 * this.zoom);
    const corners = [
      toGrid(this.camera.x - halfW, this.camera.y - halfH),
      toGrid(this.camera.x + halfW, this.camera.y - halfH),
      toGrid(this.camera.x - halfW, this.camera.y + halfH),
      toGrid(this.camera.x + halfW, this.camera.y + halfH),
    ];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of corners) {
      x0 = Math.min(x0, c.x); x1 = Math.max(x1, c.x);
      y0 = Math.min(y0, c.y); y1 = Math.max(y1, c.y);
    }
    return {
      x0: Math.max(0, Math.floor(x0) - 2),
      y0: Math.max(0, Math.floor(y0) - 2),
      x1: Math.min(level.grid.w - 1, Math.ceil(x1) + 3),
      y1: Math.min(level.grid.h - 1, Math.ceil(y1) + 3),
    };
  }

  setsFor(world, x, y) {
    const zone = world.level.zoneInfo[world.level.zoneMap[world.level.grid.idx(x, y)]];
    return tileSet((zone && zone.biome) || world.level.biome);
  }

  // --- occlusion ----------------------------------------------------------
  // Any wall that would cover something the player needs to see is faded.
  // The test is a real screen-space overlap, not a heuristic, so it only
  // fades what is genuinely in the way.
  computeFades(world, bounds) {
    this.fadeSet.clear();
    const level = world.level;
    const subjects = [];
    const p = world.player;
    const layer = world.playerLayer;
    const push = (x, y, halfW, top, bottom) => {
      if (world.layerAt(Math.floor(y)) !== layer) return;
      if (Math.abs(x - p.x) + Math.abs(y - p.y) > 16) return;
      subjects.push({ x, y, halfW, top, bottom });
    };
    push(p.x, p.y, 12, -46, 2);
    for (const e of world.enemies) {
      if (e.dead || !world.vis.isVisible(Math.floor(e.x), Math.floor(e.y))) continue;
      push(e.x, e.y, 12 * (e.scale || 1), -44 * (e.scale || 1), 2);
    }
    if (world.boss && !world.boss.dead) push(world.boss.x, world.boss.y, 34, -100, 4);
    for (const k of level.keys) {
      if (k.taken || k.holder === 'enemy') continue;
      push(k.x + 0.5, k.y + 0.5, 12, -30, 2);
    }
    for (const prop of level.props) {
      if (prop.consumed || prop.hidden) continue;
      push(prop.x, prop.y, 13, -30, 2);
    }
    // Gates are tall and carry the colour the player has to read, so nothing
    // is allowed to stand in front of one.
    for (const g of level.gates) {
      if (g.openAmount >= 1) continue;
      push(g.x + 0.5, g.y + 0.5, 18, -48, 2);
    }
    // Cracked walls have to be spottable, and so does the way out.
    for (const s of level.secrets) {
      if (s.broken || !s.discovered) continue;
      push(s.x + 0.5, s.y + 0.5, 16, -40, 2);
    }
    if (!world.level.isBoss) push(level.stairs.x + 0.5, level.stairs.y + 0.5, 16, -18, 2);

    for (const s of subjects) {
      const sx = screenX(s.x, s.y);
      const sy = screenY(s.x, s.y);
      const ax0 = sx - s.halfW, ax1 = sx + s.halfW;
      const ay0 = sy + s.top, ay1 = sy + s.bottom;
      const gx = Math.floor(s.x), gy = Math.floor(s.y);
      for (let dy = -1; dy <= 4; dy++) {
        for (let dx = -1; dx <= 4; dx++) {
          if (dx + dy <= 0) continue; // behind the subject: cannot occlude it
          const wx = gx + dx, wy = gy + dy;
          if (wx < bounds.x0 || wy < bounds.y0 || wx > bounds.x1 || wy > bounds.y1) continue;
          const t = level.grid.get(wx, wy);
          if (t !== T.WALL && t !== T.SECRET && t !== T.RUBBLE) continue;
          const wsx = screenX(wx, wy), wsy = screenY(wx, wy);
          const bx0 = wsx - HALF_W, bx1 = wsx + HALF_W;
          const by0 = wsy - HALF_H - WALL_H, by1 = wsy + HALF_H;
          if (bx1 < ax0 || bx0 > ax1 || by1 < ay0 || by0 > ay1) continue;
          this.fadeSet.add(level.grid.idx(wx, wy));
        }
      }
    }
  }

  // --- main pass ----------------------------------------------------------
  render(world, dt) {
    const ctx = this.ctx;
    const level = world.level;
    const vis = world.vis;
    const t = world.time;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = level.biome.ambient || '#07080d';
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.save();
    ctx.translate(this.width / 2 + this.shakeX, this.height / 2 + this.shakeY);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.camera.x, -this.camera.y);

    const bounds = this.layerBounds(world, this.visibleBounds(level));
    const tier = this.tier;
    this.quality = tier.scale;
    this.warm = tier.torchLight ? warmLightSprites() : null;
    // Shadows fall away from the torch, which is the player's own hand.
    setShadowLight(screenX(world.player.x, world.player.y),
      screenY(world.player.x, world.player.y) - 24, tier.softShadows);

    this.ambience.update(dt, world, tier);
    this.critters.update(dt, world, tier);
    this.computeFades(world, bounds);
    this.drawFloors(world, bounds);
    if (this.warm) this.drawFloorLight(world, bounds);
    drawStains(ctx, world, tier);
    drawCorpses(ctx, world, tier);
    this.ambience.drawGround(ctx, world, tier);
    this.buildRenderList(world, bounds);
    this.drawRenderList(world, t);
    this.critters.draw(ctx, world, tier);
    world.particles.draw(ctx, (x, y) => this.lightSample(world, x, y));
    this.ambience.drawMotes(ctx, world, tier);
    this.drawGroundEffects(world, bounds, t);
    world.particles.drawTexts(ctx);

    ctx.restore();

    this.drawTorchGlow(world);
    this.drawWeather(world, dt);
    if (tier.bloom) {
      this.post.bloom(ctx, this.canvas, this.width, this.height, tier.bloomDiv, 0.4);
    }
    this.drawVignette(world);
    if (tier.grade && level.biome.grade) {
      this.post.grade(ctx, this.width, this.height, level.biome.grade, 0.11);
    }
  }

  // A second pass over the floors that adds the torch's own warmth. Kept
  // separate so the additive blend mode is set once rather than per tile.
  drawFloorLight(world, bounds) {
    const ctx = this.ctx;
    const level = world.level;
    const vis = world.vis;
    const grid = level.grid;
    const sprite = this.warm.floor;
    const flicker = world.torch.flicker;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let y = bounds.y0; y <= bounds.y1; y++) {
      for (let x = bounds.x0; x <= bounds.x1; x++) {
        const i = grid.idx(x, y);
        if (!vis.seen[i] || vis.visGen[i] !== vis.gen) continue;
        const lit = vis.light[i];
        if (lit <= 0.14) continue;
        const tile = grid.cells[i];
        if (tile === T.WALL || tile === T.SECRET || tile === T.RUBBLE) continue;
        ctx.globalAlpha = Math.min(0.12, lit * lit * 0.085 * flicker);
        ctx.drawImage(sprite, screenX(x, y) - HALF_W, screenY(x, y) - HALF_H);
      }
    }
    ctx.restore();
  }

  lightSample(world, x, y) {
    const gx = Math.floor(x), gy = Math.floor(y);
    const lit = world.vis.lightAt(gx, gy);
    if (lit > 0) return lit;
    return world.vis.memoryAt(gx, gy) * 0.2;
  }

  drawFloors(world, bounds) {
    const ctx = this.ctx;
    const level = world.level;
    const vis = world.vis;
    const grid = level.grid;
    const ao = this.tier.contactShadows;
    for (let y = bounds.y0; y <= bounds.y1; y++) {
      for (let x = bounds.x0; x <= bounds.x1; x++) {
        const i = grid.idx(x, y);
        if (!vis.seen[i]) continue;
        const mem = vis.memory[i];
        const lit = vis.visGen[i] === vis.gen ? vis.light[i] : 0;
        if (lit <= 0 && mem <= MEMORY_MIN) continue;
        const tile = grid.cells[i];
        const set = this.setsFor(world, x, y);
        const v = level.variants[i] % VARIANTS;
        let spr;
        if (tile === T.STAIRS) spr = set.stairs;
        else if (tile === T.ENTRANCE) spr = set.entrance;
        else spr = set.floor[v];
        const sx = screenX(x, y) - HALF_W;
        const sy = screenY(x, y) - HALF_H;
        if (lit > 0.01) {
          ctx.drawImage(spr.lit, sx, sy);
          const haz = this.hazardSpriteAt(world, i);
          if (haz) ctx.drawImage(haz, sx, sy);
          if (lit < 0.995) {
            ctx.globalAlpha = 1 - lit;
            ctx.drawImage(spr.dark, sx, sy);
            ctx.globalAlpha = 1;
          }
          // The crease where the ground meets a wall. One blit, and it is what
          // stops the floor looking like a sticker under the masonry.
          if (ao && tile !== T.STAIRS) {
            const shadow = contactShadow(this.aoMask(grid, x, y));
            if (shadow) {
              ctx.globalAlpha = (0.4 + lit * 0.6) * 0.85;
              ctx.drawImage(shadow, sx, sy);
              ctx.globalAlpha = 1;
            }
          }
        } else {
          // Remembered: solid until the memory itself starts to go.
          ctx.globalAlpha = Math.min(1, mem * 2.6);
          ctx.drawImage(spr.mem, sx, sy);
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  hazardSpriteAt(world, i) {
    const zone = world.level.zoneInfo[world.level.zoneMap[i]];
    if (!zone) return null;
    return hazardOverlay(zone.hazardId);
  }

  buildRenderList(world, bounds) {
    const list = this.renderList;
    list.length = 0;
    const level = world.level;
    const vis = world.vis;
    const grid = level.grid;

    for (let y = bounds.y0; y <= bounds.y1; y++) {
      for (let x = bounds.x0; x <= bounds.x1; x++) {
        const i = grid.idx(x, y);
        if (!vis.seen[i]) continue;
        const tile = grid.cells[i];
        if (tile !== T.WALL && tile !== T.SECRET && tile !== T.GATE) continue;
        const mem = vis.memory[i];
        const lit = vis.visGen[i] === vis.gen ? vis.light[i] : 0;
        if (lit <= 0 && mem <= MEMORY_MIN) continue;
        list.push({ d: x + y, kind: tile === T.GATE ? 'gate' : 'wall', x, y, i, lit, mem });
      }
    }

    const seenAt = (gx, gy) => {
      const i = grid.idx(gx, gy);
      return { lit: vis.visGen[i] === vis.gen ? vis.light[i] : 0, mem: vis.memory[i], i };
    };

    const layer = world.playerLayer;
    const onLayer = (y) => world.layerAt(Math.floor(y)) === layer;

    // Marks on the floor. First into the list at each tile, so they lie under
    // everything standing on it -- and dropped entirely on the cheapest tier,
    // where they are the first thing worth giving up: they are atmosphere, and
    // a machine that is struggling needs the frame more than the atmosphere.
    if (this.tier.ambience > 0.2) {
      for (const decal of level.decals || []) {
        if (!onLayer(decal.y)) continue;
        const v = seenAt(Math.floor(decal.x), Math.floor(decal.y));
        if (v.lit <= 0.02 && v.mem <= MEMORY_MIN) continue;
        list.push({ d: decal.x + decal.y + 0.001, kind: 'decal', item: decal, lit: v.lit, mem: v.mem });
      }
    }
    for (const d of level.decor) {
      if (!onLayer(d.y)) continue;
      const s = seenAt(Math.floor(d.x), Math.floor(d.y));
      if (s.lit <= 0.02 && s.mem <= MEMORY_MIN) continue;
      list.push({ d: d.x + d.y + 0.005, kind: 'decor', item: d, lit: s.lit, mem: s.mem });
    }
    for (const s of level.sconces) {
      if (!onLayer(s.y)) continue;
      const v = seenAt(Math.floor(s.x), Math.floor(s.y));
      if (v.lit <= 0.02 && v.mem <= MEMORY_MIN) continue;
      // A lit fire lights itself; a cold one is only as visible as the floor
      // it is standing on, which is what makes finding them worth doing.
      const own = s.lit === false ? 0 : 0.6;
      list.push({ d: s.x + s.y + 0.006, kind: 'sconce', item: s, lit: Math.max(v.lit, own), mem: v.mem });
    }
    // Pushable stones sort with the props rather than with the walls, because
    // they move: a wall is baked into the tile behind it, and this is not.
    for (const block of world.blocks) {
      const at = world.blockPosition(block);
      if (!onLayer(at.y)) continue;
      const v = seenAt(Math.floor(at.x), Math.floor(at.y));
      if (v.lit <= 0.02 && v.mem <= MEMORY_MIN) continue;
      list.push({ d: at.x + at.y + 0.008, kind: 'block', item: block, at, lit: v.lit, mem: v.mem });
    }
    for (const prop of level.props) {
      if (prop.consumed || !onLayer(prop.y)) continue;
      if (prop.hidden && !world.revealedProps.has(prop.id)) continue;
      const v = seenAt(Math.floor(prop.x), Math.floor(prop.y));
      if (v.lit <= 0.02 && v.mem <= MEMORY_MIN) continue;
      list.push({ d: prop.x + prop.y + 0.01, kind: 'prop', item: prop, lit: v.lit, mem: v.mem });
    }
    for (const k of level.keys) {
      if (k.taken || k.holder === 'enemy' || !onLayer(k.y)) continue;
      const v = seenAt(k.x, k.y);
      if (v.lit <= 0.02 && v.mem <= MEMORY_MIN) continue;
      list.push({ d: k.x + k.y + 0.02, kind: 'key', item: k, lit: v.lit, mem: v.mem });
    }
    for (const e of world.enemies) {
      if (e.dead || !onLayer(e.y)) continue;
      // Still under the floor. Nothing is drawn, not even a silhouette --
      // the whole of the idea is that there is no tell until there is one.
      if (e.entombed) continue;
      const gx = Math.floor(e.x), gy = Math.floor(e.y);
      const lit = vis.lightAt(gx, gy);
      const revealed = world.revealRadius > 0 && e.speedNow > 0.3 &&
        Math.hypot(e.x - world.player.x, e.y - world.player.y) < world.revealRadius;
      if (lit <= 0.02 && !revealed) continue;
      list.push({ d: e.x + e.y + 0.03, kind: 'enemy', item: e, lit, ghost: lit <= 0.02 });
    }
    if (world.boss && !world.boss.dead) {
      const lit = vis.lightAt(Math.floor(world.boss.x), Math.floor(world.boss.y));
      list.push({ d: world.boss.x + world.boss.y + 0.03, kind: 'boss', item: world.boss, lit: Math.max(lit, 0.35) });
    }
    for (const p of world.projectiles) {
      if (p.dead) continue;
      list.push({ d: p.x + p.y + 0.04, kind: 'shot', item: p, lit: 1 });
    }
    list.push({ d: world.player.x + world.player.y + 0.035, kind: 'player', lit: 1 });

    list.sort((a, b) => a.d - b.d);
  }

  drawRenderList(world, t) {
    const ctx = this.ctx;
    for (const entry of this.renderList) {
      switch (entry.kind) {
        case 'wall': this.drawWall(world, entry, t); break;
        case 'gate': this.drawGateEntry(world, entry, t); break;
        case 'decal':
          // Fainter than anything else on the tile, and fainter again from
          // memory: a scratch you are only remembering is not evidence, it is
          // a suggestion that there was some.
          ctx.globalAlpha = entry.lit > 0.02 ? 0.3 + entry.lit * 0.5 : 0.1 + entry.mem * 0.12;
          drawDecal(ctx, entry.item, t);
          ctx.globalAlpha = 1;
          break;
        case 'decor':
          ctx.globalAlpha = entry.lit > 0.02 ? 0.35 + entry.lit * 0.65 : 0.14 + entry.mem * 0.16;
          drawDecor(ctx, entry.item, t);
          ctx.globalAlpha = 1;
          break;
        case 'sconce':
          ctx.globalAlpha = entry.lit > 0.02 ? Math.min(1, 0.4 + entry.lit * 0.6) : 0.18 + entry.mem * 0.2;
          drawSconce(ctx, entry.item, t);
          ctx.globalAlpha = 1;
          break;
        case 'block':
          ctx.globalAlpha = entry.lit > 0.02 ? 0.4 + entry.lit * 0.6 : 0.2 + entry.mem * 0.2;
          drawPushBlock(ctx, entry.item, entry.at, t);
          ctx.globalAlpha = 1;
          break;
        case 'prop':
          ctx.globalAlpha = entry.lit > 0.02 ? 0.4 + entry.lit * 0.6 : 0.2 + entry.mem * 0.2;
          drawProp(ctx, entry.item, t);
          ctx.globalAlpha = 1;
          break;
        case 'key':
          ctx.globalAlpha = entry.lit > 0.02 ? 1 : 0.35 + entry.mem * 0.3;
          drawKeyItem(ctx, entry.item, t);
          ctx.globalAlpha = 1;
          break;
        case 'enemy':
          if (entry.ghost) this.drawSilhouette(world, entry.item);
          else {
            ctx.globalAlpha = 0.42 + entry.lit * 0.58;
            drawEnemy(ctx, entry.item, t);
            ctx.globalAlpha = 1;
          }
          break;
        case 'boss': drawBoss(ctx, entry.item, t); break;
        case 'shot': this.drawProjectile(entry.item, t); break;
        case 'player': drawPlayer(ctx, world.player, t, { shield: world.player.hasShieldRelic }); break;
      }
    }
  }

  drawWall(world, entry, t) {
    const ctx = this.ctx;
    const level = world.level;
    const set = this.setsFor(world, entry.x, entry.y);
    const tile = level.grid.cells[entry.i];
    const v = level.variants[entry.i] % VARIANTS;
    const spr = tile === T.SECRET ? set.secret[v % set.secret.length] : set.wall[v];
    const sx = screenX(entry.x, entry.y) - HALF_W;
    const sy = screenY(entry.x, entry.y) - HALF_H - WALL_H;
    const faded = this.fadeSet.has(entry.i);

    ctx.globalAlpha = faded ? FADE_ALPHA : 1;
    if (entry.lit > 0.01) {
      ctx.drawImage(spr.lit, sx, sy);
      if (entry.lit < 0.995) {
        ctx.globalAlpha = (1 - entry.lit) * (faded ? FADE_ALPHA : 1);
        ctx.drawImage(spr.dark, sx, sy);
      }
      ctx.globalAlpha = 1;
      if (this.warm && entry.lit > 0.1) this.drawWallLight(world, entry, sx, sy, faded);
    } else {
      ctx.globalAlpha = Math.min(1, entry.mem * 2.6) * (faded ? FADE_ALPHA : 1);
      ctx.drawImage(spr.mem, sx, sy);
    }
    ctx.globalAlpha = 1;

    if (tile === T.SECRET) this.drawSecretGlow(world, entry, t, faded);
  }

  // Directional torch light on the two faces the camera can see. The left
  // face of a block looks along +y and the right face along +x, so how much
  // each catches is simply how squarely it is turned toward the flame.
  drawWallLight(world, entry, sx, sy, faded) {
    const ctx = this.ctx;
    const p = world.player;
    const vx = p.x - (entry.x + 0.5);
    const vy = p.y - (entry.y + 0.5);
    const m = Math.hypot(vx, vy) || 1;
    const strength = entry.lit * entry.lit * world.torch.flicker * (faded ? 0.35 : 1);
    // The dot product is squared before it is used. Raw, it falls off as the
    // cosine, which is nearly flat for the first forty degrees either side of
    // square-on -- so most of a corner came out at almost the same brightness
    // and the corner stopped reading as one. Squaring keeps the face that is
    // turned towards the flame exactly where it was and darkens the one that
    // is turning away, which is the whole of what makes a corner a corner.
    const lx = Math.max(0, vy / m);
    const rx = Math.max(0, vx / m);
    const left = lx * lx * strength * 0.2;
    const right = rx * rx * strength * 0.2;
    const top = strength * 0.06;
    if (left < 0.015 && right < 0.015 && top < 0.015) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (left > 0.015) { ctx.globalAlpha = left; ctx.drawImage(this.warm.left, sx, sy); }
    if (right > 0.015) { ctx.globalAlpha = right; ctx.drawImage(this.warm.right, sx, sy); }
    if (top > 0.015) { ctx.globalAlpha = top; ctx.drawImage(this.warm.top, sx, sy); }
    ctx.restore();
  }

  // Cracked walls announce themselves in amber, and turn green the moment a
  // swing would actually break them (design rule 18).
  drawSecretGlow(world, entry, t, faded) {
    const secret = world.secretAt(entry.x, entry.y);
    if (!secret || !secret.discovered) return;
    const ctx = this.ctx;
    const actionable = world.actionableSecret === secret;
    const colour = actionable ? '#5cf08a' : '#e8b45c';
    const pulse = actionable ? 0.75 + Math.sin(t * 8) * 0.25 : 0.42 + Math.sin(t * 2.4) * 0.16;
    const cx = screenX(entry.x, entry.y);
    const cy = screenY(entry.x, entry.y) - WALL_H * 0.55;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = faded ? 0.55 : 1;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 34);
    g.addColorStop(0, rgba(colour, 0.42 * pulse));
    g.addColorStop(1, rgba(colour, 0));
    ctx.fillStyle = g;
    ctx.fillRect(cx - 34, cy - 34, 68, 68);
    ctx.strokeStyle = rgba(colour, 0.8 * pulse);
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    const rnd = (n) => Math.sin(n * 12.9898 + entry.i) * 43758.5453 % 1;
    for (let b = 0; b < 3; b++) {
      ctx.beginPath();
      let px = cx + rnd(b) * 16 - 8;
      let py = cy + rnd(b + 7) * 14 - 7;
      ctx.moveTo(px, py);
      for (let i = 0; i < 3; i++) {
        px += rnd(b * 10 + i) * 12 - 6;
        py += rnd(b * 10 + i + 3) * 10 - 3;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  drawGateEntry(world, entry, t) {
    const gate = world.gateAt(entry.x, entry.y);
    if (!gate) return;
    const ctx = this.ctx;
    const faded = this.fadeSet.has(entry.i);
    ctx.globalAlpha = faded ? 0.55 : (entry.lit > 0.02 ? Math.min(1, 0.65 + entry.lit * 0.4) : 0.35 + entry.mem * 0.3);
    drawGate(ctx, gate, t);
    ctx.globalAlpha = 1;
  }

  // Dust reveals movement beyond the torch: shape only, never detail.
  drawSilhouette(world, e) {
    const ctx = this.ctx;
    const sx = screenX(e.x, e.y);
    const sy = screenY(e.x, e.y);
    const s = e.scale || 1;
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#0e1219';
    ctx.beginPath();
    ctx.ellipse(sx, sy - 20 * s, 10 * s, 22 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rgba('#8fa0b8', 0.28);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  drawProjectile(p, t) {
    const ctx = this.ctx;
    const sx = screenX(p.x, p.y);
    const sy = screenY(p.x, p.y) - 18;
    const ang = Math.atan2((p.vx + p.vy) * HALF_H, (p.vx - p.vy) * HALF_W);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(ang);
    if (p.kind === 'arrow') {
      ctx.strokeStyle = '#c9b48b';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(-11, 0); ctx.lineTo(7, 0);
      ctx.stroke();
      ctx.fillStyle = '#dfe6ee';
      ctx.beginPath();
      ctx.moveTo(7, 0); ctx.lineTo(12, 0); ctx.lineTo(7, 2.4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = rgba('#e8b45c', 0.5);
      ctx.fillRect(-12, -1.4, 4, 2.8);
    } else {
      const colour = p.colour || '#cfc6b2';
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 12);
      g.addColorStop(0, rgba(colour, 0.5));
      g.addColorStop(1, rgba(colour, 0));
      ctx.fillStyle = g;
      ctx.fillRect(-12, -12, 24, 24);
      ctx.restore();
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.ellipse(0, 0, 4.5, 2.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawGroundEffects(world, bounds, t) {
    const ctx = this.ctx;
    // Optional challenge rooms are marked on the floor so entering one is
    // always a decision rather than an accident.
    for (const enc of world.level.encounters) {
      if (!enc.optional || enc.state === 'cleared' || !enc.room) continue;
      const room = enc.room;
      const cx = (room.x0 + room.x1) / 2 + 0.5;
      const cy = (room.y0 + room.y1) / 2 + 0.5;
      if (world.vis.memoryAt(Math.floor(cx), Math.floor(cy)) <= 0.05) continue;
      const sx = screenX(cx, cy), sy = screenY(cx, cy);
      const r = Math.max(room.x1 - room.x0, room.y1 - room.y0) * 0.5 + 0.5;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(enc.type === 'survival' ? '#8fb7ff' : '#e8b45c',
        0.22 + Math.sin(t * 1.8) * 0.08);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(sx, sy, r * TILE_W * 0.5, r * TILE_H * 0.5, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Interaction highlight on whatever the Action button would act on.
    const target = world.interactTarget;
    if (target && target.hx !== undefined) {
      const sx = screenX(target.hx, target.hy);
      const sy = screenY(target.hx, target.hy);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba('#e8b45c', 0.5 + Math.sin(t * 6) * 0.22);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy - HALF_H);
      ctx.lineTo(sx + HALF_W, sy);
      ctx.lineTo(sx, sy + HALF_H);
      ctx.lineTo(sx - HALF_W, sy);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
  }

  playerScreenPos(world) {
    const p = world.player;
    return {
      x: (screenX(p.x, p.y) - this.camera.x) * this.zoom + this.width / 2 + this.shakeX,
      y: (screenY(p.x, p.y) - this.camera.y) * this.zoom + this.height / 2 + this.shakeY,
    };
  }

  drawTorchGlow(world) {
    const ctx = this.ctx;
    const pos = this.playerScreenPos(world);
    const radius = world.torchRadius * TILE_W * 0.62 * this.zoom;
    const f = world.torch.flicker;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(pos.x, pos.y - 22 * this.zoom, 0, pos.x, pos.y - 22 * this.zoom, radius);
    g.addColorStop(0, rgba('#ffbe6a', 0.22 * f));
    g.addColorStop(0.45, rgba('#ff8a3a', 0.10 * f));
    g.addColorStop(1, rgba('#ff7a2a', 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.restore();
  }

  drawVignette(world) {
    const ctx = this.ctx;
    const pos = this.playerScreenPos(world);
    const r = Math.max(this.width, this.height);
    const g = ctx.createRadialGradient(pos.x, pos.y, r * 0.22, pos.x, pos.y, r * 0.78);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.width, this.height);
    if (world.player.damageFlash > 0) {
      ctx.fillStyle = rgba('#c2452f', Math.min(0.26, world.player.damageFlash * 0.32));
      ctx.fillRect(0, 0, this.width, this.height);
    }
    if (world.lowHealthPulse > 0) {
      const a = 0.1 + Math.sin(world.time * 4) * 0.05;
      const vg = ctx.createRadialGradient(pos.x, pos.y, r * 0.15, pos.x, pos.y, r * 0.6);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, rgba('#8e1f1f', a * world.lowHealthPulse));
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, this.width, this.height);
    }
  }

  // --- weather --------------------------------------------------------------
  // Screen-space, but parallaxed against the camera so it feels attached to
  // the world rather than smeared over the top of it.
  drawWeather(world, dt) {
    const hazard = world.currentHazard;
    if (!hazard || hazard.id === 'clear') return;
    const ctx = this.ctx;
    this.weatherT += dt;
    const t = this.weatherT;
    const w = this.width, h = this.height;
    const px = this.camera.x * 0.35, py = this.camera.y * 0.35;

    ctx.save();
    switch (hazard.id) {
      case 'rain': {
        ctx.strokeStyle = 'rgba(170,200,225,0.32)';
        ctx.lineWidth = 1;
        const count = Math.round(140 * this.quality);
        for (let i = 0; i < count; i++) {
          const seed = i * 97.13;
          const x = ((seed * 7.3 + t * 130 - px * 0.4) % (w + 80)) - 40;
          const y = ((seed * 13.7 + t * 900 - py * 0.4) % (h + 120)) - 60;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - 5, y + 18);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(90,120,150,0.06)';
        ctx.fillRect(0, 0, w, h);
        break;
      }
      case 'fog': {
        for (let i = 0; i < 7; i++) {
          const seed = i * 131.7;
          const x = ((seed * 5.1 + t * 14 - px * 0.6) % (w + 500)) - 250;
          const y = ((seed * 9.3 - py * 0.6) % (h + 300)) - 150;
          const r = 180 + (i % 3) * 90;
          const g = ctx.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, 'rgba(150,168,186,0.10)');
          g.addColorStop(1, 'rgba(150,168,186,0)');
          ctx.fillStyle = g;
          ctx.fillRect(x - r, y - r, r * 2, r * 2);
        }
        ctx.fillStyle = 'rgba(126,142,162,0.09)';
        ctx.fillRect(0, 0, w, h);
        break;
      }
      case 'dust': {
        ctx.globalCompositeOperation = 'lighter';
        const count = Math.round(70 * this.quality);
        for (let i = 0; i < count; i++) {
          const seed = i * 61.7;
          const x = ((seed * 11.3 + t * 16 - px * 0.7) % (w + 60)) - 30;
          const y = ((seed * 7.9 + Math.sin(t * 0.7 + i) * 20 - py * 0.7) % (h + 60)) - 30;
          ctx.fillStyle = 'rgba(210,190,150,0.16)';
          ctx.fillRect(x, y, 2, 2);
        }
        break;
      }
      case 'embers': {
        ctx.globalCompositeOperation = 'lighter';
        const count = Math.round(60 * this.quality);
        for (let i = 0; i < count; i++) {
          const seed = i * 83.1;
          const x = ((seed * 9.7 + Math.sin(t * 0.9 + i) * 26 - px * 0.8) % (w + 40)) - 20;
          const y = h - (((seed * 5.3 + t * 60) % (h + 120)) - 60);
          const a = 0.25 + Math.abs(Math.sin(t * 3 + i)) * 0.4;
          ctx.fillStyle = `rgba(255,140,60,${a})`;
          ctx.fillRect(x, y, 2.2, 2.2);
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(120,40,10,0.06)';
        ctx.fillRect(0, 0, w, h);
        break;
      }
      case 'ice': {
        const count = Math.round(70 * this.quality);
        for (let i = 0; i < count; i++) {
          const seed = i * 47.3;
          const x = ((seed * 13.1 + Math.sin(t * 0.5 + i) * 30 - px * 0.5) % (w + 40)) - 20;
          const y = ((seed * 8.7 + t * 40 - py * 0.5) % (h + 40)) - 20;
          ctx.fillStyle = 'rgba(220,240,255,0.28)';
          ctx.fillRect(x, y, 2, 2);
        }
        ctx.fillStyle = 'rgba(120,170,210,0.05)';
        ctx.fillRect(0, 0, w, h);
        break;
      }
      case 'mud':
        ctx.fillStyle = 'rgba(70,52,32,0.08)';
        ctx.fillRect(0, 0, w, h);
        break;
      case 'vines':
        ctx.fillStyle = 'rgba(50,72,38,0.09)';
        ctx.fillRect(0, 0, w, h);
        break;
      default: break;
    }
    ctx.restore();
  }
}
