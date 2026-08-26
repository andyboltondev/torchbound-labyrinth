// Procedurally generated impulse responses.
//
// One convolver plus the right impulse buys more atmosphere than any number
// of hand-tuned delay lines, and an impulse is just an array of numbers, so
// there is still nothing to download. Each profile is built from three parts:
// discrete early reflections (the shape of the room), an optional flutter
// train (the ringing you only get between two parallel walls), and a diffuse
// tail that darkens as it decays.

export const PROFILES = {
  closet: {
    seconds: 0.42, decay: 5.2, predelay: 0.004, damping: 0.55, diffuse: 0.75,
    early: 5, earlySpread: 0.018, earlyGain: 0.5, buildup: 0.004, flutter: 0,
  },
  corridor: {
    // Parallel stone walls a metre apart. A passage barely diffuses at all:
    // almost everything you hear back is the same sound bouncing between two
    // flat faces, which is why the tail is mostly a repeating slap.
    seconds: 1.0, decay: 4.4, predelay: 0.006, damping: 0.4, diffuse: 0.3,
    early: 4, earlySpread: 0.012, earlyGain: 0.62, buildup: 0.006,
    flutter: 0.019, flutterGain: 1, flutterDecay: 4.4,
  },
  gallery: {
    // A long hall you can see the end of: slower slapback, more air.
    seconds: 1.7, decay: 2.6, predelay: 0.011, damping: 0.34, diffuse: 0.55,
    early: 6, earlySpread: 0.028, earlyGain: 0.5, buildup: 0.016,
    flutter: 0.037, flutterGain: 0.75, flutterDecay: 2.1,
  },
  chamber: {
    seconds: 1.1, decay: 3.6, predelay: 0.009, damping: 0.42, diffuse: 1,
    early: 8, earlySpread: 0.026, earlyGain: 0.42, buildup: 0.014, flutter: 0,
  },
  hall: {
    seconds: 2.1, decay: 2.3, predelay: 0.016, damping: 0.3, diffuse: 1,
    early: 11, earlySpread: 0.046, earlyGain: 0.34, buildup: 0.03, flutter: 0,
  },
  cavern: {
    seconds: 3.4, decay: 1.5, predelay: 0.024, damping: 0.5, diffuse: 1,
    early: 13, earlySpread: 0.07, earlyGain: 0.24, buildup: 0.06, flutter: 0,
  },
};

// Deterministic noise so a given profile always builds the same room.
function noise(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 16), 2246822507);
    t = Math.imul(t ^ (t >>> 13), 3266489909);
    return (((t ^ (t >>> 16)) >>> 0) / 2147483648) - 1;
  };
}

export function buildImpulse(ctx, id) {
  const p = PROFILES[id] || PROFILES.chamber;
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * p.seconds));
  const buffer = ctx.createBuffer(2, length, rate);
  const rnd = noise(id.length * 2654435761 + p.seconds * 1000);

  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    // Diffuse tail. `lp` is a one-pole whose coefficient tightens as the tail
    // decays, so the reverb loses its top end the way real stone does.
    let lp = 0;
    const buildSamples = Math.max(1, p.buildup * rate);
    const diffuse = p.diffuse === undefined ? 1 : p.diffuse;
    for (let i = 0; i < length; i++) {
      const t = i / rate;
      const frac = i / length;
      const decay = Math.exp(-p.decay * t);
      const build = 1 - Math.exp(-i / buildSamples);
      const a = 1 - (p.damping * 0.55 + p.damping * 0.4 * frac);
      lp += a * (rnd() - lp);
      data[i] = lp * decay * build * diffuse;
    }

    // Early reflections: the part that tells you the size of the room before
    // the tail has even started.
    const sign = ch === 0 ? 1 : -1;
    for (let e = 0; e < p.early; e++) {
      const jitter = 0.55 + Math.abs(rnd()) * 0.9;
      const at = Math.floor((p.predelay + p.earlySpread * (e + jitter) + ch * 0.0013) * rate);
      if (at >= length) break;
      const g = p.earlyGain * Math.pow(0.76, e) * (1 + rnd() * 0.3);
      data[at] += g * (e % 2 === 0 ? sign : -sign);
      if (at + 1 < length) data[at + 1] += g * 0.5;
    }

    // Flutter echo: evenly spaced taps, which is exactly what makes a stone
    // passage sound like a stone passage.
    if (p.flutter) {
      const step = p.flutter * (1 + ch * 0.03);
      for (let k = 1; k * step < p.seconds; k++) {
        const at = Math.floor((p.predelay + k * step) * rate);
        if (at >= length) break;
        const g = p.flutterGain * Math.exp(-p.flutterDecay * k * step) * (k % 2 ? 1 : -0.85);
        data[at] += g;
        if (at + 2 < length) data[at + 2] += g * 0.35;
      }
    }
  }

  normalise(buffer);
  return buffer;
}

// Equal perceived level between profiles, so crossfading rooms does not also
// change how loud the game is.
function normalise(buffer) {
  let energy = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < d.length; i++) energy += d[i] * d[i];
  }
  const rms = Math.sqrt(energy / (buffer.length * buffer.numberOfChannels));
  if (rms < 1e-8) return;
  const gain = 0.09 / rms;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] *= gain;
  }
}
