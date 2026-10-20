import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.e2e.ts',
  outputDir: '../test-results',
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:4321',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
    // Chromium keeps the CDP touch helpers working under iPad and phone emulation.
    { name: 'ipad', use: { ...devices['iPad Pro 11'], browserName: 'chromium' } },
    {
      name: 'phone',
      use: {
        browserName: 'chromium',
        viewport: { width: 360, height: 740 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: 'pnpm --filter fieldnotes-website build && pnpm --filter fieldnotes-website preview',
    port: 4321,
    reuseExistingServer: !process.env.CI,
    cwd: '../../',
    timeout: 180000,
  },
});
