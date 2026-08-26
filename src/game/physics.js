// Movement and collision against the tile grid.
// Circle-vs-cell, resolved one axis at a time so sliding along walls feels
// smooth instead of catching on corners.

import { T } from '../gen/tiles.js';

export function tileBlocks(world, gx, gy) {
  const t = world.level.grid.get(gx, gy);
  if (t === T.WALL || t === T.SECRET || t === T.RUBBLE) return true;
  if (t === T.GATE) {
    const gate = world.gateAt(gx, gy);
    return !gate || !gate.open;
  }
  return false;
}

function overlapsSolid(world, x, y, r) {
  const minX = Math.floor(x - r), maxX = Math.floor(x + r);
  const minY = Math.floor(y - r), maxY = Math.floor(y + r);
  for (let gy = minY; gy <= maxY; gy++) {
    for (let gx = minX; gx <= maxX; gx++) {
      if (!tileBlocks(world, gx, gy)) continue;
      // Closest point on the cell to the circle centre.
      const cx = Math.max(gx, Math.min(x, gx + 1));
      const cy = Math.max(gy, Math.min(y, gy + 1));
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy < r * r) return true;
    }
  }
  return false;
}

// Returns which axes were blocked, so callers can kill velocity on impact.
export function moveEntity(world, ent, dx, dy) {
  const r = ent.radius;
  let hitX = false, hitY = false;
  if (dx !== 0) {
    const nx = ent.x + dx;
    if (!overlapsSolid(world, nx, ent.y, r)) ent.x = nx;
    else {
      hitX = true;
      // Nudge toward the free side to round off corners.
      const step = Math.sign(dx) * 0.02;
      for (let i = 0; i < 6; i++) {
        if (overlapsSolid(world, ent.x + step, ent.y, r)) break;
        ent.x += step;
      }
    }
  }
  if (dy !== 0) {
    const ny = ent.y + dy;
    if (!overlapsSolid(world, ent.x, ny, r)) ent.y = ny;
    else {
      hitY = true;
      const step = Math.sign(dy) * 0.02;
      for (let i = 0; i < 6; i++) {
        if (overlapsSolid(world, ent.x, ent.y + step, r)) break;
        ent.y += step;
      }
    }
  }
  return { hitX, hitY };
}

// Bresenham-style line of sight over the grid, used for enemy awareness and
// ranged attacks.
export function hasLineOfSight(world, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 3);
  if (steps === 0) return true;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const gx = Math.floor(x0 + dx * t);
    const gy = Math.floor(y0 + dy * t);
    const tile = world.level.grid.get(gx, gy);
    if (tile === T.WALL || tile === T.SECRET || tile === T.RUBBLE) return false;
    if (tile === T.GATE) {
      const gate = world.gateAt(gx, gy);
      if (!gate || !gate.open) return false;
    }
  }
  return true;
}

// Is `target` inside a cone in front of `from`? Used for sword arcs and for
// deciding whether a cracked wall is currently breakable.
export function inCone(fromX, fromY, faceX, faceY, targetX, targetY, range, halfAngleCos) {
  const dx = targetX - fromX, dy = targetY - fromY;
  const d = Math.hypot(dx, dy);
  if (d > range) return false;
  if (d < 0.0001) return true;
  const dot = (dx / d) * faceX + (dy / d) * faceY;
  return dot >= halfAngleCos;
}
