// Colour helpers shared by every drawing routine.

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = h.length === 3
    ? h.split('').map((c) => parseInt(c + c, 16))
    : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  return { r: v[0], g: v[1], b: v[2] };
}

export function rgbToHex(r, g, b) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

// amount > 0 lightens toward white, < 0 darkens toward black.
export function shade(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const t = amount > 0 ? 255 : 0;
  const p = Math.abs(amount);
  return rgbToHex(r + (t - r) * p, g + (t - g) * p, b + (t - b) * p);
}

export function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(A.r + (B.r - A.r) * t, A.g + (B.g - A.g) * t, A.b + (B.b - A.b) * t);
}

export function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Deterministic tiny PRNG so a given sprite variant always bakes identically.
export function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const UI = {
  gold: '#e8b45c',
  goldDim: '#a67f3c',
  parchment: '#e6dcc6',
  stone: '#8fa0b8',
  blood: '#c2452f',
  ember: '#ff7a3a',
  frost: '#a8d8ef',
  ink: '#0b0d12',
  panel: '#141922',
  panelEdge: '#2b3444',
  good: '#6fce87',
};
