// Development harness, loaded on demand from the console:
//   await import('/tools/devharness.js')
// Gives manual control of the simulation (the render loop is driven by
// requestAnimationFrame, which stalls in a hidden tab) and pushes rendered
// frames to the dev server for inspection. Not part of the game.

window.__errs = [];
window.addEventListener('error', (e) =>
  window.__errs.push(String(e.message) + ' @ ' + String(e.filename || '').split('/').pop() + ':' + e.lineno));
window.addEventListener('unhandledrejection', (e) =>
  window.__errs.push('promise: ' + String((e.reason && e.reason.stack) || e.reason)));

// Advance the fixed-timestep simulation by hand.
window.__step = (frames = 60, intent = null) => {
  const g = window.__game;
  for (let i = 0; i < frames; i++) {
    if (intent && g.world) g.world.update(1 / 60, intent);
    else g.update(1 / 60);
    g.render(0, 1 / 60);
  }
};

window.__intent = (moveX = 0, moveY = 0, slash = false, fire = false) => ({ moveX, moveY, slash, fire });

window.__shot = async (name, scale = 0.55, quality = 0.62) => {
  const src = document.getElementById('game');
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * scale);
  c.height = Math.round(src.height * scale);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
  const res = await fetch('/_shot', { method: 'POST', body: blob, headers: { 'X-Shot-Name': name + '.jpg' } });
  return res.text();
};

// Teleport for reaching a feature quickly during testing.
window.__goto = (x, y) => {
  const g = window.__game;
  g.world.player.placeAt(x, y);
  g.world.flow = null;
  g.renderer.cameraReady = false;
};

window.__summary = () => {
  const g = window.__game;
  const w = g.world;
  if (!w) return { state: g.state };
  return {
    state: g.state, depth: w.level.depth, biome: w.level.biome.id,
    zones: w.level.zones.length, gates: w.level.gates.length,
    keys: w.level.keys.map((k) => ({ c: k.colourIndex, x: k.x, y: k.y, taken: k.taken, holder: k.holder })),
    enemies: w.enemies.length, alive: w.enemies.filter((e) => !e.dead).length,
    hp: Math.round(w.run.hp), score: Math.round(w.run.score.total),
    hazard: w.currentHazard.id, secrets: w.level.secrets.length,
    errs: window.__errs.slice(0, 8),
  };
};

console.log('devharness ready');
export default true;
