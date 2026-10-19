@group(0) @binding(0) var<uniform> params: SimParams;
@group(0) @binding(1) var<storage, read_write> actors: array<Actor>;
@group(0) @binding(2) var<storage, read_write> children: array<Actor>;
@group(0) @binding(3) var<storage, read_write> counters: Counters;
@group(0) @binding(4) var trail: texture_2d<f32>;
@group(0) @binding(5) var food: texture_2d<f32>;
// Actors per field pixel so far this step; cleared before each agent pass.
@group(0) @binding(6) var<storage, read_write> density: array<atomic<u32>>;

// Starting "worst" sensor score, as in Particles.
const MIN_DISTANCE: f32 = 5.0;

var<workgroup> workgroupAlive: atomic<u32>;

fn field_size() -> vec2f {
  return vec2f(params.width, params.height);
}

fn is_out_of_bounds(p: vec2f) -> bool {
  return p.x < 0.0 || p.y < 0.0 || p.x >= params.width || p.y >= params.height;
}

// Wraps into the field when wrapBounds is on, otherwise clamps.
fn keep_in_field(p: vec2f) -> vec2f {
  let dims = field_size();
  let inside = dims - vec2f(0.001);
  if (params.wrapBounds != 0u) {
    return min(p - floor(p / dims) * dims, inside);
  }
  return clamp(p, vec2f(0.0), inside);
}

// Respawns can land just outside the field, so clamp before indexing.
fn pixel_index(p: vec2f) -> u32 {
  let c = vec2u(clamp(floor(p), vec2f(0.0), field_size() - 1.0));
  return c.y * u32(params.width) + c.x;
}

fn hue_lock(rgb: vec3f) -> vec4f {
  return dominant_color(vec4f(rgb, 1.0), params.lockToHsvAngles, params.hsvAngleOffset,
                        params.hsvSaturationMultiplier, params.hsvValueMultiplier);
}

// Respawn in place, per always_spawn_from_parent (> 0 from a random living
// parent, otherwise at a random position keeping its own color).
fn respawn(a: ptr<function, Actor>, rng: ptr<function, u32>) {
  var fromParent = false;
  if (params.alwaysSpawnFromParent > 0) {
    let parentId = u32(rand(rng) * f32(params.poolSize)) % params.poolSize;
    // Another thread may be updating this slot: a benign race, as in Particles.
    let parent = actors[parentId];
    if (parent.alive != 0u) {
      (*a).pos = parent.pos;
      (*a).dir = parent.dir;
      (*a).color = hue_lock(parent.color.rgb);
      fromParent = true;
    }
  }
  if (!fromParent) {
    (*a).pos = vec2f(rand(rng) * params.width, rand(rng) * params.height);
    (*a).color = hue_lock((*a).seed.rgb);
  }
  (*a).seed = (*a).color;
  var side = (*a).dir + PI / 2.0;
  if (rand(rng) < 0.5) {
    side -= PI;
  }
  (*a).pos += vec2f(cos(side), sin(side)) * params.spawnRandomOffset;
  (*a).age = 0u;
  (*a).life = params.life;
  (*a).speed = params.minSpeed;
}

// Returns the direction of the best-scoring sensor (lower score is better).
fn sense(a: Actor) -> f32 {
  let seedHsv = rgb2hsv(a.seed.rgb);
  let slices = max(params.lookSlices, 1u);
  var newDir = a.dir;
  var minScore = MIN_DISTANCE;
  for (var i = 0u; i < slices; i++) {
    for (var j = 0u; j < 2u; j++) {
      var offset = f32(i) / f32(slices) * params.lookRadians;
      if (j == 0u) {
        offset = -offset;
      }
      let t = a.dir + offset;
      let look = a.pos + vec2f(cos(t), sin(t)) * params.lookDistance;
      let dist = hsv_distance(rgb2hsv(load_or_zero(trail, look).rgb), seedHsv);
      var foodVal = 0.0;
      if (params.foodSensitivity > 0.0) {
        let f = load_or_zero(food, look);
        let fd = hsv_distance(rgb2hsv(f.rgb), seedHsv);
        foodVal = params.foodSensitivity * f.a * max(0.0, 1.0 - fd);
      }
      let score = dist - foodVal;
      if (score < minScore) {
        newDir = t;
        minScore = score;
      }
    }
  }
  return newDir;
}

fn maybe_spawn_child(a: Actor, rng: ptr<function, u32>) {
  if (rand(rng) >= params.spawnProbability) {
    return;
  }
  let index = atomicAdd(&counters.childCount, 1u);
  if (index >= params.maxChildren) {
    return;
  }
  var c = a;
  let offset = (rand(rng) * 2.0 - 1.0) * params.spawnRandomOffset;
  c.pos = keep_in_field(a.pos + vec2f(-sin(a.dir), cos(a.dir)) * offset);
  c.dir = a.dir + (rand(rng) * 2.0 - 1.0) * params.directionVariance;
  let speedCap = max(params.maxSpeed, params.minSpeed);
  c.speed = clamp(a.speed * (1.0 + (rand(rng) * 2.0 - 1.0) * params.speedVariance), params.minSpeed, speedCap);
  c.age = 0u;
  c.life = params.life;
  c.alive = 1u;
  c.rng = (*rng ^ 0x9e3779b9u) | 1u;
  children[index] = c;
}

// Advances one actor by a step; returns whether it is alive afterwards.
fn step_actor(id: u32) -> bool {
  var a = actors[id];
  if (a.alive == 0u) {
    return false;
  }
  var rng = a.rng;

  a.pos += a.speed * vec2f(cos(a.dir), sin(a.dir));
  var outOfBounds = is_out_of_bounds(a.pos);
  if (outOfBounds && params.wrapBounds != 0u) {
    a.pos = keep_in_field(a.pos);
    outOfBounds = false;
  }

  let foodHere = load_or_zero(food, a.pos);
  let exhausted = params.foodExhaustion > 0.0 && foodHere.a >= params.foodExhaustion;
  if (a.age > a.life || outOfBounds || exhausted) {
    if (params.alwaysSpawnFromParent < 0) {
      a.alive = 0u;
      a.rng = rng;
      actors[id] = a;
      return false;
    }
    respawn(&a, &rng);
  }

  let newDir = sense(a) + (rand(&rng) - 0.5) * params.directionRandomization;
  a.dir = mix(a.dir, newDir, 1.0 - params.directionMomentum);
  a.dir = a.dir % (2.0 * PI);
  a.speed = min(max(params.maxSpeed, params.minSpeed), a.speed + rand(&rng) * 0.01);
  a.age += 1u;

  let trailHere = load_or_zero(trail, a.pos);
  var rgb = hsv_mix(trailHere.rgb, a.color.rgb, params.intensity);
  // Floor the value so colonies wandering over the black field don't fade to black.
  if (params.minValue > 0.0) {
    var hsv = rgb2hsv(rgb);
    hsv.z = max(hsv.z, params.minValue);
    rgb = hsv2rgb(hsv);
  }
  a.color = vec4f(rgb, params.intensity);

  // Only the first crowdingLimit actors to reach a pixel this step may reproduce.
  var crowded = false;
  if (params.crowdingLimit > 0u) {
    crowded = atomicAdd(&density[pixel_index(a.pos)], 1u) >= params.crowdingLimit;
  }
  if (!crowded) {
    maybe_spawn_child(a, &rng);
  }
  a.rng = rng;
  actors[id] = a;
  return true;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) lid: u32) {
  if (lid == 0u) {
    atomicStore(&workgroupAlive, 0u);
  }
  workgroupBarrier();
  if (gid.x < params.poolSize && step_actor(gid.x)) {
    atomicAdd(&workgroupAlive, 1u);
  }
  workgroupBarrier();
  // One global atomic per workgroup instead of one per actor.
  if (lid == 0u) {
    let n = atomicLoad(&workgroupAlive);
    if (n > 0u) {
      atomicAdd(&counters.aliveCount, n);
    }
  }
}
