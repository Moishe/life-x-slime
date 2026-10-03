// Must match packFoodParams in src/physarum/params.ts.
struct FoodParams {
  cellSize: f32,
  foodPerDeath: f32,
  width: f32,
  height: f32,
}

// Must match packFoodSeeds in src/physarum/layout.ts.
struct FoodSeed {
  color: vec4f,
  cell: vec2u,
  _pad: vec2u,
}

@group(0) @binding(0) var<uniform> foodParams: FoodParams;
@group(0) @binding(1) var<storage, read> seeds: array<FoodSeed>;

struct SeedOut {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
}

// One quad (two triangles) per dead Life cell, covering its block of the field.
@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SeedOut {
  var corners = array<vec2f, 6>(
    vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
    vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0),
  );
  let seed = seeds[ii];
  let p = (vec2f(seed.cell) + corners[vi]) * foodParams.cellSize;
  var out: SeedOut;
  out.position = vec4f(p.x / foodParams.width * 2.0 - 1.0, 1.0 - p.y / foodParams.height * 2.0, 0.0, 1.0);
  out.color = vec4f(seed.color.rgb * foodParams.foodPerDeath, foodParams.foodPerDeath);
  return out;
}

@fragment
fn fs(v: SeedOut) -> @location(0) vec4f {
  return v.color;
}
