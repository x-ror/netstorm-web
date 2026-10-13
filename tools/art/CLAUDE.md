# NetStorm art kit — briefing for Claude

Read this file fully before doing anything. Then look at `guides/00_camera_guide.png` and, in the local folder,
`L/progress/game_screenshot_original.png`, `L/progress/overview.png` and `L/style/concept_sheet_*.png`.

## Where things are
- **`tools/art/` (this folder, in git):** the scripts, `data/assets_manifest.json`, `data/ludo_style.txt`,
  `style/anchor.png`, `guides/`, this file. Paths in this file are relative to it unless they start with `L/`.
- **`L/` = `original/generator/` (local only, not in git):** `refs/` (original game sprites, copyrighted), `out/` (results and
  `log.jsonl` history), `progress/` (screenshot of the real game, overview of all original sprites), `style/concept_sheet_*.png`, `.venv`.
  Never copy original sprites from there into git.
- Commands below are run from the repo root, with `PY=original/generator/.venv/bin/python`.

## Project
- Andrii is remaking the game **NetStorm: Islands At War** (1997) as a non-commercial fan project:
  same mechanics, story and levels, new graphics, runs in the browser (TypeScript + PixiJS),
  repo `x-ror/netstorm-web` on GitHub.
- This kit is about **new graphics** in a style called **"Elemental Isles"**:
  stylized hand-painted 2D fantasy, saturated colors, soft painted shading, clean readable silhouettes.
- **Direction (Andrii, 2026-10-13): every object gets a NEW, unique design with the same game function.
  Do not make a better copy of the original sprite.** The original only tells what the object does and how big it is.
  `L/style/concept_sheet_1.png` and `L/style/concept_sheet_2.png` are his first references, but he did not like the
  results generated from them; see Status for where the direction stands.
- Image generation tool: **Ludo.ai** (Andrii has an API key). ChatGPT image generation was also tried (see "Tool comparison").
- The API key lives in the repo's `.env` (gitignored) as `LUDO_API_KEY`. `ludo.py` reads it from there.
  Never print it or write it into other files, scripts, logs or commits.

## Start here
Run `$PY tools/art/ludo.py status` first. It prints the credit balance, every asset that has been touched,
all its versions with their verdicts, and the next `todo` asset. Then read `L/out/NNN_<id>/log.jsonl` of the asset you
will work on: it holds the exact prompt behind every version.

If the venv is missing: `python3 -m venv original/generator/.venv && original/generator/.venv/bin/pip install pillow`.

## Generating with Ludo (`ludo.py`)
```
$PY tools/art/ludo.py gen <id> --brief "what it does in the game + the new design idea" [-n 2] [--note "..."]
$PY tools/art/ludo.py gen <id> --from v5 --note "make the orb bigger"   # edit an earlier version
$PY tools/art/ludo.py verdict <id> vN "concrete verdict" [--status done]
```
- `gen` calls Ludo `POST /assets/image/style` with `style/anchor.png` as the style image and the prompt
  `data/ludo_style.txt` + `brief` + faction palette + size hint + `--note`. The original sprite is NOT sent.
  It saves `L/out/NNN_<id>/<id>_vN.png`, runs `check_asset.py` into `check_vN.png`, appends to `log.jsonl`
  and sets the manifest status to `in_progress`.
- `brief` is saved in the manifest, so pass `--brief` once per asset. Write it yourself: look at the ref, find what the
  object does in `docs/game-rules.md`, then invent a design that shows that function with one clear focal element.
  Do not describe the original's parts.
- `style/anchor.png` is five text-free objects cropped from `concept_sheet_2.png`. It has no terrain tiles on purpose:
  the sheets draw terrain isometric, and the game is not isometric (see Camera).
- `check_vN.png` now checks footprint (aspect vs the original) and readability at game size, not likeness.
- After every `gen`, open the `check_vN.png` files and record a `verdict` for each version, also for rejected ones.
- Cost: 0.5 credit per image. A job takes about 30 s. Ludo returns webp of varying size; the tool converts it to PNG.
- The shared style prompt is `data/ludo_style.txt`. Change it only for something that holds for every asset.
- Full API: https://api.ludo.ai/api-documentation/openapi.json (auth header `Authorization: ApiKey <key>`, async jobs,
  `GET /assets/jobs/{id}?wait=30`). Not wired in yet: `/assets/image/remove-background`,
  `/assets/sprite/rotate` and `/assets/sprite/animate` (for units).

Lessons so far:
- The prompt must say what the object is. With only a name and generic bullets the model invents something random
  on a painted background (`sunbattery_v3`).
- Colour words in the brief win over the faction palette: "dark grey-brown" turned the whole object black (`sunbattery_v4`).
- The style endpoint follows the anchor's look well and keeps the top-down oblique camera when the prompt states it
  (`sunbattery_v5`, `v6`). Aspect drifts more than with an edit of the ref (3–18% off), so check the footprint.
- A big glowing focal element is what survives the downscale to game size (`v5` reads, `v6` does not).

## How objects are made (agreed with Andrii 2026-10-13)
**3D models built by script, Ludo only for textures.** The generator draws no object and no animation frame.
```
PY=original/generator/.venv/bin/python
$PY tools/art/ludo.py texture <name> "material description"       # textures/<name>.png, 0.5 credit
blender -b -P tools/art/render.py -- tools/art/models/<id>.py OUT_DIR --scale 8 --frame 4
$PY tools/art/sheet.py OUT_DIR SHEET.png --game-px-per-render-px 0.125   # flatten + review sheet
```
- `models/<id>.py` builds the object from primitives (helpers are listed at the top of `render.py`).
  1 unit = 1 ground cell, so the footprint from `data/units.json` (`foot_x`, `foot_y`) is built exactly.
  Parts that stand still go under `BASE`, the part that turns under `TOP`, front toward -Y, axis on the origin.
  Example: `models/suncannon.py`. Every part gets a comment saying what it is for; no decorative parts.
- `render.py` renders `base.png` and `top_n/e/s/w.png` from the exact game camera (orthographic, 43.4 degrees,
  a cell is 16 x 11 px times `--scale`), all on one canvas with one anchor, and writes `sprite.json`
  (canvas size, anchor, pixels per cell). Layers and facings stack and swap with no offsets. Flat stepped
  shading plus an ink outline is the default look; `--plain` turns it off.
- `textures/` is the shared material library (in git, 512 px, prompts in `prompts.jsonl`): sandstone, bronze, oak,
  iron. Reuse them across objects so everything looks like one world; tint and tile size are set per model.
- Organic things a script cannot build (golem, crab, jellyfish): draw the design with `ludo.py gen`, turn it into
  a GLB with Ludo `POST /assets/3d-model` (`model: prop`, 4 credits, called by hand so far), and render the GLB
  with the same `render.py` (`--turn 90 --stretch 1.35` were needed for the test gun). Image-to-3D makes parts
  that point at the viewer too short and invents a cracked texture on hidden sides.
- Facing in the sim is 0..3 = N, E, S, W and turning is instant, so four facings are enough.
- Firing = code: the top layer recoils 2-3 px and returns; muzzle flash and smoke are one shared effect.
- Integration step 1 (not done): a script copies the flattened frames into the client under the keys it already
  draws (`suncannon:0..3` in `packages/client/src/texture-selection.ts`). Step 2 later: the client draws base
  and top as two sprites to get recoil.
- Walking units need walk cycles; not started.
- Blender 5.2 is installed with Homebrew (`blender` on PATH). I cannot see the scene live: render, look at the
  sheet, fix the script.

## Source assets (original game)
The original assets are unpacked in `original/all-assets/` (local, not in git):
- `sprites/<object>/NNN_<anim>_<frame>.png` — 4033 frames, 112 objects
- `sprites/index.json` — per object, per frame: `file`, `gif` (source animation), `frame`,
  `x`, `y` (draw offset = anchor; the sprite is drawn at position + (x, y)), `w`, `h`
- `ASSETS.md` — categories and in-game names
- `sounds/` (218 wav), `screens/` (title/menu gifs) — out of scope for now
- Animation names starting with `b_` are build/icon variants, `s_` are shadow layers.

This kit contains:
- `L/refs/NNN_<id>.png` — one reference frame per object (largest frame of its main animation), upscaled with nearest-neighbour. 103 objects, in work order.
- `data/assets_manifest.json` — for each object: number, id, in-game name, category, frame count,
  reference size in original pixels, status, ref path and a ready prompt.
- `guides/` — grey block-outs in the exact game projection (see Camera).
- `L/progress/` — `game_screenshot_original.png` (the real game) and `overview.png` (all original sprites).
- `ludo.py` — generate, log and review with Ludo (see "Generating with Ludo").
- `L/out/` — Ludo results per asset, with `log.jsonl` (prompts, jobs, verdicts).
- `render.py`, `sheet.py`, `models/`, `textures/` — the 3D route (see "How objects are made").
- `check_asset.py` — compare a generated image with the original (transparency, aspect ratio, tiling, game-size preview).
- `export_refs.py`, `make_camera_guides.py` — scripts that produced refs and guides.

## Camera — the most important rule
NetStorm is **NOT isometric**. It is an orthographic **top-down oblique** view:
- the ground grid is made of axis-aligned rectangles; a ground cell is **16 px wide × 11 px deep** on screen;
- all ground edges are perfectly horizontal or vertical on screen; no diamond shapes, no 45° rotation;
- we see the **top** of every object and only its **front (south) face**; no left/right side faces;
- vertical edges stay vertical, no perspective; light from top-left.
- Round objects become wide ellipses: the Challenge Ring is **1.64 : 1** (193×118 px).
Generators default to isometric. Always state the camera explicitly and, for tiles, paint over a block-out from `guides/`.

Known original sizes:
- island ground tile `isle`: 16×11; `islebig`/`platform`: 48×33
- bridge tile: 16×18 = deck 13 + front beam 3 + hanging posts 2. Bridges are MODULAR tiles joined in rows/columns, not one object.
- most structures/units/cannons sit on a 153×122 canvas; Challenge Ring 193×118.

## Style rules for every asset
1. Paint a NEW image. Never upscale/filter the original with code.
2. ONE object per image. No collages, sheets of different objects, labels, text or frames.
3. Transparent background, nothing cropped.
4. New design, same function. Keep only the original's footprint and rough proportions so it fits the game's layout;
   silhouette and parts are free.
5. Draw everything **intact and clean**: no cracks, chips, moss, dirt or damage.
   Damage is a separate overlay (same canvas, aligned 1:1, transparent, only cracks): 3 levels — light / medium / heavy,
   shown in game at ~66% / 33% / near 0% health.
6. Must read at real game size: strong contrast, dark front face/shadow so objects stand out from the grey-purple cloudy sky.
7. Generate large, then downscale to game size and align by the anchor from `index.json` — do this in code, not in the generator.
Faction palettes: Sun — gold, warm sandstone, brass, sunlight glow · Rain — icy cyan, frosted crystal, wet silver ·
Wind — weathered bronze, pale sand, sailcloth, airy swirls · Thunder — dark iron, deep crimson, violet lightning.

## Units and cannons
In the original they are pre-rendered 3D with 8–16 facing directions, each animated
(priest 334 frames, bulf 162, golem 64 walk = 8 directions × 8 frames). An image model cannot draw hundreds of consistent frames one by one.
Plan: one master design per unit, then rotations + animations via Ludo's direction/animation tools
("Change Direction", sprite animation, sprite sheets). Fallback: master design → image-to-3D → render 8/16 directions in Blender.
First test pending: golem (`L/refs/066_sunwalker.png`) in 8 directions + walk — does it stay the same character?

## Tool comparison so far (Challenge Ring, same brief)
- ChatGPT: keeps structure (double ring, 8 bridges, 8 gems) but drifted to grass/island material; gems too small at game size; soft painted look.
- Ludo: better material and readability (stone + bronze, big gems). Problems: 14 gems instead of 8, dropped the outer band
  and bridges, added cracks, thick black ink outlines (different look from ChatGPT).
- Do NOT mix tools in one asset set — the rendering styles differ. Pick one for everything. Ludo is preferred if units work.
- With Ludo choose perspective Top-Down or Tactical, never Isometric; use "Generate with Style" with the Elemental Isles concept as style anchor.

## Status
- **The art direction is not chosen yet.** Andrii rejected every attempt so far: the redraws of the original
  (bridge, Challenge Ring, Sun Generator `v1`–`v4`) and the first new designs in the concept-sheet style (`v5`, `v6`).
  He is testing world concepts in an external image generator. Do not mass-generate until he picks one; then replace
  `style/anchor.png` and rewrite `data/ludo_style.txt` for it.
- What he said about the tests (2026-10-13): plain fantasy tropes (castle tower, cannon, rock golem) all look the same;
  the "grown from coral and shells" sheet is nice by itself; the others look cool but do not say "battle in the sky".
- **Leading candidate (2026-10-13): grounded illustration.** Andrii asked for one object with every part described,
  a realistic design (not anime, not fantasy), understandable at a glance, drawn as an illustration (not a photo).
  The Stone Tower made this way got "more or less ok": `L/style/candidate_stone_tower_illustration.png`, made in
  Microsoft Designer from `data/brief_example_sunblocker.txt`. His one complaint: the iron spike on the roof had no
  clear purpose (the example file already has it removed). Lesson: every part must have an obvious job; do not add
  decorative parts. Not confirmed as the final style yet.
- Brief format that worked: one paragraph per part, top-level order
  object and purpose → shape → masonry/body → reinforcement → top → foundation → condition → style → camera.
- `style/anchor.png` is now the Stone Tower candidate and `data/ludo_style.txt` describes the grounded illustration.
  First Ludo test in this direction: `suncannon` `v1`, `v2` (verdicts in its `log.jsonl`). The design part works
  (clear, grounded, every part has a job). The rendering does not: Ludo's style endpoint gave a smooth 3D-render look
  instead of the anchor's hand-drawn illustration, with some perspective, and ignored the size hint (31-56% too wide).
- Second test (`suncannon` `v3`-`v5`): `gen --art-style Illustration --perspective "High Angle"` (text only, no anchor)
  gives a real ink-and-watercolour illustration and follows the brief part by part (`v4`, the best so far).
  Ludo's `Top-Down` perspective is a straight overhead plan with no front face (`v5`): do not use it.
  Editing a 3D-looking result with the anchor as reference gives an engraving with heavy outlines (`v3`).
  Still open: `High Angle` turns the object about 30 degrees, and all results are wider than the original footprint.
- Andrii on `suncannon_v4` (2026-10-13): the design is fine. No cannonballs or other ammunition, on any asset
  (now in `data/ludo_style.txt`). Open task: the gun must turn to four sides (N, E, S, W) to shoot.
- `suncannon` is the pilot of the 3D route: `models/suncannon.py`, renders in `L/out/054_suncannon/model/`,
  sheet `L/out/054_suncannon/_sheet_model.png`. Four facings, four openings in the parapet, gun on the axis.
  To improve: sandstone blocks do not follow the round wall (box projection), the iron turntable is light blue
  and reads like water, the crank is a dark blob. Waiting for Andrii's verdict.
- Cleanup 2026-10-13: superseded `suncannon` files were deleted. Kept in `L/out/054_suncannon/`: `suncannon_v4.png`
  (the design Andrii approved), `suncannon_base_v5.png`, `suncannon_top_s_v1.png`, `suncannon_top_3d_v1.glb`,
  `3d_toon/` and `_sheet_3d_toon.png`. `log.jsonl` still lists the deleted versions with their verdicts.
- Assets not listed here are `todo`. The old attempts were deleted on 2026-10-13; the lessons from them are above.
- Nothing is in the game yet: no output has been downscaled, anchored or copied into `packages/client`.
- Work order when it starts: terrain → decoration → structure → cannon → unit → projectile → effect → spell icons.

## How to verify every result (do this before calling anything done)
```
$PY tools/art/check_asset.py NEW.png ORIGINAL_FRAME.png --tile   # --tile for bridges/terrain
```
Check: transparent background; aspect within ~10% of the original; not isometric; seams invisible when tiled;
readable at game size next to the original; follows the rules above. Report problems concretely
("front face too thick", "14 gems instead of 8"), never just "redo".

## Working agreement
- One asset at a time, Andrii approves each one.
- Be honest about what is finished. Never report work as done when it is not, never pass off processed originals as redraws.
- Outputs live in `L/out/<NNN>_<id>/<id>_vN.png`; `ludo.py` names them and keeps `status` in `data/assets_manifest.json`.
