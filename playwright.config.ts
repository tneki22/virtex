import { defineConfig, devices } from "@playwright/test";

const e2ePort = Number(process.env.E2E_PORT ?? 5173);
const e2eBaseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${e2ePort}`;
const reuseExistingServer = process.env.E2E_REUSE_SERVER === undefined
  ? true
  : process.env.E2E_REUSE_SERVER === "true";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: e2eBaseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev:client -- --host 127.0.0.1 --port ${e2ePort}`,
    url: e2eBaseURL,
    reuseExistingServer,
    env: { VITE_USE_MOCKS: "true" },
    timeout: 120_000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "tablet", use: { ...devices["iPad Pro 11"], browserName: "chromium" } },
  ],
});
