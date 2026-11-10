import { defineConfig } from "@playwright/test";

try {
  process.loadEnvFile();
} catch {
  // no .env file: use the real environment
}

// Needs a running database with migrations + seed applied, and `npm run build` done.
export default defineConfig({
  testDir: "e2e",
  workers: 1,
  use: {
    baseURL: "http://localhost:3000",
    channel: process.env.PW_CHANNEL || undefined, // chrome | msedge, else Playwright's own Chromium
  },
  webServer: {
    command: "npm run start",
    url: "http://localhost:3000/login",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
