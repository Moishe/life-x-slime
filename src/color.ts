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
// d is the weight toward rgb2. Hue is further weighted by each color's chroma
// (saturation x value), since black and greys have no real hue (rgb2hsv says 0, red).
export function hsvMix(rgb1: Vec3, rgb2: Vec3, d: number): Vec3 {
  const a = rgb2hsv(rgb1);
  const b = rgb2hsv(rgb2);
  const ca = (1 - d) * a[1] * a[2];
  const cb = d * b[1] * b[2];
  const t = ca + cb > 1e-6 ? cb / (ca + cb) : d;
  const dh = Math.abs(a[0] - b[0]);
  let h: number;
  if (dh < 1 - dh) h = mix(a[0], b[0], t);
  else if (a[0] < b[0]) h = fract(mix(a[0] + 1, b[0], t));
  else h = fract(mix(a[0], b[0] + 1, t));
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
