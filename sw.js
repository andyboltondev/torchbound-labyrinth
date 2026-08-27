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

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    let keep = cacheName;
    try {
      keep = 'torchbound-' + (await readManifest()).build;
    } catch (e) { /* offline on activate: keep whatever install settled on */ }
    cacheName = keep;
    const names = await caches.keys();
    await Promise.all(names.map((n) => {
      if (n === keep || n.indexOf('torchbound-') !== 0) return null;
      return caches.delete(n);
    }));
    await self.clients.claim();
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
