// Isometric projection.
//
// The camera is a slightly top-down 2:1 isometric view. Tiles are 64x32 with
// a modest 34px wall rise -- tall enough to read as architecture, short enough
// that walls rarely swallow the action (design rule 6).

export const TILE_W = 64;
export const TILE_H = 32;
export const HALF_W = TILE_W / 2;
export const HALF_H = TILE_H / 2;
export const WALL_H = 38;

// Grid space -> screen space (before camera translation).
export function toScreen(gx, gy) {
  return { x: (gx - gy) * HALF_W, y: (gx + gy) * HALF_H };
}
export function screenX(gx, gy) { return (gx - gy) * HALF_W; }
export function screenY(gx, gy) { return (gx + gy) * HALF_H; }

// Screen space -> grid space.
export function toGrid(sx, sy) {
  return {
    x: (sx / HALF_W + sy / HALF_H) / 2,
    y: (sy / HALF_H - sx / HALF_W) / 2,
  };
}

// Painter's-algorithm depth. Larger draws later, i.e. nearer the viewer.
export function depthOf(gx, gy) { return gx + gy; }

// Turns a raw input vector into the grid direction to walk, under one of two
// frames of reference:
//
//   'dungeon' -- the keys point along the dungeon's own axes. Up is north,
//                Right is east. Corridors run along these axes, so one key
//                walks a passage end to end. The isometric view draws north
//                as up-and-to-the-right.
//   'view'    -- the keys point at the screen. Up is straight up the display,
//                which in an isometric view is a diagonal across the grid.
export function inputDirToGrid(sx, sy, frame = 'dungeon') {
  if (frame === 'view') return screenDirToGrid(sx, sy);
  const m = Math.hypot(sx, sy);
  if (m < 1e-6) return { x: 0, y: 0 };
  // Dungeon frame: the input vector *is* the grid vector.
  return { x: sx, y: sy };
}

// Converts a screen-relative input direction (up on the stick means up on the
// display) into the grid-space direction the player should actually walk.
export function screenDirToGrid(sx, sy) {
  const gx = sy + sx;
  const gy = sy - sx;
  const m = Math.hypot(gx, gy);
  if (m < 1e-6) return { x: 0, y: 0 };
  const scale = Math.min(1, Math.hypot(sx, sy)) / m;
  return { x: gx * scale, y: gy * scale };
}

// The reverse, used to point HUD arrows and aim reticles.
export function gridDirToScreen(gx, gy) {
  return { x: (gx - gy) * HALF_W, y: (gx + gy) * HALF_H };
}

// Screen-space bounding box of one tile column (floor diamond plus wall rise).
export function tileBounds(gx, gy, height = 0) {
  const x = screenX(gx, gy);
  const y = screenY(gx, gy);
  return { x0: x - HALF_W, y0: y - HALF_H - height, x1: x + HALF_W, y1: y + HALF_H };
}
