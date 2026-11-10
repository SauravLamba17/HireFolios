import { defineConfig } from "@playwright/test";

try {
  process.loadEnvFile();
} catch {
  // no .env file: use the real environment
}

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3000";

// Needs a running database with migrations + seed applied, and `npm run build` done.
export default defineConfig({
  testDir: "e2e",
  workers: 1,
  timeout: 90_000,
  use: {
    baseURL,
    channel: process.env.PW_CHANNEL || undefined, // chrome | msedge, else Playwright's own Chromium
    // A fake camera (moving test pattern) with permission already granted.
    launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
  },
  webServer: {
    command: "npm run start",
    url: `${baseURL}/login`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
