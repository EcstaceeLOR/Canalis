import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL?.trim();
const baseURL = externalBaseUrl || "http://localhost:3000";
const hasVercelOidcToken = Boolean(process.env.VERCEL_OIDC_TOKEN?.trim());

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "test-results",
  // Keep runner/bootstrap overhead outside the product's explicit three-minute
  // judge-path budget, which the spec measures from the first navigation.
  timeout: 300_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    screenshot: "only-on-failure",
    // An authenticated preview trace could retain the short-lived protection
    // header. Keep trace evidence for ordinary runs, but never for OIDC runs.
    trace: hasVercelOidcToken ? "off" : "retain-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: "pnpm --filter @canalis/web start",
        url: `${baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
