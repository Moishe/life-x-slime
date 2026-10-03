import common from './shaders/common.wgsl?raw';
import code from './shaders/diffuse.wgsl?raw';
import { createModule } from '../gpu/shader';

export interface DiffuseBindings {
  fadeParams: GPUBuffer;
  source: GPUTexture;
  target: GPUTexture;
}

// Blurs and fades the trail from one texture into the other (ping-pong).
export class DiffusePass {
  private pipeline: GPUComputePipeline;

  constructor(private device: GPUDevice) {
    this.pipeline = device.createComputePipeline({
      label: 'diffuse',
      layout: 'auto',
      compute: { module: createModule(device, common + code, 'diffuse'), entryPoint: 'main' },
    });
  }

  encode(encoder: GPUCommandEncoder, b: DiffuseBindings): void {
    const bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: b.fadeParams } },
        { binding: 1, resource: b.source.createView() },
        { binding: 2, resource: b.target.createView() },
      ],
    });
    const pass = encoder.beginComputePass({ label: 'diffuse' });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(b.source.width / 8), Math.ceil(b.source.height / 8));
    pass.end();
  }
}
