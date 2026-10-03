import { defineConfig } from 'vitest/config';
import '@vitest/browser/providers/playwright';

// Unit tests run in Node. GPU tests run in real Chromium with WebGPU enabled.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'gpu',
          include: ['tests/gpu/**/*.test.ts'],
          // Verified on this Mac: headless Chromium (channel 'chromium' + --enable-unsafe-webgpu)
          // provides a working WebGPU adapter; no headed mode or Chrome channel needed.
          browser: {
            enabled: true,
            provider: 'playwright',
            headless: true,
            instances: [
              {
                browser: 'chromium',
                launch: { channel: 'chromium', args: ['--enable-unsafe-webgpu'] },
              },
            ],
          },
        },
      },
    ],
  },
});
