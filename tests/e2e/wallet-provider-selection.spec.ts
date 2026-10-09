import { expect, test } from "@playwright/test";

test("uses the registered MetaMask extension provider", async ({ page }) => {
  const oidcToken = process.env.VERCEL_OIDC_TOKEN?.trim();
  if (oidcToken) {
    await page.setExtraHTTPHeaders({ "x-vercel-trusted-oidc-idp-token": oidcToken });
  }

  await page.route("**/api/auth/session", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/auth/challenge", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ error: { message: "Fixture stops after provider selection." } }),
  }));

  await page.addInitScript(() => {
    type TestWindow = Window & { __canalisInjectedConnectCalls: number };
    const testWindow = window as TestWindow;
    testWindow.__canalisInjectedConnectCalls = 0;

    const account = {
      address: "11111111111111111111111111111111",
      publicKey: new Uint8Array(32),
      chains: ["solana:devnet"],
      features: ["solana:signMessage"],
    };
    const wallet = {
      version: "1.0.0",
      name: "MetaMask",
      icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",
      chains: ["solana:devnet"],
      accounts: [],
      features: {
        "standard:connect": {
          version: "1.0.0",
          connect: async () => {
            testWindow.__canalisInjectedConnectCalls += 1;
            return { accounts: [account] };
          },
        },
        "solana:signMessage": {
          version: "1.0.0",
          signMessage: async (...inputs: Array<{ message: Uint8Array }>) => inputs.map(({ message }) => ({
            signedMessage: message,
            signature: new Uint8Array(64),
          })),
        },
      },
    };

    window.addEventListener("wallet-standard:app-ready", (event) => {
      const detail = (event as CustomEvent<{
        register: (...wallets: unknown[]) => unknown;
      }>).detail;
      detail.register(wallet);
    });
  });

  await page.goto("/onboarding", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Connect wallet" }).click();
  const dialog = page.getByRole("dialog", { name: "Connect a Solana wallet" });
  await expect(dialog.getByRole("button", { name: /MetaMask/ })).toHaveCount(1);
  await dialog.getByRole("button", { name: /MetaMask/ }).click();

  await expect.poll(() => page.evaluate(() => (
    window as Window & { __canalisInjectedConnectCalls: number }
  ).__canalisInjectedConnectCalls)).toBe(1);
});
