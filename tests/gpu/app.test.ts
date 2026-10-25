import { describe, it, expect } from 'vitest';
import { App } from '../../src/app/app';
import { FIELD_SIZE } from '../../src/app/settings';
import { fitImage, type SeedImage } from '../../src/bridge/image-seed';
import { rgb2hsv } from '../../src/color';
import { colorFor, paletteColors } from '../../src/life/palette';
import { getDevice, readTexture } from './helpers';

// One Physarum step's worth of frame time, with a little slack.
const STEP_MS = 1000 / 30 + 1;

async function makeApp(): Promise<App> {
  const device = await getDevice();
  const context = new OffscreenCanvas(64, 64).getContext('webgpu') as GPUCanvasContext;
  context.configure({ device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: 'opaque' });
  return new App(device, context, 7, 64);
}

// A width x height source image of one color, fitted to the field.
function solidImage(width: number, height: number, rgba: number[]): SeedImage {
  const fit = fitImage(width, height, FIELD_SIZE);
  const pixels = new Uint8ClampedArray(fit.width * fit.height * 4);
  for (let i = 0; i < fit.width * fit.height; i++) pixels.set(rgba, i * 4);
  return { pixels, fit };
}

describe('App image seeding', () => {
  it('seeds actors from an image at the chosen density', async () => {
    const app = await makeApp();
    app.settings.seedSource = 'image';
    app.settings.spawnMode = 'burst';
    app.settings.imageDensityPercent = 0.01;
    app.loadImage(solidImage(4, 4, [255, 0, 0, 255]));
    app.seedFromImage();
    app.frame(STEP_MS); // injects the seed
    app.frame(STEP_MS); // counts it
    await app.pollCounters();
    expect(app.alive).toBe(Math.round(0.0001 * FIELD_SIZE * FIELD_SIZE));
  });

  it('does not run Life in image mode', async () => {
    const app = await makeApp();
    app.settings.seedSource = 'image';
    app.editWorld(w => w.randomFill(0.3));
    const before = app.world.liveCells();
    app.frame(500);
    expect(app.world.liveCells()).toEqual(before);
    app.settings.seedSource = 'life';
    app.frame(500);
    expect(app.world.liveCells()).not.toEqual(before);
  });

  it('ignores a manual Life step in image mode', async () => {
    const app = await makeApp();
    app.settings.seedSource = 'image';
    app.editWorld(w => w.randomFill(0.3));
    const before = app.world.liveCells();
    app.lifeTick();
    expect(app.world.liveCells()).toEqual(before);
  });
});

// Every pixel of a field-sized RGBA readback with enough chroma to carry a
// reliable hue, as [r, g, b]. (Actors desaturate as their color blends with
// the black field, so hue, not exact channels, is what identifies them.)
function litPixels(data: Uint8Array): [number, number, number][] {
  const lit: [number, number, number][] = [];
  for (let o = 0; o < data.length; o += 4) {
    const max = Math.max(data[o], data[o + 1], data[o + 2]);
    const min = Math.min(data[o], data[o + 1], data[o + 2]);
    if (max - min >= 8) lit.push([data[o], data[o + 1], data[o + 2]]);
  }
  return lit;
}

const hueDegrees = (rgb: [number, number, number]) => rgb2hsv([rgb[0] / 255, rgb[1] / 255, rgb[2] / 255])[0] * 360;
const hueDiff = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

// A horizontal blinker at (10..12, 10). One tick kills its ends and births (11, 9) and (11, 11).
function placeBlinker(app: App): void {
  app.editWorld(w => {
    w.toggle(10, 10);
    w.toggle(11, 10);
    w.toggle(12, 10);
  });
}

// Ticks Life once, then steps Physarum enough to inject and deposit, and returns the trail.
async function tickAndDeposit(app: App): Promise<Uint8Array> {
  app.settings.spawnMode = 'burst';
  app.lifeTick();
  app.frame(STEP_MS);
  app.frame(STEP_MS);
  return readTexture(await getDevice(), app.sim.trail, FIELD_SIZE, FIELD_SIZE);
}

describe('App hybrid mode', () => {
  it('runs Life in hybrid mode', async () => {
    const app = await makeApp();
    app.settings.seedSource = 'hybrid';
    app.editWorld(w => w.randomFill(0.3));
    const before = app.world.liveCells();
    app.frame(500);
    expect(app.world.liveCells()).not.toEqual(before);
  });

  it("colors a birth's actors from the image under its cell", async () => {
    const app = await makeApp();
    app.settings.seedSource = 'hybrid';
    app.loadImage(solidImage(4, 4, [0, 255, 0, 255]));
    placeBlinker(app);
    const lit = litPixels(await tickAndDeposit(app));
    expect(lit.length).toBeGreaterThan(0);
    for (const rgb of lit) expect(hueDiff(hueDegrees(rgb), 120)).toBeLessThan(5);
  });

  it('leaves food in the image color when a cell dies', async () => {
    const app = await makeApp();
    app.settings.seedSource = 'hybrid';
    app.loadImage(solidImage(4, 4, [0, 255, 0, 255]));
    placeBlinker(app);
    await tickAndDeposit(app);
    const food = await readTexture(await getDevice(), app.sim.foodTexture, FIELD_SIZE, FIELD_SIZE);
    // Cell (10, 10) died; on a 64-cell board its block starts at field pixel 320.
    const o = (336 * FIELD_SIZE + 336) * 4;
    expect(food[o]).toBe(0);
    expect(food[o + 1]).toBeGreaterThan(100);
    expect(food[o + 2]).toBe(0);
  });

  it('snaps the image color to the palette when image colors is palette', async () => {
    const app = await makeApp();
    app.settings.seedSource = 'hybrid';
    app.settings.imageColorMode = 'palette';
    app.loadImage(solidImage(4, 4, [255, 64, 0, 255])); // hue 15: nearest rainbow hue is red (0)
    placeBlinker(app);
    const lit = litPixels(await tickAndDeposit(app));
    expect(lit.length).toBeGreaterThan(0);
    for (const rgb of lit) expect(hueDiff(hueDegrees(rgb), 0)).toBeLessThan(5);
  });

  it('keeps the natural image color when image colors is natural', async () => {
    const app = await makeApp();
    app.settings.seedSource = 'hybrid';
    app.loadImage(solidImage(4, 4, [255, 64, 0, 255]));
    placeBlinker(app);
    const lit = litPixels(await tickAndDeposit(app));
    expect(lit.length).toBeGreaterThan(0);
    for (const rgb of lit) expect(hueDiff(hueDegrees(rgb), 15)).toBeLessThan(5);
  });

  it('falls back to organism colors when no image is loaded', async () => {
    const app = await makeApp();
    app.settings.seedSource = 'hybrid';
    placeBlinker(app);
    const expected = hueDegrees(colorFor(paletteColors('rainbow', 8), app.world.liveCells()[0].paletteIndex).map(v => v * 255) as [number, number, number]);
    const lit = litPixels(await tickAndDeposit(app));
    expect(lit.length).toBeGreaterThan(0);
    for (const rgb of lit) expect(hueDiff(hueDegrees(rgb), expected)).toBeLessThan(5);
  });
});

// A 2:1 source image fitted to the field, left half dim grey (which unweighted
// actors would still light up) and right half white.
function greyWhiteImage(): SeedImage {
  const fit = fitImage(2, 1, FIELD_SIZE);
  const pixels = new Uint8ClampedArray(fit.width * fit.height * 4);
  for (let i = 0; i < fit.width * fit.height; i++) pixels.set(i % fit.width < fit.width / 2 ? [40, 40, 40, 255] : [255, 255, 255, 255], i * 4);
  return { pixels, fit };
}

describe('App intensity weighting', () => {
  it('with a steep curve seeds only the bright part of the image', async () => {
    const app = await makeApp();
    app.settings.seedSource = 'image';
    app.settings.spawnMode = 'burst';
    app.settings.imageDensityPercent = 0.05;
    app.settings.imageIntensitySteepness = 20;
    app.settings.imageIntensityMidpoint = 0.9;
    app.loadImage(greyWhiteImage());
    app.seedFromImage();
    app.frame(STEP_MS);
    app.frame(STEP_MS);
    const trail = await readTexture(await getDevice(), app.sim.trail, FIELD_SIZE, FIELD_SIZE);
    let litLeft = 0;
    let litRight = 0;
    for (let o = 0; o < trail.length; o += 4) {
      if (trail[o] === 0 && trail[o + 1] === 0 && trail[o + 2] === 0) continue;
      // The field wraps and the trail blurs, so leave a margin at both edges of the left half.
      const x = (o / 4) % FIELD_SIZE;
      if (x >= 16 && x < FIELD_SIZE / 2 - 16) litLeft++;
      else if (x >= FIELD_SIZE / 2) litRight++;
    }
    expect(litRight).toBeGreaterThan(0);
    expect(litLeft).toBe(0);
  });
});
