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
    "priest": 64,
    "geyser": 50,  # the eruption, then the dry geyser
    "sunflyer": 8,
    "windflyer": 13,
    "rainflyer": 16,
    "rainballoon": 20,
    "nugget": 9,
    "rainwalker": 10,
    "raincannon": 12,  # three frames of firing for each facing
}


def main() -> None:
    source, public = map(pathlib.Path, sys.argv[1:3])
    index = json.loads((source / "index.json").read_text())
    manifest_path = public / "data" / "sprites.json"
    manifest = json.loads(manifest_path.read_text())

    for kind, count in SLOTS.items():
        slots = {}

        for slot in range(count):
            frame = index[kind][str(slot)]
            target = public / "sprites" / frame["file"]
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source / frame["file"], target)
            slots[str(slot)] = f"sprites/{frame['file']}#{frame['x']},{frame['y']}"

        manifest.setdefault(kind, {})["@"] = slots

    manifest_path.write_text(json.dumps(manifest, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    main()
