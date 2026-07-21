#!/usr/bin/env python3
"""Generate the PWA icons. Standard library only — no Pillow, no ImageMagick.

Run from the repo root:

    python3 tools/make_icons.py

Rewrites icons/icon-180.png, icons/icon-192.png and icons/icon-512.png. Output is
deterministic: same source, same bytes.

Design
------
A solid indigo field, full bleed, with a centred octave of piano keys: seven
cream white keys and five dark black keys grouped 2 + 3.

The mark is the course's whole first lesson. An icon of a generic music note
would say "music"; this says "the keyboard is a repeating pattern of two and
three", which is the one idea everything else here is built on.

The field is edge-to-edge and opaque. Android's maskable crop cuts icons to a
circle, squircle or rounded square depending on the launcher, clipping whatever
it likes off the edges — a solid field has nothing at the edges to lose. So one
image safely serves both "any" and "maskable" at every size, and the keyboard
stays inside the maskable safe zone (checked at run time, see _check_safe_zone).

Approach differs from the precalc workspace's version of this script: that one
renders a single-colour glyph and needs only a coverage fraction, so it
supersamples a boolean. This mark has three colours, so it supersamples RGB and
averages — which antialiases the key edges the same way without special-casing
which colour borders which.
"""

import struct
import sys
import zlib
from pathlib import Path

# --- Design constants ---------------------------------------------------------

FIELD = (0x3f, 0x4c, 0x86)   # #3f4c86 indigo accent
WHITE = (0xfd, 0xfc, 0xf9)   # #fdfcf9 cream page background
BLACK = (0x1b, 0x1a, 0x18)   # #1b1a18 dark page background

# Keyboard geometry, as fractions of the icon's edge length, origin at centre.
KB_W = 0.560                 # full width of the seven white keys
KB_H = 0.440                 # height of a white key
WHITE_W = KB_W / 7.0         # one white key
BLACK_W = 0.046
BLACK_H = 0.260
GAP = 0.005                  # dark separator drawn between adjacent white keys

# A black key sits after white-key indices 0,1 (the two-group) and 3,4,5 (the
# three-group). Nothing after 2 (E) or 6 (B). Same table as assets/keyboard.js.
BLACK_AFTER = (0, 1, 3, 4, 5)

SAFE_RADIUS = 0.40           # maskable safe zone: radius as a fraction of edge

SIZES = (180, 192, 512)
SUPERSAMPLE = 4              # 4x4 = 16 samples per pixel


def _color_at(x: float, y: float):
    """Colour at (x, y), in units of edge length with the origin at the centre."""
    left, top = -KB_W / 2.0, -KB_H / 2.0

    # Outside the keyboard block entirely.
    if not (left <= x <= left + KB_W and top <= y <= top + KB_H):
        return FIELD

    # Black keys sit on top of the white ones, so test them first.
    for i in BLACK_AFTER:
        cx = left + (i + 1) * WHITE_W
        if abs(x - cx) <= BLACK_W / 2.0 and y <= top + BLACK_H:
            return BLACK

    # Separator between two white keys: a thin dark line on each interior
    # boundary. Without it the white block reads as one slab, not seven keys.
    for i in range(1, 7):
        if abs(x - (left + i * WHITE_W)) <= GAP / 2.0:
            return BLACK

    return WHITE


def _render(size: int) -> list:
    """Render the icon as a list of RGB scanlines, supersampled for antialiasing."""
    rows = []
    step = 1.0 / (size * SUPERSAMPLE)
    for py in range(size):
        row = bytearray()
        for px in range(size):
            acc = [0, 0, 0]
            for sy in range(SUPERSAMPLE):
                y = (py + (sy + 0.5) / SUPERSAMPLE) / size - 0.5
                for sx in range(SUPERSAMPLE):
                    x = (px + (sx + 0.5) / SUPERSAMPLE) / size - 0.5
                    c = _color_at(x, y)
                    acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]
            n = SUPERSAMPLE * SUPERSAMPLE
            row += bytes(round(v / n) for v in acc)
        rows.append(row)
    return rows


def _chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def _png(rows: list, size: int) -> bytes:
    """Encode RGB scanlines as a PNG (colour type 2, 8-bit, filter 0)."""
    raw = b"".join(b"\x00" + bytes(r) for r in rows)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", ihdr)
        + _chunk(b"IDAT", zlib.compress(raw, 9))
        + _chunk(b"IEND", b"")
    )


def _check_safe_zone() -> None:
    """Fail loudly if the keyboard could be clipped by a maskable crop."""
    corner = ((KB_W / 2.0) ** 2 + (KB_H / 2.0) ** 2) ** 0.5
    if corner > SAFE_RADIUS:
        sys.exit(
            f"keyboard extends to r={corner:.3f} but the maskable safe zone is "
            f"r={SAFE_RADIUS:.3f}; it would be clipped on some launchers"
        )


def main() -> None:
    _check_safe_zone()
    out = Path(__file__).resolve().parent.parent / "icons"
    out.mkdir(exist_ok=True)
    for size in SIZES:
        path = out / f"icon-{size}.png"
        path.write_bytes(_png(_render(size), size))
        print(f"wrote {path.relative_to(path.parent.parent)} ({path.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
