import { AgentPass } from './agent-pass';
import { DepositPass } from './deposit-pass';
import { DiffusePass } from './diffuse-pass';
import { FoodPass } from './food-pass';
import { InjectPass } from './inject-pass';
import { createCountersBuffer, createFieldTexture, createStorageBuffer, createUniformBuffer } from './buffers';
import {
  ACTOR_BYTES, COUNTERS_BYTES, FOOD_SEED_BYTES, packActors, packFoodSeeds, unpackCounters,
  type ActorRecord, type CounterValues, type FoodSeed,
} from './layout';
import {
  DEFAULT_PARAMS, FADE_PARAMS_BYTES, FOOD_PARAMS_BYTES, SIM_PARAMS_BYTES,
  packFadeParams, packFoodParams, packSimParams, type PhysarumParams,
} from './params';

export interface SimOptions {
  width: number;
  height: number;
  poolSize: number;
  cellSize: number;
}

const MAX_SPAWNS_PER_STEP = 65536;

// Owns the Physarum GPU state and runs one step at a time. See the spec's
// "One Physarum step" for the pass order.
export class PhysarumSim {
  params: PhysarumParams = { ...DEFAULT_PARAMS };

  private readonly agentPass: AgentPass;
  private readonly injectPass: InjectPass;
  private readonly diffusePass: DiffusePass;
  private readonly depositPass: DepositPass;
  private readonly foodPass: FoodPass;

  private trailA: GPUTexture;
  private trailB: GPUTexture;
  private readonly food: GPUTexture;

  private actors!: GPUBuffer;
  private children!: GPUBuffer;
  private spawns!: GPUBuffer;
  private foodSeeds!: GPUBuffer;
  private readonly counters: GPUBuffer;
  private readonly density: GPUBuffer;
  private readonly countersStaging: GPUBuffer;
  private readonly simParams: GPUBuffer;
  private readonly trailFadeParams: GPUBuffer;
  private readonly foodFadeParams: GPUBuffer;
  private readonly foodParams: GPUBuffer;

  private poolSizeValue = 0;
  private cellSize = 0;
  private stepIndex = 0;
  private readPending = false;

  constructor(
    private readonly device: GPUDevice,
    private readonly opts: SimOptions,
  ) {
    const { width, height } = opts;
    this.agentPass = new AgentPass(device);
    this.injectPass = new InjectPass(device);
    this.diffusePass = new DiffusePass(device);
    this.depositPass = new DepositPass(device);
    this.foodPass = new FoodPass(device);

    this.trailA = createFieldTexture(device, width, height, 'trail A');
    this.trailB = createFieldTexture(device, width, height, 'trail B');
    this.food = createFieldTexture(device, width, height, 'food');

    this.counters = createCountersBuffer(device);
    this.density = createStorageBuffer(device, width * height * 4, 'density');
    this.countersStaging = device.createBuffer({
      label: 'counters staging',
      size: COUNTERS_BYTES,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    this.simParams = createUniformBuffer(device, SIM_PARAMS_BYTES, 'sim params');
    this.trailFadeParams = createUniformBuffer(device, FADE_PARAMS_BYTES, 'trail fade params');
    this.foodFadeParams = createUniformBuffer(device, FADE_PARAMS_BYTES, 'food fade params');
    this.foodParams = createUniformBuffer(device, FOOD_PARAMS_BYTES, 'food params');

    this.clearTrail();
    this.allocatePool(opts.poolSize);
    this.setCellSize(opts.cellSize);
  }

  get poolSize(): number {
    return this.poolSizeValue;
  }

  // One food seed per Life cell, so a tick's deaths always fit in one step.
  get maxFoodSeedsPerStep(): number {
    return (this.opts.width / this.cellSize) * (this.opts.height / this.cellSize);
  }

  get maxChildren(): number {
    return this.poolSizeValue / 8;
  }

  // Life spawns per step are capped so a step never inserts more than poolSize actors.
  get maxSpawnsPerStep(): number {
    return Math.min(this.poolSizeValue - this.maxChildren, MAX_SPAWNS_PER_STEP);
  }

  // The latest trail.
  get trail(): GPUTexture {
    return this.trailA;
  }

  get foodTexture(): GPUTexture {
    return this.food;
  }

  step(spawns: ActorRecord[], seeds: FoodSeed[]): void {
    if (spawns.length > this.maxSpawnsPerStep) {
      throw new Error(`step() got ${spawns.length} spawns; max is ${this.maxSpawnsPerStep}`);
    }
    if (seeds.length > this.maxFoodSeedsPerStep) {
      throw new Error(`step() got ${seeds.length} food seeds; max is ${this.maxFoodSeedsPerStep}`);
    }
    const { device, params: p } = this;
    const { width, height } = this.opts;
    const { cellSize } = this;
    const queue = device.queue;

    queue.writeBuffer(this.simParams, 0, packSimParams(p, {
      width, height, step: this.stepIndex, poolSize: this.poolSizeValue,
      maxChildren: this.maxChildren, spawnCount: spawns.length,
    }));
    if (spawns.length > 0) queue.writeBuffer(this.spawns, 0, packActors(spawns));

    const encoder = device.createCommandEncoder({ label: 'physarum step' });
    // Reset childCount and aliveCount (bytes 4..12); head and childrenInserted persist.
    encoder.clearBuffer(this.counters, 4, 8);
    if (p.crowdingLimit > 0) encoder.clearBuffer(this.density);

    const diffuse = this.stepIndex % Math.max(1, p.blurInterval) === 0;
    let current = this.trailA;
    if (diffuse) {
      queue.writeBuffer(this.trailFadeParams, 0, packFadeParams(p.fadeDecrement, p.blurMultiplier));
      this.diffusePass.encode(encoder, { fadeParams: this.trailFadeParams, source: this.trailA, target: this.trailB });
      current = this.trailB;
    }

    if (seeds.length > 0) {
      queue.writeBuffer(this.foodSeeds, 0, packFoodSeeds(seeds));
      queue.writeBuffer(this.foodParams, 0, packFoodParams(cellSize, p.foodPerDeath, width, height));
      this.foodPass.encodeSeeds(encoder, { foodParams: this.foodParams, seeds: this.foodSeeds, target: this.food }, seeds.length);
    }
    if (this.stepIndex % Math.max(1, p.foodFadeInterval) === 0) {
      queue.writeBuffer(this.foodFadeParams, 0, packFadeParams(p.foodFadeDecrement, 0));
      this.foodPass.encodeFade(encoder, { fadeParams: this.foodFadeParams, target: this.food });
    }

    this.agentPass.encode(encoder, {
      params: this.simParams, actors: this.actors, children: this.children,
      counters: this.counters, trail: current, food: this.food, density: this.density,
    }, this.poolSizeValue);
    this.injectPass.encode(encoder, {
      params: this.simParams, actors: this.actors, spawns: this.spawns,
      children: this.children, counters: this.counters,
    }, spawns.length + this.maxChildren);
    this.depositPass.encode(encoder, { params: this.simParams, actors: this.actors, target: current }, this.poolSizeValue);

    queue.submit([encoder.finish()]);
    if (diffuse) [this.trailA, this.trailB] = [this.trailB, this.trailA];
    this.stepIndex++;
  }

  // Follows a Life board size change: resizes the food seed buffer and clears
  // the food map, which is laid out in the old cell blocks.
  setCellSize(cellSize: number): void {
    this.cellSize = cellSize;
    this.foodSeeds?.destroy();
    this.foodSeeds = createStorageBuffer(this.device, this.maxFoodSeedsPerStep * FOOD_SEED_BYTES, 'food seeds');
    this.clearFood();
  }

  setPoolSize(poolSize: number): void {
    this.allocatePool(poolSize);
  }

  clearActors(): void {
    const encoder = this.device.createCommandEncoder({ label: 'clear actors' });
    encoder.clearBuffer(this.actors);
    encoder.clearBuffer(this.children);
    encoder.clearBuffer(this.counters);
    this.device.queue.submit([encoder.finish()]);
  }

  clearTrail(): void {
    this.clearTextures([this.trailA, this.trailB], { r: 0, g: 0, b: 0, a: 1 });
  }

  clearFood(): void {
    this.clearTextures([this.food], { r: 0, g: 0, b: 0, a: 0 });
  }

  // Reads the counters after all submitted steps finish. Returns null if a
  // read is already in flight, so callers can poll without piling up maps.
  async readCounters(): Promise<CounterValues | null> {
    if (this.readPending) return null;
    this.readPending = true;
    try {
      const encoder = this.device.createCommandEncoder({ label: 'read counters' });
      encoder.copyBufferToBuffer(this.counters, 0, this.countersStaging, 0, COUNTERS_BYTES);
      this.device.queue.submit([encoder.finish()]);
      await this.countersStaging.mapAsync(GPUMapMode.READ);
      const values = unpackCounters(this.countersStaging.getMappedRange().slice(0));
      this.countersStaging.unmap();
      return values;
    } finally {
      this.readPending = false;
    }
  }

  private allocatePool(poolSize: number): void {
    if (!Number.isInteger(Math.log2(poolSize)) || poolSize < 16) {
      throw new Error(`poolSize must be a power of two >= 16, got ${poolSize}`);
    }
    this.actors?.destroy();
    this.children?.destroy();
    this.spawns?.destroy();
    this.poolSizeValue = poolSize;
    this.actors = createStorageBuffer(this.device, poolSize * ACTOR_BYTES, 'actors');
    this.children = createStorageBuffer(this.device, this.maxChildren * ACTOR_BYTES, 'children');
    this.spawns = createStorageBuffer(this.device, this.maxSpawnsPerStep * ACTOR_BYTES, 'spawns');
    this.device.queue.writeBuffer(this.counters, 0, new Uint32Array(4));
  }

  private clearTextures(textures: GPUTexture[], clearValue: GPUColor): void {
    const encoder = this.device.createCommandEncoder({ label: 'clear textures' });
    for (const texture of textures) {
      encoder.beginRenderPass({
        colorAttachments: [{ view: texture.createView(), loadOp: 'clear', clearValue, storeOp: 'store' }],
      }).end();
    }
    this.device.queue.submit([encoder.finish()]);
  }
}
