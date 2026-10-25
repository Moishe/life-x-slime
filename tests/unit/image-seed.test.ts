import { describe, it, expect } from 'vitest';
import { cellColors, fitImage, imageToActors, intensityWeights, nearestColor, type ImageSeedSettings, type SeedImage } from '../../src/bridge/image-seed';
import { mulberry32 } from '../../src/rng';
import { hsv2rgb, type Vec3 } from '../../src/color';

describe('fitImage', () => {
  it('scales a landscape image so its width is the field size and centers it vertically', () => {
    expect(fitImage(400, 200, 2048)).toEqual({ width: 2048, height: 1024, offsetX: 0, offsetY: 512 });
  });

  it('scales a portrait image so its height is the field size and centers it horizontally', () => {
    expect(fitImage(300, 600, 2048)).toEqual({ width: 1024, height: 2048, offsetX: 512, offsetY: 0 });
  });

  it('fills the field with a square image', () => {
    expect(fitImage(10, 10, 2048)).toEqual({ width: 2048, height: 2048, offsetX: 0, offsetY: 0 });
  });

  it('rounds to whole pixels and never produces a zero-sized side', () => {
    expect(fitImage(3000, 1, 2048)).toEqual({ width: 2048, height: 1, offsetX: 0, offsetY: 1023 });
  });
});

describe('nearestColor', () => {
  const colors: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

  it('returns the palette color closest in HSV', () => {
    expect(nearestColor([0.9, 0.1, 0.1], colors)).toEqual([1, 0, 0]);
    expect(nearestColor([0.2, 0.9, 0.3], colors)).toEqual([0, 1, 0]);
  });

  it('treats hue as circular, so a reddish magenta snaps to red rather than blue', () => {
    expect(nearestColor(hsv2rgb([0.95, 1, 1]), colors)).toEqual([1, 0, 0]);
  });

  it('works with a single palette color', () => {
    expect(nearestColor([0.5, 0.5, 0.5], [[0, 0, 1]])).toEqual([0, 0, 1]);
  });
});

// A source image of the given size, fitted to the field, where every pixel has the given color.
const solidImage = (width: number, height: number, rgba: number[], fieldSize: number): SeedImage => {
  const fit = fitImage(width, height, fieldSize);
  const pixels = new Uint8ClampedArray(fit.width * fit.height * 4);
  for (let i = 0; i < fit.width * fit.height; i++) pixels.set(rgba, i * 4);
  return { pixels, fit };
};

const seedSettings: ImageSeedSettings = {
  density: 1, colorMode: 'natural', colors: [[1, 0, 0], [0, 0, 1]], minSpeed: 0.7, life: 500, intensitySteepness: 0, intensityMidpoint: 0.5,
};

describe('imageToActors', () => {
  it('at full density spawns one actor inside each pixel, offset by the fit, in the pixel color', () => {
    // 4x2 image on an 8-pixel field: 8x4 after fitting, centered at y offset 2.
    const image = solidImage(4, 2, [255, 128, 0, 255], 8);
    const actors = imageToActors(image, seedSettings, mulberry32(1), 1000);
    expect(actors).toHaveLength(32);
    const cells = new Set<string>();
    for (const a of actors) {
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.x).toBeLessThan(8);
      expect(a.y).toBeGreaterThanOrEqual(2);
      expect(a.y).toBeLessThan(6);
      cells.add(`${Math.floor(a.x)},${Math.floor(a.y)}`);
      expect(a.dir).toBeGreaterThanOrEqual(0);
      expect(a.dir).toBeLessThan(2 * Math.PI);
      expect(a.speed).toBe(0.7);
      expect(a.age).toBe(0);
      expect(a.life).toBe(500);
      expect(a.alive).toBe(true);
      expect(a.rng % 2).toBe(1);
      expect(a.seed).toEqual([1, 128 / 255, 0, 1]);
      expect(a.color).toEqual([1, 128 / 255, 0, 1]);
    }
    expect(cells.size).toBe(32);
  });

  it('uses the given share of pixels, each at most once', () => {
    const image = solidImage(10, 10, [255, 255, 255, 255], 10);
    const actors = imageToActors(image, { ...seedSettings, density: 0.3 }, mulberry32(2), 1000);
    expect(actors).toHaveLength(30);
    expect(new Set(actors.map(a => `${Math.floor(a.x)},${Math.floor(a.y)}`)).size).toBe(30);
  });

  it('spawns nothing at zero density', () => {
    expect(imageToActors(solidImage(4, 4, [255, 255, 255, 255], 4), { ...seedSettings, density: 0 }, mulberry32(1), 1000)).toEqual([]);
  });

  it('never spawns more than maxActors', () => {
    expect(imageToActors(solidImage(10, 10, [255, 255, 255, 255], 10), seedSettings, mulberry32(1), 7)).toHaveLength(7);
  });

  it('in palette mode snaps each pixel to the nearest palette color', () => {
    const image = solidImage(2, 2, [200, 30, 30, 255], 2);
    const actors = imageToActors(image, { ...seedSettings, colorMode: 'palette' }, mulberry32(1), 1000);
    expect(actors).toHaveLength(4);
    for (const a of actors) {
      expect(a.seed).toEqual([1, 0, 0, 1]);
      expect(a.color).toEqual([1, 0, 0, 1]);
    }
  });
});

// A 4x2 source fitted to an 8-pixel field: 8x4 pixels at y offset 2, left half red, right half blue.
const halvesImage = (): SeedImage => {
  const fit = fitImage(4, 2, 8);
  const pixels = new Uint8ClampedArray(fit.width * fit.height * 4);
  for (let i = 0; i < fit.width * fit.height; i++) pixels.set(i % fit.width < 4 ? [255, 0, 0, 255] : [0, 0, 255, 255], i * 4);
  return { pixels, fit };
};

describe('cellColors', () => {
  it('averages the image pixels under each cell block, with the margins as black', () => {
    // Board 4 on field 8: 2x2 blocks. Rows 0 and 3 lie in the margins.
    const colors = cellColors(halvesImage(), 4, 8);
    expect(colors).toHaveLength(16);
    expect(colors[0]).toEqual([0, 0, 0]);
    expect(colors[4 * 1 + 0]).toEqual([1, 0, 0]);
    expect(colors[4 * 1 + 3]).toEqual([0, 0, 1]);
    expect(colors[4 * 2 + 1]).toEqual([1, 0, 0]);
    expect(colors[4 * 2 + 2]).toEqual([0, 0, 1]);
    expect(colors[4 * 3 + 3]).toEqual([0, 0, 0]);
  });

  it('blends the pixels of a block that covers more than one color', () => {
    // Board 2 on field 8: 4x4 blocks. The top-left block is 2 rows of margin over 2 rows of red.
    const colors = cellColors(halvesImage(), 2, 8);
    expect(colors).toHaveLength(4);
    expect(colors[0]).toEqual([0.5, 0, 0]);
    expect(colors[1]).toEqual([0, 0, 0.5]);
  });

  it('averages each channel separately', () => {
    const fit = fitImage(2, 2, 2);
    const pixels = new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 0, 255]);
    expect(cellColors({ pixels, fit }, 1, 2)).toEqual([[0.5, 0, 0.25]]);
  });
});

const rgbaPixels = (...colors: number[][]) => new Uint8ClampedArray(colors.flatMap(c => [...c, 255]));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

describe('intensityWeights', () => {
  it('weighs every pixel the same at steepness 0', () => {
    const weights = intensityWeights(rgbaPixels([0, 0, 0], [255, 255, 255], [40, 90, 200]), 0, 0.5);
    expect(Array.from(weights)).toEqual([0.5, 0.5, 0.5]);
  });

  it('follows a sigmoid of brightness relative to the brightest pixel', () => {
    // Greys of 25%, 50% and 100%: brightness 0.25, 0.5 and 1 of the brightest.
    const weights = intensityWeights(rgbaPixels([64, 64, 64], [128, 128, 128], [255, 255, 255]), 8, 0.5);
    expect(weights[0]).toBeCloseTo(sigmoid(8 * (64 / 255 - 0.5)), 5);
    expect(weights[1]).toBeCloseTo(sigmoid(8 * (128 / 255 - 0.5)), 5);
    expect(weights[2]).toBeCloseTo(sigmoid(8 * 0.5), 5);
  });

  it('measures brightness as Rec. 709 luma, so green is brighter than blue', () => {
    const weights = intensityWeights(rgbaPixels([0, 255, 0], [0, 0, 255], [255, 255, 255]), 8, 0.5);
    expect(weights[0]).toBeCloseTo(sigmoid(8 * (0.7152 - 0.5)), 5);
    expect(weights[1]).toBeCloseTo(sigmoid(8 * (0.0722 - 0.5)), 5);
  });

  it('scales to the brightest pixel in the image, which gets brightness 1', () => {
    const weights = intensityWeights(rgbaPixels([50, 50, 50], [100, 100, 100]), 8, 0.5);
    expect(weights[1]).toBeCloseTo(sigmoid(8 * 0.5), 5);
    expect(weights[0]).toBeCloseTo(sigmoid(8 * (0.5 - 0.5)), 5);
  });

  it('moves the curve with the midpoint', () => {
    const weights = intensityWeights(rgbaPixels([128, 128, 128], [255, 255, 255]), 8, 0.9);
    expect(weights[1]).toBeCloseTo(sigmoid(8 * 0.1), 5);
  });

  it('treats an all-black image as uniform', () => {
    const weights = intensityWeights(rgbaPixels([0, 0, 0], [0, 0, 0]), 8, 0.5);
    expect(weights[0]).toBeGreaterThan(0);
    expect(weights[1]).toBe(weights[0]);
  });
});

// A 2:1 image fitted to the field, left half black and right half white.
const blackWhiteImage = (fieldSize: number): SeedImage => {
  const fit = fitImage(2, 1, fieldSize);
  const pixels = new Uint8ClampedArray(fit.width * fit.height * 4);
  for (let i = 0; i < fit.width * fit.height; i++) pixels.set(i % fit.width < fit.width / 2 ? [0, 0, 0, 255] : [255, 255, 255, 255], i * 4);
  return { pixels, fit };
};

const onBrightHalf = (image: SeedImage) => (a: { x: number }) => a.x >= image.fit.width / 2;

describe('imageToActors with intensity weighting', () => {
  it('with a steep curve puts the actors on the bright pixels while keeping the overall share', () => {
    const image = blackWhiteImage(64); // 64x32: 1024 black, 1024 white pixels
    const actors = imageToActors(image, { ...seedSettings, density: 0.25, intensitySteepness: 20 }, mulberry32(3), 100000);
    expect(actors.length).toBeGreaterThan(450);
    expect(actors.length).toBeLessThan(575);
    expect(actors.filter(onBrightHalf(image))).toHaveLength(actors.length);
  });

  it('with a gentle curve favors bright pixels without excluding dark ones', () => {
    const image = blackWhiteImage(64);
    const actors = imageToActors(image, { ...seedSettings, density: 0.25, intensitySteepness: 2 }, mulberry32(3), 100000);
    const bright = actors.filter(onBrightHalf(image)).length;
    const dark = actors.length - bright;
    expect(dark).toBeGreaterThan(50);
    expect(bright).toBeGreaterThan(dark * 1.5);
    expect(actors.length).toBeGreaterThan(450);
    expect(actors.length).toBeLessThan(575);
  });

  it('never chooses a pixel twice', () => {
    const image = blackWhiteImage(64);
    const actors = imageToActors(image, { ...seedSettings, density: 0.5, intensitySteepness: 20 }, mulberry32(3), 100000);
    expect(new Set(actors.map(a => `${Math.floor(a.x)},${Math.floor(a.y)}`)).size).toBe(actors.length);
  });

  it('still caps at maxActors', () => {
    const image = blackWhiteImage(64);
    expect(imageToActors(image, { ...seedSettings, density: 0.5, intensitySteepness: 20 }, mulberry32(3), 7)).toHaveLength(7);
  });
});
