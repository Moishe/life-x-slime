// Must match packHeightParams in src/physarum/params.ts (16 bytes).
struct HeightParams {
  gain: f32,
  decay: f32,
  _pad0: f32,
  _pad1: f32,
}

@group(0) @binding(0) var<uniform> hp: HeightParams;
@group(0) @binding(1) var pile: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> height: array<f32>;

// Adds this step's pile count, blurred 3x3 so piles grow as mounds rather than
// spikes, onto the decayed height. Pixels outside the pile count as zero.
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let dims = textureDimensions(pile);
  if (gid.x >= dims.x || gid.y >= dims.y) {
    return;
  }
  var count = 0.0;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      count += load_or_zero(pile, vec2f(vec2i(gid.xy) + vec2i(dx, dy))).r;
    }
  }
  let i = gid.y * dims.x + gid.x;
  height[i] = min(1.0, height[i] * (1.0 - hp.decay) + count / 9.0 * hp.gain);
}
