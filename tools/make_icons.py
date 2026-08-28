#!/usr/bin/env python3
"""Draws the icon set, so the artwork is source rather than binary lumps.

The project has no build step and no image tooling, so the icons are written
here in the same way the labyrinth is: procedurally, from the palette the game
already uses. Re-run it after changing the mark and commit what it writes.

    python tools/make_icons.py

The mark is a square spiral -- the oldest way anybody has drawn a labyrinth --
with the torch burning at the middle of it. It is one shape at every size:
the small ones drop the outer turns rather than shrinking the same drawing
into mush, because a 16-pixel icon has about four pixels of detail to spend.
"""

import math
import pathlib
import struct
import zlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'icons'

DARK = (0x0b, 0x0d, 0x12)      # the labyrinth, unlit
GOLD = (0xe8, 0xb4, 0x5c)      # rune gold, the interface colour
EMBER = (0xff, 0x8a, 0x3a)     # torch flame


def write_png(path, w, h, buf):
    """Minimal RGB PNG. No palette, no filtering worth the name -- these are
    tiny images and zlib does the work."""
    rows = bytearray()
    for y in range(h):
        rows.append(0)
        for x in range(w):
            i = (y * w + x) * 3
            rows += bytes((buf[i], buf[i + 1], buf[i + 2]))

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(rows), 9))
    png += chunk(b'IEND', b'')
    path.write_bytes(png)


class Canvas:
    def __init__(self, size, background):
        self.n = size
        self.px = [float(c) for c in background] * (size * size)

    def blend(self, x, y, colour, alpha):
        if alpha <= 0 or x < 0 or y < 0 or x >= self.n or y >= self.n:
            return
        i = (y * self.n + x) * 3
        if alpha > 1:
            alpha = 1.0
        for k in range(3):
            self.px[i + k] += (colour[k] - self.px[i + k]) * alpha

    def rect(self, x0, y0, x1, y1, colour, alpha=1.0):
        """Coverage-exact axis-aligned fill: the mark is all rectangles, so the
        edges come out properly soft without supersampling anything."""
        for y in range(max(0, int(math.floor(y0))), min(self.n, int(math.ceil(y1)))):
            cover_y = min(y1, y + 1) - max(y0, y)
            if cover_y <= 0:
                continue
            for x in range(max(0, int(math.floor(x0))), min(self.n, int(math.ceil(x1)))):
                cover_x = min(x1, x + 1) - max(x0, x)
                if cover_x <= 0:
                    continue
                self.blend(x, y, colour, cover_x * cover_y * alpha)

    def glow(self, cx, cy, radius, colour, strength=1.0):
        """Torchlight. Falls off as the square of the distance the way the
        game's own light does, so the icon is lit rather than tinted."""
        lo = max(0, int(cx - radius) - 1)
        hi = min(self.n, int(cx + radius) + 2)
        for y in range(max(0, int(cy - radius) - 1), min(self.n, int(cy + radius) + 2)):
            for x in range(lo, hi):
                d = math.hypot(x + 0.5 - cx, y + 0.5 - cy) / radius
                if d >= 1:
                    continue
                fall = (1 - d) ** 2
                self.blend(x, y, colour, fall * strength)

    def bytes(self):
        return bytes(max(0, min(255, int(v + 0.5))) for v in self.px)


# The spiral, as cell steps out from the middle: turn right each time, and let
# the run get two longer every second turn. Two, not one -- the arms have to
# pass each other with a cell of dark between them or the whole thing fills in
# solid and stops being a spiral at all. Truncating the list drops outer turns,
# which is how the small sizes stay legible.
TURNS = ((1, 0), (0, 1), (-1, 0), (0, -1))


def spiral_cells(rings):
    """Cells of a square spiral, centre first. `rings` counts the runs drawn,
    and wants to be a multiple of four: a spiral stopped part way round has a
    long arm sailing past the corner of everything else, which reads as the
    drawing having been clipped. Stop on the fourth and it closes square about
    its own middle, with the last corner left open as the way in."""
    x = y = 0
    cells = [(0, 0)]
    run = 2
    for i in range(rings):
        dx, dy = TURNS[i % 4]
        for _ in range(run):
            x += dx
            y += dy
            cells.append((x, y))
        if i % 2 == 1:
            run += 2
    return cells


def draw(size, rings, bleed):
    """One icon. `bleed` is how much of the tile the mark is allowed to fill:
    a maskable icon is cropped to a circle by the launcher, so its mark has to
    sit well inside the square it is drawn on."""
    c = Canvas(size, DARK)
    cells = spiral_cells(rings)
    # Centre the mark on the shape it actually is, not on the middle of the
    # walk. A spiral stops wherever its last run ends, so its bounding box is
    # never symmetrical about the middle, and centring on the start puts the
    # last arm through the edge of the tile.
    xs = [x for x, _ in cells]
    ys = [y for _, y in cells]
    ox = (min(xs) + max(xs)) / 2.0
    oy = (min(ys) + max(ys)) / 2.0
    span = max(max(xs) - min(xs), max(ys) - min(ys)) + 1
    cell = size * bleed / span
    # Just proud of half a cell, so the run reads as one continuous line and
    # the gap either side of it survives.
    arm = cell * 0.54
    mid = size / 2.0
    # The flame sits where the walk started, which is the heart of the spiral
    # rather than the middle of the tile.
    fx, fy = mid - ox * cell, mid - oy * cell

    # Small sizes are snapped to whole pixels. There is no room at sixteen
    # across for a line to be shared between two pixels: antialiasing spends
    # the gap it needs on a grey edge, and the spiral closes up into a blob.
    # Whole cells, walls exactly one cell wide and gaps exactly one cell wide,
    # and it stays a labyrinth.
    if size < 64:
        cell = max(2.0, float(int(size * bleed / span)))
        arm = cell / 2.0
        fx = int(round(mid - ox * cell - arm)) + arm
        fy = int(round(mid - oy * cell - arm)) + arm

    # Torchlight first, under everything, warmest where the flame is. Turned
    # right down on the small sizes: at sixteen pixels a bloom is not
    # atmosphere, it is the two pixels of gap between one turn of the spiral
    # and the next being filled in.
    lit = 1.0 if size >= 64 else 0.3
    c.glow(fx, fy, size * 0.52, (0x3a, 0x28, 0x1c), 0.85 * lit)
    c.glow(fx, fy, size * 0.26, (0x6b, 0x42, 0x22), 0.9 * lit)

    for x, y in cells[1:]:
        px, py = fx + x * cell, fy + y * cell
        # Dim with distance from the flame: the outer turns are further from
        # the light, which is the whole idea the game is built on.
        d = math.hypot(x, y) / max(1e-6, span / 2)
        fade = 1.0 - (0.45 if size >= 64 else 0.12) * min(1.0, d)
        colour = tuple(int(GOLD[k] * fade) for k in range(3))
        c.rect(px - arm, py - arm, px + arm, py + arm, colour)

    # The flame itself: a bright core with a bloom over the stonework.
    c.glow(fx, fy, cell * 2.1, EMBER, 0.5 * lit)
    c.rect(fx - arm, fy - arm, fx + arm, fy + arm, EMBER)
    c.glow(fx, fy, cell * 0.75, (0xff, 0xe2, 0xb0), 0.95)
    return c


def main():
    OUT.mkdir(exist_ok=True)
    # size, rings, bleed, name. Fewer turns at small sizes; a tighter mark on
    # the maskable one because launchers crop it to a circle.
    plan = [
        (16, 4, 0.95, 'favicon-16.png'),
        (32, 8, 0.88, 'favicon-32.png'),
        (180, 8, 0.82, 'apple-touch-icon.png'),
        (192, 8, 0.82, 'icon-192.png'),
        (512, 8, 0.82, 'icon-512.png'),
        (512, 8, 0.60, 'icon-maskable-512.png'),
    ]
    for size, rings, bleed, name in plan:
        canvas = draw(size, rings, bleed)
        write_png(OUT / name, size, size, canvas.bytes())
        print('%-26s %dx%d' % (name, size, size))


if __name__ == '__main__':
    main()
