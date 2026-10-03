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
