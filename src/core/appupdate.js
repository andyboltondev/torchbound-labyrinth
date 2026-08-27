// Offline play, and finding out there is a newer game than this one.
//
// Two jobs, deliberately in one small file because they are the same question
// asked twice: what build is this, and is it still the current one?
//
//   * Register the service worker (sw.js), which caches the whole game on the
//     first visit so it plays with no network afterwards.
//   * Before the menu, ask build.json whether a newer build has shipped. If it
//     has, tell the worker to fetch it -- quietly, with no prompt and no
//     progress bar. The swap lands on the next load, which is the only moment
//     it can land safely: replacing modules under a page that has already
//     imported them is how a caching bug becomes a blank screen.
//
// The one hard rule is that none of this may hold the menu up. A player with a
// bad connection is not waiting on us to finish talking to a server about a
// version they did not ask about, so the check races a short timer and loses.

import { VERSION } from './version.js';
import { load, save } from './storage.js';

// Long enough for a slow but working connection to answer, short enough that
// nobody reads it as the game failing to start.
const CHECK_MS = 2000;
const SEEN_KEY = 'lastSeenBuild';

// A service worker needs a secure context, which localhost counts as.
// Anywhere else on plain http -- a LAN address, a file share -- it simply does
// not run, and the game works exactly as it did before any of this existed.
function supported() {
  return 'serviceWorker' in navigator && window.isSecureContext;
}

// Development is the one place a cache is a liability rather than a feature.
// tools/serve.py sends `no-store` on everything precisely so an edit shows up
// on reload -- and a worker serving the previous copy out of its own cache
// would quietly undo that, which is a bad afternoon waiting to happen.
//
// So: off on localhost by default, and on with `?sw=1` when the caching itself
// is what is being worked on. The deployed game is unaffected either way.
function isDevHost() {
  const host = location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

function canRegister() {
  if (!supported()) return false;
  if (!isDevHost()) return true;
  return new URLSearchParams(location.search).has('sw');
}

export function registerWorker() {
  if (!canRegister()) return Promise.resolve(null);
  return navigator.serviceWorker.register('sw.js', { scope: './' })
    .catch(() => null);
}

// Tears down anything a previous visit left registered. Without this, turning
// the worker on once with `?sw=1` would leave it serving the whole dev tree
// from cache forever afterwards, and the cause would be invisible.
export function unregisterWorker() {
  if (!supported()) return Promise.resolve(false);
  return navigator.serviceWorker.getRegistrations()
    .then((all) => Promise.all(all.map((r) => r.unregister())))
    .then(() => caches.keys())
    .then((names) => Promise.all(
      names.filter((n) => n.indexOf('torchbound-') === 0).map((n) => caches.delete(n))))
    .then(() => true)
    .catch(() => false);
}

// Whether a newer build than the one running has shipped. Resolves to false on
// anything that is not a clear yes: offline, a slow answer, a malformed file,
// a host that returns its 404 page as JSON. Being wrong in that direction
// costs nothing -- the check runs again on the next load.
export function checkForUpdate() {
  if (!navigator.onLine) return Promise.resolve(false);
  const asked = fetch('build.json', { cache: 'no-store' })
    .then((res) => (res.ok ? res.json() : null))
    .then((manifest) => !!(manifest && manifest.build && manifest.build !== VERSION.build))
    .catch(() => false);
  const gaveUp = new Promise((resolve) => setTimeout(() => resolve(false), CHECK_MS));
  return Promise.race([asked, gaveUp]);
}

// Registers, checks, and starts the update if there is one -- then resolves,
// whatever happened, so the caller can get on with showing the game. The
// download continues in the background after this resolves; it is the worker's
// business, not the menu's.
export function startUpdateCheck() {
  if (!canRegister()) {
    // Nothing should be left running on a dev host that has stopped asking
    // for it, or the next reload silently serves yesterday's build.
    if (supported() && isDevHost()) unregisterWorker();
    return Promise.resolve(false);
  }
  const done = registerWorker().then((registration) => {
    if (!registration) return false;
    return checkForUpdate().then((stale) => {
      // `update()` re-fetches sw.js and, through it, build.json and every file
      // the new build lists. Nothing is shown for it and nothing waits on it.
      if (stale) registration.update().catch(() => {});
      return stale;
    });
  }).catch(() => false);
  const gaveUp = new Promise((resolve) => setTimeout(() => resolve(false), CHECK_MS));
  return Promise.race([done, gaveUp]);
}

// --- what to tell the player ------------------------------------------------
//
// Nothing, while updating. Once, afterwards.
//
// The build that is running is compared against the last one this device was
// told about. They differ exactly once per update, on the first load of the
// new code -- which is also the first moment there is anything true to say,
// because until the swap has actually landed "you have been updated" would be
// a promise rather than a fact.

// True on the first load after an update, and on no other load. First-ever
// visits are not updates: there is nothing to have changed from.
export function updatedSinceLastVisit() {
  const seen = load(SEEN_KEY, null);
  return typeof seen === 'string' && seen !== VERSION.build;
}

export function markBuildSeen() { save(SEEN_KEY, VERSION.build); }

// A first-ever visit has nothing to have updated from, so the build is
// recorded silently and nothing is shown. Without this the marker would never
// be written at all and the notice could never fire: every visit would go on
// looking like the first one.
export function noteFirstVisit() {
  if (load(SEEN_KEY, null) === null) markBuildSeen();
}
