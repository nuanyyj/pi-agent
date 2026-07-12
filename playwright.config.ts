import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

export default defineConfig({
  testDir: "./test/enterprise/browser",
  snapshotPathTemplate: "{testDir}/{testFileDir}/{testFileName}-snapshots/{arg}-{projectName}{ext}",
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:30141",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:30141",
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      PI_CODING_AGENT_DIR: resolve("test/enterprise/fixtures/pi-agent"),
      PI_DEPLOYMENT_MODE: "local",
    },
  },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
