import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  ApplicationError,
  networkMatches,
  type JsonObject,
  type ProviderHealthResult,
  type ProviderRegistryRecord,
} from "@canalis/application";
import { parseMppChallengeHeader } from "@canalis/providers";
import { CANALIS_DEVNET_SANDBOX_MINT } from "@canalis/solana";

export type ProviderHealthCredential = {
  kind: "bearer" | "api-key";
  secret: string;
  headerName?: string;
};

function privateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function privateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.")
  );
}

function privateAddress(address: string): boolean {
  const version = isIP(address);
  return version === 4 ? privateIpv4(address) : version === 6 ? privateIpv6(address) : true;
}

async function assertSafeProviderEndpoint(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ApplicationError("PROVIDER_ENDPOINT_INVALID", "Provider endpoint is not a valid URL.", 400);
  }
  const localDevelopment =
    process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(localDevelopment && url.protocol === "http:")) {
    throw new ApplicationError(
      "PROVIDER_ENDPOINT_INSECURE",
      "Provider endpoints must use HTTPS. HTTP is allowed only for localhost development.",
      400,
    );
  }
  if (url.username || url.password) {
    throw new ApplicationError(
      "PROVIDER_ENDPOINT_INVALID",
      "Provider endpoint URLs must not contain embedded credentials.",
      400,
    );
  }
  if (!localDevelopment) {
    const resolved = await lookup(url.hostname, { all: true, verbatim: true });
    if (resolved.length === 0 || resolved.some((entry) => privateAddress(entry.address))) {
      throw new ApplicationError(
        "PROVIDER_ENDPOINT_BLOCKED",
        "Provider endpoint resolves to a private or reserved network address.",
        400,
      );
    }
  }
  return url;
}

function credentialHeaders(credential?: ProviderHealthCredential): Headers {
  const headers = new Headers({ accept: "application/json, text/plain;q=0.8, */*;q=0.5" });
  if (!credential) return headers;
  if (credential.kind === "bearer") {
    headers.set("authorization", `Bearer ${credential.secret}`);
  } else {
    headers.set(credential.headerName ?? "x-api-key", credential.secret);
  }
  return headers;
}

function parseX402Challenge(response: Response): JsonObject {
  const encoded = response.headers.get("payment-required");
  if (!encoded) {
    throw new ApplicationError(
      "X402_CHALLENGE_MISSING",
      "The x402 endpoint returned 402 without a PAYMENT-REQUIRED header.",
      502,
    );
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("challenge is not an object");
    const value = parsed as Record<string, unknown>;
    const accepts = Array.isArray(value.accepts) ? value.accepts : [];
    if (accepts.length === 0) throw new Error("challenge has no payment requirements");
    const first = accepts[0];
    if (!first || typeof first !== "object" || Array.isArray(first)) throw new Error("invalid payment requirement");
    const requirement = first as Record<string, unknown>;
    for (const field of ["scheme", "network", "asset", "amount", "payTo"]) {
      if (typeof requirement[field] !== "string" || !requirement[field]) throw new Error(`missing ${field}`);
    }
    return {
      x402Version: typeof value.x402Version === "number" ? value.x402Version : String(value.x402Version ?? "unknown"),
      scheme: String(requirement.scheme),
      network: String(requirement.network),
      asset: String(requirement.asset),
      amount: String(requirement.amount),
      payTo: String(requirement.payTo),
    };
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError(
      "X402_CHALLENGE_INVALID",
      `The endpoint returned an invalid x402 challenge: ${error instanceof Error ? error.message : "decode failed"}.`,
      502,
    );
  }
}

function sameNetwork(configured: string, advertised: string): boolean {
  if (configured === advertised) return true;
  if (networkMatches("devnet", advertised)) return networkMatches("devnet", configured);
  if (networkMatches("mainnet-beta", advertised)) return networkMatches("mainnet-beta", configured);
  if (networkMatches("localnet", advertised)) return networkMatches("localnet", configured);
  return false;
}

function sameAsset(configured: string, advertised: string): boolean {
  if (configured === advertised || configured.toUpperCase() === advertised.toUpperCase()) return true;
  return configured.toUpperCase() === "USDC" && advertised === CANALIS_DEVNET_SANDBOX_MINT;
}

function assertConstraints(provider: ProviderRegistryRecord, metadata: JsonObject): void {
  const network = typeof metadata.network === "string" ? metadata.network : undefined;
  const asset = typeof metadata.asset === "string" ? metadata.asset : undefined;
  if (network && provider.supportedNetworks.length > 0 && !provider.supportedNetworks.some((value) => sameNetwork(value, network))) {
    throw new ApplicationError(
      "PROVIDER_NETWORK_MISMATCH",
      `Endpoint advertises network ${network}, which is not in this provider's supported network list.`,
      409,
    );
  }
  if (asset && provider.supportedAssets.length > 0 && !provider.supportedAssets.some((value) => sameAsset(value, asset))) {
    throw new ApplicationError(
      "PROVIDER_ASSET_MISMATCH",
      `Endpoint advertises asset ${asset}, which is not in this provider's supported asset list.`,
      409,
    );
  }
}

export async function verifyProviderHealth(
  provider: ProviderRegistryRecord,
  credential?: ProviderHealthCredential,
): Promise<ProviderHealthResult> {
  const checkedAtUnixSeconds = String(Math.floor(Date.now() / 1000));
  const started = performance.now();
  if (provider.protocol === "demo" && !provider.endpoint) {
    return {
      status: "healthy",
      checkedAtUnixSeconds,
      latencyMs: 0,
      message: "Built-in deterministic provider is available in-process.",
      protocolMetadata: { runtime: "in-process" },
    };
  }
  if (!provider.endpoint) {
    return {
      status: "unhealthy",
      checkedAtUnixSeconds,
      latencyMs: 0,
      code: "PROVIDER_ENDPOINT_MISSING",
      message: "Provider does not have an endpoint configured.",
    };
  }

  try {
    const url = await assertSafeProviderEndpoint(provider.endpoint);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: credentialHeaders(credential),
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    let protocolMetadata: JsonObject = { httpStatus: response.status };
    if (provider.protocol === "x402") {
      if (response.status !== 402) {
        throw new ApplicationError(
          "X402_EXPECTED_PAYMENT_REQUIRED",
          `Expected an x402 402 challenge, received HTTP ${response.status}.`,
          502,
        );
      }
      protocolMetadata = { ...protocolMetadata, ...parseX402Challenge(response) };
      assertConstraints(provider, protocolMetadata);
    } else if (provider.protocol === "mpp") {
      if (response.status !== 402) {
        throw new ApplicationError(
          "MPP_EXPECTED_PAYMENT_REQUIRED",
          `Expected an MPP 402 challenge, received HTTP ${response.status}.`,
          502,
        );
      }
      const challengeHeader = response.headers.get("www-authenticate");
      if (!challengeHeader) {
        throw new ApplicationError(
          "MPP_CHALLENGE_MISSING",
          "The MPP endpoint returned 402 without WWW-Authenticate.",
          502,
        );
      }
      const challenge = parseMppChallengeHeader(challengeHeader);
      protocolMetadata = {
        ...protocolMetadata,
        challengeId: challenge.id,
        method: challenge.method,
        intent: challenge.intent,
        realm: challenge.realm,
        ...(typeof challenge.request.currency === "string" ? { asset: challenge.request.currency } : {}),
      };
      assertConstraints(provider, protocolMetadata);
    } else if (!response.ok) {
      throw new ApplicationError(
        "PROVIDER_HTTP_UNHEALTHY",
        `Provider returned HTTP ${response.status}.`,
        502,
      );
    }

    return {
      status: "healthy",
      checkedAtUnixSeconds,
      latencyMs: Math.max(0, Math.round(performance.now() - started)),
      message: `${provider.protocol.toUpperCase()} endpoint verified successfully.`,
      protocolMetadata,
    };
  } catch (error) {
    const code = error instanceof ApplicationError ? error.code : error instanceof Error && error.name === "AbortError" ? "PROVIDER_HEALTH_TIMEOUT" : "PROVIDER_HEALTH_FAILED";
    const message = error instanceof Error ? error.message : "Provider health verification failed.";
    return {
      status: "unhealthy",
      checkedAtUnixSeconds,
      latencyMs: Math.max(0, Math.round(performance.now() - started)),
      code,
      message,
    };
  }
}
