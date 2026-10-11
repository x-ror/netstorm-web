#!/usr/bin/env python3
"""Re-encode RGBA PNGs that use at most 256 colours as palette PNGs, without changing a pixel.

The sprites extracted from the game are saved as 32-bit RGBA although the artwork is paletted.
A palette PNG of the same picture is about a quarter smaller, which keeps the client inside the
size budget of scripts/check-size.mjs.

    python3 scripts/png8.py packages/client/public/sprites/thundercannon/*.png

Each file is decoded again after encoding and compared with the original pixel for pixel; a file
that would not come out identical, or would not get smaller, is left untouched. Standard library
only.
"""
import os
import struct
import sys
import zlib

SIGNATURE = b'\x89PNG\r\n\x1a\n'


def chunks(data):
    offset = len(SIGNATURE)
    while offset < len(data):
        size = struct.unpack('>I', data[offset:offset + 4])[0]
        yield data[offset + 4:offset + 8], data[offset + 8:offset + 8 + size]
        offset += 12 + size


def chunk(kind, body):
    return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body) & 0xFFFFFFFF)


def read_rgba(data):
    """Rows of RGBA bytes of an 8-bit RGBA PNG, or None for any other kind of PNG."""
    header, packed = None, b''
    for kind, body in chunks(data):
        if kind == b'IHDR':
            header = struct.unpack('>IIBBBBB', body)
        elif kind == b'IDAT':
            packed += body
    width, height, depth, colour, _, _, interlace = header
    if (depth, colour, interlace) != (8, 6, 0):
        return None
    raw, stride, rows, previous, at = zlib.decompress(packed), width * 4, [], bytearray(width * 4), 0
    for _ in range(height):
        kind, line = raw[at], bytearray(raw[at + 1:at + 1 + stride])
        at += 1 + stride
        for i in range(stride):
            left = line[i - 4] if i >= 4 else 0
            up = previous[i]
            corner = previous[i - 4] if i >= 4 else 0
            if kind == 1:
                line[i] = (line[i] + left) & 255
            elif kind == 2:
                line[i] = (line[i] + up) & 255
            elif kind == 3:
                line[i] = (line[i] + ((left + up) >> 1)) & 255
            elif kind == 4:
                a, b, c = abs(up - corner), abs(left - corner), abs(left + up - 2 * corner)
                line[i] = (line[i] + (left if a <= b and a <= c else up if b <= c else corner)) & 255
        rows.append(bytes(line))
        previous = line
    return width, height, rows


def read_palette(data):
    """Rows of RGBA bytes of a palette PNG written by this script."""
    palette = alpha = None
    packed = b''
    for kind, body in chunks(data):
        if kind == b'IHDR':
            width, height = struct.unpack('>II', body[:8])
        elif kind == b'PLTE':
            palette = body
        elif kind == b'tRNS':
            alpha = body
        elif kind == b'IDAT':
            packed += body
    raw = zlib.decompress(packed)
    return width, height, [
        b''.join(palette[i * 3:i * 3 + 3] + bytes([alpha[i]]) for i in raw[y * (width + 1) + 1:(y + 1) * (width + 1)])
        for y in range(height)
    ]


def visible(rows):
    """The picture as it is seen: the colour stored under full transparency does not matter."""
    return [b''.join(r[i:i + 4] if r[i + 3] else b'\0\0\0\0' for i in range(0, len(r), 4)) for r in rows]


def encode(width, height, rows):
    """A palette PNG of the picture, or None if it has more than 256 colours."""
    palette, index, body = [], {}, bytearray()
    for row in visible(rows):
        body.append(0)
        for x in range(0, len(row), 4):
            pixel = row[x:x + 4]
            if pixel not in index:
                if len(palette) == 256:
                    return None
                index[pixel] = len(palette)
                palette.append(pixel)
            body.append(index[pixel])
    return (
        SIGNATURE
        + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 3, 0, 0, 0))
        + chunk(b'PLTE', b''.join(p[:3] for p in palette))
        + chunk(b'tRNS', bytes(p[3] for p in palette))
        + chunk(b'IDAT', zlib.compress(bytes(body), 9))
        + chunk(b'IEND', b'')
    )


def convert(path):
    """Bytes saved, or 0 if the file was left as it is."""
    before = open(path, 'rb').read()
    picture = read_rgba(before) if before.startswith(SIGNATURE) else None
    after = encode(*picture) if picture else None
    if after is None or len(after) >= len(before):
        return 0
    width, height, rows = picture
    again = read_palette(after)
    if again[:2] != (width, height) or visible(again[2]) != visible(rows):
        print(f'{path}: would not be identical, left as it is', file=sys.stderr)
        return 0
    temporary = path + '.tmp'
    with open(temporary, 'wb') as out:
        out.write(after)
    os.replace(temporary, path)
    return len(before) - len(after)


def main(paths):
    if not paths:
        print(__doc__)
        return 2
    saved = converted = 0
    for path in paths:
        gain = convert(path)
        saved += gain
        converted += gain > 0
    print(f'{converted} of {len(paths)} files re-encoded, {saved} bytes saved')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
