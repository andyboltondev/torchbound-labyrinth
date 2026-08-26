// Fixed-timestep simulation with an interpolating render pass.
// Gameplay determinism matters (seeded runs, hazard timings), so simulation
// always advances in constant slices regardless of display refresh rate.

const STEP = 1 / 60;
const MAX_FRAME = 0.25; // never simulate more than a quarter second at once

export class GameLoop {
  constructor(update, render) {
    this.update = update;
    this.render = render;
    this.accumulator = 0;
    this.last = 0;
    this.running = false;
    this.timeScale = 1;
    this.frozenUntil = 0;   // hit-stop: brief pause on impact for weight
    this.elapsed = 0;
    this._frame = this._frame.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this._frame);
  }

  stop() { this.running = false; }

  // Impact freeze -- makes sword hits feel like they connect.
  hitStop(seconds) {
    this.frozenUntil = Math.max(this.frozenUntil, this.elapsed + seconds);
  }

  _frame(now) {
    if (!this.running) return;
    requestAnimationFrame(this._frame);

    let delta = (now - this.last) / 1000;
    this.last = now;
    if (delta > MAX_FRAME) delta = MAX_FRAME;
    this.elapsed += delta;

    if (this.elapsed < this.frozenUntil) {
      // Still render during hit-stop so effects (flash, particles) show.
      this.render(0, delta);
      return;
    }

    this.accumulator += delta * this.timeScale;
    let steps = 0;
    while (this.accumulator >= STEP && steps < 5) {
      this.update(STEP);
      this.accumulator -= STEP;
      steps++;
    }
    if (steps >= 5) this.accumulator = 0; // give up catching up, avoid spiral

    this.render(this.accumulator / STEP, delta);
  }
}

export { STEP };
