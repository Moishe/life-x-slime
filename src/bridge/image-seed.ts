import { hsvDistance, rgb2hsv, type Vec3 } from '../color';
import type { ActorRecord } from '../physarum/layout';
import { randomNonZeroU32, type Rng } from '../rng';
// Where a seed image sits on the Physarum field: scaled so its longer side
// spans the field, centered along the shorter one. Sizes are whole pixels.
export interface ImageFit {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

export function fitImage(imageWidth: number, imageHeight: number, fieldSize: number): ImageFit {
  const scale = fieldSize / Math.max(imageWidth, imageHeight);
  const width = Math.max(1, Math.round(imageWidth * scale));
  const height = Math.max(1, Math.round(imageHeight * scale));
  return { width, height, offsetX: Math.floor((fieldSize - width) / 2), offsetY: Math.floor((fieldSize - height) / 2) };
}

// The palette color with the smallest HSV distance to rgb.
export function nearestColor(rgb: Vec3, colors: readonly Vec3[]): Vec3 {
  const target = rgb2hsv(rgb);
  let best = colors[0];
  let bestDistance = Infinity;
  for (const color of colors) {
    const distance = hsvDistance(target, rgb2hsv(color));
    if (distance < bestDistance) {
      best = color;
      bestDistance = distance;
    }
  }
  return best;
}

export type ImageColorMode = 'natural' | 'palette';

// RGBA pixels of a seed image, already scaled to its fit on the field.
export interface SeedImage {
  pixels: Uint8ClampedArray;
  fit: ImageFit;
}

export interface ImageSeedSettings {
  // Share of the image's pixels that spawn an actor, in [0, 1].
  density: number;
  colorMode: ImageColorMode;
  // Palette used in 'palette' mode.
  colors: readonly Vec3[];
  minSpeed: number;
  life: number;
  // See intensityWeights.
  intensitySteepness: number;
  intensityMidpoint: number;
}

// Spawns one actor per chosen pixel, placed randomly inside that pixel on the
// field and carrying the pixel's color (or its nearest palette color) as seed.
// Pixels are chosen at random without repeats, capped at maxActors. With no
// intensity weighting exactly round(density x pixels) are chosen, uniformly;
// with weighting each pixel's chance is scaled by its weight relative to the
// mean weight, so about the same number are chosen but brighter pixels more often.
export function imageToActors(image: SeedImage, settings: ImageSeedSettings, rng: Rng, maxActors: number): ActorRecord[] {
  const { width, height, offsetX, offsetY } = image.fit;
  const pixelCount = width * height;
  const count = Math.min(Math.round(settings.density * pixelCount), maxActors, pixelCount);
  if (count <= 0) return [];
  const chosen = settings.intensitySteepness > 0
    ? chooseWeightedPixels(intensityWeights(image.pixels, settings.intensitySteepness, settings.intensityMidpoint), settings.density, rng, maxActors)
    : choosePixels(pixelCount, count, rng);
  const actors: ActorRecord[] = [];
  for (const index of chosen) {
    const p = index * 4;
    let rgb: Vec3 = [image.pixels[p] / 255, image.pixels[p + 1] / 255, image.pixels[p + 2] / 255];
    if (settings.colorMode === 'palette') rgb = nearestColor(rgb, settings.colors);
    actors.push({
      x: offsetX + (index % width) + rng(),
      y: offsetY + Math.floor(index / width) + rng(),
      dir: rng() * 2 * Math.PI,
      speed: settings.minSpeed,
      seed: [...rgb, 1],
      color: [...rgb, 1],
      age: 0,
      life: settings.life,
      alive: true,
      rng: randomNonZeroU32(rng),
    });
  }
  return actors;
}

// `count` distinct indices in [0, total).
function choosePixels(total: number, count: number, rng: Rng): Uint32Array {
  const indices = new Uint32Array(total);
  for (let i = 0; i < total; i++) indices[i] = i;
  return randomSubset(indices, count, rng);
}

// Each pixel independently with chance density x weight / mean weight (at
// most 1), then at most maxActors of those, chosen at random.
function chooseWeightedPixels(weights: Float32Array, density: number, rng: Rng, maxActors: number): Uint32Array {
  let sum = 0;
  for (const w of weights) sum += w;
  const scale = density / (sum / weights.length);
  const chosen = new Uint32Array(weights.length);
  let n = 0;
  for (let i = 0; i < weights.length; i++) {
    if (rng() < weights[i] * scale) chosen[n++] = i;
  }
  return randomSubset(chosen.subarray(0, n), Math.min(n, maxActors), rng);
}

// The first `count` entries after a partial Fisher-Yates shuffle, in place.
function randomSubset(indices: Uint32Array, count: number, rng: Rng): Uint32Array {
  const total = indices.length;
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rng() * (total - i));
    const swap = indices[i];
    indices[i] = indices[j];
    indices[j] = swap;
  }
  return indices.subarray(0, count);
}

// The average image color under each Life cell's block on the field, row-major
// over a lifeSize x lifeSize board. Field pixels outside the image count as black.
export function cellColors(image: SeedImage, lifeSize: number, fieldSize: number): Vec3[] {
  const { width, height, offsetX, offsetY } = image.fit;
  const cellSize = fieldSize / lifeSize;
  const sums = new Float64Array(lifeSize * lifeSize * 3);
  for (let y = 0; y < height; y++) {
    const cellY = Math.floor((offsetY + y) / cellSize);
    for (let x = 0; x < width; x++) {
      const cell = (cellY * lifeSize + Math.floor((offsetX + x) / cellSize)) * 3;
      const p = (y * width + x) * 4;
      sums[cell] += image.pixels[p];
      sums[cell + 1] += image.pixels[p + 1];
      sums[cell + 2] += image.pixels[p + 2];
    }
  }
  const scale = 1 / (255 * cellSize * cellSize);
  return Array.from({ length: lifeSize * lifeSize }, (_, i) => [sums[i * 3] * scale, sums[i * 3 + 1] * scale, sums[i * 3 + 2] * scale] as Vec3);
}

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

// Rec. 709 luma of an RGBA pixel, 0-255.
const luma = (pixels: Uint8ClampedArray, p: number): number => 0.2126 * pixels[p] + 0.7152 * pixels[p + 1] + 0.0722 * pixels[p + 2];

// A relative spawn weight per pixel: a sigmoid of the pixel's brightness as a
// fraction of the image's brightest pixel, centered on `midpoint` with the
// given steepness. Steepness 0 weighs every pixel the same.
export function intensityWeights(pixels: Uint8ClampedArray, steepness: number, midpoint: number): Float32Array {
  const count = pixels.length / 4;
  const weights = new Float32Array(count);
  let brightest = 0;
  for (let i = 0; i < count; i++) brightest = Math.max(brightest, luma(pixels, i * 4));
  for (let i = 0; i < count; i++) {
    const brightness = brightest > 0 ? luma(pixels, i * 4) / brightest : 0;
    weights[i] = sigmoid(steepness * (brightness - midpoint));
  }
  return weights;
}
