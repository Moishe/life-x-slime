import common from './shaders/common.wgsl?raw';
import code from './shaders/height.wgsl?raw';
import { createModule } from '../gpu/shader';

export interface HeightBindings {
  params: GPUBuffer;
  pile: GPUTexture;
  height: GPUBuffer;
}

// Folds each step's pile counts into a persistent, decaying height field
// (one f32 per field pixel, row-major).
export class HeightPass {
  private pipeline: GPUComputePipeline;

  constructor(private device: GPUDevice) {
    this.pipeline = device.createComputePipeline({
      label: 'height',
      layout: 'auto',
      compute: { module: createModule(device, common + code, 'height'), entryPoint: 'main' },
    });
  }

  encode(encoder: GPUCommandEncoder, b: HeightBindings): void {
    const bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: b.params } },
        { binding: 1, resource: b.pile.createView() },
        { binding: 2, resource: { buffer: b.height } },
      ],
    });
    const pass = encoder.beginComputePass({ label: 'height' });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(b.pile.width / 16), Math.ceil(b.pile.height / 16));
    pass.end();
  }
}
