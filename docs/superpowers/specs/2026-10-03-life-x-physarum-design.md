# Life x Physarum — Design Spec

Date: 2026-10-03
Source idea: `high-level-idea.md`

## Purpose

An exploration tool for watching a Conway's Life simulation "leak" into an HSV-affinity Physarum simulation, and tuning the Physarum parameters live. A later goal is generating MIDI from the result, so Life organism state must be cleanly accessible (not only rendered). Unattended ambient/installation use is a future possibility, not a goal of this spec.

## Summary

- A Life board (B3/S23, dead edges; size selectable 64–1024, default 64×64) ticks at 7.5 Hz by default on the CPU.
- A 2048×2048 Physarum field steps at 30 Hz on the GPU (WebGPU compute), with a ring-buffer pool of 2^17 actors by default.
- Life cells are grouped into **organisms** by the cluster tracker ported from `~/src/life-ambient`. Each organism gets one of 8 palette colors.
- Each newborn Life cell spawns N actors (default 129) in its organism's color inside the cell's block of the Physarum field.
- Physarum actors sense, steer toward and deposit HSV pheromone using the algorithm from `~/src/Particles`, ported to WGSL with clear bugs fixed.
- Actors also reproduce (flat probability per step), inheriting velocity with variance, and respawn on death.
- Each Life cell that dies seeds food in its organism's color over its cell block. Actors are attracted to food whose hue is close to their own, and die where food is dense (exhaustion).
- Both layers render composited on one canvas with independent opacity. The user places Life patterns and controls all Physarum parameters through a lil-gui panel.
- Data flow is one-way: Life → Physarum. Physarum never affects Life.

## Non-goals (this spec)

- MIDI or audio output (the tracker's events are exposed for it, but nothing consumes them).
- Placing actors on the Physarum field manually.
- Toroidal (wrapping) Life edges.
- Per-colony Physarum parameter sets (one shared parameter set; palette colors provide colony identity).
- Source-image features from Particles (image seeding of food/pheromone/color, seed filters).
- Life birth-flash / death-fade visuals.
- A non-WebGPU fallback.

## Tech stack

- TypeScript (strict), Vite, vanilla DOM. Raw WebGPU + WGSL; no rendering framework.
- lil-gui for the parameter panel.
- npm for dependencies (not uv — this is not a Python project).
- Vitest (Node) for unit tests; Vitest browser mode with the Playwright provider (Chrome, WebGPU) for GPU integration tests; Playwright for end-to-end tests.

## Architecture

### Clocks

One `requestAnimationFrame` loop drives everything:

- **Physarum clock:** fixed 30 Hz via a time accumulator, independent of display refresh. Each accumulated step runs one full Physarum step. Cap catch-up at a few steps per frame to avoid spiral-of-death.
- **Life clock:** 7.5 Hz by default (adjustable via a tick-rate slider), driven from the same loop.
- **Render:** every display frame.

### Modules

| Module | Runs on | Responsibility |
|---|---|---|
| `src/life/engine.ts` | CPU | Square B3/S23 grid (board size setting), dead edges. `tick()` returns births and deaths. Ported from life-ambient `engine/life.ts`. |
| `src/life/tracker.ts` (+ `src/life/geometry.ts`) | CPU | Organism grouping and identity across ticks. Ported from life-ambient `tracker/cluster.ts` (and its dependency `geometry.ts`) unchanged apart from import paths. Emits `{born, updated, died}` plus per-organism metrics each tick. |
| `src/life/palette.ts` | CPU | Assigns palette colors to organisms (rules below). |
| `src/life/world.ts` | CPU | Owns engine + tracker + palette; returns colored births/deaths per tick; the single accessor for organism state (future MIDI). |
| `src/life/patterns.ts` | CPU | Pattern library and rotation. Ported from life-ambient `engine/patterns.ts`. |
| `src/bridge/spawner.ts` | CPU | Converts births into spawn requests and deaths into food seeds; burst or trickle scheduling. |
| `src/color.ts` | CPU | Reference color math (`rgb2hsv`, `hsv2rgb`, `hsv_mix`, `hsv_distance`, `dominant_color`) mirroring the WGSL. |
| `src/physarum/` | GPU | Actor pool (ring buffer), agent / inject / diffuse / deposit / food passes, ping-pong trail textures, food texture, parameter uniforms. |
| `src/render/` | GPU | Composites the Physarum trail and the Life cells with independent opacity. |
| `src/ui/` | DOM | lil-gui panel, pattern palette, placement ghost, R-to-rotate, readouts. |
| `src/main.ts` | — | Wiring and the frame loop. |

### Data flow per Life tick

`engine.tick()` → births/deaths → `tracker.update()` → organisms with ids → `palette` assigns/keeps colors → `spawner` turns each birth into spawn requests (using the newborn cell's organism color after regrouping) → requests are uploaded to the GPU and injected into the actor ring. In parallel, each death (attributed to the organism the cell belonged to on the previous tick) becomes a food-seed request, uploaded and applied on the first Physarum step after the tick.

The tracker's events and metrics for the latest tick are exposed from a single accessor so a future MIDI module can subscribe without touching the simulation.

## Life

- Square grid of the selected board size (64, 128, 256, 512 or 1024), B3/S23, cells outside the board are dead. Each cell maps to a (2048 / size)-pixel square block of the field.
- Tracker: union-find grouping with Chebyshev distance ≤ 2 (5×5 neighbourhood). Identity: each new group claims the previous id it overlaps most (ties → lower id); an unclaimed group adopts the nearest unclaimed previous centroid within distance 3; when several groups claim one id (split) the largest keeps it and the others get new ids; previous ids no group claimed are reported as died (so on a merge, the merged group keeps the id it overlaps most and the other id dies). Port life-ambient's implementation and tests as-is, including deterministic tie-breaks.

### Palette

8 colors, hues evenly spaced 45° apart at S=1, V=1: red (0°), orange (45°), yellow (90°), green (135°), cyan (180°), blue (225°), violet (270°), magenta (315°).

Color rules:

- A newly born organism id gets a palette color chosen uniformly at random (seeded RNG).
- An organism keeps its color for as long as its id survives.
- On a split, the fragment that keeps the id keeps the color; other fragments get new ids and therefore new random colors.
- On a merge, the merged group keeps the id (and thus color) of the previous organism it overlaps most — in practice the larger one.

Each live cell's color is its organism's color.

## Bridge: births → actors

- `actorsPerBirth` (default 129).
- Each spawned actor: position uniformly random within the newborn cell's cell block on the field (with cell size c = 2048 / board size, cell (cx, cy) → field pixels [c·cx, c·cx+c) × [c·cy, c·cy+c)); direction uniformly random in [0, 2π); speed `minSpeed`; seed color and deposit color = the organism's palette color; age 0; life = `life` parameter; RNG state = a random non-zero u32 from the seeded CPU RNG.
- **Spawn mode** (toggle, default **trickle**):
  - *Burst:* all spawns for a Life tick are injected on the first Physarum step after the tick (spilling into following steps only if they exceed the per-step insert cap, below).
  - *Trickle:* at each Life tick, n = max(1, round(30 / lifeHz)); the queued spawns are spread as evenly as possible over the next n Physarum steps. If a new tick arrives while spawns are still queued, the leftovers stay queued and are spread together with the new ones. The queue keeps draining while Life is paused.
- The spawn queue holds at most `poolSize` actors; beyond that the oldest queued spawns are dropped (they would be evicted by the ring anyway).
- Placing patterns or painting cells does not spawn actors or seed food. Only real Life ticks (including the Step button) do. Edits while paused re-run the tracker so colors update immediately.

## Bridge: deaths → food

- Each Life cell that dies seeds food over its cell block, in the color of the organism the cell belonged to on the previous tick.
- Applied by a render pass drawing one cell-block quad per death into the food texture with additive blending: RGB += `organismColor.rgb · foodPerDeath`, alpha += `foodPerDeath`.
- Always applied on the first Physarum step after the Life tick (the burst/trickle toggle applies only to actor spawns), up to one seed per Life cell per step.
- Food is the only thing written to the food texture besides fade and clear: **actors do not deposit food** (a deliberate departure from Particles).

## Physarum

### Fidelity to Particles

Port `~/src/Particles/Particles Shared/Shaders.metal` behaviour, with these **fixes and changes**:

1. **Hue wrap in `hsv_mix`.** The original wrap branch is wrong when `a.h > b.h`. Keep the original tie rule (`<`) but wrap correctly:
   ```
   if (abs(a.h - b.h) < 1 - abs(a.h - b.h)) h = mix(a.h, b.h, d)
   else if (a.h < b.h)                       h = fract(mix(a.h + 1, b.h, d))
   else                                      h = fract(mix(a.h, b.h + 1, d))
   s = mix(a.s, b.s, d); v = mix(a.v, b.v, d)
   ```
   Example: a.h=0.9, b.h=0.1, d=0.25 → 0.95; a.h=0.1, b.h=0.9, d=0.25 → 0.05.
2. **Food term (redesigned).** The original passes raw RGB into `hsv_distance` and has an inverted condition, so food barely affects steering. Replacement, per sensor:
   `fd = hsv_distance(rgb2hsv(food.rgb), seedHsv)`; `foodVal = food_sensitivity · food.a · max(0, 1 − fd)`.
   Zero where there is no food, largest on plenty of matching-hue food, on the same scale as pheromone distances. The candidate score is `dist − foodVal` (lower is better).
3. **Candidate selection.** Store the full score (`dist − foodVal`) in `min_distance`, not just `dist`, so all candidates are compared consistently. `min_distance` starts at 5 as in Particles.
4. **Exhaustion uses food amount.** Death by exhaustion tests the food texture's alpha: `food_exhaustion > 0 && food.a >= food_exhaustion` (0 disables exhaustion). The original used `length(food.rgba) >= 2.0`, which pure palette colors cannot reach (max √3).
5. **Blur read/write hazard.** Diffusion reads trail A and writes trail B (ping-pong) instead of in place.
6. **`dominant_color` hue fold removed.** Particles' `hsv.r = min(abs(hsv.r), 1-abs(hsv.r))` (Shaders.metal:84) folds all hues into [0, 0.5]; it is dropped so locked hues cover the whole wheel. Everything else in `dominant_color` is kept (quantize hue to `lock_to_hsv_angles` steps rounding half up, add `hsv_angle_offset`, `fmod` 1, scale and clamp S and V). Only applies when `lock_to_hsv_angles > 0`.
7. **Respawn colors (forced by having no source image).** Particles mixes 10% of the source image into a parent-respawn color and uses the image color for random respawns. Here: parent respawn uses the parent's deposit color alone; random respawn keeps the actor's own seed color. Both pass through `dominant_color`.
8. **Respawn parent liveness (new).** Particles has no "alive" concept; here a parent slot that is not alive makes the respawn behave as random-position respawn.
9. **Food fade includes alpha.** Particles pins food alpha to 1; here food alpha (amount) fades too, so exhaustion zones expire.

Things deliberately **kept** for visual character:

- Pass order per step, as in Particles: diffuse/fade the trail, fade the food, then agents move/sense/turn, then deposit. Actors therefore sense the already-faded/blurred trail.
- `rgba8unorm` trail and food textures (8-bit quantization).
- Subtractive (linear) fade, not multiplicative.
- Nearest-pixel sensing; out-of-bounds samples read as zero (implemented with an explicit bounds check, since WGSL's out-of-bounds `textureLoad` is not guaranteed to return zero).
- Sensor geometry: offsets `±(i/lookSlices)·lookRadians` for i in 0..lookSlices-1 (straight-ahead sampled twice; full `lookRadians` never reached).
- Linear (non-circular) `mix` of direction for momentum, then `fmod` by 2π (truncating, so negative directions stay negative).
- Speed ramps up by `rand·0.01` per step, capped at `maxSpeed` (if `maxSpeed < minSpeed`, `minSpeed` is used as the cap).
- `hsv_distance`: `sqrt(hd² + sd² + vd²)` with circular hue difference `hd = min(|Δh|, 1-|Δh|)`.
- Deposit color: `color = hsv_mix(trail@pos, color, intensity)` with alpha `intensity`. At the default `intensity` = 1 this is just the actor's color (no drift); below 1 it drifts, and because `rgb2hsv` of black/gray has hue 0, actors over empty trail drift toward red — an inherited quirk, kept. Sensing always uses the seed color.
- Deposit overwrites the trail pixel's RGB (last writer wins). Trail alpha is written as 1 everywhere and never read.
- Death check happens before the age increment, as in Particles: `age > life` is tested, then age += 1 at the end of the step.
- `hsv_angle_offset` default 1.0 (a no-op after `fmod` 1, as in Particles).
- Respawn offset: exactly `spawnRandomOffset` perpendicular to the direction, to a random side.
- Per-actor xorshift32 RNG (state must never be 0).

### GPU resources

- **Actor buffer** (storage), capacity `poolSize`. Per actor (64 bytes): position (vec2f), direction (f32), speed (f32), seed color (vec4f), deposit color (vec4f), age (u32), life (u32), alive (u32), rng state (u32). Slots start not alive (zero-initialized).
- **Counters buffer:** `head` (ring write head), `childCount`, `aliveCount`, `childrenInserted` — all atomic u32. The insert slot is `atomicAdd(head, 1) & (poolSize − 1)` (poolSize is a power of two). This is the only insertion path, so the CPU and GPU never coordinate on the head.
- **Child queue:** storage buffer with capacity `maxChildren = poolSize / 8`. The agent pass reserves an index with `atomicAdd(childCount, 1)` and writes only if the index < `maxChildren`; children beyond capacity in a step are dropped.
- **Spawn request buffer:** CPU-uploaded Life spawns for this step, capacity `maxSpawnsPerStep = min(poolSize − maxChildren, 65536)`, so a step never inserts more than `poolSize` actors and no two inserts in a step share a slot.
- **Food seed buffer:** capacity one seed per Life cell; resized when the board size changes.
- **Trail textures:** two `rgba8unorm` 2048×2048 textures (A, B), ping-pong.
- **Food texture:** one `rgba8unorm` 2048×2048 texture.
- **Uniforms:** all scalar f32/u32/i32 (no bools; `wrapBounds` is u32, `always_spawn_from_parent` is i32), plus field size, step counter, pool size, `maxChildren` and this step's spawn count. `blurInterval` and `foodFadeInterval` are applied on the CPU when deciding which passes to encode.
- **Device limits:** request the adapter's `maxStorageBufferBindingSize` and `maxBufferSize`; pool sizes above `min(both) / 64` are not offered. Compute passes over actors use workgroup size 256 so 2^22 actors stay under the 65535-workgroups-per-dimension limit.

### One Physarum step

All passes go in one command encoder, submitted once per step. "Current trail" starts as A.

1. **Reset counters:** `clearBuffer` on `childCount` and `aliveCount`.
2. **Diffuse/fade (compute).** Only on steps where `step % blurInterval == 0`: read A, write B (write-only storage texture):
   - `blurMultiplier == 0`: `max(0, rgb − fadeDecrement)`
   - otherwise: `max(0, (sum3x3 + center·blurMultiplier) / (blurMultiplier + 9) − fadeDecrement)`, with out-of-bounds neighbours counting as zero (Particles' clamp_to_zero).
   Alpha written as 1. Current trail becomes B. On other steps nothing is copied; current trail stays A.
3. **Food seed (render).** If there are death seeds: instanced cell-block quads, additive blend (one/one).
4. **Food fade (render).** Only on steps where `step % foodFadeInterval == 0`: fullscreen triangle outputting the constant `(d, d, d, d)` with `d = foodFadeDecrement`, blend operation `reverse-subtract` (one/one), so `food = max(0, food − d)` without reading the texture.
5. **Agent pass (compute).** For each alive actor, reading the current trail and the food texture:
   1. Move: `pos += speed·(cos dir, sin dir)`.
   2. Out of bounds (`x<0 || y<0 || x>=W || y>=H`): if `wrapBounds`, wrap into the field; otherwise mark out-of-bounds.
   3. Death check: `age > life`, or out-of-bounds without wrap, or exhaustion (fix 4). On death → respawn per Lifecycle.
   4. Sense at the final position: `lookSlices` × 2 sensors at `lookDistance`, scoring as above.
   5. Turn: `newDir += (rand − 0.5)·directionRandomization`; `dir = mix(dir, newDir, 1 − directionMomentum)`; `dir = dir % 2π`.
   6. Speed ramp; `age += 1`.
   7. Deposit color from the current trail at the final position.
   8. With probability `spawnProbability`, append a child to the child queue.
   9. Count alive actors with a workgroup-level reduction (one atomic per workgroup on `aliveCount`).
6. **Inject pass (compute).** Dispatch over `spawnCount + maxChildren` threads; thread i < spawnCount copies spawn i, otherwise copies child `i − spawnCount` if that index < `min(childCount, maxChildren)` (and increments `childrenInserted`); other threads return. Each copied actor goes to slot `atomicAdd(head, 1) & (poolSize − 1)`.
7. **Deposit pass (render).** Draw `poolSize` points (`point-list`, always 1 px) into the current trail with no blending (replace). Vertex shader: dead slots emit clip x = 2 (culled); live actors map `p = floor(pos) + 0.5` to `clip = (p.x/W·2 − 1, 1 − p.y/H·2)` — note the y flip, so the deposited pixel equals the sensed pixel `floor(pos)`. Fragment writes `(color.rgb, 1)`.
8. If the diffuse pass ran, swap A and B so A is the latest trail.

### Lifecycle

Actors enter the pool three ways, all through the ring head:

1. **Life births** (bridge, above).
2. **Reproduction.** Each step, each alive actor emits a child with probability `spawnProbability`. The child: position = parent position offset perpendicular to the parent's direction by a uniform random amount in [−`spawnRandomOffset`, +`spawnRandomOffset`] (wrapped or clamped into the field); direction = parent direction + uniform random in [−`directionVariance`, +`directionVariance`]; speed = parent speed × uniform random in [1−`speedVariance`, 1+`speedVariance`], clamped to [`minSpeed`, `maxSpeed`]; seed color and deposit color copied from parent; age 0; life = `life` param; RNG state derived from the parent's (non-zero).
3. **Respawn on death,** in the actor's own slot, per `always_spawn_from_parent`:
   - **> 0:** pick a random slot `floor(rand·poolSize) % poolSize` as parent. If that slot is alive, copy its position and direction; the respawned actor's deposit color and seed color both become `dominant_color(parent deposit color)`, so colors can migrate between colonies as in Particles. If the slot is not alive, behave as = 0. (Reading another slot while it is being updated is a benign race, as in Particles.)
   - **= 0:** uniformly random field position; seed and deposit color = `dominant_color(own seed color)`.
   - Both: then offset exactly `spawnRandomOffset` perpendicular to the direction to a random side (the next step's bounds handling deals with the field edge, as in Particles); speed = `minSpeed`; age = 0.
   - **< 0:** no respawn; the slot becomes not alive.

Actors leave the pool when evicted by the ring (oldest overwritten) or by death with no respawn. With respawn on, slots never free up, so once the pool is full every insert replaces a living actor; the inserts/s readout makes that turnover visible.

### Parameters

One shared set, all live-editable in the panel. Defaults were tuned by exploration (2026-10-03). The Particles column gives the effective value in Particles' `config.json` (— where Particles has no equivalent).

| Name | Default | Particles | Range |
|---|---|---|---|
| `poolSize` | 1048576 (2^20) | — | 2^14 – 2^22, powers of two (limited by device, above) |
| `lookSlices` | 6 | 3 | 1 – 8 |
| `lookRadians` | 1.31 | 1.0 | 0 – π |
| `lookDistance` | 17 | 10 | 1 – 64 |
| `directionRandomization` | 0.35 | 0.1 | 0 – 2 |
| `directionMomentum` | 0.25 | 0.1 | 0 – 1 |
| `minSpeed` | 1.13 | 0.3 | 0 – 5 |
| `maxSpeed` | 2.81 | 2.0 | 0 – 10 |
| `intensity` | 0.37 | 1.0 | 0 – 2 |
| `foodPerDeath` | 0.5 | — | 0 – 1 |
| `food_exhaustion` | 0 (disabled; 0 disables) | 2.0 (different formula) | 0 – 1 |
| `food_sensitivity` | 0.1 | 0.1 (different formula) | 0 – 2 |
| `life` | 20000 (steps) | 10000 + 10000 | 1 – 100000 |
| `always_spawn_from_parent` | 1 | 1 | -1, 0, 1 |
| `spawnRandomOffset` | 1.0 | 1.0 | 0 – 16 |
| `spawnProbability` | 0.0134 | — (parsed, unused) | 0 – 0.05 |
| `directionVariance` | 1.65 | ±π/4 (CPU parent spawns) | 0 – π |
| `speedVariance` | 0.1 | — | 0 – 1 |
| `lock_to_hsv_angles` | 0 | 0 | 0 – 12 (integer) |
| `hsv_angle_offset` | 1.0 | 1.0 | 0 – 1 |
| `hsv_saturation_multiplier` | 1 | 1 | 0 – 2 |
| `hsv_value_multiplier` | 1 | 1 | 0 – 2 |
| `fadeDecrement` (trail) | 0.001 | 0.01 | 0 – 0.1 |
| `blurMultiplier` | 10.6 | 0 | 0 – 16 |
| `blurInterval` | 1 | 1 | 1 – 10 |
| `foodFadeDecrement` | 0.002 | 0.01 (RGB only) | 0 – 0.1 |
| `foodFadeInterval` | 1 | 1 | 1 – 10 |
| `wrapBounds` | true | config | bool |
| `rngSeed` | 1 | config | integer |

`life` applies to actors as they are inserted or respawned. `rngSeed` seeds the CPU RNG (palette choices, random fill, spawned actors' RNG states) and can also be set with the `?seed=N` URL parameter.

Changing `poolSize` reallocates the actor, child and spawn buffers, resets the counters (including the ring head) and empties the spawn queue. "Clear actors" does the same without reallocating. Life is unaffected by either.

## Rendering

- The Physarum field is 2048×2048. The canvas displays it scaled to fit the window (square, aspect preserved, linear filtering when downscaling).
- Composite order over black: Physarum layer (trail RGB, or food RGB in food view; alpha ignored) × `physarumOpacity`, then Life cells mixed in with `lifeOpacity`, then the placement ghost.
- Life cells: cell-block squares (2048 / board size field pixels on a side) in their organism's color.
- Placement ghost: translucent preview of the selected pattern (or the single paint cell) at the cursor, clipped to the board.

## UI

lil-gui panel folders:

- **Layers:** `lifeOpacity` (default 0.05), `physarumOpacity` (default 1.0), food view toggle (also key **T**, as in Particles) that shows the food texture in place of the trail.
- **Life:** play/pause, step, clear, random fill + density (default 0.2), tick rate (default 7.5 Hz, range 0.25 – 8 Hz), board size (64, 128, 256, 512 or 1024; default 64; also `?size=N`). Changing the board size starts an empty board and clears the food map and pending food; actors and trail stay.
- **Bridge:** `actorsPerBirth` (default 129, range 0 – 256), spawn mode (burst / trickle, default trickle).
- **Physarum:** all parameters above, grouped (Sensing, Movement, Deposit & Color, Food, Fade, Reproduction & Lifecycle, World); buttons: clear trail, clear food, clear actors.
- **Readouts:** fps, Physarum steps/s, alive actors, organism count, inserts/s from Life vs from reproduction.

Pattern placement (ported from life-ambient): a palette of the 14 patterns grouped by category (drone, pulse, voyager, fountain, wildcard) plus a "paint cells" tool; ghost preview follows the cursor; **R** rotates 90° clockwise (resets on tool change); click stamps the pattern anchored top-left, or toggles a cell in paint mode.

Organism count comes from the CPU tracker. Alive actors and children inserted come from the GPU counters buffer, read back asynchronously (a 16-byte `mapAsync`, at most ~4 times per second, skipped while a read is pending) so it never stalls the frame loop.

## Movie recording

- Panel buttons "start recording" and "end recording" (only the applicable one is enabled). A "recording" readout shows movie time and frame count, or "off".
- Content: the mix (trail × `physarumOpacity`, Life × `lifeOpacity`, no placement ghost) rendered into an offscreen WebGPU canvas at the movie size and captured as a `VideoFrame` after every Physarum step.
- Pacing while recording: one video frame per Physarum step at 30 fps; Life ticks every `round(30 / lifeHz)` steps instead of by wall clock. If the encoder has more than 3 frames queued, Physarum steps are skipped (the live view slows) rather than dropping frames. Normal wall-clock pacing resumes when recording ends.
- Encoding: WebCodecs via Mediabunny into an in-memory MP4. Preference order: H.264 2048 (20 Mbit/s), H.264 1024 (8 Mbit/s), VP9 2048, VP9 1024; a fallback is announced in the message box, and a browser that can't encode video gets "This browser cannot record video."
- End downloads `life-x-physarum-<start timestamp>.mp4`. Encoder failures stop the recording with a message.

## Error handling

- No `navigator.gpu` or no adapter/device: show a clear "WebGPU not available" message in place of the canvas; do not start.
- Device lost: show a message with a reload button.
- WGSL compile errors: log with line info from `getCompilationInfo()` and show an on-screen error overlay. Uncaptured GPU validation errors are logged to the console.

## Testing

TDD throughout. All three test types are required.

**First task:** a feasibility check that a minimal WebGPU compute pass runs and reads back under Vitest browser mode / Playwright on this machine (macOS, Chrome). If headless WebGPU is unreliable, run GPU and e2e tests headed.

**Unit (Vitest, Node):**
- Life engine: life-ambient's tests (blinker period, glider displacement), dead edges. Patterns: life-ambient's tests (rotation, still lifes, oscillator periods, Gosper gun 41 cells at gen 30).
- Tracker: life-ambient's tests ported.
- Palette: new organism gets a palette color; color persists with id; split fragments get new colors; merge keeps the dominant id's color; seeded determinism.
- World: births colored by their new organism; deaths colored by their previous-tick organism; edits produce no births/deaths.
- Death food: each death produces one food-seed request with its color and block.
- Spawner: positions within the cell block; count = births × `actorsPerBirth`; color = organism color; burst puts all on one step; trickle distributes across steps with total preserved; leftovers survive a new tick; per-step cap spills into later steps; queue cap drops the oldest.
- CPU reference math (`src/color.ts`): `rgb2hsv`/`hsv2rgb`, `hsv_mix` wrap cases (0.9, 0.1, 0.25 → 0.95; 0.1, 0.9, 0.25 → 0.05), `hsv_distance`, `dominant_color` (no fold); parameter and actor packing layouts.
- Clocks: fixed-step accumulation and catch-up cap.

**Integration (Vitest browser mode, real WebGPU):**
- WGSL color functions match the CPU reference over a sample grid.
- Inject pass: with the head near the end, inserts wrap around the ring; set semantics (intra-step order is nondeterministic): after inserting k actors starting at head h, exactly the k slots h..h+k−1 (mod poolSize) are overwritten and no others; Life requests and children both inserted; children beyond `maxChildren` ignored.
- Agent pass: single-actor move; out-of-bounds wrap vs kill; age/life death; respawn modes; sensing turns toward matching-hue trail; food steering prefers matching-hue food; exhaustion at alpha 255 with threshold 1.0 kills and at alpha 128 with threshold 1.0 does not; reproduction with `spawnProbability = 1` adds `min(alive, maxChildren)` children and `= 0` adds none; deposit color matches `hsv_mix`.
- Diffuse/fade: known input texture → expected output for both blur modes.
- Deposit: an actor at a fractional position colors exactly pixel `floor(pos)` (no y flip mismatch); dead slots draw nothing.
- Food: a death quad adds `color·foodPerDeath` / `foodPerDeath` alpha over exactly the cell block; fade subtracts and clamps at 0.
- Simulation step: spawns become alive; ring overflow keeps alive ≤ poolSize; pool resize resets counts.

**End-to-end (Playwright, Chrome with WebGPU):**
- Load the page; no console errors.
- Place a glider, step Life: organism count readout = 1; alive actors > 0 shortly after; a live glider cell's pixel has a palette hue.
- Place a blinker and step Life once: with the food view on, a dead cell's block has the same hue as the blinker's live cells.
- Change `poolSize`: alive actors resets to 0.
- No-WebGPU path shows the fallback message.

## Future work (not in this spec)

- MIDI output driven by tracker events and metrics (reuse life-ambient's `scale.ts`, `arpeggio.ts`, `allocation.ts`, `probe-midi.ts`).
- Toroidal Life (needs tracker changes).
- Reproduction conditioned on local pheromone.
- Birth flash / death fade on the Life layer.
- Saving/loading parameter presets.
