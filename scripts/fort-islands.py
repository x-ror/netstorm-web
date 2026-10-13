#!/usr/bin/env python3
"""Read the island descriptions out of the original's .fort maps.

A .fort file ends with the 20 "territory" records of its player, six bytes each: the shape (a
bridge piece index, low six bits) and rotation, flags, the chunk offset (x in the low half of the
byte, y in the high half), the seed byte and two more bytes. The game lays an island for every
record whose flags have bit 0 set and bit 1 clear, at the offset plus one chunk. See "Острови: як
їх будує гра" in docs/game-rules.md.

Usage: fort-islands.py <dir with *.fort> <out.json>
"""
import json
import pathlib
import sys

RECORDS = 20
RECORD = 6
# What follows the records in every file: four bytes that vary, then this.
TRAILER = bytes.fromhex("0000002437b7d4")
GAP = 4
PLACED = 1
RESERVE = 2


def islands(data: bytes) -> list[list[int]]:
    end = data.index(TRAILER) - GAP
    start = end - RECORDS * RECORD
    found = []

    for at in range(start, end, RECORD):
        shape, flags, offset, seed = data[at:at + 4]

        if flags & PLACED and not flags & RESERVE:
            if shape >> 6:
                raise ValueError("rotated island")

            found.append([shape & 0x3F, 1 + (offset & 0xF), 1 + (offset >> 4), seed])

    return found


def main() -> None:
    source, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
    maps = {path.stem: islands(path.read_bytes()) for path in sorted(source.glob("*.fort"))}
    out.write_text(json.dumps(maps, separators=(",", ":")) + "\n")
    print(f"{len(maps)} maps, {sum(map(len, maps.values()))} islands")


if __name__ == "__main__":
    main()
