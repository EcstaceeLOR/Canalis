import { generateKeyPairSync, sign } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const baseUrl = process.env.PLAYWRIGHT_BASE_URL?.trim() || "https://canalis-sigma.vercel.app";
const outputDirectory = resolve("docs/assets");
const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function encodeBase58(bytes) {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) + BigInt(byte);

  let encoded = "";
  while (value > 0n) {
    encoded = alphabet[Number(value % 58n)] + encoded;
    value /= 58n;
  }

  let leadingZeroes = "";
  for (const byte of bytes) {
    if (byte !== 0) break;
    leadingZeroes += "1";
  }
  return leadingZeroes + encoded;
}

async function authenticate(context) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyDer = publicKey.export({ format: "der", type: "spki" });
  const walletAddress = encodeBase58(publicKeyDer.subarray(-32));
  const challengeResponse = await context.request.post(`${baseUrl}/api/auth/challenge`, {
    data: { walletAddress },
  });
  if (challengeResponse.status() !== 201) {
    throw new Error(`Challenge request failed with ${challengeResponse.status()}`);
  }

  const challenge = await challengeResponse.json();
  const signatureBase64 = sign(null, Buffer.from(challenge.message), privateKey).toString("base64");
  const sessionResponse = await context.request.post(`${baseUrl}/api/auth/session`, {
    data: { challengeId: challenge.challengeId, walletAddress, signatureBase64 },
  });
  if (sessionResponse.status() !== 201) {
    throw new Error(`Session request failed with ${sessionResponse.status()}`);
  }
}

async function navigate(page, url) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "commit", timeout: 60_000 });
      return;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
}

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
  });
  const page = await context.newPage();

  await navigate(page, baseUrl);
  await page.getByRole("heading", { level: 1 }).waitFor({ timeout: 60_000 });
  await page.screenshot({
    path: resolve(outputDirectory, "worldsfair-landing.png"),
    fullPage: true,
  });

  await authenticate(context);
  await navigate(page, `${baseUrl}/tasks/demo`);
  await page.getByRole("button", { name: /Run reference task/ }).click({ timeout: 60_000 });
  await page.getByRole("heading", { name: "Task complete" }).waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: "Inspect Search payment" }).click();
  await page.getByRole("region", { name: "Payment flow details" }).waitFor();
  await page.screenshot({
    path: resolve(outputDirectory, "worldsfair-payment-evidence.png"),
    fullPage: true,
  });

  await context.close();
  console.log(`Captured submission assets from ${baseUrl}.`);
} finally {
  await browser.close();
}
