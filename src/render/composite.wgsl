struct CompositeParams {
  physarumOpacity: f32,
  lifeOpacity: f32,
  ghostOpacity: f32,
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

// Physarum layer (alpha ignored) over black, then Life cells, then the ghost,
// each scaled by its opacity.
@fragment
fn fs(v: ScreenOut) -> @location(0) vec4f {
  let field = textureSample(fieldTexture, fieldSampler, v.uv).rgb * composite.physarumOpacity;
  let gridSize = vec2f(textureDimensions(lifeTexture));
  let cell = vec2u(clamp(floor(v.uv * gridSize), vec2f(0.0), gridSize - vec2f(1.0)));
  let life = textureLoad(lifeTexture, cell, 0);
  var rgb = mix(field, life.rgb, life.a * composite.lifeOpacity);
  let ghost = textureLoad(ghostTexture, cell, 0);
  rgb = mix(rgb, ghost.rgb, ghost.a * composite.ghostOpacity);
  return vec4f(rgb, 1.0);
}
