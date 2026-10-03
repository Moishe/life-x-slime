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
