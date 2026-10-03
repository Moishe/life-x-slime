# Life x Physarum Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser WebGPU app where a 128×128 Conway's Life board (CPU, 1 Hz) seeds actors and food into a 2048×2048 HSV-affinity Physarum simulation (GPU, 30 Hz), with live controls.

**Architecture:** Life (engine + organism tracker + palette) runs in TypeScript on the CPU and produces colored births/deaths each tick. A bridge turns births into actor spawn requests (burst or trickle) and deaths into food seeds. The Physarum simulation is a set of small WebGPU passes (diffuse, food seed, food fade, agent, inject, deposit) orchestrated by `PhysarumSim`; a compositor draws trail/food + Life cells + placement ghost to the canvas. `App` owns the clocks and wiring; `main.ts` bootstraps and attaches the UI.

**Tech Stack:** TypeScript (strict), Vite 6, raw WebGPU + WGSL, lil-gui, Vitest 3.2 (Node unit tests + browser mode via Playwright for GPU tests), Playwright (e2e), pngjs (e2e pixel checks).

**Spec:** `docs/superpowers/specs/2026-10-03-life-x-physarum-design.md` — read it before starting any task. When this plan and the spec disagree, stop and ask.

## Global Constraints

- npm for dependencies; `npm test` = unit, `npm run test:gpu` = GPU integration, `npm run test:e2e` = Playwright. (Not uv/pytest: this is not a Python project.)
- TypeScript strict mode; 2-space indent, single quotes, semicolons (matches the life-ambient code being ported).
- Life board 128×128, dead edges, B3/S23. Physarum field 2048×2048. Cell block = 16×16 field pixels. Physarum 30 Hz fixed step; Life default 1 Hz.
- Default pool 2^17 = 131072 actors; pool sizes are powers of two, 2^14–2^22, filtered by device limits.
- Actor struct is exactly 64 bytes (layout in Task 5). Uniform structs contain only f32/u32/i32 scalars.
- Trail and food textures are `rgba8unorm`.
- Compute passes over actors use `@workgroup_size(256)`.
- `src/color.ts` and `src/physarum/shaders/common.wgsl` implement the same color math and must stay in sync (Task 7 tests enforce it).
- No mock modes anywhere. GPU tests run on a real WebGPU device.
- Test output must be pristine: no stray console warnings/errors.
- Never remove existing comments. No "new/improved/enhanced" in names.
- Every task ends with a commit with a message under 10 words, ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Tab hidden then resumed** (a single frame `dt` of many seconds): the Physarum clock must run at most 4 steps and the Life clock at most 1 tick, not hundreds. Pinned in Task 12 (clock cap test).
2. **Huge birth bursts** (random fill at density 0.5 with `actorsPerBirth` 256 ≈ 2M actors): must not allocate millions of objects or exceed a step's insert capacity — births are trimmed to the pool size, the queue is capped, and steps take at most `maxSpawnsPerStep`. Pinned in Task 6 (trim/cap/spill tests) and Task 11 (sim rejects oversize steps).
3. **Pointer on a scaled/offset canvas** (window resized, high DPR, sidebar offset): clicks map to the cell under the cursor; points outside the canvas map to nothing. Pinned in Task 12 (`cellFromPointer` tests).
4. **Placing a pattern that hangs off the board edge**: the ghost shows only in-board cells and placement doesn't throw or wrap. Pinned in Task 12 (`ghostCells` clipping) and Task 4 (`place` near the edge).
5. **Changing pool size mid-run**: counters (including the ring head and children-inserted total) reset, queued spawns are dropped, and readouts never show negative rates. Pinned in Task 11 (`setPoolSize` resets counters) and Task 12 (`RateMeter` ignores negative adds).

---

## File Structure

```
package.json, tsconfig.json, vitest.config.ts, playwright.config.ts, index.html
src/
  rng.ts                      seeded CPU RNG
  color.ts                    CPU reference color math (mirrors common.wgsl)
  life/
    engine.ts                 (ported) Life grid
    geometry.ts               (ported) tracker helper
    patterns.ts               (ported) pattern library
    tracker.ts                (ported) organism tracker
    palette.ts                8-color palette + organism→color
    world.ts                  engine+tracker+palette; colored births/deaths
  bridge/
    spawner.ts                births→actors, deaths→food seeds, SpawnScheduler
  physarum/
    params.ts                 PhysarumParams, defaults, uniform packing, pool sizes
    layout.ts                 ActorRecord/FoodSeed packing, counters, ringSlot
    buffers.ts                GPU buffer/texture factories
    agent-pass.ts, inject-pass.ts, diffuse-pass.ts, deposit-pass.ts, food-pass.ts
    simulation.ts             PhysarumSim orchestrator
    shaders/common.wgsl, agent.wgsl, inject.wgsl, diffuse.wgsl, deposit.wgsl,
            food-seed.wgsl, food-fade.wgsl
  gpu/
    shader.ts                 createModule + compile error reporting
    device.ts                 initGpu
  render/
    compositor.ts, composite.wgsl
    texels.ts                 Life/ghost texel builders
  app/
    settings.ts               constants + AppSettings + seedFromUrl
    clock.ts                  FixedStepClock
    rates.ts                  RateMeter
    app.ts                    App (clocks, wiring, render)
  ui/
    placement.ts              pointer→cell, ghost cells
    panel.ts                  lil-gui panel
    pattern-bar.ts            pattern buttons
    readouts.ts               readout DOM
  main.ts, style.css
tests/unit/*.test.ts          Vitest, Node
tests/gpu/*.test.ts           Vitest browser mode, real WebGPU
e2e/*.spec.ts                 Playwright
```

---

### Task 1: Project scaffold and WebGPU test feasibility

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`
- Modify: `.gitignore`
- Create: `tests/gpu/helpers.ts`, `tests/gpu/webgpu-smoke.test.ts`

**Interfaces:**
- Produces: `getDevice(): Promise<GPUDevice>` and `readBuffer(device, buffer, size): Promise<ArrayBuffer>` in `tests/gpu/helpers.ts`; npm scripts `test`, `test:gpu`, `test:e2e`, `typecheck`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "life-x-physarum",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --project unit",
    "test:gpu": "vitest run --project gpu",
    "test:e2e": "playwright test",
    "test:all": "npm run typecheck && npm test && npm run test:gpu && npm run test:e2e"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:
```bash
npm install lil-gui
npm install -D typescript vite@^6 vitest@^3.2 @vitest/browser@^3.2 playwright @playwright/test @webgpu/types pngjs @types/pngjs @types/node
npx playwright install chromium
```
Expected: installs succeed; `package.json` gains `dependencies` and `devDependencies`.

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["@webgpu/types", "vite/client", "node"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true
  },
  "include": ["src", "tests", "e2e", "vitest.config.ts", "playwright.config.ts"]
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

// Unit tests run in Node. GPU tests run in real Chromium with WebGPU enabled.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'gpu',
          include: ['tests/gpu/**/*.test.ts'],
          browser: {
            enabled: true,
            provider: 'playwright',
            headless: true,
            instances: [
              {
                browser: 'chromium',
                launch: { channel: 'chromium', args: ['--enable-unsafe-webgpu'] },
              },
            ],
          },
        },
      },
    ],
  },
});
```

- [ ] **Step 5: Add test artifacts to `.gitignore`**

Append these lines to `.gitignore` (keep existing lines):
```
__screenshots__/
.vitest-attachments/
```

- [ ] **Step 6: Write the failing smoke test**

Create `tests/gpu/webgpu-smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { getDevice, readBuffer } from './helpers';

describe('WebGPU in the test browser', () => {
  it('runs a compute shader and reads the result back', async () => {
    const device = await getDevice();
    const input = new Float32Array([1, 2, 3, 4]);
    const buffer = device.createBuffer({
      size: input.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buffer, 0, input);
    const module = device.createShaderModule({
      code: `
        @group(0) @binding(0) var<storage, read_write> data: array<f32>;
        @compute @workgroup_size(4)
        fn main(@builtin(global_invocation_id) id: vec3u) {
          data[id.x] = data[id.x] * 2.0;
        }`,
    });
    const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer } }],
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(1);
    pass.end();
    device.queue.submit([encoder.finish()]);

    const out = new Float32Array(await readBuffer(device, buffer, input.byteLength));
    expect(Array.from(out)).toEqual([2, 4, 6, 8]);
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npm run test:gpu`
Expected: FAIL — cannot resolve `./helpers`.

- [ ] **Step 8: Write the helpers**

Create `tests/gpu/helpers.ts`:
```ts
let devicePromise: Promise<GPUDevice> | null = null;

// One shared device for every GPU test in the file.
export function getDevice(): Promise<GPUDevice> {
  devicePromise ??= (async () => {
    if (!navigator.gpu) throw new Error('navigator.gpu is missing: WebGPU is not enabled in the test browser');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No WebGPU adapter available in the test browser');
    return adapter.requestDevice();
  })();
  return devicePromise;
}

export async function readBuffer(device: GPUDevice, source: GPUBuffer, size: number): Promise<ArrayBuffer> {
  const staging = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(source, 0, staging, 0, size);
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const copy = staging.getMappedRange().slice(0);
  staging.unmap();
  staging.destroy();
  return copy;
}
```

- [ ] **Step 9: Run it to verify it passes**

Run: `npm run test:gpu`
Expected: PASS, 1 test.

**If it fails with "navigator.gpu is missing" or "No WebGPU adapter":** headless Chromium on this Mac lacks WebGPU. Try, in order, re-running after each change:
1. In `vitest.config.ts`, set `headless: false` (a Chromium window will flash open during GPU tests).
2. If Google Chrome is installed, change `channel: 'chromium'` to `channel: 'chrome'`.

Record what worked as a comment above the `browser:` block in `vitest.config.ts` (e.g. `// headless Chromium lacks WebGPU on macOS; GPU tests run headed.`). Use the same setting for Playwright in Task 13. If nothing works, STOP and ask the user.

- [ ] **Step 10: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore tests/gpu
git commit -m "Scaffold project with WebGPU test harness

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Port the Life engine, patterns, and tracker

**Files:**
- Create (copied): `src/life/engine.ts`, `src/life/patterns.ts`, `src/life/tracker.ts`, `src/life/geometry.ts`
- Create (copied): `tests/unit/life-engine.test.ts`, `tests/unit/patterns.test.ts`, `tests/unit/tracker-grouping.test.ts`, `tests/unit/tracker.test.ts`

**Interfaces:**
- Produces (unchanged from life-ambient except paths and default size):
  - `engine.ts`: `interface Cell { x: number; y: number }`, `interface TickResult { births: Cell[]; deaths: Cell[] }`, `class LifeEngine { constructor(width = 128, height = 128); width; height; get(x,y): boolean; set(x,y,alive): void; clear(): void; liveCells(): Cell[]; population(): number; tick(): TickResult }`
  - `patterns.ts`: `type PatternCategory = 'drone' | 'pulse' | 'voyager' | 'fountain' | 'wildcard'`, `interface Pattern { id; name; category; cells: Cell[]; width; height }`, `PATTERNS: Pattern[]`, `fromRows(rows): Cell[]`, `rotateCells(cells, quarterTurns): Cell[]`, `placePattern(engine, pattern, ox, oy, quarterTurns = 0): void`
  - `tracker.ts`: `cellKey(x, y): number`, `groupCells(cells): Cell[][]`, `interface ClusterMetrics { id; cells; cellCount; centroid; radial; pan; aspect; delta; velocity }`, `interface ClusterEvents { born: ClusterMetrics[]; updated: ClusterMetrics[]; died: number[] }`, `class ClusterTracker { constructor(width, height); update(liveCells: Cell[]): ClusterEvents }`

- [ ] **Step 1: Copy the source and tests**

```bash
mkdir -p src/life tests/unit
cp ~/src/life-ambient/src/engine/life.ts src/life/engine.ts
cp ~/src/life-ambient/src/engine/patterns.ts src/life/patterns.ts
cp ~/src/life-ambient/src/tracker/cluster.ts src/life/tracker.ts
cp ~/src/life-ambient/src/geometry.ts src/life/geometry.ts
cp ~/src/life-ambient/tests/life.test.ts tests/unit/life-engine.test.ts
cp ~/src/life-ambient/tests/patterns.test.ts tests/unit/patterns.test.ts
cp ~/src/life-ambient/tests/cluster-grouping.test.ts tests/unit/tracker-grouping.test.ts
cp ~/src/life-ambient/tests/cluster-tracker.test.ts tests/unit/tracker.test.ts
```

- [ ] **Step 2: Fix import paths**

```bash
sed -i '' "s#from './life'#from './engine'#" src/life/patterns.ts
sed -i '' "s#from '../engine/life'#from './engine'#; s#from '../geometry'#from './geometry'#" src/life/tracker.ts
sed -i '' "s#'../src/engine/life'#'../../src/life/engine'#; s#'../src/engine/patterns'#'../../src/life/patterns'#; s#'../src/tracker/cluster'#'../../src/life/tracker'#" tests/unit/*.test.ts
grep -rn "from '" src/life tests/unit
```
Expected: every import points at `./engine`, `./geometry`, `../../src/life/...` or `vitest`.

- [ ] **Step 3: Run the ported tests**

Run: `npm test`
Expected: PASS (all ported tests green before any change).

- [ ] **Step 4: Change the default-size test to 128 (failing)**

In `tests/unit/life-engine.test.ts`, replace the first test with:
```ts
  it('defaults to 128x128 and starts empty', () => {
    const e = new LifeEngine();
    expect(e.width).toBe(128);
    expect(e.height).toBe(128);
    expect(e.population()).toBe(0);
  });
```
And add, inside the same `describe`, a dead-edge test:
```ts
  it('treats cells beyond the edge as dead (no wrapping)', () => {
    const e = new LifeEngine(10, 10);
    // A blinker lying along the left edge: the vertical phase would need x = -1.
    setCells(e, [[0, 4], [0, 5], [0, 6]]);
    e.tick();
    expect(new Set(e.liveCells().map(c => `${c.x},${c.y}`))).toEqual(new Set(['0,5', '1,5']));
  });
```

- [ ] **Step 5: Run to verify the size test fails**

Run: `npx vitest run --project unit tests/unit/life-engine.test.ts`
Expected: FAIL — `expected 96 to be 128`. The dead-edge test passes (the engine is already bounded).

- [ ] **Step 6: Change the default size**

In `src/life/engine.ts`, change `constructor(width = 96, height = 96)` to `constructor(width = 128, height = 128)`.

- [ ] **Step 7: Run all unit tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/life tests/unit
git commit -m "Port Life engine, patterns and tracker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Seeded RNG and reference color math

**Files:**
- Create: `src/rng.ts`, `src/color.ts`
- Test: `tests/unit/rng.test.ts`, `tests/unit/color.test.ts`

**Interfaces:**
- Produces:
  - `rng.ts`: `type Rng = () => number` (floats in [0,1)); `mulberry32(seed: number): Rng`; `randomNonZeroU32(rng: Rng): number`
  - `color.ts`: `type Vec3 = [number, number, number]`; `rgb2hsv(rgb: Vec3): Vec3`; `hsv2rgb(hsv: Vec3): Vec3`; `hsvDistance(a: Vec3, b: Vec3): number` (both HSV); `hsvMix(rgb1: Vec3, rgb2: Vec3, d: number): Vec3`; `interface HueLock { lockToHsvAngles: number; hsvAngleOffset: number; hsvSaturationMultiplier: number; hsvValueMultiplier: number }`; `dominantColor(rgb: Vec3, lock: HueLock): Vec3`

- [ ] **Step 1: Write failing RNG tests**

Create `tests/unit/rng.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mulberry32, randomNonZeroU32 } from '../../src/rng';

describe('mulberry32', () => {
  it('is deterministic for a seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 5; i++) expect(a()).toBe(b());
  });

  it('differs across seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it('returns values in [0, 1)', () => {
    const r = mulberry32(7);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 10000; i++) {
      const v = r();
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(1);
  });
});

describe('randomNonZeroU32', () => {
  it('returns odd unsigned 32-bit integers', () => {
    const r = mulberry32(3);
    for (let i = 0; i < 1000; i++) {
      const v = randomNonZeroU32(r);
      expect(Number.isInteger(v)).toBe(true);
      expect(v % 2).toBe(1);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(0xffffffff);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project unit tests/unit/rng.test.ts`
Expected: FAIL — cannot resolve `../../src/rng`.

- [ ] **Step 3: Implement `src/rng.ts`**

```ts
export type Rng = () => number;

// mulberry32: a small seedable PRNG returning floats in [0, 1).
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A random u32 that is never 0, for seeding the GPU's per-actor xorshift32.
export function randomNonZeroU32(rng: Rng): number {
  return (Math.floor(rng() * 4294967296) | 1) >>> 0;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run --project unit tests/unit/rng.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing color tests**

Create `tests/unit/color.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { dominantColor, hsv2rgb, hsvDistance, hsvMix, rgb2hsv, type Vec3 } from '../../src/color';

const close = (actual: number[], expected: number[], digits = 5) =>
  expected.forEach((e, i) => expect(actual[i]).toBeCloseTo(e, digits));

const NO_LOCK = { lockToHsvAngles: 0, hsvAngleOffset: 0, hsvSaturationMultiplier: 1, hsvValueMultiplier: 1 };

describe('rgb2hsv / hsv2rgb', () => {
  it('converts primaries', () => {
    close(rgb2hsv([1, 0, 0]), [0, 1, 1]);
    close(rgb2hsv([0, 1, 0]), [1 / 3, 1, 1]);
    close(rgb2hsv([0, 0, 1]), [2 / 3, 1, 1]);
  });

  it('maps black and grey to hue 0, saturation 0', () => {
    close(rgb2hsv([0, 0, 0]), [0, 0, 0]);
    close(rgb2hsv([0.5, 0.5, 0.5]), [0, 0, 0.5]);
  });

  it('round-trips', () => {
    const samples: Vec3[] = [[0.2, 0.4, 0.6], [0.9, 0.1, 0.3], [0.5, 0.5, 0.1]];
    for (const rgb of samples) close(hsv2rgb(rgb2hsv(rgb)), rgb, 4);
  });
});

describe('hsvDistance', () => {
  it('uses circular hue difference', () => {
    expect(hsvDistance([0.95, 1, 1], [0.05, 1, 1])).toBeCloseTo(0.1, 6);
  });

  it('combines hue, saturation and value differences', () => {
    expect(hsvDistance([0, 1, 1], [0, 0, 0])).toBeCloseTo(Math.SQRT2, 6);
  });
});

describe('hsvMix', () => {
  const hueOf = (rgb: Vec3) => rgb2hsv(rgb)[0];

  it('wraps forward across red (0.9 -> 0.1 at 0.25 gives 0.95)', () => {
    expect(hueOf(hsvMix(hsv2rgb([0.9, 1, 1]), hsv2rgb([0.1, 1, 1]), 0.25))).toBeCloseTo(0.95, 4);
  });

  it('wraps backward across red (0.1 -> 0.9 at 0.25 gives 0.05)', () => {
    expect(hueOf(hsvMix(hsv2rgb([0.1, 1, 1]), hsv2rgb([0.9, 1, 1]), 0.25))).toBeCloseTo(0.05, 4);
  });

  it('interpolates directly when no wrap is shorter', () => {
    expect(hueOf(hsvMix(hsv2rgb([0.2, 1, 1]), hsv2rgb([0.4, 1, 1]), 0.5))).toBeCloseTo(0.3, 4);
  });

  it('returns the second color at d = 1', () => {
    close(hsvMix([0, 0, 1], [1, 0, 0], 1), [1, 0, 0], 4);
  });
});

describe('dominantColor', () => {
  it('returns the input unchanged when hue locking is off', () => {
    expect(dominantColor([0.2, 0.4, 0.6], NO_LOCK)).toEqual([0.2, 0.4, 0.6]);
  });

  it('quantizes hue to lockToHsvAngles steps, rounding half up', () => {
    const lock = { ...NO_LOCK, lockToHsvAngles: 4 };
    expect(rgb2hsv(dominantColor(hsv2rgb([0.3, 1, 1]), lock))[0]).toBeCloseTo(0.25, 4);
  });

  it('keeps hues above 0.5 (no fold into [0, 0.5])', () => {
    const lock = { ...NO_LOCK, lockToHsvAngles: 4 };
    expect(rgb2hsv(dominantColor(hsv2rgb([0.7, 1, 1]), lock))[0]).toBeCloseTo(0.75, 4);
  });

  it('treats an offset of 1.0 as no offset', () => {
    const lock = { ...NO_LOCK, lockToHsvAngles: 4, hsvAngleOffset: 1 };
    expect(rgb2hsv(dominantColor(hsv2rgb([0.3, 1, 1]), lock))[0]).toBeCloseTo(0.25, 4);
  });

  it('scales and clamps saturation and value', () => {
    const lock = { lockToHsvAngles: 4, hsvAngleOffset: 0, hsvSaturationMultiplier: 0.5, hsvValueMultiplier: 2 };
    close(rgb2hsv(dominantColor(hsv2rgb([0.25, 1, 0.4]), lock)), [0.25, 0.5, 0.8], 4);
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `npx vitest run --project unit tests/unit/color.test.ts`
Expected: FAIL — cannot resolve `../../src/color`.

- [ ] **Step 7: Implement `src/color.ts`**

```ts
// CPU reference for the color math in src/physarum/shaders/common.wgsl.
// Keep the two in sync; tests/gpu/color.test.ts checks that they agree.
// Hue, saturation and value are all in [0, 1].
export type Vec3 = [number, number, number];

const fract = (x: number): number => x - Math.floor(x);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const step = (edge: number, x: number): number => (x < edge ? 0 : 1);
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

// Branchless conversion, ported from Particles' Shaders.metal.
export function rgb2hsv([r, g, b]: Vec3): Vec3 {
  const s1 = step(b, g);
  const p = [mix(b, g, s1), mix(g, b, s1), mix(-1, 0, s1), mix(2 / 3, -1 / 3, s1)];
  const s2 = step(p[0], r);
  const q = [mix(p[0], r, s2), p[1], mix(p[3], p[2], s2), mix(r, p[0], s2)];
  const d = q[0] - Math.min(q[3], q[1]);
  const e = 1.0e-10;
  const h = Math.abs(q[2] + (q[3] - q[1]) / (6 * d + e));
  return [h, d / (q[0] + e), q[0]];
}

export function hsv2rgb([h, s, v]: Vec3): Vec3 {
  const channel = (k: number): number => v * mix(1, clamp01(Math.abs(fract(h + k) * 6 - 3) - 1), s);
  return [channel(1), channel(2 / 3), channel(1 / 3)];
}

// Distance between two HSV colors, treating hue as circular.
export function hsvDistance(a: Vec3, b: Vec3): number {
  const dh = Math.abs(a[0] - b[0]);
  const hd = Math.min(dh, 1 - dh);
  const sd = a[1] - b[1];
  const vd = a[2] - b[2];
  return Math.sqrt(hd * hd + sd * sd + vd * vd);
}

// Blends two RGB colors in HSV space, going the short way around the hue circle.
// d is the weight toward rgb2.
export function hsvMix(rgb1: Vec3, rgb2: Vec3, d: number): Vec3 {
  const a = rgb2hsv(rgb1);
  const b = rgb2hsv(rgb2);
  const dh = Math.abs(a[0] - b[0]);
  let h: number;
  if (dh < 1 - dh) h = mix(a[0], b[0], d);
  else if (a[0] < b[0]) h = fract(mix(a[0] + 1, b[0], d));
  else h = fract(mix(a[0], b[0] + 1, d));
  return hsv2rgb([h, mix(a[1], b[1], d), mix(a[2], b[2], d)]);
}

export interface HueLock {
  lockToHsvAngles: number;
  hsvAngleOffset: number;
  hsvSaturationMultiplier: number;
  hsvValueMultiplier: number;
}

// Snaps a color's hue to one of lockToHsvAngles directions (0 = off), then
// offsets the hue and scales saturation/value.
export function dominantColor(rgb: Vec3, lock: HueLock): Vec3 {
  if (lock.lockToHsvAngles === 0) return rgb;
  const [hue, s, v] = rgb2hsv(rgb);
  const n = lock.lockToHsvAngles;
  const h = (Math.floor(hue * n + 0.5) / n + lock.hsvAngleOffset) % 1;
  return hsv2rgb([h, Math.min(1, s * lock.hsvSaturationMultiplier), Math.min(1, v * lock.hsvValueMultiplier)]);
}
```

- [ ] **Step 8: Run to verify pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/rng.ts src/color.ts tests/unit/rng.test.ts tests/unit/color.test.ts
git commit -m "Add seeded RNG and reference color math

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Organism palette and LifeWorld

**Files:**
- Create: `src/life/palette.ts`, `src/life/world.ts`
- Test: `tests/unit/palette.test.ts`, `tests/unit/world.test.ts`

**Interfaces:**
- Consumes: `ClusterTracker`, `ClusterEvents`, `cellKey` (Task 2); `LifeEngine`, `Cell` (Task 2); `placePattern`, `Pattern` (Task 2); `Rng` (Task 3); `hsv2rgb`, `Vec3` (Task 3).
- Produces:
  - `palette.ts`: `PALETTE_HUES_DEGREES: readonly number[]` (8 values), `PALETTE: readonly Vec3[]` (RGB 0–1), `class OrganismPalette { constructor(rng: Rng); apply(events: ClusterEvents): void; indexOf(organismId: number): number | undefined }`
  - `world.ts`: `interface ColoredCell { x: number; y: number; paletteIndex: number }`, `interface WorldTick { births: ColoredCell[]; deaths: ColoredCell[]; events: ClusterEvents }`, `class LifeWorld { constructor(width, height, rng: Rng); readonly engine: LifeEngine; tick(): WorldTick; toggle(x, y): void; place(pattern: Pattern, x, y, quarterTurns: number): void; clear(): void; randomFill(density: number): void; liveCells(): ColoredCell[]; organismCount(): number; latestEvents(): ClusterEvents }`

- [ ] **Step 1: Write failing palette tests**

Create `tests/unit/palette.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { OrganismPalette, PALETTE, PALETTE_HUES_DEGREES } from '../../src/life/palette';
import { ClusterTracker } from '../../src/life/tracker';
import { rgb2hsv } from '../../src/color';
import { mulberry32, type Rng } from '../../src/rng';

const cells = (list: [number, number][]) => list.map(([x, y]) => ({ x, y }));
// Deterministic test RNG that returns the given values in order.
const sequence = (values: number[]): Rng => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe('PALETTE', () => {
  it('has 8 fully saturated colors at 45 degree steps', () => {
    expect(PALETTE).toHaveLength(8);
    PALETTE.forEach((rgb, i) => {
      const [h, s, v] = rgb2hsv(rgb);
      expect(h * 360).toBeCloseTo(PALETTE_HUES_DEGREES[i], 3);
      expect(s).toBeCloseTo(1, 5);
      expect(v).toBeCloseTo(1, 5);
    });
  });
});

describe('OrganismPalette', () => {
  it('gives a newly born organism a random palette index', () => {
    const tracker = new ClusterTracker(128, 128);
    const palette = new OrganismPalette(sequence([0.5]));
    const ev = tracker.update(cells([[10, 10], [11, 10], [12, 10]]));
    palette.apply(ev);
    expect(palette.indexOf(ev.born[0].id)).toBe(4);
  });

  it('keeps an organism color while its id survives', () => {
    const tracker = new ClusterTracker(128, 128);
    const palette = new OrganismPalette(sequence([0.1, 0.9]));
    const ev1 = tracker.update(cells([[10, 10], [11, 10], [12, 10]]));
    palette.apply(ev1);
    const ev2 = tracker.update(cells([[11, 9], [11, 10], [11, 11]]));
    palette.apply(ev2);
    expect(ev2.updated[0].id).toBe(ev1.born[0].id);
    expect(palette.indexOf(ev1.born[0].id)).toBe(0);
  });

  it('forgets organisms that died', () => {
    const tracker = new ClusterTracker(128, 128);
    const palette = new OrganismPalette(sequence([0.3]));
    const ev1 = tracker.update(cells([[10, 10], [11, 10], [12, 10]]));
    palette.apply(ev1);
    palette.apply(tracker.update([]));
    expect(palette.indexOf(ev1.born[0].id)).toBeUndefined();
  });

  it('on a split, the largest fragment keeps the color and the other gets a new one', () => {
    const tracker = new ClusterTracker(128, 128);
    const palette = new OrganismPalette(sequence([0.1, 0.9]));
    const frag4: [number, number][] = [[10, 10], [11, 10], [10, 11], [11, 11]];
    const frag6: [number, number][] = [[16, 10], [17, 10], [18, 10], [16, 11], [17, 11], [18, 11]];
    const ev1 = tracker.update(cells([...frag4, [13, 10], [14, 10], ...frag6]));
    palette.apply(ev1);
    const ev2 = tracker.update(cells([...frag4, ...frag6]));
    palette.apply(ev2);
    expect(palette.indexOf(ev2.updated[0].id)).toBe(0);
    expect(palette.indexOf(ev2.born[0].id)).toBe(7);
  });

  it('on a merge, the surviving id keeps its color', () => {
    const tracker = new ClusterTracker(128, 128);
    const palette = new OrganismPalette(sequence([0.1, 0.6]));
    const small: [number, number][] = [[10, 10], [11, 10], [10, 11], [11, 11]];
    const big: [number, number][] = [[20, 10], [21, 10], [22, 10], [20, 11], [21, 11], [22, 11]];
    const ev1 = tracker.update(cells([...small, ...big]));
    palette.apply(ev1);
    const bigId = ev1.born.find(m => m.cellCount === 6)!.id;
    const bigColor = palette.indexOf(bigId);
    const ev2 = tracker.update(cells([...small, ...big, [13, 10], [15, 10], [17, 10], [18, 10]]));
    palette.apply(ev2);
    expect(ev2.updated[0].id).toBe(bigId);
    expect(palette.indexOf(bigId)).toBe(bigColor);
  });

  it('is deterministic for a seed', () => {
    const run = () => {
      const tracker = new ClusterTracker(128, 128);
      const palette = new OrganismPalette(mulberry32(5));
      const ev = tracker.update(cells([[2, 2], [3, 2], [40, 40], [41, 40], [80, 80], [81, 80]]));
      palette.apply(ev);
      return ev.born.map(m => palette.indexOf(m.id));
    };
    expect(run()).toEqual(run());
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project unit tests/unit/palette.test.ts`
Expected: FAIL — cannot resolve `../../src/life/palette`.

- [ ] **Step 3: Implement `src/life/palette.ts`**

```ts
import { hsv2rgb, type Vec3 } from '../color';
import type { Rng } from '../rng';
import type { ClusterEvents } from './tracker';

export const PALETTE_HUES_DEGREES: readonly number[] = [0, 45, 90, 135, 180, 225, 270, 315];

// Fully saturated, full-value colors spaced evenly around the hue circle.
export const PALETTE: readonly Vec3[] = PALETTE_HUES_DEGREES.map(deg => hsv2rgb([deg / 360, 1, 1]));

// Remembers which palette color each tracked organism wears. A color lasts as
// long as the organism's id: splits give new ids (new colors), merges keep one.
export class OrganismPalette {
  private colors = new Map<number, number>();

  constructor(private rng: Rng) {}

  apply(events: ClusterEvents): void {
    for (const id of events.died) this.colors.delete(id);
    for (const m of events.born) this.colors.set(m.id, Math.floor(this.rng() * PALETTE.length));
  }

  indexOf(organismId: number): number | undefined {
    return this.colors.get(organismId);
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run --project unit tests/unit/palette.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing world tests**

Create `tests/unit/world.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { LifeWorld } from '../../src/life/world';
import { PATTERNS } from '../../src/life/patterns';
import type { Rng } from '../../src/rng';

const sequence = (values: number[]): Rng => {
  let i = 0;
  return () => values[i++ % values.length];
};
const pattern = (id: string) => PATTERNS.find(p => p.id === id)!;

describe('LifeWorld', () => {
  it('colors births by their organism and deaths by the organism they left', () => {
    const world = new LifeWorld(128, 128, sequence([0.3]));
    world.place(pattern('blinker'), 60, 64, 0);
    const result = world.tick();
    expect(result.births).toHaveLength(2);
    expect(result.deaths).toHaveLength(2);
    for (const c of [...result.births, ...result.deaths]) expect(c.paletteIndex).toBe(2);
  });

  it('attributes a lone cell death to its previous organism', () => {
    const world = new LifeWorld(128, 128, sequence([0.7]));
    world.toggle(5, 5);
    const result = world.tick();
    expect(result.deaths).toEqual([{ x: 5, y: 5, paletteIndex: 5 }]);
    expect(result.births).toEqual([]);
    expect(world.organismCount()).toBe(0);
  });

  it('keeps separate organisms in separate stable colors', () => {
    const world = new LifeWorld(128, 128, sequence([0.0, 0.99]));
    world.place(pattern('block'), 10, 10, 0);
    world.place(pattern('block'), 100, 100, 0);
    world.tick();
    const byPosition = new Map(world.liveCells().map(c => [`${c.x},${c.y}`, c.paletteIndex]));
    expect(byPosition.get('10,10')).toBe(0);
    expect(byPosition.get('100,100')).toBe(7);
    expect(world.organismCount()).toBe(2);
  });

  it('edits retrack immediately without producing births or deaths', () => {
    const world = new LifeWorld(128, 128, sequence([0.5]));
    world.toggle(3, 3);
    expect(world.organismCount()).toBe(1);
    expect(world.liveCells()).toEqual([{ x: 3, y: 3, paletteIndex: 4 }]);
    world.clear();
    expect(world.organismCount()).toBe(0);
    expect(world.latestEvents().died).toHaveLength(1);
  });

  it('places a pattern hanging off the edge without wrapping', () => {
    const world = new LifeWorld(128, 128, sequence([0.5]));
    world.place(pattern('glider'), 126, 126, 0);
    for (const c of world.liveCells()) {
      expect(c.x).toBeLessThan(128);
      expect(c.y).toBeLessThan(128);
    }
    // Only the glider's top-right cell (127, 126) lands on the board.
    expect(world.liveCells()).toEqual([{ x: 127, y: 126, paletteIndex: 4 }]);
  });

  it('random fill respects density 0 and 1', () => {
    const world = new LifeWorld(16, 16, sequence([0.25, 0.75]));
    world.randomFill(0);
    expect(world.liveCells()).toHaveLength(0);
    world.randomFill(1);
    expect(world.liveCells()).toHaveLength(256);
  });

  it('exposes the latest tracker events after a tick', () => {
    const world = new LifeWorld(128, 128, sequence([0.5]));
    world.place(pattern('blinker'), 60, 64, 0);
    const result = world.tick();
    expect(world.latestEvents()).toBe(result.events);
    expect(result.events.updated).toHaveLength(1);
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `npx vitest run --project unit tests/unit/world.test.ts`
Expected: FAIL — cannot resolve `../../src/life/world`.

- [ ] **Step 7: Implement `src/life/world.ts`**

```ts
import type { Rng } from '../rng';
import { LifeEngine, type Cell } from './engine';
import { OrganismPalette } from './palette';
import { placePattern, type Pattern } from './patterns';
import { ClusterTracker, cellKey, type ClusterEvents } from './tracker';

export interface ColoredCell {
  x: number;
  y: number;
  paletteIndex: number;
}

export interface WorldTick {
  births: ColoredCell[];
  deaths: ColoredCell[];
  events: ClusterEvents;
}

// The Life board plus organism tracking and coloring. This is the single
// place other modules (rendering, the Physarum bridge, future MIDI) read
// organism state from.
export class LifeWorld {
  readonly engine: LifeEngine;
  private tracker: ClusterTracker;
  private palette: OrganismPalette;
  private owner = new Map<number, number>();
  private events: ClusterEvents = { born: [], updated: [], died: [] };

  constructor(
    readonly width: number,
    readonly height: number,
    private rng: Rng,
  ) {
    this.engine = new LifeEngine(width, height);
    this.tracker = new ClusterTracker(width, height);
    this.palette = new OrganismPalette(rng);
  }

  tick(): WorldTick {
    const { births, deaths } = this.engine.tick();
    // Deaths take the color of the organism the cell belonged to before this tick.
    const coloredDeaths = deaths.map(c => this.colored(c));
    this.retrack();
    return { births: births.map(c => this.colored(c)), deaths: coloredDeaths, events: this.events };
  }

  toggle(x: number, y: number): void {
    this.engine.set(x, y, !this.engine.get(x, y));
    this.retrack();
  }

  place(pattern: Pattern, x: number, y: number, quarterTurns: number): void {
    placePattern(this.engine, pattern, x, y, quarterTurns);
    this.retrack();
  }

  clear(): void {
    this.engine.clear();
    this.retrack();
  }

  randomFill(density: number): void {
    this.engine.clear();
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.rng() < density) this.engine.set(x, y, true);
      }
    }
    this.retrack();
  }

  liveCells(): ColoredCell[] {
    return this.engine.liveCells().map(c => this.colored(c));
  }

  organismCount(): number {
    return this.events.born.length + this.events.updated.length;
  }

  // Organism events from the most recent tracker update (a tick or an edit).
  latestEvents(): ClusterEvents {
    return this.events;
  }

  private colored(c: Cell): ColoredCell {
    const id = this.owner.get(cellKey(c.x, c.y));
    const paletteIndex = id === undefined ? undefined : this.palette.indexOf(id);
    return { x: c.x, y: c.y, paletteIndex: paletteIndex ?? 0 };
  }

  private retrack(): void {
    this.events = this.tracker.update(this.engine.liveCells());
    this.palette.apply(this.events);
    this.owner.clear();
    for (const m of [...this.events.born, ...this.events.updated]) {
      for (const c of m.cells) this.owner.set(cellKey(c.x, c.y), m.id);
    }
  }
}
```

- [ ] **Step 8: Run to verify pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/life/palette.ts src/life/world.ts tests/unit/palette.test.ts tests/unit/world.test.ts
git commit -m "Add organism palette and LifeWorld

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Physarum parameters and data layouts

**Files:**
- Create: `src/physarum/params.ts`, `src/physarum/layout.ts`
- Test: `tests/unit/params.test.ts`, `tests/unit/layout.test.ts`

**Interfaces:**
- Consumes: `Vec3` (Task 3).
- Produces:
  - `params.ts`: `interface PhysarumParams` (fields below), `DEFAULT_PARAMS`, `DEFAULT_POOL_SIZE = 131072`, `interface SimFrame { width; height; step; poolSize; maxChildren; spawnCount }`, `SIM_PARAMS_BYTES = 112`, `packSimParams(p, frame): ArrayBuffer`, `FADE_PARAMS_BYTES = 16`, `packFadeParams(decrement, blurMultiplier): ArrayBuffer`, `FOOD_PARAMS_BYTES = 16`, `packFoodParams(cellSize, foodPerDeath, width, height): ArrayBuffer`, `supportedPoolSizes(limits: { maxStorageBufferBindingSize: number; maxBufferSize: number }): number[]`
  - `layout.ts`: `type Vec4 = [number, number, number, number]`, `interface ActorRecord { x; y; dir; speed; seed: Vec4; color: Vec4; age; life; alive: boolean; rng }`, `ACTOR_BYTES = 64`, `packActors(actors): ArrayBuffer`, `unpackActors(buf): ActorRecord[]`, `interface FoodSeed { cellX; cellY; rgb: Vec3 }`, `FOOD_SEED_BYTES = 32`, `packFoodSeeds(seeds): ArrayBuffer`, `COUNTERS_BYTES = 16`, `interface CounterValues { head; childCount; aliveCount; childrenInserted }`, `unpackCounters(buf): CounterValues`, `ringSlot(head, poolSize): number`

`PhysarumParams` fields (camelCase versions of the spec's names): `lookSlices, lookRadians, lookDistance, directionRandomization, directionMomentum, minSpeed, maxSpeed, intensity, foodPerDeath, foodExhaustion, foodSensitivity, life, alwaysSpawnFromParent, spawnRandomOffset, spawnProbability, directionVariance, speedVariance, lockToHsvAngles, hsvAngleOffset, hsvSaturationMultiplier, hsvValueMultiplier, fadeDecrement, blurMultiplier, blurInterval, foodFadeDecrement, foodFadeInterval` (numbers), `wrapBounds` (boolean), `rngSeed` (number).

`SimParams` uniform layout (28 × 4 bytes; f = f32, u = u32, i = i32), index: field —
0 f width, 1 f height, 2 u lookSlices, 3 f lookRadians, 4 f lookDistance, 5 f directionRandomization, 6 f directionMomentum, 7 f minSpeed, 8 f maxSpeed, 9 f intensity, 10 f foodSensitivity, 11 f foodExhaustion, 12 u life, 13 i alwaysSpawnFromParent, 14 f spawnRandomOffset, 15 f spawnProbability, 16 f directionVariance, 17 f speedVariance, 18 u lockToHsvAngles, 19 f hsvAngleOffset, 20 f hsvSaturationMultiplier, 21 f hsvValueMultiplier, 22 u wrapBounds, 23 u step, 24 u poolSize, 25 u maxChildren, 26 u spawnCount, 27 u padding.

`Actor` layout (16 × 4 bytes): 0 f x, 1 f y, 2 f dir, 3 f speed, 4–7 f seed rgba, 8–11 f color rgba, 12 u age, 13 u life, 14 u alive, 15 u rng.

`FoodSeed` layout (8 × 4 bytes): 0–3 f color (r, g, b, 1), 4 u cellX, 5 u cellY, 6–7 padding.

`Counters` layout (4 × u32): 0 head, 1 childCount, 2 aliveCount, 3 childrenInserted.

- [ ] **Step 1: Write failing params tests**

Create `tests/unit/params.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PARAMS, DEFAULT_POOL_SIZE, SIM_PARAMS_BYTES, packFadeParams, packFoodParams, packSimParams, supportedPoolSizes,
} from '../../src/physarum/params';

describe('DEFAULT_PARAMS', () => {
  it('matches the spec defaults', () => {
    expect(DEFAULT_POOL_SIZE).toBe(131072);
    expect(DEFAULT_PARAMS).toEqual({
      lookSlices: 3, lookRadians: 1, lookDistance: 10,
      directionRandomization: 0.1, directionMomentum: 0.1, minSpeed: 0.3, maxSpeed: 2,
      intensity: 1, foodPerDeath: 0.5, foodExhaustion: 1, foodSensitivity: 0.1,
      life: 20000, alwaysSpawnFromParent: 1, spawnRandomOffset: 1, spawnProbability: 0.0001,
      directionVariance: Math.PI / 4, speedVariance: 0.1,
      lockToHsvAngles: 0, hsvAngleOffset: 1, hsvSaturationMultiplier: 1, hsvValueMultiplier: 1,
      fadeDecrement: 0.01, blurMultiplier: 0, blurInterval: 1, foodFadeDecrement: 0.002, foodFadeInterval: 1,
      wrapBounds: true, rngSeed: 1,
    });
  });
});

describe('packSimParams', () => {
  it('writes every field at its WGSL offset', () => {
    const buf = packSimParams(
      { ...DEFAULT_PARAMS, alwaysSpawnFromParent: -1, wrapBounds: false, lockToHsvAngles: 6 },
      { width: 2048, height: 1024, step: 77, poolSize: 256, maxChildren: 32, spawnCount: 5 },
    );
    expect(buf.byteLength).toBe(SIM_PARAMS_BYTES);
    const f = new Float32Array(buf);
    const u = new Uint32Array(buf);
    const i = new Int32Array(buf);
    expect([f[0], f[1]]).toEqual([2048, 1024]);
    expect(u[2]).toBe(3);
    expect(f[3]).toBeCloseTo(1);
    expect(f[4]).toBeCloseTo(10);
    expect(f[7]).toBeCloseTo(0.3);
    expect(f[8]).toBeCloseTo(2);
    expect(f[10]).toBeCloseTo(0.1);
    expect(f[11]).toBeCloseTo(1);
    expect(u[12]).toBe(20000);
    expect(i[13]).toBe(-1);
    expect(f[15]).toBeCloseTo(0.0001);
    expect(f[16]).toBeCloseTo(Math.PI / 4);
    expect(u[18]).toBe(6);
    expect(u[22]).toBe(0);
    expect([u[23], u[24], u[25], u[26], u[27]]).toEqual([77, 256, 32, 5, 0]);
  });
});

describe('small uniform packers', () => {
  it('packs fade params', () => {
    const f = new Float32Array(packFadeParams(0.25, 3));
    expect(Array.from(f)).toEqual([0.25, 3, 0, 0]);
  });

  it('packs food params', () => {
    const f = new Float32Array(packFoodParams(16, 0.5, 2048, 1024));
    expect(Array.from(f)).toEqual([16, 0.5, 2048, 1024]);
  });
});

describe('supportedPoolSizes', () => {
  it('offers powers of two from 2^14 up to what the limits allow', () => {
    const mib = 1024 * 1024;
    expect(supportedPoolSizes({ maxStorageBufferBindingSize: 128 * mib, maxBufferSize: 256 * mib }))
      .toEqual([2 ** 14, 2 ** 15, 2 ** 16, 2 ** 17, 2 ** 18, 2 ** 19, 2 ** 20, 2 ** 21]);
    expect(supportedPoolSizes({ maxStorageBufferBindingSize: 4096 * mib, maxBufferSize: 4096 * mib }).at(-1)).toBe(2 ** 22);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project unit tests/unit/params.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement `src/physarum/params.ts`**

```ts
// Live-editable Physarum parameters. Names are camelCase versions of the
// spec's (and Particles') parameter names.
export interface PhysarumParams {
  lookSlices: number;
  lookRadians: number;
  lookDistance: number;
  directionRandomization: number;
  directionMomentum: number;
  minSpeed: number;
  maxSpeed: number;
  intensity: number;
  foodPerDeath: number;
  foodExhaustion: number;
  foodSensitivity: number;
  life: number;
  alwaysSpawnFromParent: number;
  spawnRandomOffset: number;
  spawnProbability: number;
  directionVariance: number;
  speedVariance: number;
  lockToHsvAngles: number;
  hsvAngleOffset: number;
  hsvSaturationMultiplier: number;
  hsvValueMultiplier: number;
  fadeDecrement: number;
  blurMultiplier: number;
  blurInterval: number;
  foodFadeDecrement: number;
  foodFadeInterval: number;
  wrapBounds: boolean;
  rngSeed: number;
}

export const DEFAULT_POOL_SIZE = 2 ** 17;

export const DEFAULT_PARAMS: PhysarumParams = {
  lookSlices: 3,
  lookRadians: 1,
  lookDistance: 10,
  directionRandomization: 0.1,
  directionMomentum: 0.1,
  minSpeed: 0.3,
  maxSpeed: 2,
  intensity: 1,
  foodPerDeath: 0.5,
  foodExhaustion: 1,
  foodSensitivity: 0.1,
  life: 20000,
  alwaysSpawnFromParent: 1,
  spawnRandomOffset: 1,
  spawnProbability: 0.0001,
  directionVariance: Math.PI / 4,
  speedVariance: 0.1,
  lockToHsvAngles: 0,
  hsvAngleOffset: 1,
  hsvSaturationMultiplier: 1,
  hsvValueMultiplier: 1,
  fadeDecrement: 0.01,
  blurMultiplier: 0,
  blurInterval: 1,
  foodFadeDecrement: 0.002,
  foodFadeInterval: 1,
  wrapBounds: true,
  rngSeed: 1,
};

// Per-step values that live in the SimParams uniform alongside the parameters.
export interface SimFrame {
  width: number;
  height: number;
  step: number;
  poolSize: number;
  maxChildren: number;
  spawnCount: number;
}

export const SIM_PARAMS_BYTES = 112;

// Must match `struct SimParams` in shaders/common.wgsl.
export function packSimParams(p: PhysarumParams, frame: SimFrame): ArrayBuffer {
  const buf = new ArrayBuffer(SIM_PARAMS_BYTES);
  const f = new Float32Array(buf);
  const u = new Uint32Array(buf);
  const i = new Int32Array(buf);
  f[0] = frame.width;
  f[1] = frame.height;
  u[2] = p.lookSlices;
  f[3] = p.lookRadians;
  f[4] = p.lookDistance;
  f[5] = p.directionRandomization;
  f[6] = p.directionMomentum;
  f[7] = p.minSpeed;
  f[8] = p.maxSpeed;
  f[9] = p.intensity;
  f[10] = p.foodSensitivity;
  f[11] = p.foodExhaustion;
  u[12] = p.life;
  i[13] = p.alwaysSpawnFromParent;
  f[14] = p.spawnRandomOffset;
  f[15] = p.spawnProbability;
  f[16] = p.directionVariance;
  f[17] = p.speedVariance;
  u[18] = p.lockToHsvAngles;
  f[19] = p.hsvAngleOffset;
  f[20] = p.hsvSaturationMultiplier;
  f[21] = p.hsvValueMultiplier;
  u[22] = p.wrapBounds ? 1 : 0;
  u[23] = frame.step;
  u[24] = frame.poolSize;
  u[25] = frame.maxChildren;
  u[26] = frame.spawnCount;
  u[27] = 0;
  return buf;
}

export const FADE_PARAMS_BYTES = 16;

// Must match `struct FadeParams` in shaders/common.wgsl.
export function packFadeParams(decrement: number, blurMultiplier: number): ArrayBuffer {
  return new Float32Array([decrement, blurMultiplier, 0, 0]).buffer;
}

export const FOOD_PARAMS_BYTES = 16;

// Must match `struct FoodParams` in shaders/food-seed.wgsl.
export function packFoodParams(cellSize: number, foodPerDeath: number, width: number, height: number): ArrayBuffer {
  return new Float32Array([cellSize, foodPerDeath, width, height]).buffer;
}

const ACTOR_BYTES_FOR_LIMITS = 64;

// Pool sizes (powers of two from 2^14 to 2^22) whose actor buffer fits the device limits.
export function supportedPoolSizes(limits: { maxStorageBufferBindingSize: number; maxBufferSize: number }): number[] {
  const maxActors = Math.min(limits.maxStorageBufferBindingSize, limits.maxBufferSize) / ACTOR_BYTES_FOR_LIMITS;
  const sizes: number[] = [];
  for (let e = 14; e <= 22; e++) if (2 ** e <= maxActors) sizes.push(2 ** e);
  return sizes;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run --project unit tests/unit/params.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing layout tests**

Create `tests/unit/layout.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  ACTOR_BYTES, FOOD_SEED_BYTES, packActors, packFoodSeeds, ringSlot, unpackActors, unpackCounters, type ActorRecord,
} from '../../src/physarum/layout';

const actor: ActorRecord = {
  x: 1.5, y: 2.25, dir: 0.5, speed: 1.25,
  seed: [1, 0, 0, 1], color: [0, 0.5, 1, 0.75],
  age: 7, life: 20000, alive: true, rng: 0xdeadbeef,
};

describe('actor packing', () => {
  it('uses 64 bytes per actor at the WGSL offsets', () => {
    const buf = packActors([actor, { ...actor, alive: false }]);
    expect(buf.byteLength).toBe(2 * ACTOR_BYTES);
    const f = new Float32Array(buf);
    const u = new Uint32Array(buf);
    expect(Array.from(f.slice(0, 12))).toEqual([1.5, 2.25, 0.5, 1.25, 1, 0, 0, 1, 0, 0.5, 1, 0.75]);
    expect(Array.from(u.slice(12, 16))).toEqual([7, 20000, 1, 0xdeadbeef]);
    expect(u[16 + 14]).toBe(0);
  });

  it('round-trips through unpackActors', () => {
    expect(unpackActors(packActors([actor]))).toEqual([actor]);
  });
});

describe('food seed packing', () => {
  it('writes color then cell coordinates', () => {
    const buf = packFoodSeeds([{ cellX: 3, cellY: 9, rgb: [0.5, 0.25, 1] }]);
    expect(buf.byteLength).toBe(FOOD_SEED_BYTES);
    expect(Array.from(new Float32Array(buf, 0, 4))).toEqual([0.5, 0.25, 1, 1]);
    expect(Array.from(new Uint32Array(buf, 16, 2))).toEqual([3, 9]);
  });
});

describe('counters', () => {
  it('unpacks head, childCount, aliveCount, childrenInserted', () => {
    expect(unpackCounters(new Uint32Array([5, 6, 7, 8]).buffer)).toEqual({
      head: 5, childCount: 6, aliveCount: 7, childrenInserted: 8,
    });
  });
});

describe('ringSlot', () => {
  it('wraps the head into the pool', () => {
    expect(ringSlot(0, 8)).toBe(0);
    expect(ringSlot(13, 8)).toBe(5);
    expect(ringSlot(0xffffffff, 8)).toBe(7);
  });

  it('rejects pool sizes that are not powers of two', () => {
    expect(() => ringSlot(1, 12)).toThrow(/power of two/);
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `npx vitest run --project unit tests/unit/layout.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 7: Implement `src/physarum/layout.ts`**

```ts
import type { Vec3 } from '../color';

export type Vec4 = [number, number, number, number];

// CPU view of one actor. Must match `struct Actor` in shaders/common.wgsl.
export interface ActorRecord {
  x: number;
  y: number;
  dir: number;
  speed: number;
  seed: Vec4;
  color: Vec4;
  age: number;
  life: number;
  alive: boolean;
  rng: number;
}

export const ACTOR_BYTES = 64;
const ACTOR_WORDS = ACTOR_BYTES / 4;

export function packActors(actors: ActorRecord[]): ArrayBuffer {
  const buf = new ArrayBuffer(actors.length * ACTOR_BYTES);
  const f = new Float32Array(buf);
  const u = new Uint32Array(buf);
  actors.forEach((a, i) => {
    const o = i * ACTOR_WORDS;
    f[o] = a.x;
    f[o + 1] = a.y;
    f[o + 2] = a.dir;
    f[o + 3] = a.speed;
    f.set(a.seed, o + 4);
    f.set(a.color, o + 8);
    u[o + 12] = a.age;
    u[o + 13] = a.life;
    u[o + 14] = a.alive ? 1 : 0;
    u[o + 15] = a.rng;
  });
  return buf;
}

export function unpackActors(buf: ArrayBuffer): ActorRecord[] {
  const f = new Float32Array(buf);
  const u = new Uint32Array(buf);
  const out: ActorRecord[] = [];
  for (let o = 0; o + ACTOR_WORDS <= f.length; o += ACTOR_WORDS) {
    out.push({
      x: f[o],
      y: f[o + 1],
      dir: f[o + 2],
      speed: f[o + 3],
      seed: [f[o + 4], f[o + 5], f[o + 6], f[o + 7]],
      color: [f[o + 8], f[o + 9], f[o + 10], f[o + 11]],
      age: u[o + 12],
      life: u[o + 13],
      alive: u[o + 14] !== 0,
      rng: u[o + 15],
    });
  }
  return out;
}

// One dead Life cell's food deposit. Must match `struct FoodSeed` in shaders/food-seed.wgsl.
export interface FoodSeed {
  cellX: number;
  cellY: number;
  rgb: Vec3;
}

export const FOOD_SEED_BYTES = 32;

export function packFoodSeeds(seeds: FoodSeed[]): ArrayBuffer {
  const buf = new ArrayBuffer(seeds.length * FOOD_SEED_BYTES);
  const f = new Float32Array(buf);
  const u = new Uint32Array(buf);
  seeds.forEach((s, i) => {
    const o = i * 8;
    f.set([s.rgb[0], s.rgb[1], s.rgb[2], 1], o);
    u[o + 4] = s.cellX;
    u[o + 5] = s.cellY;
  });
  return buf;
}

// Must match `struct Counters` in shaders/common.wgsl.
export const COUNTERS_BYTES = 16;

export interface CounterValues {
  head: number;
  childCount: number;
  aliveCount: number;
  childrenInserted: number;
}

export function unpackCounters(buf: ArrayBuffer): CounterValues {
  const u = new Uint32Array(buf);
  return { head: u[0], childCount: u[1], aliveCount: u[2], childrenInserted: u[3] };
}

// The pool slot the ring head points at. Mirrors the inject shader.
export function ringSlot(head: number, poolSize: number): number {
  if (!Number.isInteger(Math.log2(poolSize))) throw new Error(`poolSize must be a power of two, got ${poolSize}`);
  return (head & (poolSize - 1)) >>> 0;
}
```

- [ ] **Step 8: Run to verify pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/physarum/params.ts src/physarum/layout.ts tests/unit/params.test.ts tests/unit/layout.test.ts
git commit -m "Add Physarum params and GPU data layouts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Bridge — births to actors, deaths to food, spawn scheduling

**Files:**
- Create: `src/bridge/spawner.ts`
- Test: `tests/unit/spawner.test.ts`

**Interfaces:**
- Consumes: `PALETTE` (Task 4), `ColoredCell` (Task 4), `ActorRecord`, `FoodSeed` (Task 5), `Rng`, `randomNonZeroU32` (Task 3).
- Produces: `interface SpawnSettings { actorsPerBirth; cellSize; minSpeed; life }`; `birthsToActors(births: ColoredCell[], settings: SpawnSettings, rng: Rng, maxActors: number): ActorRecord[]`; `deathsToFoodSeeds(deaths: ColoredCell[]): FoodSeed[]`; `type SpawnMode = 'burst' | 'trickle'`; `class SpawnScheduler { constructor(maxQueued: number); mode: SpawnMode; maxQueued: number; enqueue(actors: ActorRecord[], stepsUntilNextTick: number): void; takeForStep(limit: number): ActorRecord[]; readonly pending: number; clear(): void }`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/spawner.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { SpawnScheduler, birthsToActors, deathsToFoodSeeds } from '../../src/bridge/spawner';
import { PALETTE } from '../../src/life/palette';
import { mulberry32 } from '../../src/rng';
import type { ActorRecord } from '../../src/physarum/layout';

const settings = { actorsPerBirth: 16, cellSize: 16, minSpeed: 0.3, life: 20000 };
const fakeActors = (n: number, tag = 0): ActorRecord[] =>
  Array.from({ length: n }, (_, i) => ({
    x: tag, y: i, dir: 0, speed: 0, seed: [1, 0, 0, 1], color: [1, 0, 0, 1], age: 0, life: 1, alive: true, rng: 1,
  }));

describe('birthsToActors', () => {
  it('spawns actorsPerBirth actors inside each newborn cell block', () => {
    const actors = birthsToActors([{ x: 3, y: 5, paletteIndex: 2 }], settings, mulberry32(1), 1000);
    expect(actors).toHaveLength(16);
    for (const a of actors) {
      expect(a.x).toBeGreaterThanOrEqual(48);
      expect(a.x).toBeLessThan(64);
      expect(a.y).toBeGreaterThanOrEqual(80);
      expect(a.y).toBeLessThan(96);
      expect(a.dir).toBeGreaterThanOrEqual(0);
      expect(a.dir).toBeLessThan(2 * Math.PI);
      expect(a.speed).toBe(0.3);
      expect(a.age).toBe(0);
      expect(a.life).toBe(20000);
      expect(a.alive).toBe(true);
      expect(a.rng % 2).toBe(1);
      expect(a.seed).toEqual([...PALETTE[2], 1]);
      expect(a.color).toEqual([...PALETTE[2], 1]);
    }
  });

  it('produces births x actorsPerBirth actors', () => {
    const births = [{ x: 0, y: 0, paletteIndex: 0 }, { x: 1, y: 0, paletteIndex: 1 }, { x: 2, y: 0, paletteIndex: 2 }];
    expect(birthsToActors(births, settings, mulberry32(1), 1000)).toHaveLength(48);
  });

  it('keeps only the newest maxActors when there are too many births', () => {
    const births = Array.from({ length: 100 }, (_, i) => ({ x: i, y: 0, paletteIndex: 0 }));
    const actors = birthsToActors(births, settings, mulberry32(1), 40);
    expect(actors).toHaveLength(40);
    // The last birth (x = 99) must be represented; the first must not.
    expect(actors.some(a => a.x >= 99 * 16)).toBe(true);
    expect(actors.some(a => a.x < 16)).toBe(false);
  });

  it('spawns nothing when actorsPerBirth is 0', () => {
    expect(birthsToActors([{ x: 0, y: 0, paletteIndex: 0 }], { ...settings, actorsPerBirth: 0 }, mulberry32(1), 100)).toEqual([]);
  });
});

describe('deathsToFoodSeeds', () => {
  it('makes one seed per death in the organism color', () => {
    expect(deathsToFoodSeeds([{ x: 4, y: 7, paletteIndex: 5 }])).toEqual([{ cellX: 4, cellY: 7, rgb: [...PALETTE[5]] }]);
  });
});

describe('SpawnScheduler', () => {
  it('burst: hands everything to the next step', () => {
    const s = new SpawnScheduler(1000);
    s.enqueue(fakeActors(50), 30);
    expect(s.takeForStep(Infinity)).toHaveLength(50);
    expect(s.takeForStep(Infinity)).toHaveLength(0);
  });

  it('burst: spills over steps when a step limit is hit', () => {
    const s = new SpawnScheduler(1000);
    s.enqueue(fakeActors(100), 30);
    expect([s.takeForStep(40).length, s.takeForStep(40).length, s.takeForStep(40).length]).toEqual([40, 40, 20]);
  });

  it('trickle: spreads evenly across the steps until the next tick', () => {
    const s = new SpawnScheduler(1000);
    s.mode = 'trickle';
    s.enqueue(fakeActors(31), 30);
    const counts = Array.from({ length: 30 }, () => s.takeForStep(Infinity).length);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(31);
    expect(Math.max(...counts)).toBe(2);
    expect(Math.min(...counts)).toBe(1);
  });

  it('trickle: leftovers are kept when the next tick arrives early', () => {
    const s = new SpawnScheduler(1000);
    s.mode = 'trickle';
    s.enqueue(fakeActors(30, 1), 30);
    for (let i = 0; i < 10; i++) s.takeForStep(Infinity);
    s.enqueue(fakeActors(30, 2), 30);
    let total = 0;
    for (let i = 0; i < 30; i++) total += s.takeForStep(Infinity).length;
    expect(total).toBe(50);
    expect(s.pending).toBe(0);
  });

  it('drops the oldest queued actors beyond maxQueued', () => {
    const s = new SpawnScheduler(10);
    s.enqueue(fakeActors(8, 1), 30);
    s.enqueue(fakeActors(8, 2), 30);
    const taken = s.takeForStep(Infinity);
    expect(taken).toHaveLength(10);
    expect(taken.filter(a => a.x === 1)).toHaveLength(2);
    expect(taken.filter(a => a.x === 2)).toHaveLength(8);
  });

  it('clear() empties the queue', () => {
    const s = new SpawnScheduler(100);
    s.enqueue(fakeActors(5), 30);
    s.clear();
    expect(s.pending).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project unit tests/unit/spawner.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement `src/bridge/spawner.ts`**

```ts
import { PALETTE } from '../life/palette';
import type { ColoredCell } from '../life/world';
import type { ActorRecord, FoodSeed } from '../physarum/layout';
import { randomNonZeroU32, type Rng } from '../rng';

export interface SpawnSettings {
  actorsPerBirth: number;
  cellSize: number;
  minSpeed: number;
  life: number;
}

// Turns Life births into Physarum actors placed randomly inside each newborn
// cell's block. Returns at most maxActors; when there are more, the newest
// births win (older ones would be evicted from the ring anyway).
export function birthsToActors(births: ColoredCell[], settings: SpawnSettings, rng: Rng, maxActors: number): ActorRecord[] {
  if (settings.actorsPerBirth <= 0 || maxActors <= 0) return [];
  const kept = births.slice(-Math.ceil(maxActors / settings.actorsPerBirth));
  const actors: ActorRecord[] = [];
  for (const b of kept) {
    const [r, g, bl] = PALETTE[b.paletteIndex];
    for (let i = 0; i < settings.actorsPerBirth; i++) {
      actors.push({
        x: (b.x + rng()) * settings.cellSize,
        y: (b.y + rng()) * settings.cellSize,
        dir: rng() * 2 * Math.PI,
        speed: settings.minSpeed,
        seed: [r, g, bl, 1],
        color: [r, g, bl, 1],
        age: 0,
        life: settings.life,
        alive: true,
        rng: randomNonZeroU32(rng),
      });
    }
  }
  return actors.slice(-maxActors);
}

export function deathsToFoodSeeds(deaths: ColoredCell[]): FoodSeed[] {
  return deaths.map(d => {
    const [r, g, b] = PALETTE[d.paletteIndex];
    return { cellX: d.x, cellY: d.y, rgb: [r, g, b] };
  });
}

export type SpawnMode = 'burst' | 'trickle';

// Queues spawned actors between Life ticks and hands them to Physarum steps,
// either all at once (burst) or spread evenly until the next tick (trickle).
export class SpawnScheduler {
  mode: SpawnMode = 'burst';
  private queue: ActorRecord[] = [];
  private stepsLeft = 1;

  constructor(public maxQueued: number) {}

  enqueue(actors: ActorRecord[], stepsUntilNextTick: number): void {
    this.queue = this.queue.concat(actors);
    if (this.queue.length > this.maxQueued) this.queue = this.queue.slice(this.queue.length - this.maxQueued);
    this.stepsLeft = Math.max(1, stepsUntilNextTick);
  }

  takeForStep(limit: number): ActorRecord[] {
    const wanted = this.mode === 'burst' ? this.queue.length : Math.ceil(this.queue.length / this.stepsLeft);
    this.stepsLeft = Math.max(1, this.stepsLeft - 1);
    return this.queue.splice(0, Math.min(wanted, limit));
  }

  get pending(): number {
    return this.queue.length;
  }

  clear(): void {
    this.queue = [];
    this.stepsLeft = 1;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/bridge tests/unit/spawner.test.ts
git commit -m "Add Life-to-Physarum spawn and food bridge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: GPU foundations — shared WGSL, shader helper, buffers, color parity

**Files:**
- Create: `src/physarum/shaders/common.wgsl`, `src/gpu/shader.ts`, `src/physarum/buffers.ts`
- Modify: `tests/gpu/helpers.ts` (add texture helpers and an actor fixture)
- Test: `tests/gpu/color.test.ts`

**Interfaces:**
- Consumes: `COUNTERS_BYTES`, `ActorRecord` (Task 5); `src/color.ts` (Task 3).
- Produces:
  - `common.wgsl`: `PI`, `struct Actor`, `struct SimParams`, `struct Counters`, `struct FadeParams`, `rgb2hsv`, `hsv2rgb`, `hsv_distance`, `hsv_mix`, `dominant_color(rgb: vec4f, lock: u32, offset: f32, satMul: f32, valMul: f32) -> vec4f`, `rand(state: ptr<function, u32>) -> f32`, `load_or_zero(t: texture_2d<f32>, pos: vec2f) -> vec4f`
  - `shader.ts`: `createModule(device, code, label): GPUShaderModule`; `onShaderError(listener: (message: string) => void): void`
  - `buffers.ts`: `createStorageBuffer(device, size, label)`, `createUniformBuffer(device, size, label)`, `createCountersBuffer(device)`, `createFieldTexture(device, width, height, label)` (rgba8unorm; TEXTURE_BINDING | STORAGE_BINDING | RENDER_ATTACHMENT | COPY_SRC | COPY_DST)
  - test helpers: `readTexture(device, texture, width, height): Promise<Uint8Array>` (width × 4 must be a multiple of 256), `writeTexture(device, texture, width, height, data)`, `solidTexels(width, height, rgba): Uint8Array`, `setPixel(data, width, x, y, rgba)`, `pixel(data, width, x, y): number[]`, `actor(overrides?: Partial<ActorRecord>): ActorRecord`

- [ ] **Step 1: Write `src/physarum/shaders/common.wgsl`**

```wgsl
// Shared structs and helpers, concatenated ahead of each pass's own WGSL.
// The color functions mirror src/color.ts; keep them in sync.

const PI: f32 = 3.14159265358979;

// Must match ActorRecord packing in src/physarum/layout.ts (64 bytes).
struct Actor {
  pos: vec2f,
  dir: f32,
  speed: f32,
  seed: vec4f,
  color: vec4f,
  age: u32,
  life: u32,
  alive: u32,
  rng: u32,
}

// Must match packSimParams in src/physarum/params.ts (112 bytes).
struct SimParams {
  width: f32,
  height: f32,
  lookSlices: u32,
  lookRadians: f32,
  lookDistance: f32,
  directionRandomization: f32,
  directionMomentum: f32,
  minSpeed: f32,
  maxSpeed: f32,
  intensity: f32,
  foodSensitivity: f32,
  foodExhaustion: f32,
  life: u32,
  alwaysSpawnFromParent: i32,
  spawnRandomOffset: f32,
  spawnProbability: f32,
  directionVariance: f32,
  speedVariance: f32,
  lockToHsvAngles: u32,
  hsvAngleOffset: f32,
  hsvSaturationMultiplier: f32,
  hsvValueMultiplier: f32,
  wrapBounds: u32,
  step: u32,
  poolSize: u32,
  maxChildren: u32,
  spawnCount: u32,
  _pad: u32,
}

// Must match src/physarum/layout.ts (16 bytes).
struct Counters {
  head: atomic<u32>,
  childCount: atomic<u32>,
  aliveCount: atomic<u32>,
  childrenInserted: atomic<u32>,
}

// Must match packFadeParams in src/physarum/params.ts (16 bytes).
struct FadeParams {
  decrement: f32,
  blurMultiplier: f32,
  _pad0: f32,
  _pad1: f32,
}

// Branchless conversion, ported from Particles' Shaders.metal. Hue in [0, 1].
fn rgb2hsv(c: vec3f) -> vec3f {
  let K = vec4f(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  let p = mix(vec4f(c.bg, K.wz), vec4f(c.gb, K.xy), step(c.b, c.g));
  let q = mix(vec4f(p.xyw, c.r), vec4f(c.r, p.yzx), step(p.x, c.r));
  let d = q.x - min(q.w, q.y);
  let e = 1.0e-10;
  let h = abs(q.z + (q.w - q.y) / (6.0 * d + e));
  return vec3f(h, d / (q.x + e), q.x);
}

fn hsv2rgb(c: vec3f) -> vec3f {
  let K = vec4f(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, vec3f(0.0), vec3f(1.0)), c.y);
}

// Distance between two HSV colors, treating hue as circular.
fn hsv_distance(a: vec3f, b: vec3f) -> f32 {
  let dh = abs(a.x - b.x);
  let hd = min(dh, 1.0 - dh);
  let sd = a.y - b.y;
  let vd = a.z - b.z;
  return sqrt(hd * hd + sd * sd + vd * vd);
}

// Blends two RGB colors in HSV space, going the short way around the hue
// circle. d is the weight toward rgb2.
fn hsv_mix(rgb1: vec3f, rgb2: vec3f, d: f32) -> vec3f {
  let a = rgb2hsv(rgb1);
  let b = rgb2hsv(rgb2);
  let dh = abs(a.x - b.x);
  var h: f32;
  if (dh < 1.0 - dh) {
    h = mix(a.x, b.x, d);
  } else if (a.x < b.x) {
    h = fract(mix(a.x + 1.0, b.x, d));
  } else {
    h = fract(mix(a.x, b.x + 1.0, d));
  }
  return hsv2rgb(vec3f(h, mix(a.y, b.y, d), mix(a.z, b.z, d)));
}

// Snaps hue to one of lockToHsvAngles directions (0 = off), then offsets hue
// and scales saturation/value.
fn dominant_color(rgb: vec4f, lockToHsvAngles: u32, hsvAngleOffset: f32, satMul: f32, valMul: f32) -> vec4f {
  if (lockToHsvAngles == 0u) {
    return rgb;
  }
  var hsv = rgb2hsv(rgb.rgb);
  let n = f32(lockToHsvAngles);
  hsv.x = (floor(hsv.x * n + 0.5) / n + hsvAngleOffset) % 1.0;
  hsv.y = min(1.0, hsv.y * satMul);
  hsv.z = min(1.0, hsv.z * valMul);
  return vec4f(hsv2rgb(hsv), rgb.a);
}

// xorshift32. Returns a float in [0, 1). The state must never be 0.
fn rand(state: ptr<function, u32>) -> f32 {
  var x = *state;
  x ^= x << 13u;
  x ^= x >> 17u;
  x ^= x << 5u;
  *state = x;
  return f32(x >> 8u) / 16777216.0;
}

// Nearest-pixel read where anything outside the texture reads as zero
// (WGSL does not guarantee that for out-of-bounds textureLoad).
fn load_or_zero(t: texture_2d<f32>, pos: vec2f) -> vec4f {
  let dims = vec2i(textureDimensions(t));
  let p = vec2i(floor(pos));
  if (p.x < 0 || p.y < 0 || p.x >= dims.x || p.y >= dims.y) {
    return vec4f(0.0);
  }
  return textureLoad(t, p, 0);
}
```

- [ ] **Step 2: Write `src/gpu/shader.ts`**

```ts
type ShaderErrorListener = (message: string) => void;

const shaderErrorListeners = new Set<ShaderErrorListener>();

// Called with a readable message whenever a WGSL module fails to compile.
export function onShaderError(listener: ShaderErrorListener): void {
  shaderErrorListeners.add(listener);
}

// Creates a shader module and reports WGSL problems with their line numbers.
// Line numbers count from the start of the concatenated source (common.wgsl first).
export function createModule(device: GPUDevice, code: string, label: string): GPUShaderModule {
  const module = device.createShaderModule({ code, label });
  void module.getCompilationInfo().then(info => {
    for (const m of info.messages) {
      const text = `WGSL ${m.type} in ${label} at line ${m.lineNum}:${m.linePos}: ${m.message}`;
      if (m.type === 'error') {
        console.error(text);
        shaderErrorListeners.forEach(listener => listener(text));
      } else {
        console.warn(text);
      }
    }
  });
  return module;
}
```

- [ ] **Step 3: Write `src/physarum/buffers.ts`**

```ts
import { ACTOR_BYTES, COUNTERS_BYTES } from './layout';

// Storage buffers are never smaller than one actor so that a runtime-sized
// array<Actor> binding is always valid, even for an empty spawn list.
export function createStorageBuffer(device: GPUDevice, size: number, label: string): GPUBuffer {
  return device.createBuffer({
    label,
    size: Math.max(size, ACTOR_BYTES),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
}

export function createUniformBuffer(device: GPUDevice, size: number, label: string): GPUBuffer {
  return device.createBuffer({ label, size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
}

export function createCountersBuffer(device: GPUDevice): GPUBuffer {
  return device.createBuffer({
    label: 'counters',
    size: COUNTERS_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
}

// Trail, food and test textures: rgba8unorm, usable by every pass.
export function createFieldTexture(device: GPUDevice, width: number, height: number, label: string): GPUTexture {
  return device.createTexture({
    label,
    size: [width, height],
    format: 'rgba8unorm',
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.COPY_DST,
  });
}
```

- [ ] **Step 4: Add texture helpers and an actor fixture to `tests/gpu/helpers.ts`**

Append to `tests/gpu/helpers.ts`:
```ts
import type { ActorRecord } from '../../src/physarum/layout';

export async function readTexture(device: GPUDevice, texture: GPUTexture, width: number, height: number): Promise<Uint8Array> {
  if ((width * 4) % 256 !== 0) throw new Error('readTexture needs width * 4 to be a multiple of 256');
  const size = width * height * 4;
  const staging = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer({ texture }, { buffer: staging, bytesPerRow: width * 4 }, [width, height]);
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const copy = new Uint8Array(staging.getMappedRange().slice(0));
  staging.unmap();
  staging.destroy();
  return copy;
}

export function writeTexture(device: GPUDevice, texture: GPUTexture, width: number, height: number, data: Uint8Array): void {
  device.queue.writeTexture({ texture }, data, { bytesPerRow: width * 4 }, [width, height]);
}

export function solidTexels(width: number, height: number, rgba: number[]): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
  return data;
}

export function setPixel(data: Uint8Array, width: number, x: number, y: number, rgba: number[]): void {
  data.set(rgba, (y * width + x) * 4);
}

export function pixel(data: Uint8Array, width: number, x: number, y: number): number[] {
  const o = (y * width + x) * 4;
  return Array.from(data.slice(o, o + 4));
}

// A red, alive, motionless actor at (32, 32); override any field.
export function actor(overrides: Partial<ActorRecord> = {}): ActorRecord {
  return {
    x: 32, y: 32, dir: 0, speed: 0,
    seed: [1, 0, 0, 1], color: [1, 0, 0, 1],
    age: 0, life: 100000, alive: true, rng: 12345,
    ...overrides,
  };
}
```
Move the new `import type` line to the top of the file, above `let devicePromise`.

- [ ] **Step 5: Write the failing color parity test**

Create `tests/gpu/color.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import common from '../../src/physarum/shaders/common.wgsl?raw';
import { createModule } from '../../src/gpu/shader';
import { dominantColor, hsv2rgb, hsvDistance, hsvMix, rgb2hsv, type Vec3 } from '../../src/color';
import { mulberry32 } from '../../src/rng';
import { getDevice, readBuffer } from './helpers';

const PROBE = `
@group(0) @binding(0) var<storage, read> a: array<vec4f>;
@group(0) @binding(1) var<storage, read> b: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> out: array<vec4f>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&a)) { return; }
  let x = a[i];
  let y = b[i];
  out[i * 4u + 0u] = vec4f(rgb2hsv(x.rgb), 0.0);
  out[i * 4u + 1u] = vec4f(hsv2rgb(x.rgb), 0.0);
  out[i * 4u + 2u] = vec4f(hsv_mix(x.rgb, y.rgb, x.w), hsv_distance(rgb2hsv(x.rgb), rgb2hsv(y.rgb)));
  out[i * 4u + 3u] = dominant_color(vec4f(x.rgb, 1.0), 6u, 0.1, 0.8, 1.2);
}`;

const circularDiff = (a: number, b: number) => {
  const d = Math.abs(a - b) % 1;
  return Math.min(d, 1 - d);
};

describe('WGSL color functions match src/color.ts', () => {
  it('agrees on 256 random color pairs', async () => {
    const device = await getDevice();
    const rng = mulberry32(99);
    const n = 256;
    const a = new Float32Array(n * 4);
    const b = new Float32Array(n * 4);
    for (let i = 0; i < n * 4; i++) {
      a[i] = rng();
      b[i] = rng();
    }
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    const aBuf = device.createBuffer({ size: a.byteLength, usage });
    const bBuf = device.createBuffer({ size: b.byteLength, usage });
    const outBuf = device.createBuffer({ size: n * 4 * 16, usage });
    device.queue.writeBuffer(aBuf, 0, a);
    device.queue.writeBuffer(bBuf, 0, b);
    const pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: createModule(device, common + PROBE, 'color probe'), entryPoint: 'main' },
    });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: aBuf } },
        { binding: 1, resource: { buffer: bBuf } },
        { binding: 2, resource: { buffer: outBuf } },
      ],
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(n / 64);
    pass.end();
    device.queue.submit([encoder.finish()]);
    const out = new Float32Array(await readBuffer(device, outBuf, n * 4 * 16));

    const lock = { lockToHsvAngles: 6, hsvAngleOffset: 0.1, hsvSaturationMultiplier: 0.8, hsvValueMultiplier: 1.2 };
    for (let i = 0; i < n; i++) {
      const x: Vec3 = [a[i * 4], a[i * 4 + 1], a[i * 4 + 2]];
      const y: Vec3 = [b[i * 4], b[i * 4 + 1], b[i * 4 + 2]];
      const d = a[i * 4 + 3];
      const row = (k: number) => Array.from(out.slice((i * 4 + k) * 4, (i * 4 + k) * 4 + 4));

      const hsv = rgb2hsv(x);
      const gpuHsv = row(0);
      expect(circularDiff(gpuHsv[0], hsv[0])).toBeLessThan(1e-3);
      expect(gpuHsv[1]).toBeCloseTo(hsv[1], 3);
      expect(gpuHsv[2]).toBeCloseTo(hsv[2], 3);

      hsv2rgb(x).forEach((v, k) => expect(row(1)[k]).toBeCloseTo(v, 3));
      hsvMix(x, y, d).forEach((v, k) => expect(row(2)[k]).toBeCloseTo(v, 2));
      expect(row(2)[3]).toBeCloseTo(hsvDistance(rgb2hsv(x), rgb2hsv(y)), 3);
      dominantColor(x, lock).forEach((v, k) => expect(row(3)[k]).toBeCloseTo(v, 2));
    }
  });
});
```

- [ ] **Step 6: Run to verify**

Run: `npm run test:gpu`
Expected: PASS for both GPU test files. If the color test fails, fix whichever of `common.wgsl` / `src/color.ts` departs from the spec formulas; do not loosen tolerances beyond those shown.

(No separate failing run is possible here: the probe can only fail once the WGSL exists. If you want a red step first, run the test before Step 1 and confirm it fails with "cannot resolve common.wgsl?raw".)

- [ ] **Step 7: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add src/physarum/shaders/common.wgsl src/gpu/shader.ts src/physarum/buffers.ts tests/gpu
git commit -m "Add shared WGSL, buffer helpers, color parity test

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Inject pass

**Files:**
- Create: `src/physarum/shaders/inject.wgsl`, `src/physarum/inject-pass.ts`
- Test: `tests/gpu/inject.test.ts`

**Interfaces:**
- Consumes: `common.wgsl` (Task 7), `createModule` (Task 7), buffer factories (Task 7), `packSimParams`, `DEFAULT_PARAMS`, `SIM_PARAMS_BYTES` (Task 5), `packActors`, `unpackActors`, `unpackCounters`, `ACTOR_BYTES`, `COUNTERS_BYTES` (Task 5).
- Produces: `interface InjectBindings { params: GPUBuffer; actors: GPUBuffer; spawns: GPUBuffer; children: GPUBuffer; counters: GPUBuffer }`; `class InjectPass { constructor(device: GPUDevice); encode(encoder: GPUCommandEncoder, bindings: InjectBindings, workItems: number): void }` where `workItems = spawnCount + maxChildren`.

- [ ] **Step 1: Write the failing test**

Create `tests/gpu/inject.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { InjectPass } from '../../src/physarum/inject-pass';
import { createCountersBuffer, createStorageBuffer, createUniformBuffer } from '../../src/physarum/buffers';
import { ACTOR_BYTES, COUNTERS_BYTES, packActors, unpackActors, unpackCounters } from '../../src/physarum/layout';
import { DEFAULT_PARAMS, SIM_PARAMS_BYTES, packSimParams } from '../../src/physarum/params';
import { actor, getDevice, readBuffer } from './helpers';

async function inject(opts: { poolSize: number; head: number; spawnXs: number[]; childXs: number[]; childCount: number; maxChildren: number }) {
  const device = await getDevice();
  const params = createUniformBuffer(device, SIM_PARAMS_BYTES, 'params');
  device.queue.writeBuffer(params, 0, packSimParams(DEFAULT_PARAMS, {
    width: 64, height: 64, step: 0, poolSize: opts.poolSize, maxChildren: opts.maxChildren, spawnCount: opts.spawnXs.length,
  }));
  const actors = createStorageBuffer(device, opts.poolSize * ACTOR_BYTES, 'actors');
  const spawns = createStorageBuffer(device, opts.spawnXs.length * ACTOR_BYTES, 'spawns');
  if (opts.spawnXs.length) device.queue.writeBuffer(spawns, 0, packActors(opts.spawnXs.map(x => actor({ x }))));
  const children = createStorageBuffer(device, opts.maxChildren * ACTOR_BYTES, 'children');
  if (opts.childXs.length) device.queue.writeBuffer(children, 0, packActors(opts.childXs.map(x => actor({ x }))));
  const counters = createCountersBuffer(device);
  device.queue.writeBuffer(counters, 0, new Uint32Array([opts.head, opts.childCount, 0, 0]));

  const encoder = device.createCommandEncoder();
  new InjectPass(device).encode(encoder, { params, actors, spawns, children, counters }, opts.spawnXs.length + opts.maxChildren);
  device.queue.submit([encoder.finish()]);

  return {
    actors: unpackActors(await readBuffer(device, actors, opts.poolSize * ACTOR_BYTES)),
    counters: unpackCounters(await readBuffer(device, counters, COUNTERS_BYTES)),
  };
}

describe('InjectPass', () => {
  it('writes spawns and children at the ring head, wrapping around', async () => {
    const { actors, counters } = await inject({
      poolSize: 8, head: 6, spawnXs: [100, 101, 102, 103], childXs: [200, 201], childCount: 2, maxChildren: 2,
    });
    // Intra-step order is not deterministic: check which slots changed, not their order.
    const written = [6, 7, 0, 1, 2, 3];
    expect(new Set(written.map(i => actors[i].x))).toEqual(new Set([100, 101, 102, 103, 200, 201]));
    for (const i of written) expect(actors[i].alive).toBe(true);
    for (const i of [4, 5]) expect(actors[i].alive).toBe(false);
    expect(counters.head).toBe(12);
    expect(counters.childrenInserted).toBe(2);
  });

  it('ignores children beyond maxChildren', async () => {
    const { actors, counters } = await inject({
      poolSize: 8, head: 0, spawnXs: [], childXs: [200, 201], childCount: 5, maxChildren: 2,
    });
    expect(actors.filter(a => a.alive)).toHaveLength(2);
    expect(counters.head).toBe(2);
    expect(counters.childrenInserted).toBe(2);
  });

  it('inserts nothing when there is nothing queued', async () => {
    const { actors, counters } = await inject({ poolSize: 8, head: 3, spawnXs: [], childXs: [], childCount: 0, maxChildren: 2 });
    expect(actors.filter(a => a.alive)).toHaveLength(0);
    expect(counters.head).toBe(3);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project gpu tests/gpu/inject.test.ts`
Expected: FAIL — cannot resolve `inject-pass`.

- [ ] **Step 3: Write `src/physarum/shaders/inject.wgsl`**

```wgsl
@group(0) @binding(0) var<uniform> params: SimParams;
@group(0) @binding(1) var<storage, read_write> actors: array<Actor>;
@group(0) @binding(2) var<storage, read> spawns: array<Actor>;
@group(0) @binding(3) var<storage, read> children: array<Actor>;
@group(0) @binding(4) var<storage, read_write> counters: Counters;

// Copies this step's Life spawns and queued children into the actor ring,
// overwriting the oldest slots.
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  let childCount = min(atomicLoad(&counters.childCount), params.maxChildren);
  var source: Actor;
  if (i < params.spawnCount) {
    source = spawns[i];
  } else if (i - params.spawnCount < childCount) {
    source = children[i - params.spawnCount];
    atomicAdd(&counters.childrenInserted, 1u);
  } else {
    return;
  }
  let slot = atomicAdd(&counters.head, 1u) & (params.poolSize - 1u);
  actors[slot] = source;
}
```

- [ ] **Step 4: Write `src/physarum/inject-pass.ts`**

```ts
import common from './shaders/common.wgsl?raw';
import code from './shaders/inject.wgsl?raw';
import { createModule } from '../gpu/shader';

export interface InjectBindings {
  params: GPUBuffer;
  actors: GPUBuffer;
  spawns: GPUBuffer;
  children: GPUBuffer;
  counters: GPUBuffer;
}

// Inserts Life spawns and reproduced children into the actor ring.
export class InjectPass {
  private pipeline: GPUComputePipeline;

  constructor(private device: GPUDevice) {
    this.pipeline = device.createComputePipeline({
      label: 'inject',
      layout: 'auto',
      compute: { module: createModule(device, common + code, 'inject'), entryPoint: 'main' },
    });
  }

  // workItems = spawnCount + maxChildren.
  encode(encoder: GPUCommandEncoder, b: InjectBindings, workItems: number): void {
    if (workItems === 0) return;
    const bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: b.params } },
        { binding: 1, resource: { buffer: b.actors } },
        { binding: 2, resource: { buffer: b.spawns } },
        { binding: 3, resource: { buffer: b.children } },
        { binding: 4, resource: { buffer: b.counters } },
      ],
    });
    const pass = encoder.beginComputePass({ label: 'inject' });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(workItems / 256));
    pass.end();
  }
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run --project gpu tests/gpu/inject.test.ts`
Expected: PASS, 3 tests, with no WGSL errors in the output.

- [ ] **Step 6: Commit**

```bash
git add src/physarum/shaders/inject.wgsl src/physarum/inject-pass.ts tests/gpu/inject.test.ts
git commit -m "Add ring-buffer inject pass

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Agent pass

**Files:**
- Create: `src/physarum/shaders/agent.wgsl`, `src/physarum/agent-pass.ts`
- Test: `tests/gpu/agent.test.ts`

**Interfaces:**
- Consumes: Task 7 and Task 5 items; test helpers.
- Produces: `interface AgentBindings { params: GPUBuffer; actors: GPUBuffer; children: GPUBuffer; counters: GPUBuffer; trail: GPUTexture; food: GPUTexture }`; `class AgentPass { constructor(device); encode(encoder, bindings: AgentBindings, poolSize: number): void }`

- [ ] **Step 1: Write the failing tests**

Create `tests/gpu/agent.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { AgentPass } from '../../src/physarum/agent-pass';
import { createCountersBuffer, createFieldTexture, createStorageBuffer, createUniformBuffer } from '../../src/physarum/buffers';
import { ACTOR_BYTES, COUNTERS_BYTES, packActors, unpackActors, unpackCounters, type ActorRecord } from '../../src/physarum/layout';
import { DEFAULT_PARAMS, SIM_PARAMS_BYTES, packSimParams, type PhysarumParams } from '../../src/physarum/params';
import { hsvMix } from '../../src/color';
import { actor, getDevice, readBuffer, setPixel, solidTexels, writeTexture } from './helpers';

const W = 64;
// Deterministic baseline: no randomness in turning, no reproduction, no food.
const BASE: Partial<PhysarumParams> = {
  directionRandomization: 0, spawnProbability: 0, foodSensitivity: 0, foodExhaustion: 0,
  minSpeed: 0, maxSpeed: 0, alwaysSpawnFromParent: -1,
};

async function runAgent(actors: ActorRecord[], overrides: Partial<PhysarumParams>, opts: { trail?: Uint8Array; food?: Uint8Array; maxChildren?: number } = {}) {
  const device = await getDevice();
  const poolSize = actors.length;
  const maxChildren = opts.maxChildren ?? 8;
  const params = createUniformBuffer(device, SIM_PARAMS_BYTES, 'params');
  device.queue.writeBuffer(params, 0, packSimParams({ ...DEFAULT_PARAMS, ...BASE, ...overrides }, {
    width: W, height: W, step: 0, poolSize, maxChildren, spawnCount: 0,
  }));
  const actorBuf = createStorageBuffer(device, poolSize * ACTOR_BYTES, 'actors');
  device.queue.writeBuffer(actorBuf, 0, packActors(actors));
  const children = createStorageBuffer(device, maxChildren * ACTOR_BYTES, 'children');
  const counters = createCountersBuffer(device);
  const trail = createFieldTexture(device, W, W, 'trail');
  const food = createFieldTexture(device, W, W, 'food');
  if (opts.trail) writeTexture(device, trail, W, W, opts.trail);
  if (opts.food) writeTexture(device, food, W, W, opts.food);

  const encoder = device.createCommandEncoder();
  new AgentPass(device).encode(encoder, { params, actors: actorBuf, children, counters, trail, food }, poolSize);
  device.queue.submit([encoder.finish()]);

  return {
    actors: unpackActors(await readBuffer(device, actorBuf, poolSize * ACTOR_BYTES)),
    children: unpackActors(await readBuffer(device, children, maxChildren * ACTOR_BYTES)),
    counters: unpackCounters(await readBuffer(device, counters, COUNTERS_BYTES)),
  };
}

// Mirror of the shader's xorshift32 + rand(), to predict the first random draw.
function firstRand(state: number): number {
  let x = state >>> 0;
  x = (x ^ (x << 13)) >>> 0;
  x = (x ^ (x >>> 17)) >>> 0;
  x = (x ^ (x << 5)) >>> 0;
  return (x >>> 8) / 16777216;
}

describe('AgentPass movement and bounds', () => {
  it('moves along its direction and ages by one', async () => {
    const { actors, counters } = await runAgent([actor({ x: 10, y: 10, speed: 1 })], { directionMomentum: 1, maxSpeed: 1 });
    expect(actors[0].x).toBeCloseTo(11, 4);
    expect(actors[0].y).toBeCloseTo(10, 4);
    expect(actors[0].dir).toBeCloseTo(0, 5);
    expect(actors[0].age).toBe(1);
    expect(counters.aliveCount).toBe(1);
  });

  it('wraps across the edge when wrapBounds is on', async () => {
    const { actors } = await runAgent([actor({ x: 63.5, y: 10.5, speed: 1 })], { directionMomentum: 1, maxSpeed: 1, wrapBounds: true });
    expect(actors[0].x).toBeCloseTo(0.5, 3);
    expect(actors[0].alive).toBe(true);
  });

  it('dies leaving the field when wrapBounds is off and respawn is off', async () => {
    const { actors, counters } = await runAgent([actor({ x: 63.5, y: 10.5, speed: 1 })], { directionMomentum: 1, maxSpeed: 1, wrapBounds: false });
    expect(actors[0].alive).toBe(false);
    expect(counters.aliveCount).toBe(0);
  });

  it('ignores slots that are not alive', async () => {
    const { actors, counters } = await runAgent([actor({ alive: false, x: 5 })], {});
    expect(actors[0].x).toBe(5);
    expect(counters.aliveCount).toBe(0);
  });
});

describe('AgentPass death and respawn', () => {
  it('dies of old age only once age exceeds life (checked before aging)', async () => {
    const { actors } = await runAgent([actor({ age: 5, life: 5 }), actor({ age: 6, life: 5 })], {});
    expect(actors[0].alive).toBe(true);
    expect(actors[0].age).toBe(6);
    expect(actors[1].alive).toBe(false);
  });

  it('respawns at a random position with its own color when always_spawn_from_parent = 0', async () => {
    const { actors } = await runAgent([actor({ age: 9, life: 5, speed: 2 })], { alwaysSpawnFromParent: 0, spawnRandomOffset: 0, minSpeed: 0.3, maxSpeed: 0.3 });
    const a = actors[0];
    expect(a.alive).toBe(true);
    expect(a.age).toBe(1);
    expect(a.speed).toBeCloseTo(0.3, 5);
    expect(a.x).toBeGreaterThanOrEqual(0);
    expect(a.x).toBeLessThan(W);
    expect(a.seed.slice(0, 3)).toEqual([1, 0, 0]);
  });

  it('respawns from a living parent, adopting its position, direction and color', async () => {
    const pool = 64;
    // Pick an rng seed whose first draw selects a parent other than slot 0.
    let seed = 1;
    while (Math.floor(firstRand(seed) * pool) % pool === 0) seed++;
    const green: [number, number, number, number] = [0, 1, 0, 1];
    const actors = [
      actor({ x: 5, y: 5, age: 9, life: 5, rng: seed }),
      ...Array.from({ length: pool - 1 }, () => actor({ x: 50, y: 50, dir: 1, color: green, seed: green })),
    ];
    const { actors: out } = await runAgent(actors, { alwaysSpawnFromParent: 1, spawnRandomOffset: 0, directionMomentum: 1 });
    expect(out[0].alive).toBe(true);
    expect(out[0].x).toBeCloseTo(50, 3);
    expect(out[0].y).toBeCloseTo(50, 3);
    expect(out[0].dir).toBeCloseTo(1, 4);
    expect(out[0].seed[1]).toBeCloseTo(1, 4);
    expect(out[0].seed[0]).toBeCloseTo(0, 4);
  });

  it('dies of exhaustion on food with alpha >= food_exhaustion, not below', async () => {
    const food = solidTexels(W, W, [0, 0, 0, 0]);
    setPixel(food, W, 10, 10, [255, 0, 0, 255]);
    setPixel(food, W, 20, 20, [255, 0, 0, 128]);
    const { actors } = await runAgent(
      [actor({ x: 10.5, y: 10.5 }), actor({ x: 20.5, y: 20.5 })],
      { foodExhaustion: 1 },
      { food },
    );
    expect(actors[0].alive).toBe(false);
    expect(actors[1].alive).toBe(true);
  });

  it('never dies of exhaustion when food_exhaustion is 0', async () => {
    const food = solidTexels(W, W, [255, 0, 0, 255]);
    const { actors } = await runAgent([actor({ x: 10.5, y: 10.5 })], { foodExhaustion: 0 }, { food });
    expect(actors[0].alive).toBe(true);
  });
});

describe('AgentPass sensing', () => {
  const sensorPixel = (angle: number) => [Math.floor(32 + 10 * Math.cos(angle)), Math.floor(32 + 10 * Math.sin(angle))];

  it('turns toward trail matching its seed hue', async () => {
    const trail = solidTexels(W, W, [0, 0, 0, 255]);
    const [px, py] = sensorPixel(2 / 3);
    setPixel(trail, W, px, py, [255, 0, 0, 255]);
    const { actors } = await runAgent([actor()], { directionMomentum: 0, lookSlices: 3, lookRadians: 1, lookDistance: 10 }, { trail });
    expect(actors[0].dir).toBeCloseTo(2 / 3, 4);
  });

  it('prefers food of its own hue over food of another hue', async () => {
    const food = solidTexels(W, W, [0, 0, 0, 0]);
    const [rx, ry] = sensorPixel(-1 / 3);
    const [gx, gy] = sensorPixel(1 / 3);
    setPixel(food, W, rx, ry, [255, 0, 0, 255]);
    setPixel(food, W, gx, gy, [0, 255, 0, 255]);
    const { actors } = await runAgent([actor()], { directionMomentum: 0, foodSensitivity: 1 }, { food });
    expect(actors[0].dir).toBeCloseTo(-1 / 3, 4);
  });

  it('keeps its heading when nothing distinguishes the sensors', async () => {
    const { actors } = await runAgent([actor({ dir: 0.5 })], { directionMomentum: 0 });
    expect(actors[0].dir).toBeCloseTo(0.5, 5);
  });
});

describe('AgentPass deposit color', () => {
  it('blends the trail under it toward its own color by intensity', async () => {
    const trail = solidTexels(W, W, [0, 0, 255, 255]);
    const { actors } = await runAgent([actor()], { intensity: 0.5, directionMomentum: 1 }, { trail });
    const expected = hsvMix([0, 0, 1], [1, 0, 0], 0.5);
    expected.forEach((v, k) => expect(actors[0].color[k]).toBeCloseTo(v, 2));
    expect(actors[0].color[3]).toBeCloseTo(0.5, 5);
  });
});

describe('AgentPass reproduction', () => {
  it('queues one child per alive actor at spawnProbability 1', async () => {
    const parents = [actor({ x: 10 }), actor({ x: 20 }), actor({ x: 30 }), actor({ x: 40 })];
    const { children, counters } = await runAgent(parents, {
      spawnProbability: 1, spawnRandomOffset: 0, directionVariance: 0, speedVariance: 0, directionMomentum: 1, life: 777,
    });
    expect(counters.childCount).toBe(4);
    const born = children.filter(c => c.alive);
    expect(born).toHaveLength(4);
    expect(new Set(born.map(c => Math.round(c.x)))).toEqual(new Set([10, 20, 30, 40]));
    for (const c of born) {
      expect(c.age).toBe(0);
      expect(c.life).toBe(777);
      expect(c.dir).toBeCloseTo(0, 5);
      expect(c.seed.slice(0, 3)).toEqual([1, 0, 0]);
      expect(c.rng).not.toBe(0);
    }
  });

  it('queues no children at spawnProbability 0', async () => {
    const { counters } = await runAgent([actor(), actor()], { spawnProbability: 0 });
    expect(counters.childCount).toBe(0);
  });

  it('writes no more than maxChildren children', async () => {
    const { children, counters } = await runAgent([actor(), actor(), actor(), actor()], { spawnProbability: 1 }, { maxChildren: 2 });
    expect(counters.childCount).toBe(4);
    expect(children).toHaveLength(2);
    expect(children.every(c => c.alive)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project gpu tests/gpu/agent.test.ts`
Expected: FAIL — cannot resolve `agent-pass`.

- [ ] **Step 3: Write `src/physarum/shaders/agent.wgsl`**

```wgsl
@group(0) @binding(0) var<uniform> params: SimParams;
@group(0) @binding(1) var<storage, read_write> actors: array<Actor>;
@group(0) @binding(2) var<storage, read_write> children: array<Actor>;
@group(0) @binding(3) var<storage, read_write> counters: Counters;
@group(0) @binding(4) var trail: texture_2d<f32>;
@group(0) @binding(5) var food: texture_2d<f32>;

// Starting "worst" sensor score, as in Particles.
const MIN_DISTANCE: f32 = 5.0;

var<workgroup> workgroupAlive: atomic<u32>;

fn field_size() -> vec2f {
  return vec2f(params.width, params.height);
}

fn is_out_of_bounds(p: vec2f) -> bool {
  return p.x < 0.0 || p.y < 0.0 || p.x >= params.width || p.y >= params.height;
}

// Wraps into the field when wrapBounds is on, otherwise clamps.
fn keep_in_field(p: vec2f) -> vec2f {
  let dims = field_size();
  let inside = dims - vec2f(0.001);
  if (params.wrapBounds != 0u) {
    return min(p - floor(p / dims) * dims, inside);
  }
  return clamp(p, vec2f(0.0), inside);
}

fn hue_lock(rgb: vec3f) -> vec4f {
  return dominant_color(vec4f(rgb, 1.0), params.lockToHsvAngles, params.hsvAngleOffset,
                        params.hsvSaturationMultiplier, params.hsvValueMultiplier);
}

// Respawn in place, per always_spawn_from_parent (> 0 from a random living
// parent, otherwise at a random position keeping its own color).
fn respawn(a: ptr<function, Actor>, rng: ptr<function, u32>) {
  var fromParent = false;
  if (params.alwaysSpawnFromParent > 0) {
    let parentId = u32(rand(rng) * f32(params.poolSize)) % params.poolSize;
    // Another thread may be updating this slot: a benign race, as in Particles.
    let parent = actors[parentId];
    if (parent.alive != 0u) {
      (*a).pos = parent.pos;
      (*a).dir = parent.dir;
      (*a).color = hue_lock(parent.color.rgb);
      fromParent = true;
    }
  }
  if (!fromParent) {
    (*a).pos = vec2f(rand(rng) * params.width, rand(rng) * params.height);
    (*a).color = hue_lock((*a).seed.rgb);
  }
  (*a).seed = (*a).color;
  var side = (*a).dir + PI / 2.0;
  if (rand(rng) < 0.5) {
    side -= PI;
  }
  (*a).pos += vec2f(cos(side), sin(side)) * params.spawnRandomOffset;
  (*a).age = 0u;
  (*a).speed = params.minSpeed;
}

// Returns the direction of the best-scoring sensor (lower score is better).
fn sense(a: Actor) -> f32 {
  let seedHsv = rgb2hsv(a.seed.rgb);
  let slices = max(params.lookSlices, 1u);
  var newDir = a.dir;
  var minScore = MIN_DISTANCE;
  for (var i = 0u; i < slices; i++) {
    for (var j = 0u; j < 2u; j++) {
      var offset = f32(i) / f32(slices) * params.lookRadians;
      if (j == 0u) {
        offset = -offset;
      }
      let t = a.dir + offset;
      let look = a.pos + vec2f(cos(t), sin(t)) * params.lookDistance;
      let dist = hsv_distance(rgb2hsv(load_or_zero(trail, look).rgb), seedHsv);
      var foodVal = 0.0;
      if (params.foodSensitivity > 0.0) {
        let f = load_or_zero(food, look);
        let fd = hsv_distance(rgb2hsv(f.rgb), seedHsv);
        foodVal = params.foodSensitivity * f.a * max(0.0, 1.0 - fd);
      }
      let score = dist - foodVal;
      if (score < minScore) {
        newDir = t;
        minScore = score;
      }
    }
  }
  return newDir;
}

fn maybe_spawn_child(a: Actor, rng: ptr<function, u32>) {
  if (rand(rng) >= params.spawnProbability) {
    return;
  }
  let index = atomicAdd(&counters.childCount, 1u);
  if (index >= params.maxChildren) {
    return;
  }
  var c = a;
  let offset = (rand(rng) * 2.0 - 1.0) * params.spawnRandomOffset;
  c.pos = keep_in_field(a.pos + vec2f(-sin(a.dir), cos(a.dir)) * offset);
  c.dir = a.dir + (rand(rng) * 2.0 - 1.0) * params.directionVariance;
  let speedCap = max(params.maxSpeed, params.minSpeed);
  c.speed = clamp(a.speed * (1.0 + (rand(rng) * 2.0 - 1.0) * params.speedVariance), params.minSpeed, speedCap);
  c.age = 0u;
  c.life = params.life;
  c.alive = 1u;
  c.rng = (*rng ^ 0x9e3779b9u) | 1u;
  children[index] = c;
}

// Advances one actor by a step; returns whether it is alive afterwards.
fn step_actor(id: u32) -> bool {
  var a = actors[id];
  if (a.alive == 0u) {
    return false;
  }
  var rng = a.rng;

  a.pos += a.speed * vec2f(cos(a.dir), sin(a.dir));
  var outOfBounds = is_out_of_bounds(a.pos);
  if (outOfBounds && params.wrapBounds != 0u) {
    a.pos = keep_in_field(a.pos);
    outOfBounds = false;
  }

  let foodHere = load_or_zero(food, a.pos);
  let exhausted = params.foodExhaustion > 0.0 && foodHere.a >= params.foodExhaustion;
  if (a.age > a.life || outOfBounds || exhausted) {
    if (params.alwaysSpawnFromParent < 0) {
      a.alive = 0u;
      a.rng = rng;
      actors[id] = a;
      return false;
    }
    respawn(&a, &rng);
  }

  let newDir = sense(a) + (rand(&rng) - 0.5) * params.directionRandomization;
  a.dir = mix(a.dir, newDir, 1.0 - params.directionMomentum);
  a.dir = a.dir % (2.0 * PI);
  a.speed = min(max(params.maxSpeed, params.minSpeed), a.speed + rand(&rng) * 0.01);
  a.age += 1u;

  let trailHere = load_or_zero(trail, a.pos);
  a.color = vec4f(hsv_mix(trailHere.rgb, a.color.rgb, params.intensity), params.intensity);

  maybe_spawn_child(a, &rng);
  a.rng = rng;
  actors[id] = a;
  return true;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) lid: u32) {
  if (lid == 0u) {
    atomicStore(&workgroupAlive, 0u);
  }
  workgroupBarrier();
  if (gid.x < params.poolSize && step_actor(gid.x)) {
    atomicAdd(&workgroupAlive, 1u);
  }
  workgroupBarrier();
  // One global atomic per workgroup instead of one per actor.
  if (lid == 0u) {
    let n = atomicLoad(&workgroupAlive);
    if (n > 0u) {
      atomicAdd(&counters.aliveCount, n);
    }
  }
}
```

- [ ] **Step 4: Write `src/physarum/agent-pass.ts`**

```ts
import common from './shaders/common.wgsl?raw';
import code from './shaders/agent.wgsl?raw';
import { createModule } from '../gpu/shader';

export interface AgentBindings {
  params: GPUBuffer;
  actors: GPUBuffer;
  children: GPUBuffer;
  counters: GPUBuffer;
  trail: GPUTexture;
  food: GPUTexture;
}

// Moves, kills/respawns, steers and reproduces every actor.
export class AgentPass {
  private pipeline: GPUComputePipeline;

  constructor(private device: GPUDevice) {
    this.pipeline = device.createComputePipeline({
      label: 'agent',
      layout: 'auto',
      compute: { module: createModule(device, common + code, 'agent'), entryPoint: 'main' },
    });
  }

  encode(encoder: GPUCommandEncoder, b: AgentBindings, poolSize: number): void {
    const bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: b.params } },
        { binding: 1, resource: { buffer: b.actors } },
        { binding: 2, resource: { buffer: b.children } },
        { binding: 3, resource: { buffer: b.counters } },
        { binding: 4, resource: b.trail.createView() },
        { binding: 5, resource: b.food.createView() },
      ],
    });
    const pass = encoder.beginComputePass({ label: 'agent' });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(poolSize / 256));
    pass.end();
  }
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run --project gpu tests/gpu/agent.test.ts`
Expected: PASS, all tests, no WGSL warnings. If a sensing test fails, print the actor's `dir` and compare against the sensor angles {0, ±1/3, ±2/3}; don't adjust test pixels to fit — check `sense()` against the spec.

- [ ] **Step 6: Commit**

```bash
git add src/physarum/shaders/agent.wgsl src/physarum/agent-pass.ts tests/gpu/agent.test.ts
git commit -m "Add Physarum agent pass

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Diffuse, deposit, and food passes

**Files:**
- Create: `src/physarum/shaders/diffuse.wgsl`, `src/physarum/diffuse-pass.ts`
- Create: `src/physarum/shaders/deposit.wgsl`, `src/physarum/deposit-pass.ts`
- Create: `src/physarum/shaders/food-seed.wgsl`, `src/physarum/shaders/food-fade.wgsl`, `src/physarum/food-pass.ts`
- Test: `tests/gpu/diffuse.test.ts`, `tests/gpu/deposit.test.ts`, `tests/gpu/food.test.ts`

**Interfaces:**
- Consumes: Tasks 5 and 7.
- Produces:
  - `class DiffusePass { constructor(device); encode(encoder, b: { fadeParams: GPUBuffer; source: GPUTexture; target: GPUTexture }): void }`
  - `class DepositPass { constructor(device); encode(encoder, b: { params: GPUBuffer; actors: GPUBuffer; target: GPUTexture }, poolSize: number): void }`
  - `class FoodPass { constructor(device); encodeSeeds(encoder, b: { foodParams: GPUBuffer; seeds: GPUBuffer; target: GPUTexture }, count: number): void; encodeFade(encoder, b: { fadeParams: GPUBuffer; target: GPUTexture }): void }`

- [ ] **Step 1: Write the failing diffuse test**

Create `tests/gpu/diffuse.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { DiffusePass } from '../../src/physarum/diffuse-pass';
import { createFieldTexture, createUniformBuffer } from '../../src/physarum/buffers';
import { FADE_PARAMS_BYTES, packFadeParams } from '../../src/physarum/params';
import { getDevice, pixel, readTexture, setPixel, solidTexels, writeTexture } from './helpers';

const W = 64;

async function diffuse(input: Uint8Array, decrement: number, blurMultiplier: number): Promise<Uint8Array> {
  const device = await getDevice();
  const source = createFieldTexture(device, W, W, 'source');
  const target = createFieldTexture(device, W, W, 'target');
  writeTexture(device, source, W, W, input);
  const fadeParams = createUniformBuffer(device, FADE_PARAMS_BYTES, 'fade');
  device.queue.writeBuffer(fadeParams, 0, packFadeParams(decrement, blurMultiplier));
  const encoder = device.createCommandEncoder();
  new DiffusePass(device).encode(encoder, { fadeParams, source, target });
  device.queue.submit([encoder.finish()]);
  return readTexture(device, target, W, W);
}

const near = (actual: number[], expected: number[]) =>
  expected.forEach((e, i) => expect(Math.abs(actual[i] - e)).toBeLessThanOrEqual(1));

describe('DiffusePass', () => {
  it('only fades when blurMultiplier is 0', async () => {
    const input = solidTexels(W, W, [0, 0, 0, 255]);
    setPixel(input, W, 5, 5, [128, 64, 0, 255]);
    const out = await diffuse(input, 0.01, 0);
    near(pixel(out, W, 5, 5), [125, 61, 0, 255]);
    near(pixel(out, W, 6, 5), [0, 0, 0, 255]);
  });

  it('blurs 3x3 with a weighted center, then fades', async () => {
    const input = solidTexels(W, W, [0, 0, 0, 255]);
    setPixel(input, W, 10, 10, [255, 0, 0, 255]);
    const out = await diffuse(input, 0.01, 1);
    // center: (1 + 1*1) / 10 - 0.01 = 0.19 -> 48; neighbour: 1/10 - 0.01 = 0.09 -> 23
    near(pixel(out, W, 10, 10), [48, 0, 0, 255]);
    near(pixel(out, W, 11, 11), [23, 0, 0, 255]);
    near(pixel(out, W, 12, 10), [0, 0, 0, 255]);
  });

  it('treats pixels outside the texture as zero at the edge', async () => {
    const input = solidTexels(W, W, [255, 255, 255, 255]);
    const out = await diffuse(input, 0, 1);
    // corner sees 4 of 9 neighbours plus the weighted center: (4 + 1) / 10 = 0.5
    near(pixel(out, W, 0, 0), [128, 128, 128, 255]);
    near(pixel(out, W, 30, 30), [255, 255, 255, 255]);
  });
});
```

- [ ] **Step 2: Write the failing deposit test**

Create `tests/gpu/deposit.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { DepositPass } from '../../src/physarum/deposit-pass';
import { createFieldTexture, createStorageBuffer, createUniformBuffer } from '../../src/physarum/buffers';
import { ACTOR_BYTES, packActors } from '../../src/physarum/layout';
import { DEFAULT_PARAMS, SIM_PARAMS_BYTES, packSimParams } from '../../src/physarum/params';
import { actor, getDevice, pixel, readTexture, solidTexels, writeTexture } from './helpers';

const W = 64;

describe('DepositPass', () => {
  it('colors exactly the pixel floor(pos) of each alive actor and nothing for dead ones', async () => {
    const device = await getDevice();
    const actors = [
      actor({ x: 5.7, y: 9.2, color: [0, 1, 0, 1] }),
      actor({ x: 40.1, y: 3.9, color: [0, 0, 1, 1], alive: false }),
    ];
    const params = createUniformBuffer(device, SIM_PARAMS_BYTES, 'params');
    device.queue.writeBuffer(params, 0, packSimParams(DEFAULT_PARAMS, {
      width: W, height: W, step: 0, poolSize: actors.length, maxChildren: 0, spawnCount: 0,
    }));
    const actorBuf = createStorageBuffer(device, actors.length * ACTOR_BYTES, 'actors');
    device.queue.writeBuffer(actorBuf, 0, packActors(actors));
    const target = createFieldTexture(device, W, W, 'trail');
    writeTexture(device, target, W, W, solidTexels(W, W, [10, 10, 10, 255]));

    const encoder = device.createCommandEncoder();
    new DepositPass(device).encode(encoder, { params, actors: actorBuf, target }, actors.length);
    device.queue.submit([encoder.finish()]);
    const out = await readTexture(device, target, W, W);

    expect(pixel(out, W, 5, 9)).toEqual([0, 255, 0, 255]);
    expect(pixel(out, W, 5, 54)).toEqual([10, 10, 10, 255]);   // would be hit if y were not flipped
    expect(pixel(out, W, 40, 3)).toEqual([10, 10, 10, 255]);   // dead actor drew nothing
    let changed = 0;
    for (let i = 0; i < W * W; i++) if (out[i * 4 + 1] === 255) changed++;
    expect(changed).toBe(1);
  });
});
```

- [ ] **Step 3: Write the failing food test**

Create `tests/gpu/food.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { FoodPass } from '../../src/physarum/food-pass';
import { createFieldTexture, createStorageBuffer, createUniformBuffer } from '../../src/physarum/buffers';
import { FOOD_SEED_BYTES, packFoodSeeds, type FoodSeed } from '../../src/physarum/layout';
import { FADE_PARAMS_BYTES, FOOD_PARAMS_BYTES, packFadeParams, packFoodParams } from '../../src/physarum/params';
import { getDevice, pixel, readTexture, solidTexels, writeTexture } from './helpers';

const W = 64;
const near = (actual: number[], expected: number[]) =>
  expected.forEach((e, i) => expect(Math.abs(actual[i] - e)).toBeLessThanOrEqual(1));

async function seed(seeds: FoodSeed[], initial?: Uint8Array): Promise<Uint8Array> {
  const device = await getDevice();
  const target = createFieldTexture(device, W, W, 'food');
  if (initial) writeTexture(device, target, W, W, initial);
  const foodParams = createUniformBuffer(device, FOOD_PARAMS_BYTES, 'food params');
  device.queue.writeBuffer(foodParams, 0, packFoodParams(16, 0.5, W, W));
  const seedBuf = createStorageBuffer(device, seeds.length * FOOD_SEED_BYTES, 'seeds');
  device.queue.writeBuffer(seedBuf, 0, packFoodSeeds(seeds));
  const encoder = device.createCommandEncoder();
  new FoodPass(device).encodeSeeds(encoder, { foodParams, seeds: seedBuf, target }, seeds.length);
  device.queue.submit([encoder.finish()]);
  return readTexture(device, target, W, W);
}

describe('FoodPass seeds', () => {
  it('adds color * foodPerDeath and alpha foodPerDeath over exactly the 16x16 block', async () => {
    const out = await seed([{ cellX: 1, cellY: 2, rgb: [1, 0, 0] }]);
    near(pixel(out, W, 16, 32), [128, 0, 0, 128]);
    near(pixel(out, W, 31, 47), [128, 0, 0, 128]);
    expect(pixel(out, W, 15, 32)).toEqual([0, 0, 0, 0]);
    expect(pixel(out, W, 32, 32)).toEqual([0, 0, 0, 0]);
    expect(pixel(out, W, 16, 31)).toEqual([0, 0, 0, 0]);
    expect(pixel(out, W, 16, 48)).toEqual([0, 0, 0, 0]);
  });

  it('accumulates additively', async () => {
    const out = await seed([{ cellX: 0, cellY: 0, rgb: [0, 1, 0] }, { cellX: 0, cellY: 0, rgb: [0, 1, 0] }]);
    near(pixel(out, W, 3, 3), [0, 255, 0, 255]);
  });
});

describe('FoodPass fade', () => {
  it('subtracts the decrement from every channel and clamps at 0', async () => {
    const device = await getDevice();
    const target = createFieldTexture(device, W, W, 'food');
    const initial = solidTexels(W, W, [100, 50, 0, 200]);
    writeTexture(device, target, W, W, initial);
    const fadeParams = createUniformBuffer(device, FADE_PARAMS_BYTES, 'fade');
    device.queue.writeBuffer(fadeParams, 0, packFadeParams(0.02, 0));
    const encoder = device.createCommandEncoder();
    new FoodPass(device).encodeFade(encoder, { fadeParams, target });
    device.queue.submit([encoder.finish()]);
    const out = await readTexture(device, target, W, W);
    near(pixel(out, W, 7, 7), [95, 45, 0, 195]);
  });
});
```

- [ ] **Step 4: Run to verify failures**

Run: `npx vitest run --project gpu tests/gpu/diffuse.test.ts tests/gpu/deposit.test.ts tests/gpu/food.test.ts`
Expected: FAIL — cannot resolve the pass modules.

- [ ] **Step 5: Write the diffuse shader and pass**

`src/physarum/shaders/diffuse.wgsl`:
```wgsl
@group(0) @binding(0) var<uniform> fade: FadeParams;
@group(0) @binding(1) var trailIn: texture_2d<f32>;
@group(0) @binding(2) var trailOut: texture_storage_2d<rgba8unorm, write>;

// Optionally blurs (3x3 plus a weighted center), then fades, trailIn into trailOut.
// Pixels outside the texture count as zero. Alpha is always written as 1.
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let dims = vec2i(textureDimensions(trailIn));
  let p = vec2i(gid.xy);
  if (p.x >= dims.x || p.y >= dims.y) {
    return;
  }
  let center = textureLoad(trailIn, p, 0);
  if (fade.blurMultiplier == 0.0) {
    textureStore(trailOut, p, vec4f(max(center.rgb - fade.decrement, vec3f(0.0)), 1.0));
    return;
  }
  var total = vec4f(0.0);
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      total += load_or_zero(trailIn, vec2f(p + vec2i(dx, dy)));
    }
  }
  total += center * fade.blurMultiplier;
  let rgb = max(total.rgb / (fade.blurMultiplier + 9.0) - fade.decrement, vec3f(0.0));
  textureStore(trailOut, p, vec4f(rgb, 1.0));
}
```

`src/physarum/diffuse-pass.ts`:
```ts
import common from './shaders/common.wgsl?raw';
import code from './shaders/diffuse.wgsl?raw';
import { createModule } from '../gpu/shader';

export interface DiffuseBindings {
  fadeParams: GPUBuffer;
  source: GPUTexture;
  target: GPUTexture;
}

// Blurs and fades the trail from one texture into the other (ping-pong).
export class DiffusePass {
  private pipeline: GPUComputePipeline;

  constructor(private device: GPUDevice) {
    this.pipeline = device.createComputePipeline({
      label: 'diffuse',
      layout: 'auto',
      compute: { module: createModule(device, common + code, 'diffuse'), entryPoint: 'main' },
    });
  }

  encode(encoder: GPUCommandEncoder, b: DiffuseBindings): void {
    const bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: b.fadeParams } },
        { binding: 1, resource: b.source.createView() },
        { binding: 2, resource: b.target.createView() },
      ],
    });
    const pass = encoder.beginComputePass({ label: 'diffuse' });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(b.source.width / 8), Math.ceil(b.source.height / 8));
    pass.end();
  }
}
```

- [ ] **Step 6: Write the deposit shader and pass**

`src/physarum/shaders/deposit.wgsl`:
```wgsl
@group(0) @binding(0) var<uniform> params: SimParams;
@group(0) @binding(1) var<storage, read> actors: array<Actor>;

struct DepositOut {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
}

// One 1-px point per actor slot. Dead slots are pushed outside the clip volume.
@vertex
fn vs(@builtin(vertex_index) index: u32) -> DepositOut {
  let a = actors[index];
  var out: DepositOut;
  out.color = vec4f(a.color.rgb, 1.0);
  if (a.alive == 0u) {
    out.position = vec4f(2.0, 2.0, 0.0, 1.0);
    return out;
  }
  // Centre of pixel floor(pos). Clip-space y points up, texture rows go down.
  let p = floor(a.pos) + vec2f(0.5);
  out.position = vec4f(p.x / params.width * 2.0 - 1.0, 1.0 - p.y / params.height * 2.0, 0.0, 1.0);
  return out;
}

@fragment
fn fs(v: DepositOut) -> @location(0) vec4f {
  return v.color;
}
```

`src/physarum/deposit-pass.ts`:
```ts
import common from './shaders/common.wgsl?raw';
import code from './shaders/deposit.wgsl?raw';
import { createModule } from '../gpu/shader';

export interface DepositBindings {
  params: GPUBuffer;
  actors: GPUBuffer;
  target: GPUTexture;
}

// Draws each alive actor's deposit color into the trail, replacing what was there.
export class DepositPass {
  private pipeline: GPURenderPipeline;

  constructor(private device: GPUDevice) {
    const module = createModule(device, common + code, 'deposit');
    this.pipeline = device.createRenderPipeline({
      label: 'deposit',
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
      primitive: { topology: 'point-list' },
    });
  }

  encode(encoder: GPUCommandEncoder, b: DepositBindings, poolSize: number): void {
    const bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: b.params } },
        { binding: 1, resource: { buffer: b.actors } },
      ],
    });
    const pass = encoder.beginRenderPass({
      label: 'deposit',
      colorAttachments: [{ view: b.target.createView(), loadOp: 'load', storeOp: 'store' }],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(poolSize);
    pass.end();
  }
}
```

- [ ] **Step 7: Write the food shaders and pass**

`src/physarum/shaders/food-seed.wgsl`:
```wgsl
// Must match packFoodParams in src/physarum/params.ts.
struct FoodParams {
  cellSize: f32,
  foodPerDeath: f32,
  width: f32,
  height: f32,
}

// Must match packFoodSeeds in src/physarum/layout.ts.
struct FoodSeed {
  color: vec4f,
  cell: vec2u,
  _pad: vec2u,
}

@group(0) @binding(0) var<uniform> foodParams: FoodParams;
@group(0) @binding(1) var<storage, read> seeds: array<FoodSeed>;

struct SeedOut {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
}

// One quad (two triangles) per dead Life cell, covering its block of the field.
@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SeedOut {
  var corners = array<vec2f, 6>(
    vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
    vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0),
  );
  let seed = seeds[ii];
  let p = (vec2f(seed.cell) + corners[vi]) * foodParams.cellSize;
  var out: SeedOut;
  out.position = vec4f(p.x / foodParams.width * 2.0 - 1.0, 1.0 - p.y / foodParams.height * 2.0, 0.0, 1.0);
  out.color = vec4f(seed.color.rgb * foodParams.foodPerDeath, foodParams.foodPerDeath);
  return out;
}

@fragment
fn fs(v: SeedOut) -> @location(0) vec4f {
  return v.color;
}
```

`src/physarum/shaders/food-fade.wgsl`:
```wgsl
@group(0) @binding(0) var<uniform> fade: FadeParams;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(corners[vi], 0.0, 1.0);
}

// Drawn with a reverse-subtract blend, so every channel of the target loses
// `decrement` (clamped at 0 by the unorm format) without reading the texture.
@fragment
fn fs() -> @location(0) vec4f {
  return vec4f(fade.decrement);
}
```

`src/physarum/food-pass.ts`:
```ts
import common from './shaders/common.wgsl?raw';
import seedCode from './shaders/food-seed.wgsl?raw';
import fadeCode from './shaders/food-fade.wgsl?raw';
import { createModule } from '../gpu/shader';

export interface FoodSeedBindings {
  foodParams: GPUBuffer;
  seeds: GPUBuffer;
  target: GPUTexture;
}

export interface FoodFadeBindings {
  fadeParams: GPUBuffer;
  target: GPUTexture;
}

// Adds food where Life cells died, and fades the food map.
export class FoodPass {
  private seedPipeline: GPURenderPipeline;
  private fadePipeline: GPURenderPipeline;

  constructor(private device: GPUDevice) {
    const seedModule = createModule(device, seedCode, 'food seed');
    const add: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one', operation: 'add' };
    this.seedPipeline = device.createRenderPipeline({
      label: 'food seed',
      layout: 'auto',
      vertex: { module: seedModule, entryPoint: 'vs' },
      fragment: { module: seedModule, entryPoint: 'fs', targets: [{ format: 'rgba8unorm', blend: { color: add, alpha: add } }] },
    });
    const fadeModule = createModule(device, common + fadeCode, 'food fade');
    const subtract: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one', operation: 'reverse-subtract' };
    this.fadePipeline = device.createRenderPipeline({
      label: 'food fade',
      layout: 'auto',
      vertex: { module: fadeModule, entryPoint: 'vs' },
      fragment: { module: fadeModule, entryPoint: 'fs', targets: [{ format: 'rgba8unorm', blend: { color: subtract, alpha: subtract } }] },
    });
  }

  encodeSeeds(encoder: GPUCommandEncoder, b: FoodSeedBindings, count: number): void {
    if (count === 0) return;
    const bindGroup = this.device.createBindGroup({
      layout: this.seedPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: b.foodParams } },
        { binding: 1, resource: { buffer: b.seeds } },
      ],
    });
    const pass = encoder.beginRenderPass({
      label: 'food seed',
      colorAttachments: [{ view: b.target.createView(), loadOp: 'load', storeOp: 'store' }],
    });
    pass.setPipeline(this.seedPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6, count);
    pass.end();
  }

  encodeFade(encoder: GPUCommandEncoder, b: FoodFadeBindings): void {
    const bindGroup = this.device.createBindGroup({
      layout: this.fadePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: b.fadeParams } }],
    });
    const pass = encoder.beginRenderPass({
      label: 'food fade',
      colorAttachments: [{ view: b.target.createView(), loadOp: 'load', storeOp: 'store' }],
    });
    pass.setPipeline(this.fadePipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }
}
```

- [ ] **Step 8: Run to verify pass**

Run: `npm run test:gpu`
Expected: PASS, all GPU tests.

- [ ] **Step 9: Commit**

```bash
git add src/physarum tests/gpu
git commit -m "Add diffuse, deposit and food passes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: PhysarumSim orchestrator

**Files:**
- Create: `src/physarum/simulation.ts`
- Test: `tests/gpu/simulation.test.ts`

**Interfaces:**
- Consumes: all passes (Tasks 8–10), buffers (Task 7), params/layout (Task 5).
- Produces: `interface SimOptions { width; height; poolSize; cellSize }`; `class PhysarumSim { constructor(device, opts: SimOptions); params: PhysarumParams; readonly poolSize: number; readonly maxChildren: number; readonly maxSpawnsPerStep: number; readonly maxFoodSeedsPerStep: number; readonly trail: GPUTexture; readonly foodTexture: GPUTexture; step(spawns: ActorRecord[], seeds: FoodSeed[]): void; setPoolSize(n: number): void; clearActors(): void; clearTrail(): void; clearFood(): void; readCounters(): Promise<CounterValues | null> }`

- [ ] **Step 1: Write the failing tests**

Create `tests/gpu/simulation.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { PhysarumSim } from '../../src/physarum/simulation';
import { DEFAULT_PARAMS } from '../../src/physarum/params';
import { actor, getDevice, pixel, readTexture } from './helpers';

const W = 64;

async function makeSim(poolSize = 256) {
  const sim = new PhysarumSim(await getDevice(), { width: W, height: W, poolSize, cellSize: 16 });
  // Quiet, deterministic settings: actors stand still, never die, never reproduce.
  sim.params = {
    ...DEFAULT_PARAMS, minSpeed: 0, maxSpeed: 0, spawnProbability: 0, alwaysSpawnFromParent: -1,
    foodExhaustion: 0, fadeDecrement: 0, foodFadeDecrement: 0, life: 1000000,
  };
  return sim;
}

const spawnsAt = (n: number) => Array.from({ length: n }, (_, i) => actor({ x: (i % W) + 0.5, y: Math.floor(i / W) + 0.5 }));

describe('PhysarumSim', () => {
  it('injects spawns so they are alive on the next step', async () => {
    const sim = await makeSim();
    sim.step(spawnsAt(10), []);
    sim.step([], []);
    const counters = await sim.readCounters();
    expect(counters?.aliveCount).toBe(10);
    expect(counters?.head).toBe(10);
  });

  it('deposits a new actor into the trail returned by .trail', async () => {
    const sim = await makeSim();
    sim.step([actor({ x: 5.5, y: 7.5, color: [0, 1, 0, 1], seed: [0, 1, 0, 1] })], []);
    const out = await readTexture(await getDevice(), sim.trail, W, W);
    expect(pixel(out, W, 5, 7)).toEqual([0, 255, 0, 255]);
  });

  it('never holds more than poolSize actors as the ring wraps', async () => {
    const sim = await makeSim(256);
    expect(sim.maxSpawnsPerStep).toBe(224);
    sim.step(spawnsAt(200), []);
    sim.step(spawnsAt(200), []);
    sim.step([], []);
    const counters = await sim.readCounters();
    expect(counters?.aliveCount).toBe(256);
    expect(counters?.head).toBe(400);
  });

  it('rejects more spawns than a step can hold', async () => {
    const sim = await makeSim(256);
    expect(() => sim.step(spawnsAt(225), [])).toThrow(/max is 224/);
  });

  it('counts reproduced children as inserted', async () => {
    const sim = await makeSim();
    sim.params.spawnProbability = 1;
    sim.step(spawnsAt(10), []);
    sim.step([], []);
    expect((await sim.readCounters())?.childrenInserted).toBe(10);
  });

  it('applies death food seeds to the food texture', async () => {
    const sim = await makeSim();
    sim.step([], [{ cellX: 1, cellY: 2, rgb: [1, 0, 0] }]);
    const out = await readTexture(await getDevice(), sim.foodTexture, W, W);
    const p = pixel(out, W, 20, 36);
    expect(Math.abs(p[0] - 128)).toBeLessThanOrEqual(1);
    expect(p[1]).toBe(0);
    expect(Math.abs(p[3] - 128)).toBeLessThanOrEqual(1);
  });

  it('setPoolSize clears actors and resets every counter', async () => {
    const sim = await makeSim(256);
    sim.params.spawnProbability = 1;
    sim.step(spawnsAt(10), []);
    sim.step([], []);
    sim.setPoolSize(512);
    sim.step([], []);
    expect(await sim.readCounters()).toEqual({ head: 0, childCount: 0, aliveCount: 0, childrenInserted: 0 });
    expect(sim.poolSize).toBe(512);
  });

  it('clearActors empties the pool without reallocating', async () => {
    const sim = await makeSim();
    sim.step(spawnsAt(10), []);
    sim.clearActors();
    sim.step([], []);
    expect((await sim.readCounters())?.aliveCount).toBe(0);
  });

  it('clearTrail and clearFood blank their textures', async () => {
    const device = await getDevice();
    const sim = await makeSim();
    sim.step([actor({ x: 5.5, y: 7.5, color: [0, 1, 0, 1] })], [{ cellX: 0, cellY: 0, rgb: [1, 0, 0] }]);
    sim.clearTrail();
    sim.clearFood();
    expect(pixel(await readTexture(device, sim.trail, W, W), W, 5, 7)).toEqual([0, 0, 0, 255]);
    expect(pixel(await readTexture(device, sim.foodTexture, W, W), W, 3, 3)).toEqual([0, 0, 0, 0]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project gpu tests/gpu/simulation.test.ts`
Expected: FAIL — cannot resolve `simulation`.

- [ ] **Step 3: Implement `src/physarum/simulation.ts`**

```ts
import { AgentPass } from './agent-pass';
import { DepositPass } from './deposit-pass';
import { DiffusePass } from './diffuse-pass';
import { FoodPass } from './food-pass';
import { InjectPass } from './inject-pass';
import { createCountersBuffer, createFieldTexture, createStorageBuffer, createUniformBuffer } from './buffers';
import {
  ACTOR_BYTES, COUNTERS_BYTES, FOOD_SEED_BYTES, packActors, packFoodSeeds, unpackCounters,
  type ActorRecord, type CounterValues, type FoodSeed,
} from './layout';
import {
  DEFAULT_PARAMS, FADE_PARAMS_BYTES, FOOD_PARAMS_BYTES, SIM_PARAMS_BYTES,
  packFadeParams, packFoodParams, packSimParams, type PhysarumParams,
} from './params';

export interface SimOptions {
  width: number;
  height: number;
  poolSize: number;
  cellSize: number;
}

const MAX_SPAWNS_PER_STEP = 65536;

// Owns the Physarum GPU state and runs one step at a time. See the spec's
// "One Physarum step" for the pass order.
export class PhysarumSim {
  params: PhysarumParams = { ...DEFAULT_PARAMS };
  readonly maxFoodSeedsPerStep: number;

  private readonly agentPass: AgentPass;
  private readonly injectPass: InjectPass;
  private readonly diffusePass: DiffusePass;
  private readonly depositPass: DepositPass;
  private readonly foodPass: FoodPass;

  private trailA: GPUTexture;
  private trailB: GPUTexture;
  private readonly food: GPUTexture;

  private actors!: GPUBuffer;
  private children!: GPUBuffer;
  private spawns!: GPUBuffer;
  private readonly foodSeeds: GPUBuffer;
  private readonly counters: GPUBuffer;
  private readonly countersStaging: GPUBuffer;
  private readonly simParams: GPUBuffer;
  private readonly trailFadeParams: GPUBuffer;
  private readonly foodFadeParams: GPUBuffer;
  private readonly foodParams: GPUBuffer;

  private poolSizeValue = 0;
  private stepIndex = 0;
  private readPending = false;

  constructor(
    private readonly device: GPUDevice,
    private readonly opts: SimOptions,
  ) {
    const { width, height, cellSize } = opts;
    this.agentPass = new AgentPass(device);
    this.injectPass = new InjectPass(device);
    this.diffusePass = new DiffusePass(device);
    this.depositPass = new DepositPass(device);
    this.foodPass = new FoodPass(device);

    this.trailA = createFieldTexture(device, width, height, 'trail A');
    this.trailB = createFieldTexture(device, width, height, 'trail B');
    this.food = createFieldTexture(device, width, height, 'food');

    this.maxFoodSeedsPerStep = (width / cellSize) * (height / cellSize);
    this.foodSeeds = createStorageBuffer(device, this.maxFoodSeedsPerStep * FOOD_SEED_BYTES, 'food seeds');
    this.counters = createCountersBuffer(device);
    this.countersStaging = device.createBuffer({
      label: 'counters staging',
      size: COUNTERS_BYTES,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    this.simParams = createUniformBuffer(device, SIM_PARAMS_BYTES, 'sim params');
    this.trailFadeParams = createUniformBuffer(device, FADE_PARAMS_BYTES, 'trail fade params');
    this.foodFadeParams = createUniformBuffer(device, FADE_PARAMS_BYTES, 'food fade params');
    this.foodParams = createUniformBuffer(device, FOOD_PARAMS_BYTES, 'food params');

    this.clearTrail();
    this.allocatePool(opts.poolSize);
  }

  get poolSize(): number {
    return this.poolSizeValue;
  }

  get maxChildren(): number {
    return this.poolSizeValue / 8;
  }

  // Life spawns per step are capped so a step never inserts more than poolSize actors.
  get maxSpawnsPerStep(): number {
    return Math.min(this.poolSizeValue - this.maxChildren, MAX_SPAWNS_PER_STEP);
  }

  // The latest trail.
  get trail(): GPUTexture {
    return this.trailA;
  }

  get foodTexture(): GPUTexture {
    return this.food;
  }

  step(spawns: ActorRecord[], seeds: FoodSeed[]): void {
    if (spawns.length > this.maxSpawnsPerStep) {
      throw new Error(`step() got ${spawns.length} spawns; max is ${this.maxSpawnsPerStep}`);
    }
    if (seeds.length > this.maxFoodSeedsPerStep) {
      throw new Error(`step() got ${seeds.length} food seeds; max is ${this.maxFoodSeedsPerStep}`);
    }
    const { device, params: p } = this;
    const { width, height, cellSize } = this.opts;
    const queue = device.queue;

    queue.writeBuffer(this.simParams, 0, packSimParams(p, {
      width, height, step: this.stepIndex, poolSize: this.poolSizeValue,
      maxChildren: this.maxChildren, spawnCount: spawns.length,
    }));
    if (spawns.length > 0) queue.writeBuffer(this.spawns, 0, packActors(spawns));

    const encoder = device.createCommandEncoder({ label: 'physarum step' });
    // Reset childCount and aliveCount (bytes 4..12); head and childrenInserted persist.
    encoder.clearBuffer(this.counters, 4, 8);

    const diffuse = this.stepIndex % Math.max(1, p.blurInterval) === 0;
    let current = this.trailA;
    if (diffuse) {
      queue.writeBuffer(this.trailFadeParams, 0, packFadeParams(p.fadeDecrement, p.blurMultiplier));
      this.diffusePass.encode(encoder, { fadeParams: this.trailFadeParams, source: this.trailA, target: this.trailB });
      current = this.trailB;
    }

    if (seeds.length > 0) {
      queue.writeBuffer(this.foodSeeds, 0, packFoodSeeds(seeds));
      queue.writeBuffer(this.foodParams, 0, packFoodParams(cellSize, p.foodPerDeath, width, height));
      this.foodPass.encodeSeeds(encoder, { foodParams: this.foodParams, seeds: this.foodSeeds, target: this.food }, seeds.length);
    }
    if (this.stepIndex % Math.max(1, p.foodFadeInterval) === 0) {
      queue.writeBuffer(this.foodFadeParams, 0, packFadeParams(p.foodFadeDecrement, 0));
      this.foodPass.encodeFade(encoder, { fadeParams: this.foodFadeParams, target: this.food });
    }

    this.agentPass.encode(encoder, {
      params: this.simParams, actors: this.actors, children: this.children,
      counters: this.counters, trail: current, food: this.food,
    }, this.poolSizeValue);
    this.injectPass.encode(encoder, {
      params: this.simParams, actors: this.actors, spawns: this.spawns,
      children: this.children, counters: this.counters,
    }, spawns.length + this.maxChildren);
    this.depositPass.encode(encoder, { params: this.simParams, actors: this.actors, target: current }, this.poolSizeValue);

    queue.submit([encoder.finish()]);
    if (diffuse) [this.trailA, this.trailB] = [this.trailB, this.trailA];
    this.stepIndex++;
  }

  setPoolSize(poolSize: number): void {
    this.allocatePool(poolSize);
  }

  clearActors(): void {
    const encoder = this.device.createCommandEncoder({ label: 'clear actors' });
    encoder.clearBuffer(this.actors);
    encoder.clearBuffer(this.children);
    encoder.clearBuffer(this.counters);
    this.device.queue.submit([encoder.finish()]);
  }

  clearTrail(): void {
    this.clearTextures([this.trailA, this.trailB], { r: 0, g: 0, b: 0, a: 1 });
  }

  clearFood(): void {
    this.clearTextures([this.food], { r: 0, g: 0, b: 0, a: 0 });
  }

  // Reads the counters after all submitted steps finish. Returns null if a
  // read is already in flight, so callers can poll without piling up maps.
  async readCounters(): Promise<CounterValues | null> {
    if (this.readPending) return null;
    this.readPending = true;
    try {
      const encoder = this.device.createCommandEncoder({ label: 'read counters' });
      encoder.copyBufferToBuffer(this.counters, 0, this.countersStaging, 0, COUNTERS_BYTES);
      this.device.queue.submit([encoder.finish()]);
      await this.countersStaging.mapAsync(GPUMapMode.READ);
      const values = unpackCounters(this.countersStaging.getMappedRange().slice(0));
      this.countersStaging.unmap();
      return values;
    } finally {
      this.readPending = false;
    }
  }

  private allocatePool(poolSize: number): void {
    if (!Number.isInteger(Math.log2(poolSize)) || poolSize < 16) {
      throw new Error(`poolSize must be a power of two >= 16, got ${poolSize}`);
    }
    this.actors?.destroy();
    this.children?.destroy();
    this.spawns?.destroy();
    this.poolSizeValue = poolSize;
    this.actors = createStorageBuffer(this.device, poolSize * ACTOR_BYTES, 'actors');
    this.children = createStorageBuffer(this.device, this.maxChildren * ACTOR_BYTES, 'children');
    this.spawns = createStorageBuffer(this.device, this.maxSpawnsPerStep * ACTOR_BYTES, 'spawns');
    this.device.queue.writeBuffer(this.counters, 0, new Uint32Array(4));
  }

  private clearTextures(textures: GPUTexture[], clearValue: GPUColor): void {
    const encoder = this.device.createCommandEncoder({ label: 'clear textures' });
    for (const texture of textures) {
      encoder.beginRenderPass({
        colorAttachments: [{ view: texture.createView(), loadOp: 'clear', clearValue, storeOp: 'store' }],
      }).end();
    }
    this.device.queue.submit([encoder.finish()]);
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:gpu`
Expected: PASS, all GPU tests.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck` — expected: no errors.

```bash
git add src/physarum/simulation.ts tests/gpu/simulation.test.ts
git commit -m "Add PhysarumSim step orchestrator

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Clocks, rate meter, placement and texel helpers

**Files:**
- Create: `src/app/clock.ts`, `src/app/rates.ts`, `src/ui/placement.ts`, `src/render/texels.ts`
- Test: `tests/unit/clock.test.ts`, `tests/unit/rates.test.ts`, `tests/unit/placement.test.ts`, `tests/unit/texels.test.ts`

**Interfaces:**
- Consumes: `Cell` (Task 2), `rotateCells`, `Pattern`, `PATTERNS` (Task 2), `PALETTE` (Task 4), `ColoredCell` (Task 4).
- Produces:
  - `class FixedStepClock { constructor(hz: number, maxStepsPerAdvance: number); hz: number; advance(dtMs: number): number; reset(): void }`
  - `class RateMeter { add(n?: number): void; sample(nowMs: number): number }` (negative adds are ignored)
  - `interface Rect { left; top; width; height }`, `cellFromPointer(clientX, clientY, rect: Rect, gridSize): Cell | null`, `ghostCells(pattern: Pattern | null, quarterTurns, anchor: Cell, gridSize): Cell[]`
  - `GHOST_RGBA: readonly number[]`, `lifeTexels(cells: ColoredCell[], gridSize): Uint8Array`, `ghostTexels(cells: Cell[], gridSize): Uint8Array`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/clock.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { FixedStepClock } from '../../src/app/clock';

describe('FixedStepClock', () => {
  it('emits one step per period, carrying the remainder', () => {
    const c = new FixedStepClock(10, 4); // 100 ms period
    expect(c.advance(250)).toBe(2);
    expect(c.advance(40)).toBe(0);
    expect(c.advance(10)).toBe(1); // 50 + 40 + 10 = 100
  });

  it('caps catch-up after a long pause and drops the backlog', () => {
    const c = new FixedStepClock(30, 4);
    expect(c.advance(10_000)).toBe(4);
    expect(c.advance(0)).toBe(0);
  });

  it('follows a changed rate', () => {
    const c = new FixedStepClock(1, 1);
    c.hz = 2;
    expect(c.advance(500)).toBe(1);
  });

  it('reset() discards accumulated time', () => {
    const c = new FixedStepClock(10, 4);
    c.advance(90);
    c.reset();
    expect(c.advance(20)).toBe(0);
  });
});
```

Create `tests/unit/rates.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { RateMeter } from '../../src/app/rates';

describe('RateMeter', () => {
  it('reports events per second between samples', () => {
    const m = new RateMeter();
    expect(m.sample(1000)).toBe(0);
    m.add(5);
    m.add();
    expect(m.sample(1500)).toBe(12);
    expect(m.sample(2500)).toBe(0);
  });

  it('ignores negative adds', () => {
    const m = new RateMeter();
    m.sample(0);
    m.add(-100);
    m.add(3);
    expect(m.sample(1000)).toBe(3);
  });
});
```

Create `tests/unit/placement.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { cellFromPointer, ghostCells } from '../../src/ui/placement';
import { PATTERNS } from '../../src/life/patterns';

const rect = { left: 200, top: 50, width: 640, height: 640 }; // 5 CSS px per cell at 128

describe('cellFromPointer', () => {
  it('maps a point on a scaled, offset canvas to its cell', () => {
    expect(cellFromPointer(200, 50, rect, 128)).toEqual({ x: 0, y: 0 });
    expect(cellFromPointer(200 + 5 * 10 + 2, 50 + 5 * 20 + 4, rect, 128)).toEqual({ x: 10, y: 20 });
    expect(cellFromPointer(839.9, 689.9, rect, 128)).toEqual({ x: 127, y: 127 });
  });

  it('returns null outside the canvas', () => {
    expect(cellFromPointer(199, 60, rect, 128)).toBeNull();
    expect(cellFromPointer(840, 60, rect, 128)).toBeNull();
    expect(cellFromPointer(300, 690, rect, 128)).toBeNull();
  });
});

describe('ghostCells', () => {
  const glider = PATTERNS.find(p => p.id === 'glider')!;

  it('offsets the rotated pattern by the anchor', () => {
    const cells = ghostCells(glider, 0, { x: 10, y: 10 }, 128);
    expect(new Set(cells.map(c => `${c.x},${c.y}`))).toEqual(new Set(['11,10', '12,11', '10,12', '11,12', '12,12']));
  });

  it('clips cells that fall off the board', () => {
    const cells = ghostCells(glider, 0, { x: 126, y: 126 }, 128);
    expect(cells).toEqual([{ x: 127, y: 126 }]);
  });

  it('shows the single cell under the cursor in paint mode', () => {
    expect(ghostCells(null, 0, { x: 3, y: 4 }, 128)).toEqual([{ x: 3, y: 4 }]);
  });
});
```

Create `tests/unit/texels.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { GHOST_RGBA, ghostTexels, lifeTexels } from '../../src/render/texels';
import { PALETTE } from '../../src/life/palette';

describe('lifeTexels', () => {
  it('writes each live cell in its palette color, opaque, and leaves the rest transparent', () => {
    const t = lifeTexels([{ x: 1, y: 2, paletteIndex: 3 }], 4);
    expect(t).toHaveLength(4 * 4 * 4);
    const o = (2 * 4 + 1) * 4;
    expect(Array.from(t.slice(o, o + 4))).toEqual([...PALETTE[3].map(v => Math.round(v * 255)), 255]);
    expect(Array.from(t.slice(0, 4))).toEqual([0, 0, 0, 0]);
  });
});

describe('ghostTexels', () => {
  it('writes the ghost color at each cell', () => {
    const t = ghostTexels([{ x: 0, y: 1 }], 2);
    expect(Array.from(t.slice(8, 12))).toEqual([...GHOST_RGBA]);
    expect(Array.from(t.slice(0, 4))).toEqual([0, 0, 0, 0]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — the four modules cannot be resolved.

- [ ] **Step 3: Implement the modules**

`src/app/clock.ts`:
```ts
// Converts frame time into a whole number of fixed-rate steps. After a long
// stall (e.g. a hidden tab) it runs at most maxStepsPerAdvance steps and
// drops the rest instead of trying to catch up.
export class FixedStepClock {
  private accumulatorMs = 0;

  constructor(
    public hz: number,
    private maxStepsPerAdvance: number,
  ) {}

  advance(dtMs: number): number {
    this.accumulatorMs += dtMs;
    const periodMs = 1000 / this.hz;
    const steps = Math.floor(this.accumulatorMs / periodMs);
    if (steps > this.maxStepsPerAdvance) {
      this.accumulatorMs = 0;
      return this.maxStepsPerAdvance;
    }
    this.accumulatorMs -= steps * periodMs;
    return steps;
  }

  reset(): void {
    this.accumulatorMs = 0;
  }
}
```

`src/app/rates.ts`:
```ts
// Counts events and reports them as a per-second rate between samples.
export class RateMeter {
  private count = 0;
  private lastSampleMs: number | null = null;

  add(n = 1): void {
    if (n > 0) this.count += n;
  }

  sample(nowMs: number): number {
    const elapsed = this.lastSampleMs === null ? 0 : nowMs - this.lastSampleMs;
    const rate = elapsed > 0 ? (this.count * 1000) / elapsed : 0;
    this.count = 0;
    this.lastSampleMs = nowMs;
    return rate;
  }
}
```

`src/ui/placement.ts`:
```ts
import type { Cell } from '../life/engine';
import { rotateCells, type Pattern } from '../life/patterns';

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

// The Life cell under a pointer, or null when the pointer is outside the canvas.
export function cellFromPointer(clientX: number, clientY: number, rect: Rect, gridSize: number): Cell | null {
  const fx = (clientX - rect.left) / rect.width;
  const fy = (clientY - rect.top) / rect.height;
  if (fx < 0 || fy < 0 || fx >= 1 || fy >= 1) return null;
  return { x: Math.floor(fx * gridSize), y: Math.floor(fy * gridSize) };
}

// Cells the current tool would affect if clicked at anchor, clipped to the
// board. A null pattern means paint mode (the single cell under the cursor).
export function ghostCells(pattern: Pattern | null, quarterTurns: number, anchor: Cell, gridSize: number): Cell[] {
  const cells = pattern
    ? rotateCells(pattern.cells, quarterTurns).map(c => ({ x: anchor.x + c.x, y: anchor.y + c.y }))
    : [anchor];
  return cells.filter(c => c.x >= 0 && c.y >= 0 && c.x < gridSize && c.y < gridSize);
}
```

`src/render/texels.ts`:
```ts
import type { Cell } from '../life/engine';
import { PALETTE } from '../life/palette';
import type { ColoredCell } from '../life/world';

// Translucent blue, as in life-ambient's placement preview.
export const GHOST_RGBA: readonly number[] = [90, 170, 255, 120];

// One RGBA texel per Life cell: palette color where alive, transparent elsewhere.
export function lifeTexels(cells: ColoredCell[], gridSize: number): Uint8Array {
  const texels = new Uint8Array(gridSize * gridSize * 4);
  for (const c of cells) {
    const [r, g, b] = PALETTE[c.paletteIndex];
    texels.set([Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), 255], (c.y * gridSize + c.x) * 4);
  }
  return texels;
}

export function ghostTexels(cells: Cell[], gridSize: number): Uint8Array {
  const texels = new Uint8Array(gridSize * gridSize * 4);
  for (const c of cells) texels.set(GHOST_RGBA, (c.y * gridSize + c.x) * 4);
  return texels;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/clock.ts src/app/rates.ts src/ui/placement.ts src/render/texels.ts tests/unit
git commit -m "Add clocks, rate meter, placement and texel helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: App shell — GPU init, compositor, frame loop, smoke e2e

**Files:**
- Create: `src/gpu/device.ts`, `src/render/composite.wgsl`, `src/render/compositor.ts`, `src/app/settings.ts`, `src/app/app.ts`, `src/main.ts`, `src/style.css`, `index.html`, `playwright.config.ts`, `e2e/smoke.spec.ts`
- Test: `tests/gpu/compositor.test.ts`, `tests/unit/settings.test.ts`, `e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `device.ts`: `type GpuInit = { ok: true; device: GPUDevice; poolSizes: number[] } | { ok: false; reason: string }`; `initGpu(): Promise<GpuInit>`
  - `compositor.ts`: `class Compositor { constructor(device, format: GPUTextureFormat, gridSize: number); setLife(texels: Uint8Array): void; setGhost(texels: Uint8Array): void; render(target: GPUTextureView, field: GPUTexture, physarumOpacity: number, lifeOpacity: number): void }`
  - `settings.ts`: `LIFE_SIZE = 128`, `FIELD_SIZE = 2048`, `CELL_SIZE = 16`, `PHYSARUM_HZ = 30`, `interface AppSettings { playing; lifeHz; randomDensity; actorsPerBirth; spawnMode: SpawnMode; lifeOpacity; physarumOpacity; foodView; poolSize }`, `DEFAULT_SETTINGS`, `seedFromUrl(search: string, fallback: number): number`
  - `app.ts`: `class App { constructor(device, context: GPUCanvasContext, format, seed: number); readonly settings: AppSettings; readonly world: LifeWorld; readonly sim: PhysarumSim; readonly stats: { frames: RateMeter; physSteps: RateMeter; lifeInserts: RateMeter; childInserts: RateMeter }; alive: number; frame(dtMs: number): void; lifeTick(): void; editWorld(edit: (world: LifeWorld) => void): void; setGhost(cells: Cell[]): void; setPoolSize(n: number): void; clearActors(): void; reseed(seed: number): void; pollCounters(): Promise<void> }`

- [ ] **Step 1: Write failing settings and compositor tests**

Create `tests/unit/settings.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { CELL_SIZE, DEFAULT_SETTINGS, FIELD_SIZE, LIFE_SIZE, seedFromUrl } from '../../src/app/settings';

describe('settings', () => {
  it('has the spec sizes and defaults', () => {
    expect([LIFE_SIZE, FIELD_SIZE, CELL_SIZE]).toEqual([128, 2048, 16]);
    expect(DEFAULT_SETTINGS).toEqual({
      playing: true, lifeHz: 1, randomDensity: 0.2, actorsPerBirth: 16, spawnMode: 'burst',
      lifeOpacity: 0.6, physarumOpacity: 1, foodView: false, poolSize: 131072,
    });
  });

  it('reads an integer ?seed= from the URL, else falls back', () => {
    expect(seedFromUrl('?seed=42', 1)).toBe(42);
    expect(seedFromUrl('?seed=abc', 1)).toBe(1);
    expect(seedFromUrl('', 7)).toBe(7);
  });
});
```

Create `tests/gpu/compositor.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { Compositor } from '../../src/render/compositor';
import { createFieldTexture } from '../../src/physarum/buffers';
import { getDevice, pixel, readTexture, solidTexels, writeTexture } from './helpers';

describe('Compositor', () => {
  it('draws the field, then Life cells, then the ghost', async () => {
    const device = await getDevice();
    const compositor = new Compositor(device, 'rgba8unorm', 2);
    const field = createFieldTexture(device, 64, 64, 'field');
    writeTexture(device, field, 64, 64, solidTexels(64, 64, [255, 0, 0, 255]));
    const life = new Uint8Array(2 * 2 * 4);
    life.set([0, 255, 0, 255], 0); // cell (0, 0)
    compositor.setLife(life);
    const ghost = new Uint8Array(2 * 2 * 4);
    ghost.set([0, 0, 255, 255], 3 * 4); // cell (1, 1), fully opaque
    compositor.setGhost(ghost);
    const target = createFieldTexture(device, 64, 64, 'target');

    compositor.render(target.createView(), field, 1, 1);
    let out = await readTexture(device, target, 64, 64);
    expect(pixel(out, 64, 10, 10)).toEqual([0, 255, 0, 255]);
    expect(pixel(out, 64, 40, 10)).toEqual([255, 0, 0, 255]);
    expect(pixel(out, 64, 40, 40)).toEqual([0, 0, 255, 255]);

    compositor.render(target.createView(), field, 0.5, 0);
    out = await readTexture(device, target, 64, 64);
    const p = pixel(out, 64, 10, 10);
    expect(Math.abs(p[0] - 128)).toBeLessThanOrEqual(1);
    expect(p[1]).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project unit tests/unit/settings.test.ts && npx vitest run --project gpu tests/gpu/compositor.test.ts`
Expected: FAIL — modules cannot be resolved.

- [ ] **Step 3: Implement `src/app/settings.ts`**

```ts
import type { SpawnMode } from '../bridge/spawner';
import { DEFAULT_POOL_SIZE } from '../physarum/params';

export const LIFE_SIZE = 128;
export const FIELD_SIZE = 2048;
export const CELL_SIZE = FIELD_SIZE / LIFE_SIZE;
export const PHYSARUM_HZ = 30;

export interface AppSettings {
  playing: boolean;
  lifeHz: number;
  randomDensity: number;
  actorsPerBirth: number;
  spawnMode: SpawnMode;
  lifeOpacity: number;
  physarumOpacity: number;
  foodView: boolean;
  poolSize: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  playing: true,
  lifeHz: 1,
  randomDensity: 0.2,
  actorsPerBirth: 16,
  spawnMode: 'burst',
  lifeOpacity: 0.6,
  physarumOpacity: 1,
  foodView: false,
  poolSize: DEFAULT_POOL_SIZE,
};

// The integer ?seed=N URL parameter, if present.
export function seedFromUrl(search: string, fallback: number): number {
  const value = new URLSearchParams(search).get('seed');
  const n = value === null ? NaN : Number(value);
  return Number.isInteger(n) ? n : fallback;
}
```

- [ ] **Step 4: Implement the compositor**

`src/render/composite.wgsl`:
```wgsl
struct CompositeParams {
  physarumOpacity: f32,
  lifeOpacity: f32,
  _pad0: f32,
  _pad1: f32,
}

@group(0) @binding(0) var<uniform> composite: CompositeParams;
@group(0) @binding(1) var fieldTexture: texture_2d<f32>;
@group(0) @binding(2) var fieldSampler: sampler;
@group(0) @binding(3) var lifeTexture: texture_2d<f32>;
@group(0) @binding(4) var ghostTexture: texture_2d<f32>;

struct ScreenOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> ScreenOut {
  var corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  let c = corners[vi];
  var out: ScreenOut;
  out.position = vec4f(c, 0.0, 1.0);
  out.uv = vec2f((c.x + 1.0) * 0.5, (1.0 - c.y) * 0.5);
  return out;
}

// Physarum layer (alpha ignored) over black, then Life cells, then the ghost.
@fragment
fn fs(v: ScreenOut) -> @location(0) vec4f {
  let field = textureSample(fieldTexture, fieldSampler, v.uv).rgb * composite.physarumOpacity;
  let gridSize = vec2f(textureDimensions(lifeTexture));
  let cell = vec2u(clamp(floor(v.uv * gridSize), vec2f(0.0), gridSize - vec2f(1.0)));
  let life = textureLoad(lifeTexture, cell, 0);
  var rgb = mix(field, life.rgb, life.a * composite.lifeOpacity);
  let ghost = textureLoad(ghostTexture, cell, 0);
  rgb = mix(rgb, ghost.rgb, ghost.a);
  return vec4f(rgb, 1.0);
}
```

`src/render/compositor.ts`:
```ts
import code from './composite.wgsl?raw';
import { createModule } from '../gpu/shader';

// Draws the Physarum field, Life cells and placement ghost into one target.
export class Compositor {
  private pipeline: GPURenderPipeline;
  private sampler: GPUSampler;
  private params: GPUBuffer;
  private lifeTexture: GPUTexture;
  private ghostTexture: GPUTexture;

  constructor(
    private device: GPUDevice,
    format: GPUTextureFormat,
    private gridSize: number,
  ) {
    const module = createModule(device, code, 'composite');
    this.pipeline = device.createRenderPipeline({
      label: 'composite',
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    });
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    this.params = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const cellTexture = (label: string) =>
      device.createTexture({
        label,
        size: [gridSize, gridSize],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
    this.lifeTexture = cellTexture('life cells');
    this.ghostTexture = cellTexture('ghost cells');
  }

  setLife(texels: Uint8Array): void {
    this.writeCells(this.lifeTexture, texels);
  }

  setGhost(texels: Uint8Array): void {
    this.writeCells(this.ghostTexture, texels);
  }

  render(target: GPUTextureView, field: GPUTexture, physarumOpacity: number, lifeOpacity: number): void {
    this.device.queue.writeBuffer(this.params, 0, new Float32Array([physarumOpacity, lifeOpacity, 0, 0]));
    const bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.params } },
        { binding: 1, resource: field.createView() },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: this.lifeTexture.createView() },
        { binding: 4, resource: this.ghostTexture.createView() },
      ],
    });
    const encoder = this.device.createCommandEncoder({ label: 'composite' });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: target, loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store' }],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  private writeCells(texture: GPUTexture, texels: Uint8Array): void {
    this.device.queue.writeTexture({ texture }, texels, { bytesPerRow: this.gridSize * 4 }, [this.gridSize, this.gridSize]);
  }
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run --project unit tests/unit/settings.test.ts && npx vitest run --project gpu tests/gpu/compositor.test.ts`
Expected: PASS.

- [ ] **Step 6: Implement `src/gpu/device.ts`**

```ts
import { supportedPoolSizes } from '../physarum/params';

export type GpuInit = { ok: true; device: GPUDevice; poolSizes: number[] } | { ok: false; reason: string };

// Requests a device with the adapter's largest buffer limits so big actor pools fit.
export async function initGpu(): Promise<GpuInit> {
  if (!navigator.gpu) {
    return { ok: false, reason: 'WebGPU is not available in this browser. Try a recent Chrome, Edge or Safari.' };
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return { ok: false, reason: 'WebGPU is available, but no GPU adapter was found.' };
  try {
    const limits = {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
    };
    const device = await adapter.requestDevice({ requiredLimits: limits });
    return { ok: true, device, poolSizes: supportedPoolSizes(limits) };
  } catch (error) {
    return { ok: false, reason: `Could not create a WebGPU device: ${(error as Error).message}` };
  }
}
```

- [ ] **Step 7: Implement `src/app/app.ts`**

```ts
import { FixedStepClock } from './clock';
import { RateMeter } from './rates';
import { CELL_SIZE, DEFAULT_SETTINGS, FIELD_SIZE, LIFE_SIZE, PHYSARUM_HZ, type AppSettings } from './settings';
import { SpawnScheduler, birthsToActors, deathsToFoodSeeds } from '../bridge/spawner';
import type { Cell } from '../life/engine';
import { LifeWorld } from '../life/world';
import type { FoodSeed } from '../physarum/layout';
import { PhysarumSim } from '../physarum/simulation';
import { Compositor } from '../render/compositor';
import { ghostTexels, lifeTexels } from '../render/texels';
import { mulberry32, type Rng } from '../rng';

// Owns the simulations and clocks, and draws each frame.
export class App {
  readonly settings: AppSettings = { ...DEFAULT_SETTINGS };
  readonly world: LifeWorld;
  readonly sim: PhysarumSim;
  readonly stats = {
    frames: new RateMeter(),
    physSteps: new RateMeter(),
    lifeInserts: new RateMeter(),
    childInserts: new RateMeter(),
  };
  alive = 0;

  private readonly scheduler: SpawnScheduler;
  private readonly compositor: Compositor;
  private seededRng: Rng;
  // A stable function the world can hold on to, even after reseeding.
  private readonly rng: Rng = () => this.seededRng();
  private readonly lifeClock = new FixedStepClock(1, 1);
  private readonly physClock = new FixedStepClock(PHYSARUM_HZ, 4);
  private pendingSeeds: FoodSeed[] = [];
  private lastChildrenInserted = 0;
  private lifeDirty = true;
  private ghost: Cell[] = [];
  private ghostDirty = true;

  constructor(
    device: GPUDevice,
    private readonly context: GPUCanvasContext,
    format: GPUTextureFormat,
    seed: number,
  ) {
    this.seededRng = mulberry32(seed);
    this.world = new LifeWorld(LIFE_SIZE, LIFE_SIZE, this.rng);
    this.sim = new PhysarumSim(device, { width: FIELD_SIZE, height: FIELD_SIZE, poolSize: this.settings.poolSize, cellSize: CELL_SIZE });
    this.sim.params.rngSeed = seed;
    this.scheduler = new SpawnScheduler(this.settings.poolSize);
    this.compositor = new Compositor(device, format, LIFE_SIZE);
  }

  frame(dtMs: number): void {
    this.lifeClock.hz = this.settings.lifeHz;
    if (this.settings.playing) {
      for (let n = this.lifeClock.advance(dtMs); n > 0; n--) this.lifeTick();
    } else {
      this.lifeClock.reset();
    }
    for (let n = this.physClock.advance(dtMs); n > 0; n--) this.physStep();
    this.render();
    this.stats.frames.add();
  }

  // One Life generation; queues its spawns and food for the next Physarum steps.
  lifeTick(): void {
    const result = this.world.tick();
    const actors = birthsToActors(
      result.births,
      { actorsPerBirth: this.settings.actorsPerBirth, cellSize: CELL_SIZE, minSpeed: this.sim.params.minSpeed, life: this.sim.params.life },
      this.rng,
      this.settings.poolSize,
    );
    this.scheduler.enqueue(actors, Math.max(1, Math.round(PHYSARUM_HZ / this.settings.lifeHz)));
    this.pendingSeeds = this.pendingSeeds.concat(deathsToFoodSeeds(result.deaths));
    this.lifeDirty = true;
  }

  editWorld(edit: (world: LifeWorld) => void): void {
    edit(this.world);
    this.lifeDirty = true;
  }

  setGhost(cells: Cell[]): void {
    this.ghost = cells;
    this.ghostDirty = true;
  }

  setPoolSize(poolSize: number): void {
    this.settings.poolSize = poolSize;
    this.sim.setPoolSize(poolSize);
    this.scheduler.maxQueued = poolSize;
    this.scheduler.clear();
    this.lastChildrenInserted = 0;
  }

  clearActors(): void {
    this.sim.clearActors();
    this.scheduler.clear();
    this.lastChildrenInserted = 0;
  }

  reseed(seed: number): void {
    this.seededRng = mulberry32(seed);
  }

  // Refreshes alive/children readouts from the GPU; skipped if a read is in flight.
  async pollCounters(): Promise<void> {
    const counters = await this.sim.readCounters();
    if (!counters) return;
    this.alive = counters.aliveCount;
    this.stats.childInserts.add(counters.childrenInserted - this.lastChildrenInserted);
    this.lastChildrenInserted = counters.childrenInserted;
  }

  private physStep(): void {
    this.scheduler.mode = this.settings.spawnMode;
    const spawns = this.scheduler.takeForStep(this.sim.maxSpawnsPerStep);
    const seeds = this.pendingSeeds.splice(0, this.sim.maxFoodSeedsPerStep);
    this.sim.step(spawns, seeds);
    this.stats.physSteps.add();
    this.stats.lifeInserts.add(spawns.length);
  }

  private render(): void {
    if (this.lifeDirty) {
      this.compositor.setLife(lifeTexels(this.world.liveCells(), LIFE_SIZE));
      this.lifeDirty = false;
    }
    if (this.ghostDirty) {
      this.compositor.setGhost(ghostTexels(this.ghost, LIFE_SIZE));
      this.ghostDirty = false;
    }
    const field = this.settings.foodView ? this.sim.foodTexture : this.sim.trail;
    this.compositor.render(this.context.getCurrentTexture().createView(), field, this.settings.physarumOpacity, this.settings.lifeOpacity);
  }
}
```

- [ ] **Step 8: Create `index.html`, `src/style.css`, `src/main.ts`**

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Life x Physarum</title>
  </head>
  <body>
    <div id="sidebar">
      <div id="patterns"></div>
      <div id="readouts"></div>
    </div>
    <div id="stage">
      <canvas id="field"></canvas>
      <div id="message" hidden></div>
    </div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`src/style.css`:
```css
[hidden] { display: none !important; }
html, body { margin: 0; height: 100%; background: #000; color: #ddd; font: 13px system-ui, sans-serif; }
body { display: flex; }
#sidebar { width: 190px; flex: none; padding: 8px; box-sizing: border-box; overflow-y: auto; }
#stage { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: center; position: relative; }
#field { width: min(100vh, 100%); aspect-ratio: 1; display: block; cursor: crosshair; }
#message { position: absolute; left: 10%; right: 10%; padding: 16px; background: #300; border: 1px solid #a33; color: #fdd; white-space: pre-wrap; }
#patterns h3 { margin: 10px 0 4px; font-size: 11px; text-transform: uppercase; color: #888; }
#patterns button { display: block; width: 100%; margin: 2px 0; text-align: left; }
#patterns button.selected { outline: 2px solid #5af; }
#readouts { margin-top: 12px; font-variant-numeric: tabular-nums; }
#readouts div { display: flex; justify-content: space-between; gap: 8px; }
```

`src/main.ts`:
```ts
import './style.css';
import { App } from './app/app';
import { seedFromUrl } from './app/settings';
import { initGpu } from './gpu/device';
import { onShaderError } from './gpu/shader';
import { DEFAULT_PARAMS } from './physarum/params';

const canvas = document.querySelector<HTMLCanvasElement>('#field')!;
const message = document.querySelector<HTMLDivElement>('#message')!;

function showMessage(text: string, offerReload = false): void {
  message.hidden = false;
  message.textContent = text;
  if (offerReload) {
    const button = document.createElement('button');
    button.textContent = 'Reload';
    button.addEventListener('click', () => location.reload());
    message.append(' ', button);
  }
}

// Keeps the canvas backing store matched to its on-screen size (max 2048).
function fitCanvas(): void {
  const resize = () => {
    const size = Math.max(1, Math.min(2048, Math.round(canvas.getBoundingClientRect().width * devicePixelRatio)));
    canvas.width = size;
    canvas.height = size;
  };
  new ResizeObserver(resize).observe(canvas);
  resize();
}

async function start(): Promise<void> {
  onShaderError(text => showMessage(text));
  const gpu = await initGpu();
  if (!gpu.ok) {
    canvas.hidden = true;
    showMessage(gpu.reason);
    return;
  }
  const { device } = gpu;
  device.addEventListener('uncapturederror', event => console.error((event as GPUUncapturedErrorEvent).error.message));
  void device.lost.then(info => {
    if (info.reason !== 'destroyed') showMessage(`The GPU device was lost: ${info.message}`, true);
  });

  const context = canvas.getContext('webgpu')!;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });
  fitCanvas();

  const app = new App(device, context, format, seedFromUrl(location.search, DEFAULT_PARAMS.rngSeed));
  let last = performance.now();
  const loop = (now: number) => {
    app.frame(now - last);
    last = now;
    document.body.dataset.ready = 'true';
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

void start();
```

- [ ] **Step 9: Create `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';

// Use the same browser setup that worked for GPU tests in Task 1
// (if GPU tests needed headless: false or channel 'chrome', mirror it here).
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5199',
    browserName: 'chromium',
    channel: 'chromium',
    launchOptions: { args: ['--enable-unsafe-webgpu'] },
    viewport: { width: 1200, height: 900 },
  },
  webServer: {
    command: 'npx vite --port 5199 --strictPort',
    url: 'http://localhost:5199',
    reuseExistingServer: true,
  },
});
```

- [ ] **Step 10: Write the smoke e2e tests**

Create `e2e/smoke.spec.ts`:
```ts
import { test, expect } from '@playwright/test';

test('loads, renders, and logs no errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', m => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text());
  });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#field')).toBeVisible();
  await expect(page.locator('#message')).toBeHidden();
  await page.waitForTimeout(1500);
  expect(errors).toEqual([]);
});

test('shows a message when WebGPU is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined });
  });
  await page.goto('/');
  await expect(page.locator('#message')).toContainText('WebGPU is not available');
  await expect(page.locator('#field')).toBeHidden();
});
```

- [ ] **Step 11: Run e2e to verify**

Run: `npm run test:e2e`
Expected: PASS, 2 tests. If the first test fails because WebGPU is missing, apply the same headed/channel change that Task 1 recorded.

- [ ] **Step 12: Run everything and commit**

Run: `npm run test:all`
Expected: typecheck clean; unit, GPU and e2e tests all PASS with no stray output.

```bash
git add index.html playwright.config.ts src e2e tests
git commit -m "Add app shell, compositor and frame loop

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: UI — panel, pattern bar, readouts, interaction e2e

**Files:**
- Create: `src/ui/panel.ts`, `src/ui/pattern-bar.ts`, `src/ui/readouts.ts`, `e2e/interaction.spec.ts`
- Modify: `src/main.ts` (full replacement below)

**Interfaces:**
- Consumes: `App` (Task 13), `AppSettings`, `PhysarumParams`, `PATTERNS`, `Pattern`, `cellFromPointer`, `ghostCells`, `LIFE_SIZE`.
- Produces:
  - `panel.ts`: `interface PanelActions { playPause(): void; step(): void; clear(): void; randomFill(): void; clearTrail(): void; clearFood(): void; clearActors(): void; poolSizeChanged(n: number): void; seedChanged(seed: number): void }`, `buildPanel(settings: AppSettings, params: PhysarumParams, poolSizes: number[], actions: PanelActions): GUI`
  - `pattern-bar.ts`: `type Tool = { kind: 'pattern'; pattern: Pattern } | { kind: 'paint' }`, `buildPatternBar(root: HTMLElement, onSelect: (tool: Tool) => void): void`
  - `readouts.ts`: `interface ReadoutValues { fps; physStepsPerSec; alive; organisms; lifeInsertsPerSec; childInsertsPerSec }`, `createReadouts(root: HTMLElement): (values: ReadoutValues) => void`

- [ ] **Step 1: Write the failing interaction e2e tests**

Create `e2e/interaction.spec.ts`:
```ts
import { test, expect, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

const PALETTE_HUES = [0, 45, 90, 135, 180, 225, 270, 315];

async function boot(page: Page): Promise<void> {
  await page.goto('/?seed=7');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: 'play / pause' }).click(); // starts playing; pause it
}

async function clickCell(page: Page, x: number, y: number): Promise<void> {
  const box = (await page.locator('#field').boundingBox())!;
  const s = box.width / 128;
  await page.mouse.click(box.x + (x + 0.5) * s, box.y + (y + 0.5) * s);
}

async function cellPixel(page: Page, x: number, y: number): Promise<[number, number, number]> {
  const shot = PNG.sync.read(await page.locator('#field').screenshot());
  const s = shot.width / 128;
  const o = (Math.floor((y + 0.5) * s) * shot.width + Math.floor((x + 0.5) * s)) * 4;
  return [shot.data[o], shot.data[o + 1], shot.data[o + 2]];
}

function hueDegrees([r, g, b]: [number, number, number]): number {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

const hueDiff = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

const alive = (page: Page) => async () => Number(await page.getByTestId('readout-alive').textContent());

test('a placed glider is one organism and spawns actors in its color', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Glider', exact: true }).click();
  await clickCell(page, 60, 60);
  await expect(page.getByTestId('readout-organisms')).toHaveText('1');
  await page.getByRole('button', { name: 'step', exact: true }).click();
  await expect.poll(alive(page), { timeout: 5000 }).toBeGreaterThan(0);
  await page.mouse.move(0, 0); // leave the canvas so the ghost disappears
  await page.waitForTimeout(200);
  // (61, 62) is alive in both the first and second glider phases.
  const rgb = await cellPixel(page, 61, 62);
  expect(Math.max(...rgb)).toBeGreaterThan(100);
  expect(Math.min(...PALETTE_HUES.map(h => hueDiff(h, hueDegrees(rgb))))).toBeLessThan(12);
});

test('dead Life cells leave food in their organism color', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Blinker', exact: true }).click();
  await clickCell(page, 60, 64); // cells (60..62, 64)
  await page.getByRole('button', { name: 'step', exact: true }).click(); // (60,64) and (62,64) die
  await page.mouse.move(0, 0);
  await page.keyboard.press('t');
  await page.waitForTimeout(300);
  const live = await cellPixel(page, 61, 64); // still alive: Life color, no food beneath
  const food = await cellPixel(page, 60, 64); // died: food only
  expect(Math.max(...food)).toBeGreaterThan(60);
  expect(hueDiff(hueDegrees(food), hueDegrees(live))).toBeLessThan(12);
});

test('changing the pool size clears the actors', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Glider', exact: true }).click();
  await clickCell(page, 60, 60);
  await page.getByRole('button', { name: 'step', exact: true }).click();
  await expect.poll(alive(page), { timeout: 5000 }).toBeGreaterThan(0);
  await page.getByTestId('pool-size').locator('select').selectOption({ label: '16384' });
  await expect.poll(alive(page), { timeout: 5000 }).toBe(0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx playwright test e2e/interaction.spec.ts`
Expected: FAIL — no `play / pause` button exists yet.

- [ ] **Step 3: Implement `src/ui/readouts.ts`**

```ts
export interface ReadoutValues {
  fps: number;
  physStepsPerSec: number;
  alive: number;
  organisms: number;
  lifeInsertsPerSec: number;
  childInsertsPerSec: number;
}

const ROWS: [keyof ReadoutValues, string, string][] = [
  ['fps', 'fps', 'readout-fps'],
  ['physStepsPerSec', 'physarum steps/s', 'readout-steps'],
  ['alive', 'alive actors', 'readout-alive'],
  ['organisms', 'organisms', 'readout-organisms'],
  ['lifeInsertsPerSec', 'inserts/s from Life', 'readout-life-inserts'],
  ['childInsertsPerSec', 'inserts/s from children', 'readout-child-inserts'],
];

// Builds the readout rows; returns a function that updates them.
export function createReadouts(root: HTMLElement): (values: ReadoutValues) => void {
  const cells = new Map<keyof ReadoutValues, HTMLSpanElement>();
  for (const [key, label, testId] of ROWS) {
    const row = document.createElement('div');
    const name = document.createElement('span');
    name.textContent = label;
    const value = document.createElement('span');
    value.dataset.testid = testId;
    value.textContent = '0';
    row.append(name, value);
    root.append(row);
    cells.set(key, value);
  }
  return values => {
    for (const [key] of ROWS) cells.get(key)!.textContent = String(Math.round(values[key]));
  };
}
```

- [ ] **Step 4: Implement `src/ui/pattern-bar.ts`**

```ts
import { PATTERNS, type Pattern, type PatternCategory } from '../life/patterns';

export type Tool = { kind: 'pattern'; pattern: Pattern } | { kind: 'paint' };

const CATEGORIES: PatternCategory[] = ['drone', 'pulse', 'voyager', 'fountain', 'wildcard'];

// A "Paint cells" tool plus one button per pattern, grouped by category.
export function buildPatternBar(root: HTMLElement, onSelect: (tool: Tool) => void): void {
  const buttons: HTMLButtonElement[] = [];
  const add = (label: string, tool: Tool, parent: HTMLElement): HTMLButtonElement => {
    const button = document.createElement('button');
    button.textContent = label;
    button.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('selected'));
      button.classList.add('selected');
      onSelect(tool);
    });
    buttons.push(button);
    parent.append(button);
    return button;
  };
  add('Paint cells', { kind: 'paint' }, root).classList.add('selected');
  for (const category of CATEGORIES) {
    const heading = document.createElement('h3');
    heading.textContent = category;
    root.append(heading);
    for (const pattern of PATTERNS.filter(p => p.category === category)) {
      add(pattern.name, { kind: 'pattern', pattern }, root);
    }
  }
}
```

- [ ] **Step 5: Implement `src/ui/panel.ts`**

```ts
import GUI from 'lil-gui';
import type { AppSettings } from '../app/settings';
import type { PhysarumParams } from '../physarum/params';

export interface PanelActions {
  playPause(): void;
  step(): void;
  clear(): void;
  randomFill(): void;
  clearTrail(): void;
  clearFood(): void;
  clearActors(): void;
  poolSizeChanged(poolSize: number): void;
  seedChanged(seed: number): void;
}

// The lil-gui control panel. Controls write straight into settings/params,
// which the app reads every frame/step.
export function buildPanel(settings: AppSettings, params: PhysarumParams, poolSizes: number[], actions: PanelActions): GUI {
  const gui = new GUI({ title: 'Life x Physarum' });

  const layers = gui.addFolder('Layers');
  layers.add(settings, 'lifeOpacity', 0, 1, 0.01);
  layers.add(settings, 'physarumOpacity', 0, 1, 0.01);
  layers.add(settings, 'foodView').name('food view (T)');

  const life = gui.addFolder('Life');
  life.add(actions, 'playPause').name('play / pause');
  life.add(actions, 'step');
  life.add(actions, 'clear');
  life.add(actions, 'randomFill').name('random fill');
  life.add(settings, 'randomDensity', 0, 1, 0.01).name('density');
  life.add(settings, 'lifeHz', 0.25, 8, 0.25).name('tick rate (Hz)');

  const bridge = gui.addFolder('Bridge');
  bridge.add(settings, 'actorsPerBirth', 0, 256, 1);
  bridge.add(settings, 'spawnMode', ['burst', 'trickle']);

  const physarum = gui.addFolder('Physarum');
  const pool = physarum.add(settings, 'poolSize', poolSizes).onChange(actions.poolSizeChanged);
  pool.domElement.dataset.testid = 'pool-size';

  const sensing = physarum.addFolder('Sensing');
  sensing.add(params, 'lookSlices', 1, 8, 1);
  sensing.add(params, 'lookRadians', 0, Math.PI, 0.01);
  sensing.add(params, 'lookDistance', 1, 64, 1);

  const movement = physarum.addFolder('Movement');
  movement.add(params, 'directionRandomization', 0, 2, 0.01);
  movement.add(params, 'directionMomentum', 0, 1, 0.01);
  movement.add(params, 'minSpeed', 0, 5, 0.01);
  movement.add(params, 'maxSpeed', 0, 10, 0.01);

  const deposit = physarum.addFolder('Deposit & Color');
  deposit.add(params, 'intensity', 0, 2, 0.01);
  deposit.add(params, 'lockToHsvAngles', 0, 12, 1);
  deposit.add(params, 'hsvAngleOffset', 0, 1, 0.01);
  deposit.add(params, 'hsvSaturationMultiplier', 0, 2, 0.01);
  deposit.add(params, 'hsvValueMultiplier', 0, 2, 0.01);

  const food = physarum.addFolder('Food');
  food.add(params, 'foodPerDeath', 0, 1, 0.01);
  food.add(params, 'foodExhaustion', 0, 1, 0.01).name('foodExhaustion (0 = off)');
  food.add(params, 'foodSensitivity', 0, 2, 0.01);

  const fade = physarum.addFolder('Fade');
  fade.add(params, 'fadeDecrement', 0, 0.1, 0.001);
  fade.add(params, 'blurMultiplier', 0, 16, 0.1);
  fade.add(params, 'blurInterval', 1, 10, 1);
  fade.add(params, 'foodFadeDecrement', 0, 0.1, 0.0005);
  fade.add(params, 'foodFadeInterval', 1, 10, 1);

  const lifecycle = physarum.addFolder('Reproduction & Lifecycle');
  lifecycle.add(params, 'spawnProbability', 0, 0.05, 0.0001);
  lifecycle.add(params, 'directionVariance', 0, Math.PI, 0.01);
  lifecycle.add(params, 'speedVariance', 0, 1, 0.01);
  lifecycle.add(params, 'spawnRandomOffset', 0, 16, 0.1);
  lifecycle.add(params, 'alwaysSpawnFromParent', [-1, 0, 1]);
  lifecycle.add(params, 'life', 1, 100000, 1);

  const world = physarum.addFolder('World');
  world.add(params, 'wrapBounds');
  world.add(params, 'rngSeed').step(1).onFinishChange(actions.seedChanged);

  physarum.add(actions, 'clearTrail').name('clear trail');
  physarum.add(actions, 'clearFood').name('clear food');
  physarum.add(actions, 'clearActors').name('clear actors');

  return gui;
}
```

- [ ] **Step 6: Replace `src/main.ts` with the full wiring**

```ts
import './style.css';
import { App } from './app/app';
import { LIFE_SIZE, seedFromUrl } from './app/settings';
import { initGpu } from './gpu/device';
import { onShaderError } from './gpu/shader';
import type { Cell } from './life/engine';
import { DEFAULT_PARAMS } from './physarum/params';
import { buildPanel } from './ui/panel';
import { buildPatternBar, type Tool } from './ui/pattern-bar';
import { cellFromPointer, ghostCells } from './ui/placement';
import { createReadouts } from './ui/readouts';

const canvas = document.querySelector<HTMLCanvasElement>('#field')!;
const message = document.querySelector<HTMLDivElement>('#message')!;

function showMessage(text: string, offerReload = false): void {
  message.hidden = false;
  message.textContent = text;
  if (offerReload) {
    const button = document.createElement('button');
    button.textContent = 'Reload';
    button.addEventListener('click', () => location.reload());
    message.append(' ', button);
  }
}

// Keeps the canvas backing store matched to its on-screen size (max 2048).
function fitCanvas(): void {
  const resize = () => {
    const size = Math.max(1, Math.min(2048, Math.round(canvas.getBoundingClientRect().width * devicePixelRatio)));
    canvas.width = size;
    canvas.height = size;
  };
  new ResizeObserver(resize).observe(canvas);
  resize();
}

function attachUi(app: App, poolSizes: number[]): void {
  const gui = buildPanel(app.settings, app.sim.params, poolSizes, {
    playPause: () => {
      app.settings.playing = !app.settings.playing;
    },
    step: () => app.lifeTick(),
    clear: () => app.editWorld(w => w.clear()),
    randomFill: () => app.editWorld(w => w.randomFill(app.settings.randomDensity)),
    clearTrail: () => app.sim.clearTrail(),
    clearFood: () => app.sim.clearFood(),
    clearActors: () => app.clearActors(),
    poolSizeChanged: n => app.setPoolSize(n),
    seedChanged: seed => app.reseed(seed),
  });

  let tool: Tool = { kind: 'paint' };
  let quarterTurns = 0;
  let hover: Cell | null = null;
  const refreshGhost = () => {
    const pattern = tool.kind === 'pattern' ? tool.pattern : null;
    app.setGhost(hover ? ghostCells(pattern, quarterTurns, hover, LIFE_SIZE) : []);
  };

  buildPatternBar(document.querySelector<HTMLElement>('#patterns')!, selected => {
    tool = selected;
    quarterTurns = 0;
    refreshGhost();
  });

  canvas.addEventListener('pointermove', e => {
    hover = cellFromPointer(e.clientX, e.clientY, canvas.getBoundingClientRect(), LIFE_SIZE);
    refreshGhost();
  });
  canvas.addEventListener('pointerleave', () => {
    hover = null;
    refreshGhost();
  });
  canvas.addEventListener('click', e => {
    const cell = cellFromPointer(e.clientX, e.clientY, canvas.getBoundingClientRect(), LIFE_SIZE);
    if (!cell) return;
    const current = tool;
    app.editWorld(w => {
      if (current.kind === 'pattern') w.place(current.pattern, cell.x, cell.y, quarterTurns);
      else w.toggle(cell.x, cell.y);
    });
  });

  window.addEventListener('keydown', e => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const key = e.key.toLowerCase();
    if (key === 'r') {
      quarterTurns = (quarterTurns + 1) % 4;
      refreshGhost();
    } else if (key === 't') {
      app.settings.foodView = !app.settings.foodView;
      gui.controllersRecursive().forEach(c => c.updateDisplay());
    }
  });

  const updateReadouts = createReadouts(document.querySelector<HTMLElement>('#readouts')!);
  setInterval(async () => {
    await app.pollCounters();
    const now = performance.now();
    updateReadouts({
      fps: app.stats.frames.sample(now),
      physStepsPerSec: app.stats.physSteps.sample(now),
      alive: app.alive,
      organisms: app.world.organismCount(),
      lifeInsertsPerSec: app.stats.lifeInserts.sample(now),
      childInsertsPerSec: app.stats.childInserts.sample(now),
    });
  }, 250);
}

async function start(): Promise<void> {
  onShaderError(text => showMessage(text));
  const gpu = await initGpu();
  if (!gpu.ok) {
    canvas.hidden = true;
    showMessage(gpu.reason);
    return;
  }
  const { device } = gpu;
  device.addEventListener('uncapturederror', event => console.error((event as GPUUncapturedErrorEvent).error.message));
  void device.lost.then(info => {
    if (info.reason !== 'destroyed') showMessage(`The GPU device was lost: ${info.message}`, true);
  });

  const context = canvas.getContext('webgpu')!;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });
  fitCanvas();

  const app = new App(device, context, format, seedFromUrl(location.search, DEFAULT_PARAMS.rngSeed));
  attachUi(app, gpu.poolSizes);

  let last = performance.now();
  const loop = (now: number) => {
    app.frame(now - last);
    last = now;
    document.body.dataset.ready = 'true';
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

void start();
```

- [ ] **Step 7: Run the interaction e2e tests**

Run: `npx playwright test e2e/interaction.spec.ts`
Expected: PASS, 3 tests. If the pool-size test can't find the select, inspect `page.getByTestId('pool-size')` in `npx playwright test --ui` and adjust only the locator, not the behavior.

- [ ] **Step 8: Run everything**

Run: `npm run test:all`
Expected: typecheck clean; all unit, GPU and e2e tests PASS; no stray warnings.

- [ ] **Step 9: Manual check**

Run `npm run dev`, open the printed URL in Chrome, and confirm: random fill + play produces colored organisms and colored slime that follows them; R rotates the ghost; T toggles the food view; the fps readout is near the display rate and Physarum steps/s near 30 at the default pool size. Report the observed fps and steps/s to the user.

- [ ] **Step 10: Commit**

```bash
git add src e2e
git commit -m "Add control panel, pattern bar and readouts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
