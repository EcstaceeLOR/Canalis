import { generateKeyPairSync, sign } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const VERCEL_OIDC_HEADER = "x-vercel-trusted-oidc-idp-token";

function deploymentRequestHeaders() {
  const token = process.env.VERCEL_OIDC_TOKEN?.trim();
  return token ? { [VERCEL_OIDC_HEADER]: token } : undefined;
}

async function authenticateProtectedPreview(page: Page) {
  const token = process.env.VERCEL_OIDC_TOKEN?.trim();
  const rawBaseUrl = process.env.PLAYWRIGHT_BASE_URL?.trim();
  if (!token || !rawBaseUrl) return;

  const origin = new URL(rawBaseUrl).origin;
  await page.route(`${origin}/**`, async (route) => {
    await route.continue({
      headers: {
        ...route.request().headers(),
        [VERCEL_OIDC_HEADER]: token,
      },
    });
  });
}

function encodeBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) + BigInt(byte);
  }
  let encoded = "";
  while (value > 0n) {
    encoded = BASE58_ALPHABET[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  let leadingZeroes = "";
  for (const byte of bytes) {
    if (byte !== 0) break;
    leadingZeroes += "1";
  }
  return leadingZeroes + encoded;
}

async function authenticateEphemeralWallet(page: Page): Promise<string> {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyDer = publicKey.export({ format: "der", type: "spki" });
  const walletAddress = encodeBase58(publicKeyDer.subarray(-32));

  const challengeResponse = await page.request.post("/api/auth/challenge", {
    data: { walletAddress },
    headers: deploymentRequestHeaders(),
  });
  expect(challengeResponse.status()).toBe(201);
  const challenge = (await challengeResponse.json()) as {
    challengeId: string;
    message: string;
  };
  const signatureBase64 = sign(null, Buffer.from(challenge.message), privateKey).toString("base64");

  const sessionResponse = await page.request.post("/api/auth/session", {
    data: {
      challengeId: challenge.challengeId,
      walletAddress,
      signatureBase64,
    },
    headers: deploymentRequestHeaders(),
  });
  expect(sessionResponse.status()).toBe(201);
  return walletAddress;
}

test("three-minute judge path persists, renders, and rejects policy violations", async ({ page }) => {
  await authenticateProtectedPreview(page);
  const healthResponse = await page.request.get("/api/health", { headers: deploymentRequestHeaders() });
  expect(healthResponse.status()).toBe(200);
  expect(await healthResponse.json()).toMatchObject({
    status: "ok",
    checks: { web: "ok", durableStorage: "connected" },
  });

  const judgePathStartedAt = Date.now();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Give the agent a budget");
  await expect(page.getByText("$1.00 USDC example", { exact: true })).toBeVisible();

  await authenticateEphemeralWallet(page);
  await page.goto("/tasks/demo");
  await expect(page.getByRole("heading", { name: "Reference task", exact: true })).toBeVisible();

  const budget = page.getByLabel("Task budget");
  const cap = page.getByLabel("Max per call");
  await expect(budget).toHaveValue("1.00");
  await expect(cap).toHaveValue("0.25");

  const createResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === "/api/tasks",
  );
  const executeResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && /\/api\/tasks\/[^/]+\/execute$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole("button", { name: /Run reference task/ }).click();
  const creation = await createResponse;
  expect(creation.status()).toBe(201);
  const execution = await executeResponse;
  expect(execution.ok()).toBeTruthy();
  const result = (await execution.json()) as { task: { id: string } };

  await expect(page.getByRole("heading", { name: "Task complete" })).toBeVisible();
  await expect(page.getByText("$0.20", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("$0.80", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Inspect Search payment" })).toContainText("$0.05");
  await expect(page.getByRole("button", { name: "Inspect Data payment" })).toContainText("$0.03");
  await expect(page.getByRole("button", { name: "Inspect Inference payment" })).toContainText("$0.12");

  await page.getByRole("button", { name: "Inspect Search payment" }).click();
  const details = page.getByRole("region", { name: "Payment flow details" });
  await expect(details).toContainText("Search");
  await expect(details).toContainText("$0.05");
  await expect(details).toContainText("canalis:");
  await expect(details.getByText("Response hash")).toBeVisible();

  const taskReadResponse = await page.request.get(`/api/tasks/${result.task.id}`, {
    headers: deploymentRequestHeaders(),
  });
  expect(taskReadResponse.ok()).toBeTruthy();
  expect(await taskReadResponse.json()).toMatchObject({
    task: { id: result.task.id },
    graph: { budgetAtomic: "1000000", spentAtomic: "200000", remainingAtomic: "800000" },
  });
  expect((await page.request.get("/api/tasks", { headers: deploymentRequestHeaders() })).ok()).toBeTruthy();

  await cap.fill("0.04");
  await page.getByRole("button", { name: /Run reference task/ }).click();
  await expect(page.getByText("PER_CALL_CAP_EXCEEDED", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("$0.03", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("$0.97", { exact: true }).first()).toBeVisible();
  expect(Date.now() - judgePathStartedAt, "judge journey should complete within three minutes").toBeLessThanOrEqual(
    180_000,
  );
});
