import code from './composite.wgsl?raw';
import { createModule } from '../gpu/shader';

// Relief shading of the Physarum layer: strength in [0, 1], the height field's
// scale in pixels, and the light's direction as angles in radians.
export interface ReliefSettings {
  relief: number;
  reliefHeight: number;
  lightAngle: number;
  lightElevation: number;
}

const PARAMS_BYTES = 48;

// Draws the Physarum field (shaded by its height field), Life cells and
// placement ghost into one target.
export class Compositor {
  relief: ReliefSettings = { relief: 0, reliefHeight: 0, lightAngle: 0, lightElevation: 0 };

  private module: GPUShaderModule;
  // One pipeline per target color format (the canvas's, and rgba8unorm for snapshots).
  private pipelines = new Map<GPUTextureFormat, GPURenderPipeline>();
  private sampler: GPUSampler;
  private params: GPUBuffer;
  private lifeTexture!: GPUTexture;
  private ghostTexture!: GPUTexture;
  // Until setHeight, a one-pixel flat field.
  private height: GPUBuffer;
  private fieldWidth = 1;
  private fieldHeight = 1;

  constructor(
    private device: GPUDevice,
    private gridSize: number,
  ) {
    this.module = createModule(device, code, 'composite');
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    this.params = device.createBuffer({ size: PARAMS_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.height = device.createBuffer({ label: 'flat height', size: 4, usage: GPUBufferUsage.STORAGE });
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

  // The height field to shade the Physarum layer with: one f32 per field pixel, row-major.
  setHeight(height: GPUBuffer, fieldWidth: number, fieldHeight: number): void {
    this.height = height;
    this.fieldWidth = fieldWidth;
    this.fieldHeight = fieldHeight;
  }

  setLife(texels: Uint8Array): void {
    this.writeCells(this.lifeTexture, texels);
  }

  setGhost(texels: Uint8Array): void {
    this.writeCells(this.ghostTexture, texels);
  }

  render(target: GPUTexture, field: GPUTexture, physarumOpacity: number, lifeOpacity: number, ghostOpacity: number): void {
    this.device.queue.writeBuffer(this.params, 0, this.packParams(physarumOpacity, lifeOpacity, ghostOpacity));
    const pipeline = this.pipelineFor(target.format);
    const bindGroup = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.params } },
        { binding: 1, resource: field.createView() },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: this.lifeTexture.createView() },
        { binding: 4, resource: this.ghostTexture.createView() },
        { binding: 5, resource: { buffer: this.height } },
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

  // Must match `struct CompositeParams` in composite.wgsl.
  private packParams(physarumOpacity: number, lifeOpacity: number, ghostOpacity: number): ArrayBuffer {
    const { relief, reliefHeight, lightAngle, lightElevation } = this.relief;
    const buf = new ArrayBuffer(PARAMS_BYTES);
    new Float32Array(buf, 0, 8).set([
      physarumOpacity, lifeOpacity, ghostOpacity, relief, reliefHeight,
      Math.cos(lightAngle) * Math.cos(lightElevation), Math.sin(lightAngle) * Math.cos(lightElevation), Math.sin(lightElevation),
    ]);
    new Uint32Array(buf, 32, 2).set([this.fieldWidth, this.fieldHeight]);
    return buf;
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
