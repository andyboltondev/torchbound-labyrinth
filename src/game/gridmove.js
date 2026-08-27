// Tile-to-tile movement.
//
// Everything that walks the labyrinth moves between tile centres rather than
// floating freely, which removes the whole class of problems where a body
// grinds along a wall or gets wedged on a corner. Movement still *looks*
// continuous: a step interpolates linearly at constant speed, and the next
// step begins the instant the current one lands, so holding a direction reads
// as running rather than hopping.
//
// The important trick is direction selection. Input is a free vector, but the
// mover only ever takes one of the eight grid directions -- and it picks the
// open one closest to what was asked for. In a room that means you go exactly
// where you pointed; in a corridor it means you follow the corridor. Pressing
// into a wall does nothing at all.

import { T } from '../gen/tiles.js';

export const GRID_DIRS = [
  { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: -1, y: 1 },
  { x: -1, y: 0 }, { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
];

// Below this alignment a direction is not "roughly what was asked for", so we
// would rather stand still than send the player somewhere they did not point.
const MIN_ALIGNMENT = 0.34;
const ICE_SLIDE_TILES = 2;
const SQRT2 = Math.SQRT2;

export function tileOpen(world, x, y) {
  if (!world.grid.inBounds(x, y)) return false;
  const t = world.grid.get(x, y);
  if (t === T.WALL || t === T.SECRET || t === T.RUBBLE) return false;
  if (t === T.GATE) {
    const gate = world.gateAt(x, y);
    if (!gate || !gate.open) return false;
  }
  // A pushable stone is as solid as the wall it was cut from, to everything
  // that walks -- the player included. Walking into one is not a step, it is
  // a shove, and that is handled a level up in the chooser.
  if (world.blockAt && world.blockAt(x, y)) return false;
  return !world.sealBlocks.has(world.grid.idx(x, y));
}

// Diagonals may not cut corners: both orthogonal neighbours must be open too.
export function canStepTo(world, fromX, fromY, dir) {
  const tx = fromX + dir.x, ty = fromY + dir.y;
  if (!tileOpen(world, tx, ty)) return false;
  if (dir.x !== 0 && dir.y !== 0) {
    if (!tileOpen(world, fromX + dir.x, fromY)) return false;
    if (!tileOpen(world, fromX, fromY + dir.y)) return false;
  }
  return true;
}

// Picks the open grid direction that best matches `want`, preferring to carry
// on in a straight line when two options are equally good.
//
// `strict` disables the corridor assist: the requested direction is taken or
// nothing is. That makes a single arrow key mean exactly one screen direction
// and never a 45-degree deflection, at the cost of needing two keys to walk a
// corridor (corridors run diagonally on screen in an isometric view).
export function chooseGridDirection(world, tileX, tileY, want, heading, isBlocked, strict = false) {
  const m = Math.hypot(want.x, want.y);
  if (m < 0.001) return null;
  const wx = want.x / m, wy = want.y / m;
  const threshold = strict ? 0.95 : MIN_ALIGNMENT;
  let best = null;
  let bestScore = -Infinity;
  for (const dir of GRID_DIRS) {
    const len = dir.x !== 0 && dir.y !== 0 ? SQRT2 : 1;
    const dot = (dir.x / len) * wx + (dir.y / len) * wy;
    if (dot < threshold) continue;
    if (!canStepTo(world, tileX, tileY, dir)) continue;
    if (isBlocked && isBlocked(tileX + dir.x, tileY + dir.y)) continue;
    let score = dot;
    if (heading && dir.x === heading.x && dir.y === heading.y) score += 0.05;
    if (score > bestScore) { bestScore = score; best = dir; }
  }
  return best;
}

// Doorway assist.
//
// The labyrinth is full of one-tile openings, and tile movement means you are
// either lined up with one or you are not. Walking a wall and pressing through
// a door you are standing one tile short of used to do nothing at all, which
// reads as the controls ignoring you rather than as a wall being in the way.
//
// So when the pressed direction is masonry, look for the door: if the tile one
// step to either side has open ground *through* the wall behind it, take the
// sidestep. The next frame the way ahead is clear and the player walks through
// under their own steam, having pressed one direction the whole time.
//
// The tolerance is deliberately exactly one tile. Two would let the assist
// walk you round pillars and along walls hunting for gaps you never saw, which
// is a different feature and a worse one.
export function doorwayStep(world, tileX, tileY, want, heading, isBlocked) {
  const m = Math.hypot(want.x, want.y);
  if (m < 0.001) return null;
  const wx = want.x / m, wy = want.y / m;

  // Only cardinals: a blocked diagonal already has two orthogonal fallbacks,
  // and the ordinary chooser will have taken one of them.
  let best = null, bestScore = -Infinity;
  for (const dir of GRID_DIRS) {
    if (dir.x !== 0 && dir.y !== 0) continue;
    const dot = dir.x * wx + dir.y * wy;
    if (dot < 0.5) continue;

    // The way ahead has to be genuinely solid. A tile held by another creature
    // is not a door to be found -- shoving past bodies is a separate feature.
    const ax = tileX + dir.x, ay = tileY + dir.y;
    if (tileOpen(world, ax, ay)) continue;

    for (const side of [{ x: -dir.y, y: dir.x }, { x: dir.y, y: -dir.x }]) {
      const sx = tileX + side.x, sy = tileY + side.y;
      if (!tileOpen(world, sx, sy)) continue;
      if (isBlocked && isBlocked(sx, sy)) continue;
      // ...and the opening has to lead somewhere, not just be floor beside us.
      if (!tileOpen(world, sx + dir.x, sy + dir.y)) continue;
      // The wall must genuinely continue the other way. Without this test a
      // lone pillar reads as a doorway with an opening on both sides, and
      // pressing into it would shunt the player round it -- which is routing
      // around obstacles, not lining up with a door, and is not wanted.
      if (tileOpen(world, tileX - side.x + dir.x, tileY - side.y + dir.y)) continue;

      // Prefer the side the stick is already leaning towards, then the side we
      // are already travelling, so the choice is stable frame to frame.
      let score = dot + (side.x * wx + side.y * wy) * 0.5;
      if (heading && side.x === heading.x && side.y === heading.y) score += 0.25;
      if (score > bestScore) { bestScore = score; best = side; }
    }
  }
  return best;
}

export class GridMover {
  constructor(entity) {
    this.ent = entity;
    this.tileX = 0; this.tileY = 0;
    this.fromX = 0; this.fromY = 0;
    this.toX = 0; this.toY = 0;
    this.progress = 0;
    this.duration = 0;
    this.moving = false;
    this.heading = null;
    this.slideSteps = 0;
    this.speedNow = 0;
    this.carry = 0;         // leftover time owed to the next step
    this.arrived = false;   // true on the frame a tile is reached
    this.assisted = false;  // true when the last step was a doorway sidestep
  }

  placeAt(tileX, tileY) {
    this.tileX = this.fromX = this.toX = tileX;
    this.tileY = this.fromY = this.toY = tileY;
    this.progress = 0;
    this.moving = false;
    this.heading = null;
    this.slideSteps = 0;
    this.carry = 0;
    this.ent.x = tileX + 0.5;
    this.ent.y = tileY + 0.5;
  }

  get atRest() { return !this.moving; }

  cancel() {
    // Snap back to the tile we came from -- used when a step is invalidated
    // mid-stride (a gate slamming, a room sealing).
    this.moving = false;
    this.progress = 0;
    this.toX = this.tileX = this.fromX;
    this.toY = this.tileY = this.fromY;
    this.ent.x = this.fromX + 0.5;
    this.ent.y = this.fromY + 0.5;
  }

  // `desired` is a free vector in grid space, or null to stand still.
  // `opts`: { speed (tiles/sec), ice, isBlocked(x, y), onEnterTile(x, y) }
  //
  // At most one step is *started* per call. When a step lands with time to
  // spare, the remainder is carried into the next frame rather than spent on
  // a second step immediately: that second step would have to be chosen from
  // input decided for the tile we just left, which makes anything steering by
  // its current tile (the AI, an autopilot) oscillate. Carrying the time
  // forward keeps the speed exact while every decision uses fresh input.
  update(dt, world, desired, opts = {}) {
    const startX = this.ent.x, startY = this.ent.y;
    this.arrived = false;
    this.assisted = false;
    let remaining = dt + this.carry;
    this.carry = 0;

    if (this.moving) {
      const need = (1 - this.progress) * this.duration;
      if (remaining < need) {
        this.progress += remaining / this.duration;
        remaining = 0;
      } else {
        remaining -= need;
        this._land(world, opts);
      }
    }

    if (this.arrived) {
      // Landed this frame. Owe the remainder to the next one so the next step
      // is chosen from input decided at the tile we are actually standing on.
      this.carry = Math.min(remaining, 0.25);
    } else if (!this.moving && remaining > 0) {
      const dir = this._choose(world, desired, opts);
      if (dir && this._begin(world, dir, opts)) {
        if (remaining >= this.duration) {
          // Running behind (a long frame): consume the step and keep what is
          // left, bounded so a stall cannot snowball.
          remaining -= this.duration;
          this._land(world, opts);
          this.carry = Math.min(remaining, 0.25);
        } else {
          this.progress = remaining / this.duration;
        }
      }
    }

    this._applyPosition();
    this.speedNow = Math.hypot(this.ent.x - startX, this.ent.y - startY) / Math.max(dt, 1e-5);
    return this.arrived;
  }

  _choose(world, desired, opts) {
    const hasDesire = !!desired && (desired.x !== 0 || desired.y !== 0);
    const canHold = () => this.heading
      && canStepTo(world, this.tileX, this.tileY, this.heading)
      && !(opts.isBlocked && opts.isBlocked(this.tileX + this.heading.x, this.tileY + this.heading.y));
    const sliding = opts.ice && this.heading && this.slideSteps > 0;

    // Ice: what you cannot do is *stop*. Letting go carries you on a couple
    // more tiles, and a hard about-face has to wait for the slide to run out.
    // Ordinary steering still works, because controls that ignore you do not
    // read as slippery, they read as broken.
    if (sliding && !hasDesire) {
      if (canHold()) { this.slideSteps--; return this.heading; }
      this.slideSteps = 0;
      this.heading = null;
      return null;
    }
    if (!hasDesire) return null;

    if (sliding) {
      const hm = Math.hypot(this.heading.x, this.heading.y) || 1;
      const dm = Math.hypot(desired.x, desired.y) || 1;
      const dot = (this.heading.x / hm) * (desired.x / dm) + (this.heading.y / hm) * (desired.y / dm);
      if (dot < -0.3 && canHold()) { this.slideSteps--; return this.heading; }
    }

    let dir = chooseGridDirection(world, this.tileX, this.tileY, desired,
      this.heading, opts.isBlocked, opts.strict);
    // Nothing anywhere near the pressed direction is open. Before giving up,
    // check whether a doorway is sitting one tile off the line.
    if (!dir && opts.doorAssist) {
      dir = doorwayStep(world, this.tileX, this.tileY, desired, this.heading, opts.isBlocked);
      if (dir) this.assisted = true;
    }
    // Still nothing. The stone in the way may be one that moves -- and if it
    // does, shoving it is the same press as walking, so it happens here rather
    // than on a verb of its own. Tried last, after every ordinary way through
    // has been ruled out, so a block never steals a step that had somewhere
    // else to go.
    if (!dir && opts.tryPush) {
      dir = opts.tryPush(this.tileX, this.tileY, desired, this.heading) || null;
    }
    if (dir && opts.ice) this.slideSteps = ICE_SLIDE_TILES;
    return dir;
  }

  _begin(world, dir, opts) {
    const tx = this.tileX + dir.x, ty = this.tileY + dir.y;
    const diagonal = dir.x !== 0 && dir.y !== 0;
    const speed = Math.max(0.2, opts.speed || 3.5);
    this.fromX = this.tileX; this.fromY = this.tileY;
    this.toX = tx; this.toY = ty;
    this.duration = (diagonal ? SQRT2 : 1) / speed;
    this.progress = 0;
    this.moving = true;
    this.heading = dir;
    if (opts.onLeaveTile) opts.onLeaveTile(this.fromX, this.fromY);
    if (opts.onClaimTile) opts.onClaimTile(tx, ty);
    return true;
  }

  _land(world, opts) {
    this.tileX = this.toX;
    this.tileY = this.toY;
    this.fromX = this.toX;
    this.fromY = this.toY;
    this.progress = 0;
    this.moving = false;
    this.arrived = true;
    if (opts.onEnterTile) opts.onEnterTile(this.tileX, this.tileY);
  }

  _applyPosition() {
    if (!this.moving) {
      this.ent.x = this.tileX + 0.5;
      this.ent.y = this.tileY + 0.5;
      return;
    }
    // Linear: easing each step would visibly stutter when steps are chained.
    const t = this.progress;
    this.ent.x = (this.fromX + 0.5) + (this.toX - this.fromX) * t;
    this.ent.y = (this.fromY + 0.5) + (this.toY - this.fromY) * t;
  }
}
