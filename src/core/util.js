// Small math / helper utilities shared across systems.

export const TAU = Math.PI * 2;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const inverseLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (t) => t * t * (3 - 2 * t);

// Frame-rate independent exponential approach. `rate` is roughly
// "fraction of the remaining gap closed per second".
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));

export const dist2 = (ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  return dx * dx + dy * dy;
};
export const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));

// Shortest signed difference between two angles.
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

// Eight compass directions, index 0 = east, going counter-clockwise in
// screen space is awkward for iso so we keep plain grid-space vectors.
export const DIRS8 = [
  { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: -1, y: 1 },
  { x: -1, y: 0 }, { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
];
export const DIRS4 = [
  { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 },
];

export function facingIndex(dx, dy) {
  const a = Math.atan2(dy, dx);
  let i = Math.round(a / (TAU / 8));
  if (i < 0) i += 8;
  return i % 8;
}

export const formatScore = (n) => Math.round(n).toLocaleString('en-US');

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}

// Roman-ish depth label used in UI flourishes.
export function depthLabel(depth) {
  const numerals = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let n = depth, out = '';
  for (const [v, s] of numerals) while (n >= v) { out += s; n -= v; }
  return out || 'I';
}
