import common from './shaders/common.wgsl?raw';
import code from './shaders/inject.wgsl?raw';
import { createModule } from '../gpu/shader';

export interface InjectBindings {
  params: GPUBuffer;
  actors: GPUBuffer;
  spawns: GPUBuffer;
  children: GPUBuffer;
  counters: GPUBuffer;
}

// Inserts Life spawns and reproduced children into the actor ring.
export class InjectPass {
  private pipeline: GPUComputePipeline;

  constructor(private device: GPUDevice) {
    this.pipeline = device.createComputePipeline({
      label: 'inject',
      layout: 'auto',
      compute: { module: createModule(device, common + code, 'inject'), entryPoint: 'main' },
    });
  }

  // workItems = spawnCount + maxChildren.
  encode(encoder: GPUCommandEncoder, b: InjectBindings, workItems: number): void {
    if (workItems === 0) return;
    const bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: b.params } },
        { binding: 1, resource: { buffer: b.actors } },
        { binding: 2, resource: { buffer: b.spawns } },
        { binding: 3, resource: { buffer: b.children } },
        { binding: 4, resource: { buffer: b.counters } },
      ],
    });
    const pass = encoder.beginComputePass({ label: 'inject' });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(workItems / 256));
    pass.end();
  }
}
