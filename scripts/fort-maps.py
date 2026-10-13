#!/usr/bin/env python3
"""Read the islands and the objects of the original's .fort maps into data/maps.json.

A .fort file is a header and a run of streams, each a 16-bit length (itself included) and data.
Stream 0 holds the objects that stand on no island ("Chaff"), stream 2 the 20 island descriptions
of six bytes ("Territory"), streams 11 to 30 the objects of each of those islands. An object stream
is a version byte and then, for every chunk in turn, 'c', a 16-bit count and that many records.
Chaff lists all 256 chunks row by row, an island stream only the chunks of its island. A record is
the cell in the chunk (x in the high half of the byte), the type, and bytes the type's flags call
for: a frame, the owner, what a carrier holds. See "Острови: як їх будує гра" and "Карти місій" in
docs/game-rules.md.

Usage: fort-maps.py <dir with *.fort> <data/units.json> <out.json>
"""
from __future__ import annotations

import json
import pathlib
import struct
import sys

# Type names in the order of the game's type table; a type id in a map is the index plus 70.
NAMES = (
    "dude sunArcher sunAviary sunFlyer banner windBattery rainBattery thunderBattery sunBlocker "
    "thunderBlocker blankMissile bolt bridge sunDisc emptyGeyser sunFactory windFactory "
    "rainFactory thunderFactory residence fencemark flag fortGump icon island islandStalag "
    "playerBanner isle isleBig geyserBrightener treeTwo treeThree fringe mana range manabolt "
    "flare puzzlePiece playerIsland battleIsland particlePlaceHolder sunBalloon buried "
    "bombExplodeSmall bombExplodeMedium bombExplodeLarge bombHeal bombInvisible bombParalyze "
    "bombHardener bombTreason edgeFarm geyser windVortex rainVortex thunderVortex outpost mcloud "
    "sunCannon rainCannon rainCannonMissile thunderCannon thunderCannonMissile sunWalker "
    "teleportEffect bulf sunFence windWalker windFlyer windAviary windArcher windBalloon "
    "windBlocker rainAviary rainFlyer rainFence rainBalloon rainBlocker thunderArcher "
    "thunderFence growingRainBlocker platform player mog nugget bridgeConnector rainWalker "
    "noIsland priest windWhirl thunderaviary RUIN Monument sunBattery lightning anim "
    "challengeIsland fakeThreeByThreeSurface sunFlyerBomb altar dais rune forceField "
    "bombSpecialOne daisExtraFrames fenceShield bombTwister bombIITwister bombIIITwister "
    "GravitationEffect bombGraviton HealEffect MeteorEffect BOMBmeteor bombIMano bombIIMano "
    "bombIIIMano bombLightingZap bombLightingwave"
).split()
FIRST_TYPE = 70
ISLAND = 94
GEYSER = 122
NO_ISLAND = 157
BRIDGES_FROM = 0xF6  # a type from here up is a bridge cell of player 255 - type
# The island shapes of the game (its second "canon" table): a letter is a chunk.
SHAPES = [
    [".L.", "FAG", "INH"], ["FG.", "BAG", "INH"], ["FCG", "BAD", "INH"], ["OG", ".N"], ["OKM"],
    ["OKG", "..N"], ["OCM", ".N."], ["FG", "IH"], ["OG.", ".IM"], ["OCG", ".IH"], ["FKG", "N.N"],
    [".L.", "OAM", ".N."], ["L..", "IG.", ".IM"], ["FKG", "J.J", "IKH"], [".L.", "OAG", ".IH"],
    ["..L", "OCD", ".IH"], ["OCG", ".IH"], ["FKG", "N.J", "..N"], [".FM", "OH."],
    ["L..", "BKG", "N.N"], [".L.", "FEG", "N.N"],
]
OWNED = {
    "bomb", "vortex", "guy", "focus", "factory", "nugget", "walker", "balloon", "emplacement",
    "flyer", "priest", "dais", "islandthreebythree", "geyser", "residence",
}
CARRIERS = {"walker", "balloon", "container"}
# Read off the files, where the flags do not tell the length: the bytes after the type, and which
# of them is the owner (None: no owner).
FIXED = {
    "windVortex": (4, 0), "rainVortex": (4, 0), "thunderVortex": (4, 0),
    "sunFactory": (3, 1), "windFactory": (3, 1), "rainFactory": (3, 1), "thunderFactory": (3, 1),
    "buried": (1, None), "anim": (2, None),
}
TERRITORY = 2
FIRST_ISLAND_STREAM = 11
ISLANDS = 20
PLACED = 1
RESERVE = 2
SIDE = 16


class Types:
    def __init__(self, units: list[dict]) -> None:
        self.flags = {u["id"].lower(): {f.lower() for f in u.get("flags", [])} for u in units}

    def read(self, data: bytes, at: int) -> tuple[dict | None, int]:
        """One record at `at`: what it describes, and where the next one starts."""
        cell, kind = data[at], data[at + 1]
        where = {"x": cell >> 4, "y": cell & 15}

        if kind >= BRIDGES_FROM:
            return {**where, "bridge": data[at + 2], "owner": 255 - kind}, at + 3

        if kind in (0, ISLAND):
            return None, at + 3

        name = NAMES[kind - FIRST_TYPE]
        rest = at + 2
        item = {**where, "type": name, "owner": 0, "frame": 0}

        if name in FIXED:
            length, owner = FIXED[name]

            if owner is not None:
                item["owner"] = data[rest + owner]

            return item, rest + length

        flags = self.flags[name.lower()]

        if "saveframe" in flags:
            item["frame"] = data[rest]
            rest += 1

        rest += ("saveqa" in flags) + 2 * ("saveqb" in flags) + ("factory" in flags)

        if flags & OWNED:
            item["owner"] = data[rest]
            rest += 1

        if flags & CARRIERS:
            rest += 1 + data[rest]  # a count, then a type byte for each thing carried

        return item, rest


def streams(data: bytes) -> list[bytes]:
    """The streams of a file. The header has no fixed length, so the start is looked for: the
    place from which the lengths run on to the end of the file."""
    for start in range(0x20, 0x400):
        if data[start + 2] > 2 or data[start + 3] != 0x63:
            continue

        found, at = [], start

        while at + 2 <= len(data):
            (length,) = struct.unpack_from("<H", data, at)

            if length < 2 or at + length > len(data):
                break

            found.append(data[at + 2:at + length])
            at += length

        if len(found) >= FIRST_ISLAND_STREAM + ISLANDS:
            return found

    raise ValueError("no streams")


def objects(types: Types, stream: bytes, chunks: list[tuple[int, int]]) -> list[dict]:
    found, at = [], 1

    for cx, cy in chunks:
        if stream[at] != 0x63:
            raise ValueError("chunk list expected")

        (count,) = struct.unpack_from("<H", stream, at + 1)
        at += 3

        for _ in range(count):
            item, at = types.read(stream, at)

            if item:
                item["x"] += cx * SIDE
                item["y"] += cy * SIDE
                found.append(item)

    if at != len(stream):
        raise ValueError("stream not read to its end")

    return found


def read_map(types: Types, data: bytes) -> dict:
    parts = streams(data)
    everything = objects(types, parts[0], [(n % SIDE, n // SIDE) for n in range(SIDE * SIDE)])
    islands = []

    for k in range(ISLANDS):
        shape, flags, offset, seed = parts[TERRITORY][k * 6:k * 6 + 4]

        if not flags & PLACED or flags & RESERVE:
            continue

        cx, cy = 1 + (offset & 15), 1 + (offset >> 4)
        chunks = sorted(
            ((cx + x, cy + y) for y, row in enumerate(SHAPES[shape & 63])
             for x, letter in enumerate(row) if letter != "."),
            key=lambda c: (c[1], c[0]),
        )
        everything += objects(types, parts[FIRST_ISLAND_STREAM + k], chunks)
        islands.append([shape & 63, cx, cy, seed])

    out = {"islands": islands, "geysers": [], "ground": [], "bridges": [], "units": []}

    for item in everything:
        x, y, owner = item["x"], item["y"], item["owner"]

        if "bridge" in item:
            out["bridges"].append([x, y, item["bridge"], owner])
        elif item["type"] == "geyser":
            out["geysers"].append([x - 1, y - 1])  # the record is its islet's far corner
        elif item["type"] == "noIsland":
            out["ground"].append([x, y, owner])
        else:
            out["units"].append([item["type"].lower(), owner, x, y, item["frame"]])

    return out


def main() -> None:
    source, units, out = map(pathlib.Path, sys.argv[1:4])
    types = Types(json.loads(units.read_text()))
    maps = {}

    for path in sorted(source.glob("*.fort")):
        try:
            maps[path.stem] = read_map(types, path.read_bytes())
        except (ValueError, IndexError, KeyError) as error:
            print(f"{path.stem}: skipped, {error!r}")

    out.write_text(json.dumps(maps, separators=(",", ":")) + "\n")
    print(f"{len(maps)} maps")


if __name__ == "__main__":
    main()
