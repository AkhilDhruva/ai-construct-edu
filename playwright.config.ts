import { defineConfig, devices } from '@playwright/test'

export const API_URL = 'http://localhost:8317'

// E2E runs against the production build so the service worker (offline mode) is real,
// plus a local API (mock model, dev auth, SQLite) for the API-mode journey.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:4317', trace: 'retain-on-failure', contextOptions: { reducedMotion: 'reduce' } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run preview',
      url: 'http://localhost:4317',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'uv run --directory api uvicorn mantle_api.main:app_factory --factory --port 8317',
      url: `${API_URL}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        MANTLE_ENV: 'test',
        MANTLE_DATABASE_URL: 'sqlite:///./e2e.db',
        MANTLE_MODEL_MODE: 'mock',
        MANTLE_AUTH_MODE: 'dev',
      },
    },
  ],
})
