#!/usr/bin/env python3
"""Unpack every sprite of the original game from d/_shapes.shp into PNG files.

Usage: python3 scripts/unshp.py original/game/Netstorm original/extracted original/assets

_shapes.shp is 119 "1.10" shape tables back to back, one per unit type, in the order of the type
name table of netstorm.game. A table holds the sprite of every frame line of the .type file, then
the shadow of every line if any line names one. Shadows keep their flat palette colour; the game
draws them translucent. Colours come from d/GIFCLOUD.COL. Each PNG is cropped to the bounding box
of its frame; index.json keeps the offset of that box from the hot spot of the frame. Standard
library only.
"""
import json
import os
import re
import struct
import sys

from png8 import SIGNATURE, chunk, zlib

MAGIC = b'1.10'
FRAME_HEADER = '<4H4i'
PALETTE_OFFSET = 8
FIRST_TYPE = b'dude\0'
OFF_SCREEN = 1 << 30  # blank placeholder frames sit this far away and hold no picture


def tables(shp):
    """(offset, slot count) of each shape table."""
    found, at = [], 0
    while shp[at:at + 4] == MAGIC:
        count = struct.unpack_from('<I', shp, at + 4)[0]
        found.append((at, count))
        at += 8 + 8 * count
    return found


def type_names(game, count):
    """The first `count` names of the type table of the game binary, lower case."""
    return [n.decode('latin-1').lower() for n in game[game.index(FIRST_TYPE):].split(b'\0') if n][:count]


def slots(text):
    """(gif, frame number, suffix) of each slot of a .type file: all sprites first, then all shadows."""
    text = re.sub(r'/\*.*?\*/', '', re.sub(r'//.*', '', text), flags=re.S)
    lines = [re.findall(r'"([^"]+)"\s*#\s*(\d+)', line) for line in re.findall(r'^\s*\w+\s*:[^;{}]*;', text, re.M)]
    width = max(map(len, lines), default=0)
    # A line without a shadow of its own still has a generated one: name it after its sprite.
    return [(*line[i], '') if i < len(line) else (*line[0], '_shadow') for i in range(width) for line in lines]


def decode(shp, at, palette):
    """(x, y, width, height, RGBA rows) of the frame at `at`, or None for an empty one."""
    _, _, _, _, left, top, right, bottom = struct.unpack_from(FRAME_HEADER, shp, at)
    width, height = right - left + 1, bottom - top + 1
    if width <= 0 or height <= 0 or left > OFF_SCREEN:
        return None
    at += struct.calcsize(FRAME_HEADER)
    rows = []
    for _ in range(height):
        row = bytearray()
        while shp[at]:
            code, at = shp[at], at + 1
            if code == 1:  # skip transparent pixels
                row += b'\0\0\0\0' * shp[at]
                at += 1
            elif code & 1:  # literal pixels
                for index in shp[at:at + (code >> 1)]:
                    row += palette[index]
                at += code >> 1
            else:  # run of one colour
                row += palette[shp[at]] * (code >> 1)
                at += 1
        at += 1
        assert len(row) <= width * 4 or not any(row[width * 4 + 3::4]), at
        rows.append(bytes(row[:width * 4]).ljust(width * 4, b'\0'))
    return left, top, width, height, rows


def png(width, height, rows):
    return (
        SIGNATURE
        + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(b''.join(b'\0' + row for row in rows), 9))
        + chunk(b'IEND', b'')
    )


def main(game_dir, extracted, out):
    shp = open(os.path.join(game_dir, 'd', '_shapes.shp'), 'rb').read()
    col = open(os.path.join(game_dir, 'd', 'GIFCLOUD.COL'), 'rb').read()[PALETTE_OFFSET:]
    palette = [col[i:i + 3] + b'\xff' for i in range(0, 768, 3)]
    found = tables(shp)
    names = type_names(open(os.path.join(game_dir, 'netstorm.game'), 'rb').read(), len(found))
    index, total = {}, 0
    for name, (table, count) in zip(names, found):
        refs = slots(open(os.path.join(extracted, 'd', name + '.type'), encoding='latin-1').read())
        assert len(refs) == count, (name, len(refs), count)
        os.makedirs(os.path.join(out, name), exist_ok=True)
        frames = index[name] = {}
        for slot, ref in enumerate(refs):
            offset = struct.unpack_from('<I', shp, table + 8 + 8 * slot)[0]
            frame = decode(shp, table + offset, palette)
            if not frame:
                continue
            x, y, width, height, rows = frame
            gif, number = os.path.splitext(ref[0])[0].lower(), int(ref[1])
            file = f'{name}/{slot:03d}_{gif}_{number:03d}{ref[2]}.png'
            with open(os.path.join(out, file), 'wb') as target:
                target.write(png(width, height, rows))
            frames[slot] = {'file': file, 'gif': ref[0], 'frame': number, 'x': x, 'y': y, 'w': width, 'h': height}
            total += 1
    with open(os.path.join(out, 'index.json'), 'w') as target:
        json.dump(index, target, indent=1)
    print(total, 'frames of', len(names), 'types')


if __name__ == '__main__':
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
