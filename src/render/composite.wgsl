// Must match Compositor.packParams in compositor.ts (48 bytes).
struct CompositeParams {
  physarumOpacity: f32,
  lifeOpacity: f32,
  ghostOpacity: f32,
  // Relief shading of the Physarum layer from the height field: 0 = flat.
  relief: f32,
  // Height-to-pixel scale for the slope.
  heightScale: f32,
  lightX: f32,
  lightY: f32,
  lightZ: f32,
  fieldWidth: u32,
  fieldHeight: u32,
  _pad0: u32,
  _pad1: u32,
}

@group(0) @binding(0) var<uniform> composite: CompositeParams;
@group(0) @binding(1) var fieldTexture: texture_2d<f32>;
@group(0) @binding(2) var fieldSampler: sampler;
@group(0) @binding(3) var lifeTexture: texture_2d<f32>;
@group(0) @binding(4) var ghostTexture: texture_2d<f32>;
// One height per field pixel, row-major, in [0, 1].
@group(0) @binding(5) var<storage, read> height: array<f32>;

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

fn height_at(c: vec2i) -> f32 {
  let w = i32(composite.fieldWidth);
  let h = i32(composite.fieldHeight);
  let q = clamp(c, vec2i(0), vec2i(w - 1, h - 1));
  return height[q.y * w + q.x];
}

// Lambert plus a little specular from the height field's slope, taken over a
// two-pixel radius. Flat ground shades to exactly 1, so it looks the same as
// with relief off.
fn relief_shade(uv: vec2f) -> f32 {
  let c = vec2i(floor(uv * vec2f(f32(composite.fieldWidth), f32(composite.fieldHeight))));
  let dx = (height_at(c + vec2i(2, 0)) - height_at(c - vec2i(2, 0))) * composite.heightScale * 0.5;
  let dy = (height_at(c + vec2i(0, 2)) - height_at(c - vec2i(0, 2))) * composite.heightScale * 0.5;
  let n = normalize(vec3f(-dx, -dy, 1.0));
  let l = normalize(vec3f(composite.lightX, composite.lightY, composite.lightZ));
  let diffuse = max(dot(n, l), 0.0) / max(l.z, 0.05);
  let halfway = normalize(l + vec3f(0.0, 0.0, 1.0));
  let specular = pow(max(dot(n, halfway), 0.0), 24.0) - pow(halfway.z, 24.0);
  return diffuse + specular * 0.6;
}

// Physarum layer (alpha ignored) over black, shaded by the relief, then Life
// cells, then the ghost, each scaled by its opacity.
@fragment
fn fs(v: ScreenOut) -> @location(0) vec4f {
  var field = textureSample(fieldTexture, fieldSampler, v.uv).rgb * composite.physarumOpacity;
  if (composite.relief > 0.0) {
    field *= mix(1.0, relief_shade(v.uv), composite.relief);
  }
  let gridSize = vec2f(textureDimensions(lifeTexture));
  let cell = vec2u(clamp(floor(v.uv * gridSize), vec2f(0.0), gridSize - vec2f(1.0)));
  let life = textureLoad(lifeTexture, cell, 0);
  var rgb = mix(field, life.rgb, life.a * composite.lifeOpacity);
  let ghost = textureLoad(ghostTexture, cell, 0);
  rgb = mix(rgb, ghost.rgb, ghost.a * composite.ghostOpacity);
  return vec4f(rgb, 1.0);
}
