import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.e2e.ts',
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:5173',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'ipad',
      // Keep iPad viewport/touch emulation while using Chromium so CDP-based touch helpers work.
      use: { ...devices['iPad Pro 11'], browserName: 'chromium' },
    },
  ],
  webServer: {
    command: 'pnpm --filter fieldnotes-demo dev',
    port: 5173,
    reuseExistingServer: true,
    cwd: '../../',
  },
});
