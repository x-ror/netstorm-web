#!/usr/bin/env python3
"""Ship the sounds the client plays.

The .type files name a sound for what a unit does ("fireSound", "impactSound", "activeSound",
"pickupSound", "dropSound", "moveSound", "buildDoneSound"); the game's own code names a few more.
A file may carry a number after its name ("thunderCannon-1000.wav" for "thunderCannon.wav"): it is
taken for the sound's attenuation in hundredths of a decibel, as DirectSound counts volume (`?`).

This copies the sounds in use to the client's public folder and writes its index:
data/sounds.json = {"files": {name: [path, volume 0..1]}, "units": {type: {what: name}}}.

Usage: sounds.py <original/all-assets/sounds> <data/units.json> <packages/client/public>
"""
from __future__ import annotations

import json
import pathlib
import re
import shutil
import sys

KEYS = {
    "fireSound": "fire",
    "impactSound": "impact",
    "activeSound": "active",
    "pickupSound": "pickup",
    "dropSound": "drop",
    "moveSound": "move",
    "buildDoneSound": "built",
}
# Sounds the client plays for events of the battle; which the original plays when is not read,
# the names are matched to the events by what they say.
EVENTS = [
    "explosion", "bridgeFall", "bridgecrack", "buildDone", "dropPiece", "rotatePiece", "select",
    "thunderCrack", "iceCannonImpact1", "iceCannonImpact2", "iceCannonImpact3", "iceCannonImpact4",
    "enemyPriestCaptured", "ourPriestCaptured", "ourPriestImmobile", "priestFree", "dissolve",
    "priestSacrifice2", "altarBurnCollapse", "somethingCreated", "geyserMined1",
]
HUNDREDTHS_PER_BEL = 2000  # of amplitude: 20 dB is a factor of ten


def main() -> None:
    source, units, public = map(pathlib.Path, sys.argv[1:4])
    found: dict[str, tuple[pathlib.Path, float]] = {}

    for path in sorted(source.iterdir()):
        named = re.fullmatch(r"(.+?)(?:-(\d+))?\.wav", path.name, re.I)

        if named:
            volume = 10 ** (-int(named[2] or 0) / HUNDREDTHS_PER_BEL)
            found.setdefault(named[1].lower(), (path, round(volume, 3)))

    files: dict[str, list] = {}

    def use(name: str) -> str | None:
        key = re.sub(r"\.wav$", "", name, flags=re.I).lower()

        if key not in found:
            return None

        path, volume = found[key]
        target = public / "sounds" / f"{key}.wav"
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target)
        files[key] = [f"sounds/{key}.wav", volume]
        return key

    by_unit: dict[str, dict[str, str]] = {}

    for unit in json.loads(units.read_text()):
        sounds = {what: use(unit[key]) for key, what in KEYS.items() if unit.get(key)}
        sounds = {what: name for what, name in sounds.items() if name}

        if sounds:
            by_unit[unit["id"].lower()] = sounds

    for name in EVENTS:
        if not use(name):
            raise SystemExit(f"no sound {name}")

    out = public / "data" / "sounds.json"
    out.write_text(json.dumps({"files": files, "units": by_unit}, separators=(",", ":")) + "\n")
    print(len(files), "sounds")


if __name__ == "__main__":
    main()
