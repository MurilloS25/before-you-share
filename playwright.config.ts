import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests run against the production build served by `vite preview` (which sends the real
 * security headers). They use the Microsoft Edge that is already installed (channel 'msedge'), so no
 * browser is downloaded. Set E2E_CHANNEL= (empty) to use Playwright's own Chromium if installed.
 */
const channel = process.env.E2E_CHANNEL ?? 'msedge';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    channel: channel || undefined,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
