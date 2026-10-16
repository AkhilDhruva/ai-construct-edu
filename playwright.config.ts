import { defineConfig, devices } from '@playwright/test'

// E2E runs against the production build so the service worker (offline mode)
// is real, not a dev-server approximation.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:4317', trace: 'retain-on-failure', contextOptions: { reducedMotion: 'reduce' } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4317',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
