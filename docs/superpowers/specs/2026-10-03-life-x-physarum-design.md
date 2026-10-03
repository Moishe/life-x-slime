# Life x Physarum — Design Spec

Date: 2026-10-03
Source idea: `high-level-idea.md`

## Purpose

An exploration tool for watching a Conway's Life simulation "leak" into an HSV-affinity Physarum simulation, and tuning the Physarum parameters live. A later goal is generating MIDI from the result, so Life organism state must be cleanly accessible (not only rendered). Unattended ambient/installation use is a future possibility, not a goal of this spec.

## Summary

- A 128×128 Life board (B3/S23, dead edges) ticks at 1 Hz on the CPU.
- A 2048×2048 Physarum field steps at 30 Hz on the GPU (WebGPU compute), with a ring-buffer pool of 2^17 actors by default.
- Life cells are grouped into **organisms** by the cluster tracker ported from `~/src/life-ambient`. Each organism gets one of 8 palette colors.
- Each newborn Life cell spawns N actors (default 16) in its organism's color inside the cell's 16×16 block of the Physarum field.
- Physarum actors sense, steer toward and deposit HSV pheromone using the algorithm from `~/src/Particles`, ported to WGSL with clear bugs fixed.
- Actors also reproduce (flat probability per step), inheriting velocity with variance, and respawn on death.
- Each Life cell that dies seeds food in its organism's color over its 16×16 block. Actors are attracted to food whose hue is close to their own, and die where food is dense (exhaustion).
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
- **Life clock:** 1 Hz by default (adjustable via a tick-rate slider), driven from the same loop.
- **Render:** every display frame.

### Modules

| Module | Runs on | Responsibility |
|---|---|---|
| `src/life/engine.ts` | CPU | 128×128 B3/S23 grid, dead edges. `tick()` returns births and deaths. Ported from life-ambient `engine/life.ts`. |
| `src/life/tracker.ts` | CPU | Organism grouping and identity across ticks. Ported from life-ambient `tracker/cluster.ts` unchanged. Emits `{born, updated, died}` plus per-organism metrics each tick. |
| `src/life/palette.ts` | CPU | Assigns palette colors to organisms (rules below). |
| `src/life/patterns.ts` | CPU | Pattern library and rotation. Ported from life-ambient `engine/patterns.ts`. |
| `src/bridge/spawner.ts` | CPU | Converts births into spawn requests; burst or trickle scheduling. |
| `src/physarum/` | GPU | Actor pool (ring buffer), agent / inject / diffuse / deposit / food passes, ping-pong trail textures, food texture, parameter uniforms. |
| `src/render/` | GPU | Composites the Physarum trail and the Life cells with independent opacity. |
| `src/ui/` | DOM | lil-gui panel, pattern palette, placement ghost, R-to-rotate, readouts. |
| `src/main.ts` | — | Wiring and the frame loop. |

### Data flow per Life tick

`engine.tick()` → births/deaths → `tracker.update()` → organisms with ids → `palette` assigns/keeps colors → `spawner` turns each birth into spawn requests (using the newborn cell's organism color after regrouping) → requests are uploaded to the GPU and injected into the actor ring. In parallel, each death (attributed to the organism the cell belonged to on the previous tick) becomes a food-seed request, uploaded and applied on the first Physarum step after the tick.

The tracker's events and metrics for the latest tick are exposed from a single accessor so a future MIDI module can subscribe without touching the simulation.

## Life

- Grid 128×128, B3/S23, cells outside the board are dead.
- Tracker: union-find grouping with Chebyshev distance ≤ 2 (5×5 neighbourhood); identity via max-overlap claim, then nearest unclaimed previous centroid within distance 3, splits → largest keeps id, merges → each previous id goes to the group overlapping it most. Port life-ambient's implementation and tests as-is, including deterministic tie-breaks (do not depend on Map iteration order).

### Palette

8 colors, hues evenly spaced 45° apart at S=1, V=1: red (0°), orange (45°), yellow (90°), green (135°), cyan (180°), blue (225°), violet (270°), magenta (315°).

Color rules:

- A newly born organism id gets a palette color chosen uniformly at random (seeded RNG).
- An organism keeps its color for as long as its id survives.
- On a split, the fragment that keeps the id keeps the color; other fragments get new ids and therefore new random colors.
- On a merge, the merged group keeps the id (and thus color) of the previous organism it overlaps most — in practice the larger one.

Each live cell's color is its organism's color.

## Bridge: births → actors

- `actorsPerBirth` (default 16).
- Each spawned actor: position uniformly random within the newborn cell's 16×16 block on the field (cell (cx, cy) → field pixels [16cx, 16cx+16) × [16cy, 16cy+16)); direction uniformly random in [0, 2π); speed `minSpeed`; seed color and deposit color = the organism's palette color.
- **Spawn mode** (toggle, default **burst**):
  - *Burst:* all spawns for a Life tick are injected on the first Physarum step after the tick.
  - *Trickle:* spawns are spread as evenly as possible across the Physarum steps until the next Life tick (30 at the default rates).
- Placing patterns or painting cells does not spawn actors or seed food. Only real Life ticks do. Edits while paused re-run the tracker so colors update immediately.

## Bridge: deaths → food

- Each Life cell that dies seeds food over its 16×16 block, in the color of the organism the cell belonged to on the previous tick.
- Applied by a render pass drawing one 16×16 quad per death into the food texture with additive blending: RGB += `organismColor.rgb · foodPerDeath`, alpha += `foodPerDeath`.
- Always applied in one go on the first Physarum step after the Life tick (the burst/trickle toggle applies only to actor spawns).
- Food is the only thing written to the food texture besides fade and clear: **actors do not deposit food** (a deliberate departure from Particles).

## Physarum

### Fidelity to Particles

Port `~/src/Particles/Particles Shared/Shaders.metal` behaviour, with these **fixes**:

1. **Hue wrap in `hsv_mix`.** The original wrap branch is wrong when `a.h > b.h`. Use the shortest arc correctly:
   ```
   if (abs(a.h - b.h) <= 0.5) h = mix(a.h, b.h, d)
   else if (a.h < b.h)        h = fract(mix(a.h + 1, b.h, d))
   else                       h = fract(mix(a.h, b.h + 1, d))
   s = mix(a.s, b.s, d); v = mix(a.v, b.v, d)
   ```
   Example: a.h=0.9, b.h=0.1, d=0.25 → 0.95.
2. **Food term.** Convert sensed food RGB to HSV before `hsv_distance`, and invert the broken condition so food attracts as intended: `foodVal = food_sensitivity / max(d, 0.01)`, where `d = hsv_distance(rgb2hsv(food.rgb), seedHsv)` (the 0.01 floor keeps it finite). Food lowers a candidate's score (better), i.e. the candidate score is `dist - foodVal`. (The original adds `foodVal`; with the fixed formula, subtraction makes closer-hue food more attractive.)
3. **Exhaustion uses food amount.** Death by exhaustion tests the food texture's alpha (accumulated amount): `food.a >= food_exhaustion`. The original used `length(food.rgba)`, which pure palette colors can never push to its default threshold of 2.0.
4. **Candidate selection.** Store the full score (`dist ± foodVal`) in `min_distance`, not just `dist`, so all candidates are compared consistently.
5. **Blur read/write hazard.** Diffusion reads texture A and writes texture B (ping-pong).
6. **Stale pheromone after respawn.** Sample pheromone for the deposit color after respawn handling, at the actor's final position.

Things deliberately **kept** for visual character:

- `rgba8unorm` trail and food textures (8-bit quantization).
- Subtractive (linear) fade, not multiplicative.
- Nearest-pixel sensing with out-of-bounds samples reading as zero.
- Sensor geometry: offsets `±(i/lookSlices)·lookRadians` for i in 0..lookSlices-1 (straight-ahead sampled twice; full `lookRadians` never reached).
- Linear (non-circular) `mix` of direction for momentum, then `fmod` by 2π.
- Speed ramps up by `rand·0.01` per step, capped at `maxSpeed`.
- `hsv_distance`: `sqrt(hd² + sd² + vd²)` with circular hue difference `hd = min(|Δh|, 1-|Δh|)`.
- Deposit color drifts: `color = hsv_mix(pheromoneAtLoc, color, intensity)`; sensing always uses the immutable seed color.
- Deposit overwrites the trail pixel (last writer wins).
- `lock_to_hsv_angles` / `dominant_color` behaviour on respawn color.
- Per-actor xorshift RNG.

### GPU resources

- **Actor buffer** (storage), capacity `poolSize` (default 2^17 = 131072, adjustable). Per actor: position (vec2f), direction (f32), speed (f32), seed color (vec4f), deposit color (vec4f), age (u32), life (u32), alive (u32), rng state (u32). Slots start not alive.
- **Ring head:** an `atomic<u32>` in a storage buffer; the slot for an insert is `atomicAdd(head, 1) % poolSize`. This is the only insertion path, so the CPU and GPU never coordinate on the head.
- **Child queue:** storage buffer of capacity `poolSize / 8` with an atomic count. Children beyond capacity in a step are dropped.
- **Spawn request buffer:** CPU-uploaded Life spawn requests for this step, plus a count.
- **Trail textures:** two `rgba8unorm` 2048×2048 textures (A, B), ping-pong.
- **Food texture:** one `rgba8unorm` 2048×2048 texture.
- **Uniforms:** all parameters below plus step counter and field size.

### One Physarum step

1. **Agent pass (compute).** For each alive actor: move (`pos += speed·(cos dir, sin dir)`); wrap or kill on out-of-bounds per `wrapBounds`; age++; death check (`age > life`, or out-of-bounds without wrap, or `food@pos.a >= food_exhaustion`) → respawn per `always_spawn_from_parent`; sense (`lookSlices` × 2 sensors at `lookDistance`, reading trail A and food); turn (`directionRandomization`, `directionMomentum`); speed ramp; compute deposit color from trail A at the final position. Then with probability `spawnProbability`, append a child to the child queue.
2. **Inject pass (compute).** For each Life spawn request and each queued child, write a new alive actor at `atomicAdd(head,1) % poolSize`. Reset the child queue count.
3. **Diffuse/fade pass.** Every `blurInterval` steps: read trail A, write trail B with
   - `blurMultiplier == 0`: `rgb - fadeDecrement`
   - otherwise: `max(0, (sum3x3 + center·blurMultiplier) / (blurMultiplier + 9)) - fadeDecrement`
   On steps where it doesn't run, copy A → B.
4. **Deposit pass (render).** Draw each alive actor as a 1-px point into trail B (blend: replace RGB). Actors do not write to the food texture.
5. **Food seed + fade.** On the first step after a Life tick, draw the death food quads (see Bridge: deaths → food). Every `foodFadeInterval` steps: `rgba - foodFadeDecrement`, clamped at 0 (alpha fades too, so exhaustion zones expire).
6. Swap A and B.

### Lifecycle

Actors enter the pool three ways, all through the ring head:

1. **Life births** (bridge, above).
2. **Reproduction.** Each step, each alive actor emits a child with probability `spawnProbability`. The child: position = parent position offset perpendicular to the parent's direction by a random amount in [-`spawnRandomOffset`, +`spawnRandomOffset`]; direction = parent direction + uniform random in [-`directionVariance`, +`directionVariance`]; speed = parent speed × uniform random in [1-`speedVariance`, 1+`speedVariance`] (clamped to [`minSpeed`, `maxSpeed`]); seed color and deposit color copied from parent; age 0; life from `life`.
3. **Respawn on death,** in the actor's own slot, per `always_spawn_from_parent` (matching Particles): > 0 pick a random pool slot as parent; if that parent is alive, copy its position, direction and current deposit color (the color, passed through `dominant_color`, becomes both the respawned actor's deposit color and its new seed color, so colors can migrate between colonies as in Particles); if the parent slot is not alive, behave as = 0. = 0 respawn at a uniformly random field position keeping its own seed color (through `dominant_color`). Then offset exactly `spawnRandomOffset` perpendicular to the direction, to a random side, and wrap/clamp into the field. < 0 no respawn (slot becomes not alive). Speed resets to `minSpeed`, age to 0.

Actors leave the pool when evicted by the ring (oldest overwritten) or by death with no respawn.

### Parameters

One shared set, all live-editable in the panel. Defaults come from Particles `config.json` unless noted.

| Name | Default | Range |
|---|---|---|
| `poolSize` | 131072 (2^17) | 2^14 – 2^22 (powers of two; options above the device's `maxStorageBufferBindingSize / 64` are hidden) |
| `lookSlices` | 3 | 1 – 8 |
| `lookRadians` | 1.0 | 0 – π |
| `lookDistance` | 10 | 1 – 64 |
| `directionRandomization` | 0.1 | 0 – 2 |
| `directionMomentum` | 0.1 | 0 – 1 |
| `minSpeed` | 0.3 | 0 – 5 |
| `maxSpeed` | 2.0 | 0 – 10 |
| `intensity` | 1.0 | 0 – 2 |
| `foodPerDeath` | 0.5 | 0 – 1 |
| `food_exhaustion` | 1.0 | 0 – 1 |
| `food_sensitivity` | 0.1 | 0 – 1 |
| `life` | 10000 (steps) | 1 – 100000 |
| `always_spawn_from_parent` | 1 | -1, 0, 1 |
| `spawnRandomOffset` | 1.0 | 0 – 16 |
| `spawnProbability` | 0.001 | 0 – 0.05 |
| `directionVariance` | π/4 | 0 – π |
| `speedVariance` | 0.1 | 0 – 1 |
| `lock_to_hsv_angles` | 0 | 0 – 12 (integer) |
| `hsv_angle_offset` | 1.0 | 0 – 1 |
| `hsv_saturation_multiplier` | 1 | 0 – 2 |
| `hsv_value_multiplier` | 1 | 0 – 2 |
| `fadeDecrement` (trail) | 0.01 | 0 – 0.1 |
| `blurMultiplier` | 0 | 0 – 16 |
| `blurInterval` | 1 | 1 – 10 |
| `foodFadeDecrement` | 0.002 | 0 – 0.1 |
| `foodFadeInterval` | 1 | 1 – 10 |
| `wrapBounds` | true | bool |
| `rngSeed` | 1 | integer |

Changing `poolSize` reallocates the actor buffer and clears all actors (Life is unaffected).

## Rendering

- The Physarum field is 2048×2048. The canvas displays it scaled to fit the window (square, aspect preserved).
- Composite order: Physarum trail (with `physarumOpacity`) then Life cells (with `lifeOpacity`) over a black background.
- Life cells: 16×16-field-pixel squares in their organism's color.
- Placement ghost: translucent preview of the selected pattern at the cursor.

## UI

lil-gui panel folders:

- **Layers:** `lifeOpacity` (default 0.6), `physarumOpacity` (default 1.0), food view toggle (also key **T**, as in Particles) that shows the food texture in place of the trail.
- **Life:** play/pause, step, clear, random fill + density (default 0.2), tick rate (default 1 Hz, range 0.25 – 8 Hz).
- **Bridge:** `actorsPerBirth` (default 16, range 0 – 256), spawn mode (burst / trickle).
- **Physarum:** all parameters above, grouped (Sensing, Movement, Deposit & Color, Food, Fade, Reproduction & Lifecycle, World); buttons: clear trail, clear food, clear actors.
- **Readouts:** fps, Physarum steps/s, alive actors, organism count, inserts/s from Life vs from reproduction.

Pattern placement (ported from life-ambient): a palette of the 14 patterns grouped by category (drone, pulse, voyager, fountain, wildcard) plus a "paint cells" tool; ghost preview follows the cursor; **R** rotates 90° clockwise (resets on tool change); click stamps the pattern anchored top-left, or toggles a cell in paint mode.

Getting actor and organism counts for readouts requires GPU readback; do it asynchronously at most a few times per second so it never stalls the frame loop.

## Error handling

- No `navigator.gpu` or no adapter/device: show a clear "WebGPU not available" message in place of the canvas; do not start.
- Device lost: show a message with a reload button.
- WGSL compile errors: log with line info from `getCompilationInfo()`; show an on-screen error overlay in dev builds.
- `poolSize` change: reallocate and clear actors.

## Testing

TDD throughout. All three test types are required.

**First task:** a feasibility check that a minimal WebGPU compute pass runs and reads back under Vitest browser mode / Playwright on this machine (macOS, Chrome). If headless WebGPU is unreliable, run GPU and e2e tests headed.

**Unit (Vitest, Node):**
- Life engine: life-ambient's tests (blinker period, glider displacement, Gosper gun 41 cells at gen 30), dead edges.
- Tracker: life-ambient's tests ported.
- Palette: new organism gets a palette color; color persists with id; split fragments get new colors; merge keeps the dominant id's color; seeded determinism.
- Patterns: rotation and placement (ported tests).
- Death food: each death produces one food-seed request with the dying cell's previous-tick organism color and block; edits while paused produce none.
- Spawner: positions within the 16×16 block; count = births × `actorsPerBirth`; color = organism color; burst puts all on one step; trickle distributes across steps with total preserved.
- CPU reference math (`src/physarum/reference.ts`): `rgb2hsv`/`hsv2rgb`, `hsv_mix` including the wrap case (0.9, 0.1, 0.25 → 0.95) and the reverse case, `hsv_distance`, ring slot arithmetic.

**Integration (Vitest browser mode, real WebGPU):**
- `hsv_mix` / `hsv_distance` in WGSL match the CPU reference over a sample grid.
- Inject pass: wraps around the ring and evicts the oldest; Life requests and children both inserted.
- Agent pass: a seeded single-actor step matches expected position/direction; out-of-bounds wrap vs kill.
- Diffuse/fade: known input texture → expected output for both blur modes.
- Food seed: a death quad adds `color·foodPerDeath` / `foodPerDeath` alpha over exactly the 16×16 block; exhaustion kills an actor on food with alpha ≥ `food_exhaustion` and not below; food steering prefers a sensor over matching-hue food to one over other-hue food.
- Reproduction: `spawnProbability = 1` doubles alive actors (up to capacity); `= 0` adds none.

**End-to-end (Playwright, Chrome with WebGPU):**
- Load the page; no console errors.
- Place a glider, step Life: organism count readout = 1; alive actors > 0 after the next tick; canvas contains pixels of the glider's palette color.
- Place a blinker and step Life once: with the food view on, the canvas contains the blinker's palette color in the blocks of the two cells that died.
- Change `poolSize`: alive actors resets to 0.
- No-WebGPU path shows the fallback message.

## Future work (not in this spec)

- MIDI output driven by tracker events and metrics (reuse life-ambient's `scale.ts`, `arpeggio.ts`, `allocation.ts`, `probe-midi.ts`).
- Toroidal Life (needs tracker changes).
- Reproduction conditioned on local pheromone.
- Birth flash / death fade on the Life layer.
- Saving/loading parameter presets.
