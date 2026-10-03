import common from './shaders/common.wgsl?raw';
import seedCode from './shaders/food-seed.wgsl?raw';
import fadeCode from './shaders/food-fade.wgsl?raw';
import { createModule } from '../gpu/shader';

export interface FoodSeedBindings {
  foodParams: GPUBuffer;
  seeds: GPUBuffer;
  target: GPUTexture;
}

export interface FoodFadeBindings {
  fadeParams: GPUBuffer;
  target: GPUTexture;
}

// Adds food where Life cells died, and fades the food map.
export class FoodPass {
  private seedPipeline: GPURenderPipeline;
  private fadePipeline: GPURenderPipeline;

  constructor(private device: GPUDevice) {
    const seedModule = createModule(device, seedCode, 'food seed');
    const add: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one', operation: 'add' };
    this.seedPipeline = device.createRenderPipeline({
      label: 'food seed',
      layout: 'auto',
      vertex: { module: seedModule, entryPoint: 'vs' },
      fragment: { module: seedModule, entryPoint: 'fs', targets: [{ format: 'rgba8unorm', blend: { color: add, alpha: add } }] },
    });
    const fadeModule = createModule(device, common + fadeCode, 'food fade');
    const subtract: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one', operation: 'reverse-subtract' };
    this.fadePipeline = device.createRenderPipeline({
      label: 'food fade',
      layout: 'auto',
      vertex: { module: fadeModule, entryPoint: 'vs' },
      fragment: { module: fadeModule, entryPoint: 'fs', targets: [{ format: 'rgba8unorm', blend: { color: subtract, alpha: subtract } }] },
    });
  }

  encodeSeeds(encoder: GPUCommandEncoder, b: FoodSeedBindings, count: number): void {
    if (count === 0) return;
    const bindGroup = this.device.createBindGroup({
      layout: this.seedPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: b.foodParams } },
        { binding: 1, resource: { buffer: b.seeds } },
      ],
    });
    const pass = encoder.beginRenderPass({
      label: 'food seed',
      colorAttachments: [{ view: b.target.createView(), loadOp: 'load', storeOp: 'store' }],
    });
    pass.setPipeline(this.seedPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6, count);
    pass.end();
  }

  encodeFade(encoder: GPUCommandEncoder, b: FoodFadeBindings): void {
    const bindGroup = this.device.createBindGroup({
      layout: this.fadePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: b.fadeParams } }],
    });
    const pass = encoder.beginRenderPass({
      label: 'food fade',
      colorAttachments: [{ view: b.target.createView(), loadOp: 'load', storeOp: 'store' }],
    });
    pass.setPipeline(this.fadePipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }
}
