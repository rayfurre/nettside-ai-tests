// ===================================================
// PLAYWRIGHT CONFIG: Nettside.ai E2E Testing
// VERSION: 1.0
// ===================================================

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  
  reporter: [
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['list']
  ],
  
  use: {
    baseURL: 'https://app.nettside.ai',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'nb-NO',
    timezoneId: 'Europe/Oslo',
  },

  timeout: 180000, // 3 min per test (generering tar ~2 min)
  expect: {
    timeout: 150000, // 2.5 min for assertions
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
