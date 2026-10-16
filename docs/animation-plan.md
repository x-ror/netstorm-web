# Animation improvement plan

> Historical: implemented in Phase 3, see [animation-results.md](animation-results.md). The comparison toggle of §0 served its measurement and was removed at merge.

## Phase and scope

Phase 1 analysis is approved. This is the Phase 2 proposal, based on the findings in [animation-analysis.md](animation-analysis.md). Implementation requires a separate approval.

All changes belong to the client presentation layer. Keep existing sprites, assets, simulation state, hitboxes, commands, targeting, damage, cooldowns, construction completion, replay format and fixed-step scheduling unchanged. Do not alter the simulation's five-step catch-up policy to improve visual pacing.

Entity interpolation already exists, including flyers. Extend and correct it rather than replace it wholesale. The projection is rectangular oblique 16×11, not diamond isometric.

## Priority and delivery order

The order balances visible impact against change scope and risk. Each numbered improvement is a separate Conventional Commit with its own regression checks. The comparison toggle and baseline precede visual changes so every improvement can be compared.

| Order | Improvement | Expected visual impact | Relative effort | Could affect gameplay? |
| --- | --- | --- | --- | --- |
| 0 | Comparison toggle and repeatable baseline | Enables trustworthy comparison | Small | No intended effect; must not alter commands, random state or stepping. |
| 1 | Preserve presentation across catch-up and pause/resume | High: fewer jumps and missing actions | Moderate | No mechanics changes; event/audio dispatch must remain exactly once and in order. |
| 2 | Correct impact burst initialization | High for short impacts | Small | No; retain existing impact tick and burst lifetime. |
| 3 | Interpolate missiles, Energy bolts and streams | High: removes prominent 10 Hz stepping | Moderate | No mechanics changes; visual arrival must not imply early or late damage. |
| 4 | Attach health bars to rendered positions | High for moving damaged units | Small | No; selection and input footprints remain authoritative. |
| 5 | Correct depth at displayed positions | High in overlapping scenes, pending reproduction | Moderate | No; never change collision, occupancy or hit testing. |
| 6 | Small visual animation utility and per-entity states | Medium/high: coherent walking and turning | Moderate | No; attack/ritual/production timing stays simulation-driven. |
| 7 | Hit feedback and construction/placement polish | Medium/high | Moderate | No mechanics changes; damage and completion must not be delayed or concealed. |
| 8 | Camera smoothing with pixel-stable presentation | High during navigation, subjective trade-offs | Moderate | No mechanics changes; input mapping can regress and needs explicit checks. |
| 9 | Optional movement/turn/arc accents, pulses and particles | Medium, subjective | Moderate | No mechanics changes; can visually misrepresent position, range or timing, so constrained and gated. |
| 10 | Results and architecture documentation | Records verified behavior | Small | No. |

### 0. Comparison toggle and baseline

- Add a debug-only switch for legacy versus improved animation presentation, accessible through the existing match debug surface. Exclude it from simulation state, saved matches and replay data.
- A switch must rebuild/rebase presentation from the current read-only world without stepping the simulation, issuing commands, duplicating sounds or replaying old effects.
- Use identical replay commands and starting state for comparisons; record visual settings, browser, hardware, viewport, device pixel ratio, zoom and entity/effect counts.
- Establish baseline renderer/frame-time measurements before implementing the expensive parts. Keep baseline measurements available throughout the series.

### 1. Catch-up-safe tick capture and pause handling

Addresses A2 and A4. Relevant boundaries: `packages/client/src/match.ts:142-146,226-246,316-334`; `packages/client/src/renderer.ts:474-478,958-986`.

- Separate capture of each completed simulation tick from per-frame presentation. Capture adjacent previous/current render samples, shot detection, turn progression and transient event data for every catch-up step, not just the last observed frame.
- Copy the minimal render data needed for each sample; the live read-only world is not a historical snapshot. Retain enough entity/target placement data for effects whose source or target is removed during a tick.
- Preserve existing command delivery and simulation step order. Consume each event once; multiple capture calls must not replay audio or duplicate effects.
- Freeze the displayed pose on pause, then resume/rebase without moving backward when clock alpha resets. Apply the same policy to hidden-tab suspension and mission-induced pauses.
- Do not replay missed wall time after a hidden tab or unboundedly queue intermediate visual samples. Expired effects should remain expired rather than run a backlog on resume.

### 2. Impact burst initialization

Addresses A6: `packages/client/src/renderer.ts:525-528,707-729,893-938`.

- Initialize a new impact burst's first texture in the same presentation update in which it is created.
- Keep the original impact timestamp, number of frames and expiry; do not extend duration to compensate for the previously skipped first frame.
- A display stalled past the first frame should show the effect at its correct current age, not rewind to show missed frames.
- Verify shell impacts, ordinary missiles, Whirligig bombs, death bursts and spell bursts independently.

### 3. Continuous projectile and stream presentation

Addresses A1: `packages/client/src/renderer.ts:531-702,803-938`.

- Use fractional presentation progress for missile/Energy-bolt positions and stream streaks. Keep launch, landing and expiry anchored to captured tick timestamps.
- Preserve the current interpolation latency for entities; define projectile sampling on a consistent timeline without extrapolating targets or changing authoritative landing ticks.
- At the landing tick, the missile must end at its recorded endpoint and the impact must appear once. Short flights, catch-up and removed targets need explicit coverage.
- Existing sprite sequences keep their current cycle/one-shot duration initially. Delta time should improve continuous transforms, not arbitrarily speed up sprite playback or invent original frame rates.
- Limit stream work to currently visible emissions rather than scanning its entire emission history. Keep static terrain, pathfinding and other tick-only work out of per-frame updates.

### 4. Render-attached health bars

Addresses A3: `packages/client/src/renderer.ts:496-499,975-985`; `packages/client/src/controls.ts:607-640`.

- Position health bars using the same rendered pose and frame anchor as the owning sprite. Keep HP values authoritative.
- Separate moving health-bar drawing from the shared tick-generated effect geometry so one update does not erase the other.
- Keep selection/hover footprints and path markers grid-accurate by default. Do not move hitboxes or selection tests to interpolated coordinates.

### 5. Depth ordering for the implemented projection

Addresses A7: `packages/client/src/renderer.ts:403-405,465-487,975-985`.

- Reproduce moving crossings and attachment interleaving first. Use displayed ground-contact depth for moving entities and footprint depth for stationary buildings.
- Keep an entity's base and attached overlays/shadows ordered coherently; use a stable tie-break where depths are equal.
- Preserve ground, air, effects and UI layer intent. Do not globally substitute `x + y` sorting or move flying shadows to a new layer without verified scene evidence.
- Check large buildings, geysers, bridge landings, close flyers, temple overlays and effects crossing units. Only add broader sorting/grouping changes if the reproduced defects require them.

### 6. Reusable visual timing and entity animation states

Addresses A5: `packages/client/src/animations.ts:165-172,240-478`.

- Introduce a small client-only utility when multiple features need it, not a general animation framework or new dependency. Cover elapsed progress, easing, completion/cancellation and cleanup.
- Separate gameplay-coupled presentation time from cosmetic elapsed delta time. Gameplay visuals freeze with the match and respect discarded clock time; camera/UI movement may continue while paused.
- Track per-entity presentation states such as idle, walking, turning, firing, constructing and ritual where the type supports them. Centralize state-entry phase, precedence and cleanup on removal.
- Preserve existing slot groups, hotspot anchors and turn frames. Turn progression must depend on elapsed game time, not number of render calls.
- Keep firing/charge/ritual/production sequences synchronized to authoritative state. Do not wait for a visual turn or transition before showing an actual shot.
- Retain existing sequence durations until original durations are verified or a clearly labeled visual approximation is approved. More frequent rendering alone does not add frames to low-frame-count art.

### 7. Hit feedback and construction/placement polish

Addresses A9: `packages/client/src/renderer.ts:352-368,483-487,704-764,1068-1092`; `packages/client/src/controls.ts:437-515`.

- Add short damage tint feedback based on captured HP decreases, restoring ownership tint and preserving invisibility/HP alpha. Healing must not trigger a damage flash.
- Add restrained construction progress feedback using existing sprites and read-only progress. A completed building must look operational at its existing completion tick.
- Give new building/bridge placement a bounded presentation accent without hiding usable terrain, moving the logical footprint or delaying placement feedback.
- Keep existing explosions, spell effects and Storm Power streams; enrich rather than replace them.
- Ensure chained priests, carried crystals, invisible entities and regrowing buildings retain their current visibility rules.

### 8. Smooth camera without sacrificing input correctness

Addresses A8: `packages/client/src/camera.ts:4-64`; `packages/client/src/controls.ts:315-413`; `packages/client/src/minimap.ts:132-149`.

- Replace key-repeat-driven pan jumps with delta-time-based navigation; add restrained easing/inertia while keeping direct pointer drag responsive.
- Keep an unsnapped motion target and snap the final camera translation to physical pixels. Hover, placement, minimap viewport and cursor-centered zoom must use the camera transform actually displayed.
- Keep crisp discrete zoom as the default. Offer eased zoom only as an opt-in comparison: finish on an existing snapped zoom level and acknowledge intermediate nearest-neighbor pixel crawl.
- Preserve minimap immediate targeting by default and cancel motion appropriately on blur, hidden-tab suspension and match teardown.
- Honor reduced motion; camera inertia, shake and continuous zoom must be suppressible independently of gameplay.

### 9. Optional accents after the core fixes pass validation

- Movement start/stop: prefer animation-phase or small visual-body accents over easing authoritative travel. Never let accumulated visual lag move feet across an impassable tile or hide a stop.
- Turning: use existing directional/turn frames; do not rotate the whole oblique-view unit sprite as if it were top-down art.
- Projectile arcs: add only a bounded visual height offset with unchanged start/end times and endpoints. Do not imply a new trajectory, range, collision or target behavior.
- Add restrained alpha/scale pulses and bounded simple particles using existing textures or code-drawn primitives; no new art or edited sprite files.
- Screen shake is optional and reduced-motion aware. Apply it only to presentation, with input mapping matched to the visible camera.
- Cap active effects, reuse resources, and cancel them on entity removal/match teardown. Reject accents that obscure tactical information or exceed the measured performance gate.

## Validation and acceptance criteria for Phase 3

Use the existing test runners and browser smoke infrastructure, adding regression cases there rather than introducing a new toolchain.

1. **Determinism and gameplay:** replay identical commands with improvements on/off; compare world hashes at equal simulation ticks, event order/count, shot launch/landing ticks, construction completion and selection/placement commands. Confirm no simulation source, version constants or sprite assets changed.
2. **Timing:** cover 30, 60 and 144 FPS frame schedules, irregular frame intervals, multi-step catch-up, severe stalls beyond the clock cap, pause/resume and visibility suspension. Test helpers at identical game timestamps. Under discarded wall time, compare animation against simulation time, not an impossible promise of unchanged wall-clock simulation speed.
3. **Visual review:** use repeatable walking/turning, damaged-unit, overlapping-building/flyer, combat, construction, bridge and spell scenes. Verify attachment alignment, first-frame initialization, exact-once impact, stable ordering and no pause rewind.
4. **Pixel/input review:** check DPR 1, 1.5 and 2 where available, each existing zoom level, drag, keyboard pan, wheel/pinch zoom and minimap navigation. Verify pointer targeting against the displayed transform; compare crisp and optional eased zoom explicitly.
5. **Performance:** measure warmed-up, alternating on/off runs in the same idle, crowded combat and construction scenes. Record main-thread renderer CPU time, total frame-time median/p95, missed frame budgets, allocations and effect counts. Repeat under a documented CPU throttle. FPS caps or average FPS alone cannot prove unchanged frame cost.
6. **Performance gate:** agree the measurement environment and noise-based regression threshold before implementation. “No measurable cost” means no repeatable regression outside baseline variation, not zero work. If a feature exceeds the threshold, optimize, disable/defer it or request approval; do not claim success from inconclusive measurements.
7. **Existing checks:** run `npm run check` and `npm run test:browser` for implementation commits, plus secret scanning and automated review/security validation. A documentation-only plan does not require runtime test execution.
8. **Results:** create `docs/animation-results.md` in Phase 3 with per-commit changes, comparison instructions, test matrix, actual measurements, limitations and unresolved issues. Update stale interpolation/event-flow descriptions in the architecture documentation when the corresponding implementation is finalized.

Synthetic frame schedules establish timing behavior, not physical high-refresh display quality. Distinguish actual display observations from emulation and report unavailable hardware/browser checks as unverified.

## Decisions proposed for approval

- Preserve current sprite durations until evidence or explicit approval supports different ones.
- Keep grid-accurate selection and discrete crisp zoom as defaults.
- Make eased zoom, screen shake and decorative accents optional; prioritize confirmed defects first.
- Agree the performance measurement environment/threshold before calling any implementation performance-neutral.

**Approval gate:** approve or amend this plan before Phase 3. This document does not authorize implementation by itself.
