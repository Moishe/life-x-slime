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
