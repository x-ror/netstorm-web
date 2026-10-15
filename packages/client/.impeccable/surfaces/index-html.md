---
version: 1
slug: "index-html"
primary_target: "index.html"
related_targets: ["src/ui/Hud.svelte","src/ui/Menu.svelte","src/styles.css"]
---

# Surface: game UI (menu + in-match HUD + context menu)

Scope: `index.html` styles, `src/ui/Menu.svelte`, `src/ui/Hud.svelte` and new context menu. Mode: Operate.
Task: pick a Fury/mission and start; in match read resources, build, act on the selected unit, open a right-click / long-press context menu (About, Upgrade with cost, produce, Pray/build by priest, cast, Meltdown, salvage).
Constraints: inlang messages only; keep data-testid; map stays PixiJS; mouse and tablet equal; must not look like a generic web dashboard.

## Direction contract

THESIS: The Furies are weather, so the interface is a synoptic weather chart laid over the storm. It refuses the dark-glass dashboard and the stock bottom console.

OWN-WORLD: Pale chart paper (#e9ede4) with faint isobar rings, navy chart ink (#2f3d5c). Front symbols are structure: a warm front (red semicircles) under the top strip, cold-front blue rules on panel tops, an occluded purple for Thunder. Fury hues (Sun amber, Wind teal, Rain blue, Thunder violet) are the only colour code, as a station-circle fill. Tabular figures everywhere. States are stamps (cooldown, short of Storm Power, max level). Sharp corners, no glass, no gradients.

STORY: A veteran recognises the right-click menu and Upgrade. A newcomer reads every number with a label and opens About on anything.

FIRST VIEWPORT: Top: a full-width paper strip with a warm front along its foot: Буресила (largest, tabular), energy with a ticked scale, clock; pause, sound and menu at the right. Left column of chart sheets, each with cold-front teeth: bridge slots, production as a chart legend (the card under the cursor lifts, its neighbours recede, blocked cards carry a stamp), and the selected unit as a station: its picture in a ring of its side's colour, HP, facts, actions. The log sits top-right, the minimap bottom-right. The context menu opens at the cursor: a header with the station, name, owner and HP; commands with costs; About expanding in place; destructive commands last, behind a dashed warm rule.

FORM: synoptic chart, candidate 5 of 7; seed c886df19. Raises: tabular figures (ikeda), focus-expands (streaming), isolated destructive (console), single hue code (saville), stamped states (ticket).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
