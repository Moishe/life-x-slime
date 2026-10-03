import { describe, it, expect } from 'vitest';
import common from '../../src/physarum/shaders/common.wgsl?raw';
import { createModule } from '../../src/gpu/shader';
import { dominantColor, hsv2rgb, hsvDistance, hsvMix, rgb2hsv, type Vec3 } from '../../src/color';
import { mulberry32 } from '../../src/rng';
import { getDevice, readBuffer } from './helpers';

const PROBE = `
@group(0) @binding(0) var<storage, read> a: array<vec4f>;
@group(0) @binding(1) var<storage, read> b: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> out: array<vec4f>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&a)) { return; }
  let x = a[i];
  let y = b[i];
  out[i * 4u + 0u] = vec4f(rgb2hsv(x.rgb), 0.0);
  out[i * 4u + 1u] = vec4f(hsv2rgb(x.rgb), 0.0);
  out[i * 4u + 2u] = vec4f(hsv_mix(x.rgb, y.rgb, x.w), hsv_distance(rgb2hsv(x.rgb), rgb2hsv(y.rgb)));
  out[i * 4u + 3u] = dominant_color(vec4f(x.rgb, 1.0), 6u, 0.1, 0.8, 1.2);
}`;

const circularDiff = (a: number, b: number) => {
  const d = Math.abs(a - b) % 1;
  return Math.min(d, 1 - d);
};

describe('WGSL color functions match src/color.ts', () => {
  it('agrees on 256 random color pairs', async () => {
    const device = await getDevice();
    const rng = mulberry32(99);
    const n = 256;
    const a = new Float32Array(n * 4);
    const b = new Float32Array(n * 4);
    for (let i = 0; i < n * 4; i++) {
      a[i] = rng();
      b[i] = rng();
    }
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    const aBuf = device.createBuffer({ size: a.byteLength, usage });
    const bBuf = device.createBuffer({ size: b.byteLength, usage });
    const outBuf = device.createBuffer({ size: n * 4 * 16, usage });
    device.queue.writeBuffer(aBuf, 0, a);
    device.queue.writeBuffer(bBuf, 0, b);
    const pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: createModule(device, common + PROBE, 'color probe'), entryPoint: 'main' },
    });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: aBuf } },
        { binding: 1, resource: { buffer: bBuf } },
        { binding: 2, resource: { buffer: outBuf } },
      ],
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(n / 64);
    pass.end();
    device.queue.submit([encoder.finish()]);
    const out = new Float32Array(await readBuffer(device, outBuf, n * 4 * 16));

    const lock = { lockToHsvAngles: 6, hsvAngleOffset: 0.1, hsvSaturationMultiplier: 0.8, hsvValueMultiplier: 1.2 };
    for (let i = 0; i < n; i++) {
      const x: Vec3 = [a[i * 4], a[i * 4 + 1], a[i * 4 + 2]];
      const y: Vec3 = [b[i * 4], b[i * 4 + 1], b[i * 4 + 2]];
      const d = a[i * 4 + 3];
      const row = (k: number) => Array.from(out.slice((i * 4 + k) * 4, (i * 4 + k) * 4 + 4));

      const hsv = rgb2hsv(x);
      const gpuHsv = row(0);
      expect(circularDiff(gpuHsv[0], hsv[0])).toBeLessThan(1e-3);
      expect(gpuHsv[1]).toBeCloseTo(hsv[1], 3);
      expect(gpuHsv[2]).toBeCloseTo(hsv[2], 3);

      hsv2rgb(x).forEach((v, k) => expect(row(1)[k]).toBeCloseTo(v, 3));
      hsvMix(x, y, d).forEach((v, k) => expect(row(2)[k]).toBeCloseTo(v, 2));
      expect(row(2)[3]).toBeCloseTo(hsvDistance(rgb2hsv(x), rgb2hsv(y)), 3);
      dominantColor(x, lock).forEach((v, k) => expect(row(3)[k]).toBeCloseTo(v, 2));
    }
  });
});
