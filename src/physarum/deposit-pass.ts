import common from './shaders/common.wgsl?raw';
import code from './shaders/deposit.wgsl?raw';
import { createModule } from '../gpu/shader';

export interface DepositBindings {
  params: GPUBuffer;
  actors: GPUBuffer;
  target: GPUTexture;
  pile: GPUTexture;
}

// Draws each alive actor's deposit color into the trail, replacing what was
// there, and adds one per actor to the pile texture, which starts from zero.
export class DepositPass {
  private pipeline: GPURenderPipeline;

  constructor(private device: GPUDevice) {
    const module = createModule(device, common + code, 'deposit');
    this.pipeline = device.createRenderPipeline({
      label: 'deposit',
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: {
        module,
        entryPoint: 'fs',
        targets: [
          { format: 'rgba8unorm' },
          { format: 'r16float', blend: { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } } },
        ],
      },
      primitive: { topology: 'point-list' },
    });
  }

  encode(encoder: GPUCommandEncoder, b: DepositBindings, poolSize: number): void {
    const bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: b.params } },
        { binding: 1, resource: { buffer: b.actors } },
      ],
    });
    const pass = encoder.beginRenderPass({
      label: 'deposit',
      colorAttachments: [
        { view: b.target.createView(), loadOp: 'load', storeOp: 'store' },
        { view: b.pile.createView(), loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 0 }, storeOp: 'store' },
      ],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(poolSize);
    pass.end();
  }
}
