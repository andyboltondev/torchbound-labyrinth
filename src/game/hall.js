// The Hall of Fame.
//
// Fifty names, kept locally, in a flat comma-separated table. CSV remains the
// internal shape because it is compact, append-extensible a column at a time,
// and this file already contains a complete reader for it -- but it is no
// longer a format anybody is handed. The table used to be exportable and
// importable as a file; it is not, and it is now written through a scramble
// (see below) so that the board is a record of what was played rather than a
// text field waiting to be typed a better score into.
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
  'diff', 'build', 'date', 'seed', 'version', 'mercy'];

const NUMERIC = new Set(['score', 'depth', 'bosses', 'kills', 'secrets']);

// Counts that are allowed to come out below zero. Mercy is the running total
// of who you let live against who you did not, so it has a wrong side.
const SIGNED = new Set(['mercy']);

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
      entry[name] = NUMERIC.has(name) ? Math.max(0, Math.round(Number(raw) || 0))
        : SIGNED.has(name) ? Math.round(Number(raw) || 0)
          : raw;
    });
    if (!entry.name || !entry.score) continue;
    out.push(normalise(entry));
  }
  return out;
}

// Everything that reaches the board goes through here, whether it came from a
// finished run or from a stored table read back off this machine.
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
    // Signed on purpose: freeing captives counts up, killing the ones
    // who never asked counts down, and a run can end on either side.
    mercy: Math.round(Number(entry.mercy) || 0),
  };
}

// Two entries are the same run if everything that identifies one matches.
// Used when merging, so a table re-read while another tab was writing to it
// cannot end up holding the same run twice.
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

// --- keeping the table off the surface --------------------------------------
//
// The hall is stored through a reversible scramble rather than as readable
// text. This is not encryption and cannot be: the key is four lines below this
// comment and ships to every player who loads the page. It is a speed bump.
// What it buys is that the board is no longer a text field in the developer
// tools waiting to be typed a better score into by anybody who opens it out of
// idle curiosity, and that a table which has been edited is *noticed* rather
// than believed -- a checksum travels with it, and anything that does not add
// up is discarded instead of trusted.
//
// The salt is ordinary Math.random rather than the game's seeded generator on
// purpose. Nothing here is gameplay: a run must be reproducible, a write to
// local storage must not be.

const STORE_MARK = 'tb1:';
const STORE_KEY = 'torchbound-hall-of-fame';

// FNV-1a, 32-bit. Small, fast, and more than enough to notice a hand edit.
function checksum(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h = Math.imul(h ^ bytes[i], 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// A keystream from the constant key and this write's salt. xorshift32, which
// is not a cipher either -- it only has to avoid repeating itself over the few
// kilobytes a fifty-row table comes to.
function keystream(salt, length) {
  let s = salt >>> 0;
  for (let i = 0; i < STORE_KEY.length; i++) {
    s = Math.imul(s ^ STORE_KEY.charCodeAt(i), 0x01000193) >>> 0;
  }
  if (!s) s = 0x9e3779b9;         // xorshift is stuck at zero forever
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    out[i] = s & 0xff;
  }
  return out;
}

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fromBase64(text) {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function writeU32(bytes, at, value) {
  bytes[at] = (value >>> 24) & 0xff;
  bytes[at + 1] = (value >>> 16) & 0xff;
  bytes[at + 2] = (value >>> 8) & 0xff;
  bytes[at + 3] = value & 0xff;
}

function readU32(bytes, at) {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16)
    | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

// salt (4 bytes) | table xor keystream | checksum of the table (4 bytes)
export function scramble(text) {
  const plain = new TextEncoder().encode(text);
  const salt = Math.floor(Math.random() * 0x100000000) >>> 0;
  const key = keystream(salt, plain.length);
  const out = new Uint8Array(plain.length + 8);
  writeU32(out, 0, salt);
  for (let i = 0; i < plain.length; i++) out[4 + i] = plain[i] ^ key[i];
  writeU32(out, plain.length + 4, checksum(plain));
  return STORE_MARK + toBase64(out);
}

// Returns the table, or null for anything that is not intact -- a truncated
// value, a hand-edited one, a half-finished write. Null is the same answer as
// "nothing stored yet", which the caller already knows how to survive.
export function unscramble(value) {
  if (typeof value !== 'string' || value.slice(0, STORE_MARK.length) !== STORE_MARK) return null;
  try {
    const raw = fromBase64(value.slice(STORE_MARK.length));
    if (raw.length < 8) return null;
    const body = raw.length - 8;
    const key = keystream(readU32(raw, 0), body);
    const plain = new Uint8Array(body);
    for (let i = 0; i < body; i++) plain[i] = raw[4 + i] ^ key[i];
    if (checksum(plain) !== readU32(raw, body + 4)) return null;
    return new TextDecoder().decode(plain);
  } catch (e) {
    return null;
  }
}

// --- the stored table -------------------------------------------------------

export function readHall() {
  const stored = load(KEY, null);
  if (typeof stored !== 'string') return null;
  const csv = unscramble(stored);
  if (csv !== null) return rank(parseCsv(csv));
  // Marked as ours and did not survive the checksum: somebody has been at it.
  // Refuse it rather than reading whatever they left behind.
  if (stored.slice(0, STORE_MARK.length) === STORE_MARK) return null;
  // Not marked at all, so it is a table written before any of this existed.
  // Read it as it stands; the next write puts it away in the new form.
  return rank(parseCsv(stored));
}

function writeHall(rows) { save(KEY, scramble(toCsv(rows))); }

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

// Replaces the whole table. Only used when seeding a fresh install, and when
// the player asks for the hall to be cleared.
export function writeAll(rows) {
  const ranked = rank(rows.map(normalise));
  writeHall(ranked);
  return ranked;
}
