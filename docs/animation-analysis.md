# Animation analysis for netstorm-web

## Scope reviewed
Animation-related code was reviewed in:
- `packages/client/src/animations.ts`
- `packages/client/src/effects.ts`
- `packages/client/src/renderer.ts`
- `packages/client/src/match.ts`
- `packages/client/src/camera.ts`
- `packages/client/src/minimap.ts`
- supporting input/UI code in `packages/client/src/controls.ts` and `packages/client/src/ui-state.ts`

## How animation works today

### Simulation and render timing
- The game simulation runs on a fixed-step clock: `FixedStepClock(TPS)` in `packages/client/src/match.ts` advances the world in discrete simulation ticks.
- Rendering runs every browser frame, and `renderer.sync(clock.alpha)` interpolates some entity positions between the previous and current tick.
- Most other visual state is still tied to simulation ticks rather than elapsed frame time.

### Sprite frame selection
- `packages/client/src/animations.ts` is the main frame-selection table.
- Its top-level comment says one frame is shown per tick, and the original frame rates are not read.
- Walker, building, projectile, spell, and overlay frames are selected mostly with `tick % N` or tick-derived counters.
- Direction is usually encoded through discrete heading/facing indexes, not smooth rotation.

### Movement and interpolation
- Ground units are rendered at an interpolated position using `stepShare(entity)` plus the fixed-step `alpha` in `renderer.sync()`.
- Flyers use exact simulation coordinates, so their apparent smoothness depends on how often the sim updates their position.
- Walkers visually snap between heading/turn states using discrete turn rings in `animations.ts`.

### Depth sorting
- The client uses `entityLayer.sortableChildren = true` and sets `sprite.zIndex = entity.kind === 'flyer' ? AIR_Z : sy`.
- This gives a mostly correct isometric ordering by screen Y, with a fixed override for flyers.
- Overlays and shadows are attached as separate sprites layered relative to the base entity sprite.

### Camera
- `camera.ts` deliberately snaps zoom to a small set of discrete levels to preserve crisp pixels and avoid shimmer.
- Camera panning is immediate, not eased.
- `match.ts` uses `roundPixels: true`, reinforcing pixel stability over subpixel smoothness.

### Effects
- Missiles, explosion bursts, spell bursts, and lightning are all implemented as short-lived sprite runs in `renderer.ts` and `effects.ts`.
- Their timing is tick-driven; each frame advances once per simulation tick.
- Visual richness currently comes from existing art frames, plus some straight-line motion and simple visibility changes.

## Concrete problems found

### 1) Visual timing is still largely tied to ticks, not frame time
- `packages/client/src/animations.ts:1-5`
- `packages/client/src/effects.ts:1-5`
- `packages/client/src/renderer.ts:894-923`

Most animation state advances on tick boundaries. That is deterministic, but it also means uneven browser frame pacing can show as visible stepping in frame selection, projectile animation, and one-shot effects.

### 2) Movement smoothing is partial and inconsistent
- `packages/client/src/renderer.ts:975-986`
- `packages/client/src/renderer.ts:1004-1009`

Ground units glide between ticks, but many other animated objects still snap on the tick they change state. Flyers, missiles, and overlays do not all use the same interpolation model.

### 3) State transitions are abrupt
- `packages/client/src/animations.ts:165-172`
- `packages/client/src/animations.ts:240-478`

The current logic selects a single slot for the current tick rather than modeling transitions. That makes turning, attack windup, rise/fall, and ritual states feel mechanical instead of continuous.

### 4) Depth ordering is simple and can still produce overlap edge cases
- `packages/client/src/renderer.ts:483-488`
- `packages/client/src/renderer.ts:350-350`

Sorting by Y is cheap and usually correct, but wide footprints, flying objects, overlays, and large buildings can still flicker or overlap awkwardly when entities are close.

### 5) Camera motion is crisp but not alive
- `packages/client/src/camera.ts:19-49`
- `packages/client/src/match.ts:77-81`
- `packages/client/src/controls.ts:329-339`

The code explicitly favors pixel stability. That avoids shimmer, but it also means there is no easing, inertia, or “weight” in camera movement.

### 6) Some effects feel flat because they are single-run slot sequences only
- `packages/client/src/effects.ts:7-12`
- `packages/client/src/renderer.ts:704-730`
- `packages/client/src/renderer.ts:732-764`

Explosions and spell bursts are visually clear, but they rely on existing animation frames with no extra code-driven polish such as pulses, flashes, or screen shake.

## Files and lines to revisit for improvements
- `packages/client/src/animations.ts:1-478`
- `packages/client/src/renderer.ts:333-1099`
- `packages/client/src/effects.ts:1-92`
- `packages/client/src/camera.ts:4-64`
- `packages/client/src/match.ts:117-375`
- `packages/client/src/controls.ts:264-386`

## Summary
The current client is already deterministic and reasonably smooth for fixed-tick rendering, but most animation decisions are still made on simulation ticks rather than on a reusable visual animation layer. The biggest opportunities are interpolation consistency, transition handling, camera easing, and richer code-driven effects without changing simulation rules or sprite assets.
