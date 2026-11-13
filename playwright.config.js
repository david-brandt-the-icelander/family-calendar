// The browser tests (test/ui/). scripts/ci-test.sh starts `wrangler dev` on :8801 with the stand-in
// sign-in and a fresh local database before running them.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'test/ui',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:8801', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
