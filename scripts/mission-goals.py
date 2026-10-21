#!/usr/bin/env python3
"""Add to data/missions.json how each mission is won and lost, and read its header again.

A mission file names its sections in square brackets, and a section may carry more names: the
events that bring it up. "[Succeeded][BadTeamDead]" is shown when every enemy is defeated,
"[Failed][Ai2PriestDead]" when the Priest of side 2 dies, "[@120]" 120 seconds into the mission.
The engine raises the events and shows the section, if there is one; its buttons decide the rest
("Tell" shows another section, "DoNothing" goes on with the battle, "MissionBegin" starts a mission,
"MissionRestart" plays this one again, "MissionAbort" and "LeaveBattle" leave). Every section is
listed under "sections" in the file's order, with all its names, its $Timeout and its inline
commands; the buttons under "buttons", by the first name of their section. data/missions.json
keeps the first name of each section only, so the names are read from the files again.

The header is read as the original's config.cpp reads a value: up to the end of its line, quotes
dropped (a quote after ` is kept) and the rest cut at an unquoted "//". A quote left open does not
run on into the next line, so "ai3Name = \"Marquis de Thunder" is followed by its ai3Tech.

Usage: mission-goals.py <dir with *.english> <data/missions.json>
"""
import json
import pathlib
import re
import sys

HEAD = re.compile(r"^((?:\[[^\]]+\])+)\s*$")
ESCAPE = "`"


def value(rest: str) -> str:
    """A value as config.cpp copies it: to the end of the line or an unquoted comment, unquoted."""
    out: list[str] = []
    quoted = False
    previous = ""

    for i, char in enumerate(rest):
        if char in "\r\n" or (not quoted and rest.startswith("//", i)):
            break

        if char == '"' and previous != ESCAPE:
            quoted = not quoted
        else:
            out.append(char)

        previous = char

    return "".join(out).rstrip()


def header(text: str) -> dict:
    found: dict = {}
    inside = False

    for line in text.replace("\r", "").split("\n"):
        head = HEAD.match(line)

        if head:
            inside = head[1].lower().startswith("[header]")
        elif inside and "=" in line and not line.lstrip().startswith("//"):
            key, rest = line.split("=", 1)
            found[key.strip()] = value(rest.lstrip(" \t="))

    return found


def goals(text: str) -> dict:
    """Every section in the file's order: all the names on its line (the first is its own, the
    others the events that bring it up, as FUN_0044a180 matches any of them), its buttons, its
    $Timeout and its inline commands such as <$Config,Done{mission.fileName}=1>."""
    found: dict = {"buttons": {}, "sections": []}
    sections: list[tuple[list[str], list[str]]] = []

    for line in text.replace("\r", "").split("\n"):
        head = HEAD.match(line)

        if head:
            sections.append((re.findall(r"\[([^\]]+)\]", head[1]), []))
        elif sections:
            sections[-1][1].append(line)

    for names, body in sections:
        buttons = [line[len("$Button="):].split(",") for line in body if line.startswith("$Button=")]
        timeouts = [line[len("$Timeout="):].split(",") for line in body if line.startswith("$Timeout=")]
        commands = [
            [part.strip() for part in command.split(",", 1)]
            for line in body for command in re.findall(r"<\$([^>]+)>", line)
        ]

        if buttons:
            found["buttons"][names[0]] = [[part.strip() for part in button] for button in buttons]

        found["sections"].append({
            "names": [name.lower() for name in names],
            **({"timeout": [part.strip() for part in timeouts[0]]} if timeouts else {}),
            **({"commands": commands} if commands else {}),
        })

    return found


def main() -> None:
    source, out = map(pathlib.Path, sys.argv[1:3])
    missions = json.loads(out.read_text())

    for mission in missions:
        path = source / f"{mission['file']}.english"

        # A chapter of the campaign (offical*.english) names itself on a line of its own.
        if path.exists() and mission["file"].startswith("offical"):
            title = re.search(r'^title\s*=\s*"([^"]*)"', path.read_bytes().decode("latin-1"), re.M)
            mission["header"] = {"title": title[1]} if title else {}

        if path.exists() and (mission.get("header", {}).get("missionType") or mission["file"] == "tell"):
            text = path.read_bytes().decode("latin-1")
            mission["header"] = header(text)
            mission["goals"] = goals(text)

    out.write_text(json.dumps(missions, indent=4) + "\n")


if __name__ == "__main__":
    main()
