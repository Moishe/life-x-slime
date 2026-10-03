import code from './composite.wgsl?raw';
import { createModule } from '../gpu/shader';

// Draws the Physarum field, Life cells and placement ghost into one target.
export class Compositor {
  private pipeline: GPURenderPipeline;
  private sampler: GPUSampler;
  private params: GPUBuffer;
  private lifeTexture: GPUTexture;
  private ghostTexture: GPUTexture;

  constructor(
    private device: GPUDevice,
    format: GPUTextureFormat,
    private gridSize: number,
  ) {
    const module = createModule(device, code, 'composite');
    this.pipeline = device.createRenderPipeline({
      label: 'composite',
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    });
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    this.params = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const cellTexture = (label: string) =>
      device.createTexture({
        label,
        size: [gridSize, gridSize],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
    this.lifeTexture = cellTexture('life cells');
    this.ghostTexture = cellTexture('ghost cells');
  }

  setLife(texels: Uint8Array): void {
    this.writeCells(this.lifeTexture, texels);
  }

  setGhost(texels: Uint8Array): void {
    this.writeCells(this.ghostTexture, texels);
  }

  render(target: GPUTextureView, field: GPUTexture, physarumOpacity: number, lifeOpacity: number): void {
    this.device.queue.writeBuffer(this.params, 0, new Float32Array([physarumOpacity, lifeOpacity, 0, 0]));
    const bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.params } },
        { binding: 1, resource: field.createView() },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: this.lifeTexture.createView() },
        { binding: 4, resource: this.ghostTexture.createView() },
      ],
    });
    const encoder = this.device.createCommandEncoder({ label: 'composite' });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: target, loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store' }],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  private writeCells(texture: GPUTexture, texels: Uint8Array): void {
    this.device.queue.writeTexture({ texture }, texels, { bytesPerRow: this.gridSize * 4 }, [this.gridSize, this.gridSize]);
  }
}
