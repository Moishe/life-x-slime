@group(0) @binding(0) var<uniform> params: SimParams;
@group(0) @binding(1) var<storage, read_write> actors: array<Actor>;
@group(0) @binding(2) var<storage, read> spawns: array<Actor>;
@group(0) @binding(3) var<storage, read> children: array<Actor>;
@group(0) @binding(4) var<storage, read_write> counters: Counters;

// Copies this step's Life spawns and queued children into the actor ring,
// overwriting the oldest slots.
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  let childCount = min(atomicLoad(&counters.childCount), params.maxChildren);
  var source: Actor;
  if (i < params.spawnCount) {
    source = spawns[i];
  } else if (i - params.spawnCount < childCount) {
    source = children[i - params.spawnCount];
    atomicAdd(&counters.childrenInserted, 1u);
  } else {
    return;
  }
  let slot = atomicAdd(&counters.head, 1u) & (params.poolSize - 1u);
  actors[slot] = source;
}
