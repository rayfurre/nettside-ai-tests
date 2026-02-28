// ===================================================
// PLAYWRIGHT CONFIG: Nettside.ai E2E Testing
// VERSION: 2.4 (timeout 900s for crash-proof test)
// ===================================================

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
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

  timeout: 900000, // 15 min per test (økt fra 12 min for å gi margin)
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
