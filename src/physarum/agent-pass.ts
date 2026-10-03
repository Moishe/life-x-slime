import common from './shaders/common.wgsl?raw';
import code from './shaders/agent.wgsl?raw';
import { createModule } from '../gpu/shader';

export interface AgentBindings {
  params: GPUBuffer;
  actors: GPUBuffer;
  children: GPUBuffer;
  counters: GPUBuffer;
  trail: GPUTexture;
  food: GPUTexture;
}

// Moves, kills/respawns, steers and reproduces every actor.
export class AgentPass {
  private pipeline: GPUComputePipeline;

  constructor(private device: GPUDevice) {
    this.pipeline = device.createComputePipeline({
      label: 'agent',
      layout: 'auto',
      compute: { module: createModule(device, common + code, 'agent'), entryPoint: 'main' },
    });
  }

  encode(encoder: GPUCommandEncoder, b: AgentBindings, poolSize: number): void {
    const bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: b.params } },
        { binding: 1, resource: { buffer: b.actors } },
        { binding: 2, resource: { buffer: b.children } },
        { binding: 3, resource: { buffer: b.counters } },
        { binding: 4, resource: b.trail.createView() },
        { binding: 5, resource: b.food.createView() },
      ],
    });
    const pass = encoder.beginComputePass({ label: 'agent' });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(poolSize / 256));
    pass.end();
  }
}
