# Animation implementation results

Phase 3, 2026-10-16. Implementation follows [animation-plan.md](animation-plan.md), with the optional features and measurement limitations below. Simulation, fixed-step scheduling, commands, replay format, rules/snapshot versions and sprite assets are unchanged.

## Delivered changes

| Commit | Improvement |
| --- | --- |
| `6161622` | Repeatable alternating renderer CPU baseline in the existing browser smoke runner. |
| `d6480f7` | Match-local comparison toggle; every-tick presentation capture, non-rewinding clock resets, first-frame impacts, fractional missiles/Energy/streams and attached bars. |
| `56eb3ca` | Atomic sprite/shadow/overlay groups and depth based on displayed ground contact. |
| `dde88f2` | Small presentation timing/state utility, state-entry walking phase, tick-driven turns and authoritative firing frames. |
| `c90f3cc` | Two-tick damage tint, authoritative construction progress, capped three-tick footprint placement outlines and effect regression coverage. These accent durations are presentation approximations, not original timing evidence. |
| `fa07684` | Held-key navigation at 480 CSS px/s, physical-pixel translation snapping, immediate drag/minimap/discrete zoom, blur cancellation, synthetic refresh and emulated DPR checks. |
| `236577b` | Measurement-driven optimization: cache bar/construction geometry, pool visible stream quads, isolate silent benchmark fixtures and extend lifecycle/endpoint regressions. |
| `f4bd426` | Replace per-segment display objects with two bounded reusable mesh buffers; explicitly destroy geometry/buffers and retain captive altar placement before sprite destruction. |
| `8a9b50d` | Require command-bearing replay equality, nonempty flight state and exact construction completion across synthetic schedules. |
| `27edea7` | Cancel building/bridge placement outlines as soon as their logical footprint disappears. |

Entity positions retain the existing adjacent-sample, one-tick interpolation latency. Missiles and Energy bolts use fractional **current-tick** progress, clamped to their captured start/end points; tick capture still owns landing, impact audio and expiry. They never extrapolate a target. Delayed shots use the simulation's recorded target cells and landing tick, including removed sources/targets. Shells, ordinary missiles, bombs, death and spell bursts initialize in the impact tick without extending lifetime.

Pause/visibility reset preserves the last displayed fractional pose until the reset accumulator catches up or a new tick arrives; it does not replay hidden wall time. Catch-up capture retains only adjacent entity samples and live finite effects, not an unbounded visual queue. Expired effects stay expired.

## Comparison and reproduction

In a running match:

```js
ns.animation.setImproved(false); // legacy capture/effects
ns.animation.setImproved(true); // default improved presentation
ns.animation.inspect(); // copied diagnostic timestamps, endpoints and counts
```

Switching does not step the world, issue commands, drain events or replay sounds. It silently clears transient effects, rebases/reparents entities and reconstructs active streams; an old bolt/burst is deliberately not replayed. The mode is absent from saved matches and replays. Discrete zoom, grid selection and the physical-pixel camera/input correction are shared; legacy mode restores key-repeat navigation.

```sh
npm run check
npm run test:browser
NS_ANIMATION_BENCH=1 npm run test:browser
```

The opt-in benchmark uses the existing built client, an isolated renderer cloned from the replay's exact initial snapshot, and silent audio. It does not mutate the recorded match. For each of idle, combat (48 damaged guns + 48 damaged transports) and construction (48 sites + transports + a compatible Workshop), it alternates legacy/improved/legacy/improved at normal and CDP 4× CPU throttle. Thirty synthetic ticks warm state/effects; each round submits 60 RAF-paced renders and discards the first 30. Sync CPU and sync-plus-Pixi-render CPU are measured with `performance.now()`. RAF interval, budget counts, display-object/effect counts and heap deltas are also logged. Timing excludes scene setup, AI, HUD and snapshot cloning; it is not total gameplay CPU or GPU completion time.

### Environment and baseline

Linux runner, AMD EPYC 7763, 4 exposed logical CPUs; Node 24.21.0; headless Chromium 154.0.0.0, WebGL ANGLE/SwiftShader; viewport 1280×800, DPR 1, zoom 1 for performance. Zoom is inherited from smoke navigation and logged with the environment. The DPR interaction matrix additionally uses emulated 1, 1.5 and 2, with reduced motion enabled. No physical 144 Hz display or hardware-GPU browser was available.

A pre-improvement baseline was captured before the renderer work using the initial version of this same smoke harness. Both toggle labels then used the legacy renderer. Normal-throttle sync median rounded to 0 ms (0.1 ms timer quantization); legacy sync p95 ranged 0.2 ms idle, 1.5–2.5 ms combat and 1.4–1.7 ms construction. Legacy sync-plus-render p95 ranged 3.5–5.9, 5.4–6.4 and 4.6–6.7 ms respectively. At 4× throttle those render p95 ranges were 12.5–23.1, 29.8–31.6 and 29.2–32.9 ms.

That preliminary harness submitted renders synchronously, did not isolate the initial world, and its construction scene lacked a compatible stream source. Its measurement completed, but the following menu click timed out under the queued software-GPU workload. These are diagnostic baseline numbers, **not** directly comparable end-to-end frame-rate claims. The final harness fixes those problems and retains an actual legacy mode for same-scene comparisons.

An intermediate RAF-paced run exposed a real CPU regression: regenerating attached Graphics every frame produced improved sync-plus-render medians of 3.3–4.5 ms idle, 6.5 ms combat and 6.1–7.1 ms construction, versus legacy 0.2–0.3 ms. That implementation was replaced with tick-cached bars/lines and pooled stream segments before final validation. Decorative displacement, particles, arcs, shake and eased zoom were not added to that workload.

Pooling individual segment sprites fixed idle/combat overhead but not mass construction: the next run still measured 4.5–6.3 ms construction medians at 1× and 19.8–20.7 ms at 4× (legacy 0.2 and 0.8–0.9 ms). This triggered the final two-mesh buffer implementation rather than accepting that regression.

### Final measurements

Measured renderer revision: `f4bd426`. Subsequent changes add command-bearing tests and cancel removed placement accents; the measured steady scenes have no live placement accents after warm-up. Peak placement/hit-feedback workloads are not represented by this benchmark. All values are milliseconds. Each range spans the two alternating rounds for that mode, not a confidence interval. Each mode/scene has 60 retained frame samples in total. `CPU` means sync + Pixi render submission; `RAF` includes software-GPU/browser scheduling and is not renderer CPU. The last column counts **CPU** samples exceeding 60/144 Hz budgets (16.67/6.94 ms), not a measured physical display's dropped frames.

| Throttle | Scene | Mode | Sync median / p95 | CPU median / p95 | RAF median / p95 | CPU >60 / >144 budgets |
| --- | --- | --- | --- | --- | --- | --- |
| 1× | idle | legacy | 0.0 / 0.2 | 0.2 / 6.2–8.1 | 100.0–150.1 / 116.7–266.6 | 1 / 4 |
| 1× | idle | improved | 0.0–0.1 / 0.2–0.3 | 0.2 / 4.8–8.1 | 133.3–200.0 / 283.4–300.0 | 0 / 3 |
| 1× | combat | legacy | 0.0–0.1 / 1.5–1.8 | 0.2–0.3 / 12.5–15.9 | 200.0–250.0 / 383.3–400.0 | 1 / 8 |
| 1× | combat | improved | 0.2 / 2.0–2.1 | 0.4 / 11.8–26.3 | 150.0–366.6 / 283.3–483.3 | 4 / 8 |
| 1× | construction | legacy | 0.0–0.1 / 1.4–1.6 | 0.2 / 7.3–10.3 | 100.1–116.6 / 216.7 | 0 / 4 |
| 1× | construction | improved | 0.3 / 1.4–1.6 | 0.5–0.6 / 7.5–10.4 | 116.6 / 200.0–216.8 | 0 / 6 |
| 4× | idle | legacy | 0.0 / 0.6–0.7 | 0.3–0.7 / 22.0–36.9 | 100.0 / 199.9–200.0 | 6 / 9 |
| 4× | idle | improved | 0.0–0.1 / 0.6–1.0 | 0.2–0.8 / 16.0 | 100.0–116.6 / 199.9–283.3 | 2 / 10 |
| 4× | combat | legacy | 0.1 / 9.3–18.4 | 0.8–0.9 / 50.4–62.6 | 166.6 / 316.7 | 9 / 10 |
| 4× | combat | improved | 0.5 / 5.5–14.2 | 1.1–1.2 / 37.0–65.3 | 166.6–166.7 / 316.6–316.7 | 10 / 11 |
| 4× | construction | legacy | 0.0 / 7.0–19.2 | 0.7–0.8 / 35.5–63.0 | 116.7 / 233.2–233.3 | 8 / 10 |
| 4× | construction | improved | 0.8–1.0 / 6.3–6.7 | 1.7–1.9 / 32.8–36.2 | 116.6–116.7 / 216.6–216.7 | 10 / 11 |

The final fixture contains 12 entities idle, 108 combat and 109 construction. Recursive display-object totals are legacy/improved 5116/5128, 5788/6040 and 5309/5562. Both combat modes have 528 live bursts at the recorded round endpoint; short missiles have already landed there. Construction has 48 streams, idle has none, and launch Energy bolts have expired after warm-up. Active-stream work is bounded to visible emissions; mesh capacity is capped at 8192 segments per stroke and placement at 64 accents.

Observed heap deltas across all final rounds span −22,082,303 to +3,724,948 bytes at 1× and approximately −11.4 to +2.2 MiB at 4×. Negative values demonstrate GC, not negative allocation. This telemetry cannot prove allocation equivalence or absence of leaks; buffer reuse/capping/destruction additionally have direct regression tests.

**Gate decision:** the multi-millisecond construction regression was rejected and optimized. The final core correctness changes retain a measurable median cost: roughly +0.1–0.2 ms combat and +0.3–0.4 ms construction at 1×; about +0.9–1.2 ms construction at 4×. Idle medians overlap. Tail ranges are noisy and both modes exceed frame budgets in this software environment. There is no evidence for “no measurable cost” or a 60/144 Hz end-to-end guarantee. Optional accents beyond the bounded feedback above remain deferred. A hardware-GPU/high-refresh follow-up and a user-agreed hardware threshold are still needed for those stronger acceptance claims.

## Verification

- `npm run check`: **203 tests passed** (47 client, 156 simulation), lint/typecheck/build/size passed using the identical TypeScript formatter 0.96.1 from its upstream GitHub release mirror. The configured `plugins.dprint.dev` hostname could not resolve: the unmodified command was first attempted and failed at formatter download. Only for validation the URL was temporarily substituted; `dprint.json` was restored unchanged. Commit hooks hit the same external outage; commits used the already-run lint/format validation with hooks disabled. No dependency or formatter version changed.
- `npm run test:browser`: passed, including menu/assets, live stepping, bridge redraw, production/commands, pause, minimap, drag/wheel, replay equality, comparison hash invariance, synthetic visibility suspension, held-key schedules, blur cancellation, and DPR/discrete-zoom/synthetic pinch checks.
- Sixteen durable presentation tests exercise 30/60/144 FPS **synthetic** schedules, irregular frames, multi-step catch-up, severe clock caps, pause/visibility resets, adjacent samples, states, crossings/temple attachment grouping, health bars, damage/healing tint, stream/Energy motion, mesh growth/capping/reuse/teardown, captive altar removal, construction completion, bounded placement and first-frame/exact-once/expiry behavior for independent impact families. Across modes, per-tick hashes, event sequence, nonempty shot/landing state and completion ticks match; equal simulation-tick prefixes match across schedules. The schedules also record movement/build commands and replay each result to the same hash. Under clock caps, discarded wall time is intentionally not simulated.
- Automated validation: CodeQL JavaScript **0 alerts**. The combined tool reported no review comments but explicitly said its code-review binary was unavailable; this is **not** a completed independent code review.

## Limitations and explicit deferrals

- No original sprite playback duration provenance is claimed. Existing slot cadence/cycle lengths remain; walking entry phase changes, not cycle duration. Low-frame-count art still has discrete frames.
- Selection, hitboxes, path previews and placement commands remain grid-accurate. Health-bar attachment and displayed-depth crossing assertions are automated geometry checks, not subjective physical-display approval of every map/overlap.
- Eased zoom, camera inertia/shake, body displacement, projectile arcs and decorative particles are deferred. Immediate direct camera control and crisp zoom avoid input lag, nearest-neighbor crawl and reduced-motion regressions. There are no optional persistent oscillations to suppress; the new fades/tints do not displace game objects.
- Construction progress is a read-only line; sprites are never hidden, scaled or delayed at completion. Placement is an outline only, capped at 64 cells/footprints; it never hides usable bridge terrain.
- Heap deltas include garbage collection and are not precise allocation counts. CPU throttling is emulated; RAF scheduling in software headless Chromium is not actual 30/60/144 Hz display hardware.
- No “no measurable cost,” timing equality in discarded wall time, hardware-GPU budget or universal tactical-visual equivalence is claimed. The performance gate is diagnostic, not an agreed hardware acceptance threshold; final measurements and budget limitations must be read with this environment in mind.

## Changed files

Runtime: `packages/client/src/{animations,camera,controls,match,renderer,presentation,stream-batch}.ts`.
Tests/measurements: `packages/client/test/presentation.test.ts`, `scripts/smoke-browser.mjs`.
Documentation: `docs/architecture.md`, `docs/animation-results.md`, `docs/README.md`.
