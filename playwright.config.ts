import { defineConfig, devices } from '@playwright/test';

/**
 * UniteFix Admin Dashboard — Playwright E2E Test Configuration
 * 
 * Run: npx playwright test
 * UI:  npx playwright test --ui
 * Report: npx playwright show-report
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // Run sequentially — some tests depend on state
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],
  timeout: 30000,
  expect: {
    timeout: 10000,
  },
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Don't start dev server automatically — user should start it manually
  // webServer: {
  //   command: 'npm run dev',
  //   url: 'http://localhost:3000/api/health',
  //   reuseExistingServer: true,
  // },
});
