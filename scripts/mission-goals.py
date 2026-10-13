#!/usr/bin/env python3
"""Add to data/missions.json how each mission is won and lost.

A mission file names its sections in square brackets, and a section may carry a second name: the
event that brings it up. "[Succeeded][BadTeamDead]" is shown, and the mission won, when every enemy
is defeated; "[Failed][Ai2PriestDead]" when the Priest of side 2 is sacrificed. A section that only
names an event is a failure too when its button leads to "TryAgain". data/missions.json keeps the
first name of each section only, so the events are read from the files again.

Usage: mission-goals.py <dir with *.english> <data/missions.json>
"""
import json
import pathlib
import re
import sys

HEAD = re.compile(r"^((?:\[[^\]]+\])+)\s*$")
WON = {"succeeded", "success"}
LOST = {"failed"}


def goals(text: str) -> dict[str, list[str]]:
    found: dict[str, list[str]] = {"win": [], "lose": []}
    sections: list[tuple[set[str], list[str]]] = []

    for line in text.replace("\r", "").split("\n"):
        head = HEAD.match(line)

        if head:
            sections.append(({name.lower() for name in re.findall(r"\[([^\]]+)\]", head[1])}, []))
        elif sections:
            sections[-1][1].append(line)

    for names, body in sections:
        events = sorted(names - WON - LOST)

        if names & WON:
            found["win"] += events
        elif names & LOST or (events and any("Tell,TryAgain" in line for line in body)):
            found["lose"] += [e for e in events if re.fullmatch(r"ai\d+(priest|temple)dead", e)]

    return found


def main() -> None:
    source, out = map(pathlib.Path, sys.argv[1:3])
    missions = json.loads(out.read_text())

    for mission in missions:
        path = source / f"{mission['file']}.english"

        if path.exists() and mission.get("header", {}).get("missionType"):
            mission["goals"] = goals(path.read_bytes().decode("latin-1"))

    out.write_text(json.dumps(missions, indent=4) + "\n")


if __name__ == "__main__":
    main()
