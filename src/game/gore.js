// What a fight leaves behind.
//
// Blood, bodies and the prints they get tracked around on. None of it does
// anything mechanically -- nothing here can be walked into, damaged or picked
// up -- but a corridor you have already fought your way down should look like
// it, and a trail of your own footprints leading back the way you came is a
// better map than any marker.
//
// Everything is a fixed-size ring buffer. A long fight overwrites its own
// oldest splashes rather than growing without limit, so the cost of the whole
// system is flat and knowable however long a depth lasts.

const MAX_STAINS = 240;
const MAX_CORPSES = 36;

// How long a stain is still wet enough to be stepped in, and how many tiles a
// pair of wet boots carries it before it wears off.
const WET_SECONDS = 26;
const PRINT_TILES = 5;

export class Gore {
  constructor(grid) {
    this.grid = grid;
    this.stains = [];
    this.corpses = [];
    this.stainAt = 0;
    this.corpseAt = 0;
    // tile index -> { colour, at } for the most recent wet stain on it, so
    // "did I just walk through blood" is one map lookup rather than a scan.
    this.wet = new Map();
    this.t = 0;
  }

  update(dt) {
    this.t += dt;
    // The wet map is small and only ever holds tiles that were bled on, so a
    // sweep every few seconds costs nothing and keeps it from growing.
    if (this.wet.size > 0 && Math.floor(this.t) % 4 === 0 && this._swept !== Math.floor(this.t)) {
      this._swept = Math.floor(this.t);
      for (const [i, entry] of this.wet) {
        if (this.t - entry.at > WET_SECONDS) this.wet.delete(i);
      }
    }
  }

  // `power` is roughly how hard the hit landed: it sets the size and how far
  // the spray throws from the point of impact.
  splat(x, y, colour, power = 1, dirX = 0, dirY = 0) {
    if (!colour) return;
    const blobs = Math.min(5, 1 + Math.round(power * 2));
    for (let i = 0; i < blobs; i++) {
      const spread = 0.16 + power * 0.34;
      const throwX = dirX * power * 0.4 * (i / blobs);
      const throwY = dirY * power * 0.4 * (i / blobs);
      this._addStain({
        x: x + throwX + (Math.random() - 0.5) * spread,
        y: y + throwY + (Math.random() - 0.5) * spread,
        r: (0.13 + Math.random() * 0.2) * (0.6 + power * 0.7),
        colour,
        alpha: 0.36 + Math.random() * 0.3,
        squash: 0.55 + Math.random() * 0.35,
        angle: Math.random() * Math.PI,
      });
    }
  }

  // A pool, for something that has stopped moving.
  pool(x, y, colour, size = 1) {
    if (!colour) return;
    for (let i = 0; i < 4; i++) {
      this._addStain({
        x: x + (Math.random() - 0.5) * 0.36,
        y: y + (Math.random() - 0.5) * 0.36,
        r: (0.38 + Math.random() * 0.28) * size,
        colour,
        alpha: 0.5 + Math.random() * 0.24,
        squash: 0.6 + Math.random() * 0.3,
        angle: Math.random() * Math.PI,
      });
    }
  }

  _addStain(stain) {
    stain.born = this.t;
    if (this.stains.length < MAX_STAINS) this.stains.push(stain);
    else this.stains[this.stainAt] = stain;
    this.stainAt = (this.stainAt + 1) % MAX_STAINS;
    const gx = Math.floor(stain.x), gy = Math.floor(stain.y);
    if (this.grid.inBounds(gx, gy)) {
      this.wet.set(this.grid.idx(gx, gy), { colour: stain.colour, at: this.t });
    }
  }

  corpse(entry) {
    entry.born = this.t;
    if (this.corpses.length < MAX_CORPSES) this.corpses.push(entry);
    else this.corpses[this.corpseAt] = entry;
    this.corpseAt = (this.corpseAt + 1) % MAX_CORPSES;
  }

  // Called when anything that walks lands on a tile. Picks up blood that is
  // still wet, and puts a print down for the next few tiles after that.
  //
  // `walker` needs somewhere to keep two numbers; anything with a mutable
  // object will do, which is every actor in the game.
  tread(walker, gx, gy) {
    if (!this.grid.inBounds(gx, gy)) return;
    const here = this.wet.get(this.grid.idx(gx, gy));
    if (here && this.t - here.at <= WET_SECONDS) {
      walker.bloodySteps = PRINT_TILES;
      walker.bloodColour = here.colour;
    } else if (walker.bloodySteps > 0) {
      walker.bloodySteps--;
      // Two feet, offset either side of the direction of travel, fainter each
      // step -- which is what makes it read as a trail rather than a smear.
      const fade = (walker.bloodySteps + 1) / (PRINT_TILES + 1);
      const fx = walker.faceX || 0, fy = walker.faceY || 1;
      const px = -fy, py = fx;
      const side = walker.bloodySteps % 2 ? 0.16 : -0.16;
      this.stains.push({
        x: gx + 0.5 + px * side, y: gy + 0.5 + py * side,
        r: 0.13, colour: walker.bloodColour, alpha: 0.42 * fade,
        squash: 0.5, angle: Math.atan2(fy, fx), born: this.t, print: true,
      });
      if (this.stains.length > MAX_STAINS) this.stains.shift();
    }
  }

  clear() {
    this.stains.length = 0;
    this.corpses.length = 0;
    this.wet.clear();
    this.stainAt = 0;
    this.corpseAt = 0;
  }
}
