#!/usr/bin/env python3
"""Ship the frames of the client's animations.

scripts/unshp.py numbers the frames of a type by their line in its .type file ("slots") and keeps,
in index.json, where each cropped picture lies from the hot spot of its frame. This copies the
slots the client animates into its public folder and lists them in its sprite manifest under the
pseudo-gif "@": manifest[type]["@"][slot] = "path#x,y", the offset riding on the path.

Usage: anim-frames.py <original/all-assets/sprites> <packages/client/public>
"""
import json
import pathlib
import shutil
import sys

# How many slots of each type the client uses, from the first. See texture-selection.ts.
SLOTS = {
    "sunwalker": 64,  # eight frames of walking for each of eight headings
    "priest": 167,  # walking, then floating and the chant of each stage of a sacrifice
    "geyser": 50,  # the eruption, then the dry geyser
    "sunflyer": 8,
    "windflyer": 13,
    "rainflyer": 16,
    "rainballoon": 20,
    "nugget": 9,
    "rainwalker": 10,
    "raincannon": 12,  # three frames of firing for each facing
    "windwalker": 36,  # four frames for each of four headings, then twenty of turning
    "bulf": 56,  # eight frames for each of four headings, then twenty-four of turning
    "windvortex": 14,  # the whirl, then the Temple under it
    "rainvortex": 15,  # the Temple, then the pool in it
    "thundervortex": 8,
    "thundercannon": 36,  # for each facing: the gun, six frames of charge laid over it, two of fire
    "suncannon": 28,  # the facings, the frames of turning, the frames of fire
    "sunbattery": 8,
    "thunderarcher": 2,
    "sunarcher": 33,  # the arm of the Disc Thrower in sixteen bearings, wound and flung, then its base
    "sunaviary": 27,  # the dome opening, then the Whirligig rising out of it
    "windaviary": 6,
    "rainaviary": 13,
    "dais": 59,  # the ring of an Altar through the five stages of a sacrifice
    "altar": 89,  # its horns, the captive struggling between them, then the sacrifice
    "windarcher": 80,  # for each facing: five frames of a shot, then twenty of turning
    "fringe": 83,  # the rock that hangs under the southern rim of an island
}


# The frame lines of each .type file that names shadows: the shadow of slot n is slot n plus this.
SHADOWS = {"sunwalker": 66, "priest": 168, "geyser": 51, "sunflyer": 9, "windflyer": 23, "rainflyer": 17, "rainballoon": 21, "nugget": 10, "rainwalker": 21, "raincannon": 13, "windwalker": 37, "bulf": 81, "windvortex": 21, "rainvortex": 29, "thundervortex": 16, "suncannon": 29, "sunbattery": 9, "thunderarcher": 3, "sunaviary": 32, "windaviary": 7, "rainaviary": 14, "windarcher": 101}


def main() -> None:
    source, public = map(pathlib.Path, sys.argv[1:3])
    index = json.loads((source / "index.json").read_text())
    manifest_path = public / "data" / "sprites.json"
    manifest = json.loads(manifest_path.read_text())

    for kind, count in SLOTS.items():
        slots = {}

        shadows = range(SHADOWS[kind], SHADOWS[kind] + count) if kind in SHADOWS else []

        for slot in [*range(count), *shadows]:
            frame = index[kind].get(str(slot))

            if frame is None:  # a blank line of the .type file
                continue

            target = public / "sprites" / frame["file"]
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source / frame["file"], target)
            slots[str(slot)] = f"sprites/{frame['file']}#{frame['x']},{frame['y']}"

        manifest.setdefault(kind, {})["@"] = slots

    manifest_path.write_text(json.dumps(manifest, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    main()
