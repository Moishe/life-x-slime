import { defineConfig } from '@playwright/test';

// Use the same browser setup that worked for GPU tests in Task 1
// (if GPU tests needed headless: false or channel 'chrome', mirror it here).
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5199',
    browserName: 'chromium',
    channel: 'chromium',
    launchOptions: { args: ['--enable-unsafe-webgpu'] },
    viewport: { width: 1200, height: 900 },
  },
  webServer: {
    command: 'npx vite --port 5199 --strictPort',
    url: 'http://localhost:5199',
    reuseExistingServer: true,
  },
});
