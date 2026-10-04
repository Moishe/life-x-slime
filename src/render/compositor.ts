import code from './composite.wgsl?raw';
import { createModule } from '../gpu/shader';

// Draws the Physarum field, Life cells and placement ghost into one target.
export class Compositor {
  private module: GPUShaderModule;
  // One pipeline per target color format (the canvas's, and rgba8unorm for snapshots).
  private pipelines = new Map<GPUTextureFormat, GPURenderPipeline>();
  private sampler: GPUSampler;
  private params: GPUBuffer;
  private lifeTexture!: GPUTexture;
  private ghostTexture!: GPUTexture;

  constructor(
    private device: GPUDevice,
    private gridSize: number,
  ) {
    this.module = createModule(device, code, 'composite');
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    this.params = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.setGridSize(gridSize);
  }

  // Recreates the per-cell textures (both start transparent) for a new Life board size.
  setGridSize(gridSize: number): void {
    this.gridSize = gridSize;
    this.lifeTexture?.destroy();
    this.ghostTexture?.destroy();
    const cellTexture = (label: string) =>
      this.device.createTexture({
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

  render(target: GPUTexture, field: GPUTexture, physarumOpacity: number, lifeOpacity: number, ghostOpacity: number): void {
    this.device.queue.writeBuffer(this.params, 0, new Float32Array([physarumOpacity, lifeOpacity, ghostOpacity, 0]));
    const pipeline = this.pipelineFor(target.format);
    const bindGroup = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
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
      colorAttachments: [{ view: target.createView(), loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store' }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  private pipelineFor(format: GPUTextureFormat): GPURenderPipeline {
    let pipeline = this.pipelines.get(format);
    if (!pipeline) {
      pipeline = this.device.createRenderPipeline({
        label: `composite (${format})`,
        layout: 'auto',
        vertex: { module: this.module, entryPoint: 'vs' },
        fragment: { module: this.module, entryPoint: 'fs', targets: [{ format }] },
      });
      this.pipelines.set(format, pipeline);
    }
    return pipeline;
  }

  private writeCells(texture: GPUTexture, texels: Uint8Array): void {
    this.device.queue.writeTexture({ texture }, texels, { bytesPerRow: this.gridSize * 4 }, [this.gridSize, this.gridSize]);
  }
}
