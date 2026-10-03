type ShaderErrorListener = (message: string) => void;

const shaderErrorListeners = new Set<ShaderErrorListener>();

// Called with a readable message whenever a WGSL module fails to compile.
export function onShaderError(listener: ShaderErrorListener): void {
  shaderErrorListeners.add(listener);
}

// Creates a shader module and reports WGSL problems with their line numbers.
// Line numbers count from the start of the concatenated source (common.wgsl first).
export function createModule(device: GPUDevice, code: string, label: string): GPUShaderModule {
  const module = device.createShaderModule({ code, label });
  void module.getCompilationInfo().then(info => {
    for (const m of info.messages) {
      const text = `WGSL ${m.type} in ${label} at line ${m.lineNum}:${m.linePos}: ${m.message}`;
      if (m.type === 'error') {
        console.error(text);
        shaderErrorListeners.forEach(listener => listener(text));
      } else {
        console.warn(text);
      }
    }
  });
  return module;
}
