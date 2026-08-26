// Screen-space post-processing.
//
// Canvas 2D has no shaders, so bloom is built out of the two things it does
// have that are hardware-accelerated: scaling a canvas, and blend modes. The
// frame is scaled down (which is the blur), multiplied by itself twice (which
// is the threshold -- squaring twice crushes the mid-tones and leaves the
// flame, the runes and the sparks), and added back over the top.

const HAS_FILTER = (() => {
  try {
    const c = document.createElement('canvas').getContext('2d');
    c.filter = 'blur(2px)';
    return c.filter === 'blur(2px)';
  } catch (e) { return false; }
})();

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

export class PostFX {
  constructor() {
    this.a = null;
    this.b = null;
    this.div = 0;
    this.w = 0;
    this.h = 0;
  }

  _ensure(w, h, div) {
    if (this.a && this.w === w && this.h === h && this.div === div) return;
    this.w = w; this.h = h; this.div = div;
    const sw = Math.max(1, Math.round(w / div));
    const sh = Math.max(1, Math.round(h / div));
    this.a = makeCanvas(sw, sh);
    this.b = makeCanvas(sw, sh);
    this.actx = this.a.getContext('2d');
    this.bctx = this.b.getContext('2d');
  }

  // `strength` is the amount added back; 0 skips the whole pass.
  bloom(ctx, canvas, width, height, div, strength) {
    if (strength <= 0.001) return;
    this._ensure(canvas.width, canvas.height, div);
    const { a, b, actx, bctx } = this;

    actx.globalCompositeOperation = 'copy';
    actx.globalAlpha = 1;
    actx.drawImage(canvas, 0, 0, a.width, a.height);

    // Threshold. Raising the frame to the fourth power leaves the flame, the
    // sparks and the rune glow, and throws away the lit stonework -- which is
    // bright enough to bloom the whole screen into fog if it is let through.
    bctx.globalCompositeOperation = 'copy';
    bctx.filter = 'none';
    bctx.drawImage(a, 0, 0);
    bctx.globalCompositeOperation = 'multiply';
    bctx.drawImage(a, 0, 0);
    bctx.drawImage(a, 0, 0);
    bctx.drawImage(a, 0, 0);
    bctx.globalCompositeOperation = 'source-over';

    // Soften. The downscale is already most of the blur; a small real blur on
    // a canvas this size costs very little and removes the blockiness.
    if (HAS_FILTER) {
      actx.globalCompositeOperation = 'copy';
      actx.filter = 'blur(2px)';
      actx.drawImage(b, 0, 0);
      actx.filter = 'none';
    } else {
      actx.globalCompositeOperation = 'copy';
      actx.drawImage(b, 0, 0);
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = strength;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(a, 0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  // A single multiply pass in the biome's own colour. Subtle on purpose: it
  // should tie the palette together, not tint the game a flat orange.
  grade(ctx, width, height, tint, amount) {
    if (!tint || amount <= 0.001) return;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = amount;
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }
}
