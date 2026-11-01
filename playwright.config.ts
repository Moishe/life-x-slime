import { defineConfig } from '@playwright/test';

// Runs the e2e suite in headless Chromium with WebGPU enabled
// (--enable-unsafe-webgpu) and a fake camera standing in for a webcam,
// against the Vite dev server on port 5199.
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5199',
    browserName: 'chromium',
    channel: 'chromium',
    launchOptions: { args: ['--enable-unsafe-webgpu', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
    viewport: { width: 1200, height: 900 },
  },
  webServer: {
    command: 'npx vite --port 5199 --strictPort',
    url: 'http://localhost:5199',
    reuseExistingServer: true,
  },
});
