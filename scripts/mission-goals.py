#!/usr/bin/env python3
"""Add to data/missions.json how each mission is won and lost.

A mission file names its sections in square brackets, and a section may carry a second name: the
event that brings it up. "[Succeeded][BadTeamDead]" is shown, and the mission won, when every enemy
is defeated; "[Failed][Ai2PriestDead]" when the Priest of side 2 is sacrificed. A section that only
names an event is a failure too when its button leads to "TryAgain"; any other is a message shown
when the event comes ("[@120]": 120 seconds into the mission), listed under "tell" with the name
its text has in the file. The buttons of every section are kept under "buttons", by the name
of the section: their label, what they do ("Tell" shows another section, "DoNothing" goes on with
the battle, "LeaveBattle" and the "Mission..." ones leave it) and what with. data/missions.json keeps the
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


EVENT = re.compile(r"@\d+|ai\d+(priest|temple)\w+")


def goals(text: str) -> dict:
    found: dict = {"win": [], "lose": [], "tell": [], "buttons": {}}
    sections: list[tuple[set[str], list[str]]] = []
    first: list[str] = []

    for line in text.replace("\r", "").split("\n"):
        head = HEAD.match(line)

        if head:
            names = re.findall(r"\[([^\]]+)\]", head[1])
            sections.append(({name.lower() for name in names}, []))
            first.append(names[0])
        elif sections:
            sections[-1][1].append(line)

    for (names, body), section in zip(sections, first):
        events = sorted(names - WON - LOST)
        buttons = [line[len("$Button="):].split(",") for line in body if line.startswith("$Button=")]

        if buttons:
            found["buttons"][section] = [[part.strip() for part in button] for button in buttons]

        if names & WON:
            found["win"] += events
        elif names & LOST or (events and any("Tell,TryAgain" in line for line in body)):
            found["lose"] += [e for e in events if re.fullmatch(r"ai\d+(priest|temple)dead", e)]
        elif any(EVENT.fullmatch(e) for e in events):
            found["tell"].append({"on": [e for e in events if EVENT.fullmatch(e)], "section": section})

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
