// ===================================================
// PLAYWRIGHT CONFIG: Nettside.ai E2E Testing
// VERSION: 2.2 (timeout 720s for betaling + Stripe)
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

  timeout: 720000, // 12 min per test (generering ~3 min + editor ~3 min + AI-bilde ~2 min + kladd-retry ~2 min + betaling ~1 min + margin)
  expect: {
    timeout: 150000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
