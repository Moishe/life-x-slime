@group(0) @binding(0) var<uniform> params: SimParams;
@group(0) @binding(1) var<storage, read> actors: array<Actor>;

struct DepositOut {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
}

// One 1-px point per actor slot. Dead slots are pushed outside the clip volume.
@vertex
fn vs(@builtin(vertex_index) index: u32) -> DepositOut {
  let a = actors[index];
  var out: DepositOut;
  out.color = vec4f(a.color.rgb, 1.0);
  if (a.alive == 0u) {
    out.position = vec4f(2.0, 2.0, 0.0, 1.0);
    return out;
  }
  // Centre of pixel floor(pos). Clip-space y points up, texture rows go down.
  let p = floor(a.pos) + vec2f(0.5);
  out.position = vec4f(p.x / params.width * 2.0 - 1.0, 1.0 - p.y / params.height * 2.0, 0.0, 1.0);
  return out;
}

struct DepositFrag {
  @location(0) color: vec4f,
  // Added onto the pile texture, so each actor counts one.
  @location(1) pile: vec4f,
}

@fragment
fn fs(v: DepositOut) -> DepositFrag {
  return DepositFrag(v.color, vec4f(1.0));
}
