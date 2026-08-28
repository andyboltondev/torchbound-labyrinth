// Offline play, and finding out there is a newer game than this one.
//
// Two jobs, deliberately in one small file because they are the same question
// asked twice: what build is this, and is it still the current one?
//
//   * Register the service worker (sw.js), which caches the whole game on the
//     first visit so it plays with no network afterwards.
//   * Ask build.json what the current build is and compare it against the one
//     running. If they differ -- and only then, and only online -- fetch the
//     new one and reload onto it.
//
// The reload is the part worth being careful about, and there are two rules
// holding it in place.
//
// The first is that it never lands mid-descent. A run lives in memory and
// nowhere else, so a reload during one is a run destroyed by a version number;
// the caller says whether this moment is a safe one and is asked again after
// the download, because a player can start a descent while a megabyte of game
// is coming down behind the menu.
//
// The second is that the reload has to actually reach the new build, or it is
// a loop rather than an update. So the files are downloaded and the stale
// cache dropped *before* the page goes anywhere -- a reload onto a cache that
// still holds the old build comes straight back to where it started -- and a
// build that cannot be reached in UPDATE_TRIES goes back to being fetched
// quietly, to land on some later load, rather than reloading forever.
//
// The one hard rule left from before still holds: none of this may hold the
// menu up. A player with a bad connection is not waiting on us to finish
// talking to a server about a version they did not ask about, so the check
// races a short timer and loses, and the caller never waits on the result.

import { VERSION } from './version.js';
import { load, save, remove } from './storage.js';

// Long enough for a slow but working connection to answer, short enough that
// nobody reads it as the game failing to start.
const CHECK_MS = 2000;
// The whole game is around a megabyte of text, but it is being fetched one
// file at a time over whatever connection the player has. This is the point at
// which we stop waiting and let the download finish on its own, unreloaded.
const DOWNLOAD_MS = 25000;
const SEEN_KEY = 'lastSeenBuild';
const TRY_KEY = 'updateTries';

// How many times a forced reload will be attempted for one build before the
// game stops trying and settles for the copy it has.
//
// This guard is the difference between a feature and a trap. A reload aimed at
// a build the device cannot actually end up running -- a manifest that ships
// ahead of the files it lists, a proxy pinning one file, a cache the browser
// will not give up -- comes back on the old build, finds the same disagreement
// and reloads again, forever, on a game that never draws a menu. Two goes, and
// then the quiet background path has it back.
export const UPDATE_TRIES = 2;

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

// --- is this still the current build? ---------------------------------------

// What build the host is serving, or null if it would not say. Null covers
// every unclear answer there is -- offline, a slow one, a malformed file, a
// host returning its 404 page as JSON -- because the only answer worth acting
// on is a build string that is plainly not this one.
export function latestBuild() {
  const asked = fetch('build.json', { cache: 'no-store' })
    .then((res) => (res.ok ? res.json() : null))
    .then((manifest) => (manifest && typeof manifest.build === 'string' && manifest.build
      ? manifest.build : null))
    .catch(() => null);
  const gaveUp = new Promise((resolve) => setTimeout(() => resolve(null), CHECK_MS));
  return Promise.race([asked, gaveUp]);
}

// The whole decision, with nothing in it that touches the network, the clock,
// storage or the page -- so the rules can be read in one place and tested
// without a browser. One of:
//
//   offline  -- the device says it has no connection, so there is no question
//               to ask. An update needs the network by definition.
//   unknown  -- asked, and got no usable answer. Not the same as up to date,
//               and deliberately not acted on either way.
//   current  -- the build running is the build being served. The common case.
//   stuck    -- there is a newer build and we have already reloaded for it as
//               often as we are willing to. See UPDATE_TRIES.
//   stale    -- there is a newer build and it is worth going and getting.
export function updatePlan(state) {
  const running = state && state.running;
  const latest = state && state.latest;
  const tried = (state && state.tried) || null;
  if (state && state.online === false) return 'offline';
  if (!latest) return 'unknown';
  if (latest === running) return 'current';
  if (tried && tried.build === latest && tried.tries >= UPDATE_TRIES) return 'stuck';
  return 'stale';
}

// The reload counter, kept per target build so that a build we gave up on
// never holds a later one back. Written before the page goes, because after it
// goes there is nobody left to write anything.
export function nextTry(record, build) {
  const same = record && record.build === build && Number.isFinite(record.tries);
  return { build, tries: same ? record.tries + 1 : 1 };
}

export function updateTries() {
  const record = load(TRY_KEY, null);
  if (!record || typeof record.build !== 'string' || !Number.isFinite(record.tries)) return null;
  return record;
}

// Called on every load: if the build now running is the one the counter was
// aiming at, the reload worked and the counter has done its job. Clearing it
// is what lets the *next* update start from a clean two attempts.
export function clearArrivedTries() {
  const record = updateTries();
  if (record && record.build === VERSION.build) remove(TRY_KEY);
}

// --- going and getting it ---------------------------------------------------

// Asks the worker to fetch the current build now and resolves when it has --
// or when we stop waiting, which is not a failure so much as a decision to
// stop holding a reload open. False means the caller must not assume the new
// files are on the device.
export function downloadUpdate() {
  if (!supported()) return Promise.resolve(false);
  // `getRegistration()` rather than `ready`, which never resolves at all when
  // nothing is registered -- and a page with no worker is exactly the case
  // that has to answer quickly, because it still has a reload to do.
  const asked = navigator.serviceWorker.getRegistration().then((registration) => {
    // The browser's own check as well, so a worker that genuinely did change
    // is installed the ordinary way. It is not enough on its own -- sw.js is
    // the same file from build to build -- which is what the message is for.
    if (registration) registration.update().catch(() => {});
    const worker = (registration && registration.active) || navigator.serviceWorker.controller;
    if (!worker) return false;
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = (event) => resolve(!!(event.data && event.data.ok));
      worker.postMessage({ type: 'refresh' }, [channel.port2]);
    });
  }).catch(() => false);
  const gaveUp = new Promise((resolve) => setTimeout(() => resolve(false), DOWNLOAD_MS));
  return Promise.race([asked, gaveUp]);
}

// Reload, out of cache, onto whatever the host is serving now.
//
// Where the worker is running it has already done the hard part: the new build
// is in a cache of its own and every older one has been deleted, so an
// ordinary reload can only be answered with the new files. Where it is not --
// plain http, a browser without workers, a dev host with the worker off --
// there is nothing of ours between the page and the network, and a reload
// revalidates the document and its modules against the host, which is the same
// outcome by a different road. Either way anything we cached ourselves and are
// no longer sure of is dropped first.
export function reloadForUpdate(target) {
  if (target) save(TRY_KEY, nextTry(updateTries(), target));
  const controlled = supported() && !!navigator.serviceWorker.controller;
  const cleaned = (controlled || typeof caches === 'undefined')
    ? Promise.resolve()
    : caches.keys()
      .then((names) => Promise.all(names
        .filter((n) => n.indexOf('torchbound-') === 0)
        .map((n) => caches.delete(n))))
      .catch(() => {});
  return cleaned.then(() => { location.reload(); });
}

// Check, and act on the answer. Resolves to the plan that was carried out,
// which is the plan above plus the two outcomes only reloading can produce:
//
//   ready     -- the new build is on the device but the moment was not a safe
//                one to reload in, so it lands on the next load instead.
//   reloading -- the page is on its way out. Nothing after this runs.
//
// `canReload` is asked twice on purpose: once before the download and once
// after, because a player who pressed Descend while it was coming down has
// changed the answer. `onState` is told each state as it is reached, with the
// build being fetched where there is one, so a screen can narrate it.
export function runUpdateCheck(options = {}) {
  const canReload = typeof options.canReload === 'function' ? options.canReload : () => false;
  const say = typeof options.onState === 'function' ? options.onState : () => {};
  const online = typeof navigator.onLine === 'boolean' ? navigator.onLine : true;
  say('checking');
  if (!online) { say('offline'); return Promise.resolve('offline'); }
  return latestBuild().then((latest) => {
    // A player who pressed the button has asked for this build to be fetched
    // whatever happened last time, so the give-up counter is not consulted.
    const tried = options.force ? null : updateTries();
    const plan = updatePlan({ running: VERSION.build, latest, online, tried });
    if (plan !== 'stale') { say(plan, latest); return plan; }
    say('downloading', latest);
    return downloadUpdate().then(() => {
      // Asked again, because the answer can have changed while a build was
      // coming down: a menu is a safe place to reload, a descent is not.
      if (!canReload()) { say('ready', latest); return 'ready'; }
      say('reloading', latest);
      reloadForUpdate(latest);
      return 'reloading';
    });
  }).catch(() => { say('unknown'); return 'unknown'; });
}

// The boot path: register the worker, then check. Returns the plan that was
// carried out, but nothing is expected to wait on it -- the menu is drawn on
// the next line whatever the network is doing.
export function startUpdateCheck(options = {}) {
  clearArrivedTries();
  if (!canRegister()) {
    // Nothing should be left running on a dev host that has stopped asking
    // for it, or the next reload silently serves yesterday's build.
    if (supported() && isDevHost()) unregisterWorker();
    // The version check still stands on its own without a worker: comparing
    // build strings needs no cache, and neither does reloading out of one.
    return runUpdateCheck(options);
  }
  return registerWorker()
    .then(() => runUpdateCheck(options))
    .catch(() => 'unknown');
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

// --- keeping it -------------------------------------------------------------
//
// Whether the game can be installed is the browser's decision, not ours: it
// wants a manifest, an icon big enough to draw a tile with, and a worker that
// can serve the thing offline. When Chrome has satisfied itself of all three
// it offers `beforeinstallprompt`, and holding on to that event is the only
// way to ask later, at a moment the player chose.
//
// The event is caught at module load rather than from a screen, because it
// fires once, early, and usually before any menu has been drawn. Taking it
// means Chrome's own banner is not shown -- which is the trade: one offer, in
// the game's own voice, in a place it can sit quietly until it is wanted.
// Desktop keeps the install control in its address bar either way.

let offer = null;
const watchers = new Set();

// A watcher that returns false has gone off screen with the panel it was drawn
// on, and is dropped. Screens are rebuilt every time they are shown, so
// without this the set would grow for the whole session.
function tellWatchers(available) {
  for (const watcher of watchers) {
    if (watcher(available) === false) watchers.delete(watcher);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    offer = event;
    tellWatchers(true);
  });
  window.addEventListener('appinstalled', () => {
    offer = null;
    tellWatchers(false);
  });
}

export function canInstall() { return !!offer; }

export function onInstallOffer(watcher) {
  watchers.add(watcher);
  return () => watchers.delete(watcher);
}

// Already installed, or opened from the home screen: there is nothing to offer.
export function runningInstalled() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || window.navigator.standalone === true;
}

// One shot: the event cannot be prompted with twice, so whatever the player
// answers, the offer is spent and the control goes away.
export function promptInstall() {
  const event = offer;
  if (!event) return Promise.resolve(false);
  offer = null;
  event.prompt();
  return Promise.resolve(event.userChoice)
    .then((choice) => !!choice && choice.outcome === 'accepted')
    .catch(() => false)
    .then((accepted) => { tellWatchers(false); return accepted; });
}
