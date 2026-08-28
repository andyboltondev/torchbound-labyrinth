// Service worker: the game, kept on the device.
//
// Torchbound Labyrinth has no build step and no server of its own -- it is a
// folder of ES modules on a static host -- which makes it exactly the kind of
// thing that should keep working on a train. This caches every file the game
// is made of on the first visit and serves them from there afterwards.
//
// Three rules, and they are the whole design:
//
//   * The list of files is generated, not written here. tools/stamp_version.py
//     walks the tree and writes build.json at stamp time, so a module added to
//     src/ is cached without anybody remembering to add it. A hand-maintained
//     precache list in a project with no bundler is a list that goes stale and
//     takes the offline build down with it, silently, one file at a time.
//
//   * The cache is named after the build. A new build is a new cache, so there
//     is never a half-updated mixture of old and new modules being imported by
//     each other -- which is the failure that turns a caching bug into a blank
//     screen. Old caches are deleted on activate.
//
//   * build.json itself is never served from cache. It is the one thing that
//     has to be able to say something new, because it is how the page finds
//     out there is something new.
//
//   * The page can ask for the newest build outright, with a `refresh` message,
//     and is told when it is down. The browser's own `registration.update()`
//     cannot do that job here -- it compares this file byte for byte and this
//     file does not change between builds -- and being told is what lets the
//     page reload onto the new build rather than back onto the old one.
//
// This worker is registered from index.html only, via src/core/appupdate.js.
// tests.html loads none of that, so the test page is never intercepted for
// anything but files that happen to already be cached.

const MANIFEST = 'build.json';

// Everything the game needs before build.json has been read -- so a first
// visit that goes offline mid-install still has the page itself.
const BOOTSTRAP = ['./', './index.html'];

let cacheName = 'torchbound-boot';

async function readManifest() {
  const res = await fetch(MANIFEST, { cache: 'no-store' });
  if (!res.ok) throw new Error('no manifest');
  return res.json();
}

async function precache() {
  const manifest = await readManifest();
  const name = 'torchbound-' + manifest.build;
  const cache = await caches.open(name);
  // One at a time rather than cache.addAll, which rejects the whole set if any
  // single request fails. A missing file should cost the game that file, not
  // its entire offline mode.
  const wanted = BOOTSTRAP.concat(manifest.assets || []);
  await Promise.all(wanted.map(async (url) => {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) await cache.put(url, res);
    } catch (e) { /* keep going: the rest of the game is still worth having */ }
  }));
  return name;
}

self.addEventListener('install', (event) => {
  // Take over as soon as the files are down. The alternative is waiting for
  // every tab to close, which for a game people leave open is never.
  event.waitUntil(precache().then((name) => {
    cacheName = name;
    return self.skipWaiting();
  }).catch(() => self.skipWaiting()));
});

// Everything but the build named. Ordering matters more than it looks:
// `caches.match` searches every cache there is, oldest first, so while an old
// cache survives it is the one that answers -- and a page reloaded at that
// moment comes back on the build it was trying to leave.
async function dropOtherCaches(keep) {
  const names = await caches.keys();
  await Promise.all(names.map((n) => {
    if (n === keep || n.indexOf('torchbound-') !== 0) return null;
    return caches.delete(n);
  }));
}

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    let keep = cacheName;
    try {
      keep = 'torchbound-' + (await readManifest()).build;
    } catch (e) { /* offline on activate: keep whatever install settled on */ }
    cacheName = keep;
    await dropOtherCaches(keep);
    await self.clients.claim();
  })());
});

// The page asking, in as many words, for the current build to be fetched now.
//
// `registration.update()` is the browser's own route to this and it is not
// enough on its own: it compares sw.js byte for byte, and this file does not
// change from one build to the next -- the file list lives in build.json, on
// purpose. So the browser's honest answer is "the worker is unchanged", while
// the game it is serving is a build behind. This is the same question asked of
// the manifest instead, which is the file that does change.
//
// It answers when the new build is down and the old cache is gone, and that
// answer is what makes a forced reload safe: reloading before it would land
// the page straight back on the build it was leaving.
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'refresh') return;
  const reply = (payload) => {
    const port = event.ports && event.ports[0];
    if (port) port.postMessage(payload);
  };
  event.waitUntil((async () => {
    try {
      const name = await precache();
      cacheName = name;
      await dropOtherCaches(name);
      reply({ ok: true, build: name.slice('torchbound-'.length) });
    } catch (e) {
      // Offline, or the manifest could not be read. The cache is untouched and
      // still whole, which is the point of doing the deleting last.
      reply({ ok: false });
    }
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // The freshness probe. Always the network, and never remembered -- a cached
  // answer here would mean the game could never learn it was out of date.
  if (url.pathname.endsWith('/' + MANIFEST)) {
    event.respondWith(fetch(request, { cache: 'no-store' }).catch(
      () => new Response('{}', { headers: { 'Content-Type': 'application/json' } })));
    return;
  }

  // Cache-first, but only for things actually in the cache. Anything else --
  // the test page, a shot being posted back, a file added since the last
  // install -- goes to the network exactly as it would with no worker at all.
  event.respondWith((async () => {
    const hit = await caches.match(request, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(request);
    } catch (e) {
      // Offline and not cached. A navigation still deserves the game rather
      // than the browser's dinosaur, so fall back to the shell.
      if (request.mode === 'navigate') {
        const shell = await caches.match('./index.html', { ignoreSearch: true });
        if (shell) return shell;
      }
      throw e;
    }
  })());
});
