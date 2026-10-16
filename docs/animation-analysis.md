# Animation analysis for netstorm-web

## Scope and evidence

Phase 1 only: source inspection, not implementation or the Phase 2 plan. No simulation, runtime code, sprite files, or art assets were changed.

Source references below describe revision `ad778e7995c30ce09599a5c3537bb693e35d78dc`; paths are relative to the repository root. **Confirmed** means the behavior follows from the inspected code, not that its visual severity has been measured. **Risk** means a scene must reproduce it before treating it as a visible defect. No browser/FPS/CPU-throttling tests or frame-time measurements were performed for this analysis.

Two important corrections to the earlier analysis:

- Flyers **are** position-interpolated, as are ground units and their attached overlays/shadows.
- The implemented projection is an oblique rectangular 16×11 grid, not diamond isometric projection. Use its screen-depth convention, not an assumed `x + y` isometric sort key.

## Animation-related code map

| Area | Source and responsibility |
| --- | --- |
| Scheduling and event dispatch | `packages/client/src/match.ts:117-118,142-146,226-246,316-375`: fixed-step clock, pause/visibility handling, effect events, per-frame sync, periodic HUD/minimap refresh. |
| Simulation timing and movement inputs | `packages/sim/src/state.ts:3`; `packages/sim/src/clock.ts:7-48`; `packages/sim/src/world.ts:610-660`; `packages/sim/src/rules/movement.ts:18-76`: tick rate, accumulator, deterministic steps, fixed-point movement progress. Read for context only. |
| Sprite frames and direction/state | `packages/client/src/animations.ts:34-163,165-172,240-478`: loops, directional walk/turn rings, cooldown-driven attacks, altar/ritual states, overlays, shadows. |
| Entity placement and interpolation | `packages/client/src/renderer.ts:333-529,958-1024`: sprite lifetime, anchors, attachments, health bars, previous/current rendered positions, depth. |
| Missiles and transient effects | `packages/client/src/effects.ts:7-91`; `packages/client/src/renderer.ts:704-948`: burst definitions, bearings, shots, beams, spell/death/impact effects. |
| Construction and Storm Power | `packages/client/src/animations.ts:210-225,240-249,301-308`; `packages/client/src/renderer.ts:352-368,531-702`: construction-dependent slots, completion sound, Energy bolts and path-following streams. |
| Terrain and bridges | `packages/client/src/renderer.ts:151-279,958-968`; `packages/client/src/texture-selection.ts:49-95`: static bridge/link/strength pictures, landing/rim layering, revision-triggered terrain rebuild. |
| Placement and selection | `packages/client/src/controls.ts:437-515,607-640`: bridge ghosts, building footprint/aim preview, selection outlines and paths. |
| Camera and projection | `packages/client/src/projection.ts:1-17`; `packages/client/src/camera.ts:4-64`; `packages/client/src/controls.ts:278-435`; `packages/client/src/minimap.ts:132-149`: coordinate mapping, zoom, drag, keyboard pan, minimap recentering. |
| Texture/frame pipeline | `packages/client/src/assets.ts:12-33,77-93`; `packages/client/src/slots.ts:1-78`; `packages/client/src/texture-selection.ts`; `packages/client/atlas.ts:215-230`; `scripts/anim-frames.py:1-66`: existing slot inventory, hotspot offsets, nearest sampling, atlas spacing. |
| UI motion | `packages/client/src/menu.ts:17-34`; `packages/client/src/ui/Menu.svelte:59-65,124-141`; `packages/client/src/hud.ts:29-49`; `packages/client/src/ui/Hud.svelte:25-59`; `packages/client/src/styles.css:71-78,206-261,324-325,946-949,1165-1184`: CSS transitions/keyframes and immediate component visibility/state changes. |

## How it works now

### Time: fixed simulation, partial render interpolation

- `TPS = 10`, so a simulation step is 100 ms (`packages/sim/src/state.ts:3`). `FixedStepClock.advance()` accumulates elapsed milliseconds, executes whole steps and exposes the remaining fraction as `alpha` (`packages/sim/src/clock.ts:24-44`).
- Pixi's ticker supplies `t.deltaMS` to that clock. The client performs **all** due simulation steps before draining events and calling `renderer.sync(clock.alpha)` once (`packages/client/src/match.ts:322-334`).
- The renderer updates entities, slots and effects only when `world.tick` changes. Every render frame then interpolates non-footprint entity positions between two cached screen points (`packages/client/src/renderer.ts:970-986`). This includes flyers: `unitSpot()` uses their fixed-point `px/py`, and they have no building/geyser footprint (`packages/client/src/renderer.ts:999-1023`).
- Ground movement already uses `stepShare(entity)` to position a unit partway along its next path segment before interpolation (`packages/client/src/renderer.ts:1004-1008`). Units do **not** simply teleport one whole tile per tick.
- Ordinary tick-based frame selection is independent of display FPS at a fixed simulation pace; it is **not** a “one animation step per browser frame” bug. However, sprites and non-interpolated effects normally change only at 10 Hz.
- Catch-up is deliberately bounded to five steps, discarding excess accumulated time (`packages/sim/src/clock.ts:11,29-38`). Severe stalls can therefore slow simulated time relative to wall time. This existing scheduling policy is not an animation defect to fix by changing mechanics.
- Pausing resets the clock; visibility changes reset it too, and hidden documents skip ticker work (`packages/client/src/match.ts:142-146,316-334`). There is no separate continuous visual clock or reusable tween utility in these inspected paths.

### Sprite frames, direction and state

- Frames are named slots from the original `.type` files; the current animation code explicitly says original frame rates are not read (`packages/client/src/animations.ts:1-5`). Existing comments marked `?` are assumptions, not verified original timing.
- Ambient loops use `tick % count`, including flyers, rain walkers, balloons, crystals and several buildings. Entities of the same looping type share a global phase (`packages/client/src/animations.ts:36-49,318-326,349-354`).
- Golem/Priest use eight directional walk groups; Bulf/Sail Skater use four groups with diagonal mappings. The next path cell selects heading; the last heading is retained at rest (`packages/client/src/animations.ts:59-87,362-396`). Walking starts at the current global tick phase, while stopping selects the group's first frame.
- Bulf/Sail Skater and some guns already have turn sequences. `turnTo()` advances one ring position per call, by the shorter route; other direction changes select a group immediately (`packages/client/src/animations.ts:165-172,259-279,369-383`).
- Attack pictures use facing, target, cooldown and tick-derived charge/fire indices rather than a general entity animation state machine. Priest floating, chanting and altar capture/sacrifice have explicit branches (`packages/client/src/animations.ts:240-478`).
- The renderer falls back from a missing slot to a static texture, or initially to a geometric marker. It recalculates anchors from each frame's hotspot so differently cropped frames retain a shared attachment point (`packages/client/src/renderer.ts:415-448`). Shadows use a slot offset; temple whirls, charging guns and other overlays are separate sprites (`packages/client/src/animations.ts:181-185,414-478`).

### Projectiles, effects, construction and bridges

- A cooldown increase is interpreted as a shot. When available, the visual missile duration comes from the simulation shot's landing tick (`packages/client/src/renderer.ts:803-837`). Missiles move on straight screen-space lines with tick-only progress; bearings and frame selection come from `missileSlot()` (`packages/client/src/effects.ts:69-75`; `packages/client/src/renderer.ts:842-938`). Bombs start above their target plane, but there is no curved trajectory.
- Explosions are **present**, not missing: death events call `explode()`, and missiles/shells create impact bursts. Spells have heal, gravitation, meteor, blast and lightning representations (`packages/client/src/match.ts:226-234`; `packages/client/src/effects.ts:14-37,77-90`; `packages/client/src/renderer.ts:704-764,893-948`).
- Burst age is `world.tick - start`, one slot per tick. Lightning is a rotated/stretched existing texture held for two ticks (`packages/client/src/renderer.ts:60-61,711-729,875-890`).
- Storm Power is **present**: an Energy bolt moves toward a construction site; stream streaks travel along a path cached at construction start. Bolts and streaks advance only on ticks (`packages/client/src/renderer.ts:531-702`).
- Construction checks `rising`/`regrow`, holds many buildings at a static frame, has altar-specific stages and plays completion audio. There is no generic construction reveal, placement easing or progress-scaled visual transform (`packages/client/src/animations.ts:210-225,240-249,301-308`; `packages/client/src/renderer.ts:352-368,469-487`).
- Bridge whole/cracked/hard appearances are static choices based on connectivity/strength. A terrain revision destroys/recreates terrain sprites; there is no placement/drop/crack/fall transition (`packages/client/src/renderer.ts:154-179,958-968`; `packages/client/src/texture-selection.ts:49-95`). Preview bridge sprites are also rebuilt immediately (`packages/client/src/controls.ts:444-455,493-513`).

### Depth and pixel stability

- Projection is `sx = x * 16`, `sy = y * 11` (`packages/client/src/projection.ts:8-17`). Scene layers are terrain graphics → ground → entities → bars → ghosts → selection overlay (`packages/client/src/match.ts:98-107`). Ground decorations/bridge landings have explicit insertion order (`packages/client/src/renderer.ts:239-248`).
- Entities enable Pixi child sorting. Non-flyers use their tick-position `sy`; building/geyser placement accounts for footprint and sprite hotspot. Flyers use the constant `AIR_Z = 1e6`. Attachments use base depth ±0.5; missiles and many effects also use `AIR_Z` (`packages/client/src/renderer.ts:108,130,350,403-405,465-487,621,743-761,852,889`).
- Per-frame interpolation moves the base/overlay/shadow positions, **not their depth keys** (`packages/client/src/renderer.ts:975-986`). No explicit equal-depth entity tie-break or atomic base/overlay grouping is implemented here. This does not by itself prove flicker.
- Atlas textures use nearest sampling and one-pixel packing gaps; Pixi disables antialiasing, uses device resolution and enables `roundPixels` (`packages/client/src/assets.ts:19-20,77-78`; `packages/client/atlas.ts:215-218`; `packages/client/src/match.ts:72-82`). Blurred sprite sampling is not established by this review.
- Zoom levels are 0.5/1/2/3/4 physical-pixel scales, divided by device pixel ratio (`packages/client/src/camera.ts:4-23`). The half-scale option is deliberately downsampled, not an integer enlargement.

### Camera and UI

- Dragging writes camera coordinates directly; keyboard panning adds a fixed step per keydown/repeat event, not per render delta. Wheel/pinch zoom selects the next discrete level immediately around the cursor. Minimap dragging recenters immediately (`packages/client/src/controls.ts:315-339,383-386,394-413`; `packages/client/src/camera.ts:39-48`; `packages/client/src/minimap.ts:132-149`).
- There is no camera velocity, inertia or easing. Camera translation is not explicitly snapped in those setters; pixel rounding is delegated to rendering. Nearest sampling and discrete zoom reduce artifacts but cannot establish shimmer-free motion on every DPR/zoom combination without observation.
- UI already uses elapsed-time CSS transitions: title descent/opacity, plate entry, button/card hover and a 140 ms context-menu entry. Title/plate/context entry honor reduced motion (`packages/client/src/styles.css:71-78,206-261,946-949,1165-1184`). These are not tick-driven.
- HUD and minimap periodically refresh every five ticks (500 ms), with additional event-driven updates. Selection/path outlines redraw when simulation steps occur, not during each interpolated frame (`packages/client/src/match.ts:38,340-349`; `packages/client/src/controls.ts:607-640`). Menu exit and HUD page visibility change immediately (`packages/client/src/menu.ts:30-34`; `packages/client/src/ui/Hud.svelte:44-59`).

## Concrete findings

### A1 — Confirmed: projectiles and construction streams move at tick cadence

`packages/client/src/renderer.ts:525-528,573-582,674-699,893-923,970-986`.

Only entities in `glides` are position-interpolated. Missile/Energy-bolt progress and stream geometry use integer ticks; a 60 or 144 FPS display repeats their positions between 100 ms updates. This is temporal stepping, not an FPS-dependent nominal speed. Beam/burst frame cadence is similarly tick-quantized.

### A2 — Confirmed: catch-up loses intermediate visual samples and actions

`packages/client/src/match.ts:330-334`; `packages/client/src/renderer.ts:474-478,711-715,773-774,813-834,970-973`; `packages/client/src/animations.ts:165-172`.

Multiple simulation steps can precede one render sync. The next glide then spans the last **observed** tick to the final state, but consumes one tick's `alpha`; it is not a previous/current simulation-tick pair. A two-step catch-up can compress a two-tick displacement into that interpolation interval. Turn rings advance only once per observed update; cooldown comparisons can miss a shot whose increase has already counted down below the previous observation. Effects age by the skipped ticks. This is a low-FPS/stall risk even when deterministic simulation proceeds correctly.

### A3 — Confirmed: bars and selection do not follow interpolated units

`packages/client/src/renderer.ts:496-499,975-985`; `packages/client/src/controls.ts:607-640`; `packages/client/src/match.ts:340-349`.

Health bars are drawn at current-tick positions, while the unit glides from an older position. The code itself notes that mismatch. Selection/hover outlines derive from grid footprints, not the interpolated sprite, and paths redraw per step. The displacement is code-confirmed; whether selection should instead remain an honest grid indicator requires a presentation decision.

### A4 — Confirmed: resetting the clock can rewind the displayed glide

`packages/client/src/match.ts:142-146,316-334`; `packages/sim/src/clock.ts:41-47`; `packages/client/src/renderer.ts:970-985`.

Pause resets `alpha` to zero without clearing/rebasing cached endpoints. If a moving sprite was partway from `from` to `to`, the next same-tick sync places it back at `from` and freezes it there. Visibility resets can cause the same issue when no new tick occurs before the next visible sync.

### A5 — Confirmed: animation phase and transitions are mostly immediate/global

`packages/client/src/animations.ts:36-49,165-172,337-396,436-456`.

An idle walker enters the walk cycle at `tick % frames`, not at a state-relative phase, then stops at the group's first frame. Golem/Priest facing changes jump groups; other units have turn rings but continue their independent simulated movement while the turn pictures play. Same-type loops are synchronized. No general entry/exit transition or per-entity elapsed animation phase exists. Whether an added transition matches the original is **unknown**; existing turn animations should not be described as absent.

### A6 — Confirmed: projectile-created impact bursts skip their first frame

`packages/client/src/renderer.ts:525-528,707-729,835-837,910-912,925-928`.

`playEffects()` runs before `drawTracers()` → `fly()`. An impact queued by `fly()` at tick T is first visited by `playEffects()` at T+1, where its age is already 1. There is no second effect update during same-tick renders, so slot zero of that burst is never shown. Death/spell bursts queued before sync do not necessarily have this ordering problem.

### A7 — Risk: depth changes are ahead of displayed positions; attachments can interleave

`packages/client/src/renderer.ts:403-405,469-487,975-985`.

Depth keys use destination-tick Y while positions interpolate. A moving unit can change which side of another object's depth it occupies before its displayed feet cross that point. Attachments are independent sorted children at ±0.5, so another entity with an intermediate depth can split a base/overlay/shadow stack. Constant air/effect depths have no explicit spatial tie-break. Reproduce moving crossings, wide footprints, close flyers and temple overlays before asserting visible wrong ordering or flicker; neither was visually verified.

### A8 — Confirmed camera discontinuities; shimmer remains a risk, not a finding

`packages/client/src/camera.ts:13-23,32-48`; `packages/client/src/controls.ts:315-339,383-413`.

Keyboard pan jumps per OS key-repeat event; zoom jumps levels. Neither is an FPS-based animation, but both lack a continuous motion profile. Fractional CSS translations, DPR changes and the half-scale zoom need visual checks for pixel crawl. Existing nearest sampling/rounding are intentional protections. Continuous zoom would pass through non-integer pixel scales, trading crispness for smoothness; it is not automatically an improvement.

### A9 — Confirmed polish gaps, not missing core effects

`packages/client/src/renderer.ts:483-487,704-764,1068-1092`; `packages/client/src/effects.ts:14-90`.

Existing bursts, beams and streams provide feedback, but entity tint depends on ownership rather than recent damage; alpha depends on HP/invisibility. These paths have no transient hit flash, shake, scale pulse or particle layer. Buildings/bridges also lack a generic placement/construction transition. Describing these effects as “flat” is subjective until observed; changing animation duration or delaying an impact would risk misrepresenting gameplay timing.

### A10 — Confirmed performance pressure points; no frame-cost claim yet

`packages/client/src/renderer.ts:154-165,674-680,970-986`; `packages/client/src/controls.ts:444-455`.

Terrain changes rebuild every terrain sprite; overlay redraws recreate ghost sprites. Stream drawing scans every historical emission from its start, skipping expired streaks only after entering the loop, so work grows with stream age. These are potential baseline costs, not measured bottlenecks. Per-frame effects/sorting could add cost; “no measurable frame-time cost” is not established.

### A11 — Confirmed: architecture text is stale about interpolation

`docs/architecture.md:48,72` versus `packages/client/src/match.ts:330-334` and `packages/client/src/renderer.ts:970-1008`.

The architecture document says movement interpolation is absent, despite the implemented glides. It also describes per-step event draining, whereas the current match loop drains after the complete catch-up batch. This analysis follows executable code. Those sections were not edited as part of the requested Phase 1 findings file.

## Existing validation and limits

- `packages/client/test/client.test.ts:291-461,519-555` checks shipped frames, headings, turning, overlays and missile/burst definitions. It does not establish per-frame renderer smoothness or depth correctness.
- `packages/sim/test/runtime.test.ts:16-49,169-172` checks clock accumulation/catch-up/reset, equivalent timing hashes and interpolation inputs, not displayed sprite positions.
- `scripts/smoke-browser.mjs:154-180` checks minimap interaction, replay and match teardown among other smoke behaviors. It does not demonstrate equivalent animation at 30/60/144 FPS or under CPU throttling.
- Existing commands are `npm run check` and `npm run test:browser` (`package.json:18-20`). No runtime suite was run for this documentation-only revision; no simulation invariants, visual quality measurements or performance results are claimed from such a run.

Open questions before design: Are original per-type frame durations available/required, or may their timing be an explicitly approved visual approximation? Should selection outlines remain grid-accurate? Should crisp stepped zoom remain the default? What repeatable scene, hardware/browser/DPR and measurement threshold define “no measurable cost”? These choices need approval rather than invented original behavior.

## Summary and approval gate

The highest-confidence issues are tick-stepped projectiles/streams, lost intermediate presentation during catch-up, non-gliding bars, pause-reset rewinds and first-frame loss for impact bursts. Entity interpolation and core explosion/spell/Storm Power effects already exist. Depth flicker, camera shimmer and performance severity remain unverified runtime risks.

This completes Phase 1 source analysis only. Wait for approval before writing `docs/animation-plan.md` or implementing any visual changes; do not change simulation state, hitboxes, gameplay timing or art.
