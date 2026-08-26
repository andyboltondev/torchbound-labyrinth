// localStorage wrapper that degrades gracefully when storage is unavailable
// (private browsing, embedded webviews) so the game still runs.

const PREFIX = 'torchbound.';
let memoryFallback = new Map();
let available = null;

function probe() {
  if (available !== null) return available;
  try {
    const k = PREFIX + '__probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    available = true;
  } catch (e) {
    available = false;
  }
  return available;
}

export function load(key, fallback = null) {
  try {
    const raw = probe()
      ? localStorage.getItem(PREFIX + key)
      : memoryFallback.get(key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

export function save(key, value) {
  const raw = JSON.stringify(value);
  try {
    if (probe()) localStorage.setItem(PREFIX + key, raw);
    else memoryFallback.set(key, raw);
  } catch (e) {
    memoryFallback.set(key, raw);
  }
}

export function remove(key) {
  try {
    if (probe()) localStorage.removeItem(PREFIX + key);
    else memoryFallback.delete(key);
  } catch (e) { /* ignore */ }
}
