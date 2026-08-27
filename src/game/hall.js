// The Hall of Fame.
//
// Fifty names, kept locally, in a flat comma-separated table. CSV rather than
// JSON on purpose: it is the format a person can open, read, sort and paste
// somewhere else without any tooling, which is the whole point of a hall of
// fame that lives on your own machine.
//
// Two things make writing it safe. Every write re-reads the stored table
// first and merges into it, so a second tab that carved a name while this one
// was playing does not have that name thrown away. And an advisory lock keeps
// two writers from interleaving in the first place -- taken with a timestamp
// so a tab that dies mid-write cannot wedge the hall shut forever.

import { load, save } from '../core/storage.js';
import { VERSION } from '../core/version.js';

export const HALL_SIZE = 50;
const KEY = 'hallOfFameCsv';
const LOCK_KEY = 'hallOfFameLock';
const LOCK_MS = 2000;      // a lock older than this is assumed abandoned
const WAIT_MS = 40;
const MAX_WAIT = 1500;

// The column order of the stored table. Adding a column to the end is a
// compatible change: older rows simply read as empty for it, which is why
// parsing prefers the header when the file carries one.
const COLUMNS = ['name', 'score', 'depth', 'bosses', 'kills', 'secrets',
  'diff', 'build', 'date', 'seed', 'version'];

const NUMERIC = new Set(['score', 'depth', 'bosses', 'kills', 'secrets']);

function escapeCell(value) {
  const s = value === undefined || value === null ? '' : String(value);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCsv(rows) {
  const out = [COLUMNS.join(',')];
  for (const row of rows) out.push(COLUMNS.map((c) => escapeCell(row[c])).join(','));
  return out.join('\n');
}

// A small, complete CSV reader: quoted cells, doubled quotes inside them, and
// either line ending. Small enough to keep honest, and this file is the only
// thing that ever produces the format it has to read.
export function parseCsv(text) {
  if (!text) return [];
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(cell); cell = ''; continue; }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = []; cell = '';
      continue;
    }
    cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return [];

  // Honour the header when there is one, so a file written by a later version
  // with extra columns still reads correctly here.
  const header = rows[0].map((h) => h.trim());
  const known = header.filter((h) => COLUMNS.includes(h)).length;
  const useHeader = known >= 3;
  const names = useHeader ? header : COLUMNS;
  const body = useHeader ? rows.slice(1) : rows;

  const out = [];
  for (const r of body) {
    if (!r.length || (r.length === 1 && !r[0].trim())) continue;
    const entry = {};
    names.forEach((name, i) => {
      if (!COLUMNS.includes(name)) return;
      const raw = (r[i] || '').trim();
      entry[name] = NUMERIC.has(name) ? Math.max(0, Math.round(Number(raw) || 0)) : raw;
    });
    if (!entry.name || !entry.score) continue;
    out.push(normalise(entry));
  }
  return out;
}

// Everything that reaches the board goes through here, whether it came from a
// finished run or from a file somebody handed over.
export function normalise(entry) {
  return {
    name: String(entry.name || 'Nameless').slice(0, 18),
    score: Math.max(0, Math.round(Number(entry.score) || 0)),
    depth: Math.max(1, Math.round(Number(entry.depth) || 1)),
    bosses: Math.max(0, Math.round(Number(entry.bosses) || 0)),
    kills: Math.max(0, Math.round(Number(entry.kills) || 0)),
    secrets: Math.max(0, Math.round(Number(entry.secrets) || 0)),
    diff: String(entry.diff || 'torchbound').slice(0, 24),
    build: String(entry.build || 'Torchbearer').slice(0, 24),
    date: String(entry.date || '').slice(0, 24),
    seed: String(entry.seed || '').slice(0, 32),
    version: String(entry.version || '').slice(0, 40),
  };
}

// Two entries are the same run if everything that identifies one matches.
// Used when merging a file in, so importing the same export twice does not
// double every name in the hall.
function fingerprint(e) {
  return [e.name, e.score, e.depth, e.diff, e.date, e.seed].join('\u0001');
}

export function rank(rows) {
  return rows
    .slice()
    .sort((a, b) => b.score - a.score || b.depth - a.depth)
    .slice(0, HALL_SIZE);
}

export function merge(existing, incoming) {
  const seen = new Set(existing.map(fingerprint));
  const out = existing.slice();
  for (const raw of incoming) {
    const entry = normalise(raw);
    const fp = fingerprint(entry);
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push(entry);
  }
  return rank(out);
}

// --- the stored table -------------------------------------------------------

export function readHall() {
  const csv = load(KEY, null);
  if (typeof csv === 'string') return rank(parseCsv(csv));
  return null;
}

function writeHall(rows) { save(KEY, toCsv(rows)); }

// The lock is advisory and best-effort: storage is not transactional, so this
// narrows the window rather than closing it. Combined with the read-and-merge
// below, the worst case is a name arriving twice, never one being lost.
function takeLock() {
  const now = Date.now();
  const held = load(LOCK_KEY, 0);
  if (held && now - held < LOCK_MS) return false;
  save(LOCK_KEY, now);
  return true;
}

function releaseLock() { save(LOCK_KEY, 0); }

async function withLock(fn) {
  const waited = Date.now();
  while (!takeLock()) {
    if (Date.now() - waited > MAX_WAIT) break;   // assume the holder is gone
    await new Promise((r) => setTimeout(r, WAIT_MS));
  }
  try {
    return fn();
  } finally {
    releaseLock();
  }
}

// Waits for the table to be free, merges, writes, and reports where the new
// name landed. Async because waiting is the whole point; callers that do not
// care where it landed can ignore the promise.
export function submitEntry(entry, seedRows) {
  return withLock(() => {
    const current = readHall() || (seedRows ? rank(seedRows.map(normalise)) : []);
    const row = normalise({
      ...entry,
      date: entry.date || new Date().toISOString().slice(0, 10),
      version: entry.version || VERSION.number + '-' + VERSION.build,
    });
    const merged = merge(current, [row]);
    writeHall(merged);
    const fp = fingerprint(row);
    const at = merged.findIndex((e) => fingerprint(e) === fp);
    return { rows: merged, rank: at >= 0 ? at + 1 : null, entry: row };
  });
}

export function importCsv(text) {
  const incoming = parseCsv(text);
  if (!incoming.length) return Promise.resolve({ added: 0, read: 0, rows: readHall() || [] });
  return withLock(() => {
    const current = readHall() || [];
    const merged = merge(current, incoming);
    writeHall(merged);
    return { added: merged.length - current.length, read: incoming.length, rows: merged };
  });
}

export function exportCsv(rows) { return toCsv(rank(rows)); }

// Replaces the whole table. Only used when seeding a fresh install, and when
// the player asks for the hall to be cleared.
export function writeAll(rows) {
  const ranked = rank(rows.map(normalise));
  writeHall(ranked);
  return ranked;
}
