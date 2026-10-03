import { supportedPoolSizes } from '../physarum/params';

export type GpuInit = { ok: true; device: GPUDevice; poolSizes: number[] } | { ok: false; reason: string };

// Requests a device with the adapter's largest buffer limits so big actor pools fit.
export async function initGpu(): Promise<GpuInit> {
  if (!navigator.gpu) {
    return { ok: false, reason: 'WebGPU is not available in this browser. Try a recent Chrome, Edge or Safari.' };
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return { ok: false, reason: 'WebGPU is available, but no GPU adapter was found.' };
  try {
    const limits = {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
    };
    const device = await adapter.requestDevice({ requiredLimits: limits });
    return { ok: true, device, poolSizes: supportedPoolSizes(limits) };
  } catch (error) {
    return { ok: false, reason: `Could not create a WebGPU device: ${(error as Error).message}` };
  }
}
