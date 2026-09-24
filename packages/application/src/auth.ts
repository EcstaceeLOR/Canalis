import { createHash, randomBytes, randomUUID, webcrypto } from "node:crypto";
import { ApplicationError } from "./errors.js";

export const CANALIS_AUTH_NETWORK = "solana:devnet";
export const WALLET_CHALLENGE_TTL_SECONDS = 5n * 60n;
export const WALLET_SESSION_TTL_SECONDS = 24n * 60n * 60n;

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export type PersistedWalletChallenge = {
  id: string;
  walletAddress: string;
  domain: string;
  network: string;
  message: string;
  createdAtUnixSeconds: bigint;
  expiresAtUnixSeconds: bigint;
  usedAtUnixSeconds?: bigint;
};

export type PersistedWalletSession = {
  tokenHash: string;
  walletAddress: string;
  network: string;
  createdAtUnixSeconds: bigint;
  expiresAtUnixSeconds: bigint;
  lastSeenAtUnixSeconds: bigint;
  revokedAtUnixSeconds?: bigint;
};

export type WalletSessionIdentity = {
  walletAddress: string;
  network: string;
  expiresAtUnixSeconds: string;
};

export interface WalletAuthRepository {
  createChallenge(challenge: PersistedWalletChallenge): Promise<void>;
  getChallenge(challengeId: string): Promise<PersistedWalletChallenge | null>;
  consumeChallenge(
    challengeId: string,
    walletAddress: string,
    usedAtUnixSeconds: bigint,
  ): Promise<boolean>;
  createSession(session: PersistedWalletSession): Promise<void>;
  getSession(tokenHash: string): Promise<PersistedWalletSession | null>;
  touchSession(tokenHash: string, lastSeenAtUnixSeconds: bigint): Promise<void>;
  revokeSession(tokenHash: string, revokedAtUnixSeconds: bigint): Promise<void>;
  close?(): Promise<void>;
}

export type WalletSignatureVerifier = (
  message: string,
  walletAddress: string,
  signatureBase64: string,
) => Promise<boolean>;

function decodeBase58(value: string): Uint8Array {
  if (!value) return new Uint8Array();
  const bytes = [0];

  for (const char of value) {
    const digit = BASE58_ALPHABET.indexOf(char);
    if (digit < 0) throw new Error("Invalid base58 character");
    let carry = digit;
    for (let index = 0; index < bytes.length; index += 1) {
      carry += bytes[index]! * 58;
      bytes[index] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  for (let index = 0; index < value.length - 1 && value[index] === "1"; index += 1) {
    bytes.push(0);
  }

  return Uint8Array.from(bytes.reverse());
}

export function normalizeWalletAddress(value: unknown): string {
  if (typeof value !== "string") {
    throw new ApplicationError("VALIDATION_ERROR", "Wallet address is required.", 400);
  }
  const normalized = value.trim();
  try {
    if (decodeBase58(normalized).length !== 32) throw new Error("invalid length");
  } catch {
    throw new ApplicationError("VALIDATION_ERROR", "Wallet address is not a valid Solana address.", 400);
  }
  return normalized;
}

function normalizeDomain(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.length > 255 || /[\r\n]/.test(normalized)) {
    throw new ApplicationError("VALIDATION_ERROR", "Authentication domain is invalid.", 400);
  }
  return normalized;
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function verifySolanaMessageSignature(
  message: string,
  walletAddress: string,
  signatureBase64: string,
): Promise<boolean> {
  try {
    const publicKeyBytes = decodeBase58(walletAddress);
    const signatureBytes = new Uint8Array(Buffer.from(signatureBase64, "base64"));
    if (publicKeyBytes.length !== 32 || signatureBytes.length !== 64) return false;
    const key = await webcrypto.subtle.importKey(
      "raw",
      publicKeyBytes,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return webcrypto.subtle.verify(
      { name: "Ed25519" },
      key,
      signatureBytes,
      new TextEncoder().encode(message),
    );
  } catch {
    return false;
  }
}

export class WalletAuthService {
  constructor(
    private readonly repository: WalletAuthRepository,
    private readonly nowUnixSeconds: () => bigint = () => BigInt(Math.floor(Date.now() / 1000)),
    private readonly verifySignature: WalletSignatureVerifier = verifySolanaMessageSignature,
  ) {}

  async createChallenge(walletAddressInput: unknown, domainInput: string) {
    const walletAddress = normalizeWalletAddress(walletAddressInput);
    const domain = normalizeDomain(domainInput);
    const now = this.nowUnixSeconds();
    const expiresAt = now + WALLET_CHALLENGE_TTL_SECONDS;
    const nonce = randomBytes(24).toString("base64url");
    const id = `challenge_${randomUUID()}`;
    const issuedIso = new Date(Number(now) * 1000).toISOString();
    const expiresIso = new Date(Number(expiresAt) * 1000).toISOString();
    const message = [
      "Canalis wallet authentication",
      "",
      `Domain: ${domain}`,
      `Wallet: ${walletAddress}`,
      `Network: ${CANALIS_AUTH_NETWORK}`,
      `Nonce: ${nonce}`,
      `Issued at: ${issuedIso}`,
      `Expires at: ${expiresIso}`,
      "",
      "Purpose: authenticate to Canalis. This signature cannot submit a transaction or move funds.",
    ].join("\n");

    const challenge: PersistedWalletChallenge = {
      id,
      walletAddress,
      domain,
      network: CANALIS_AUTH_NETWORK,
      message,
      createdAtUnixSeconds: now,
      expiresAtUnixSeconds: expiresAt,
    };
    await this.repository.createChallenge(challenge);
    return {
      challengeId: id,
      walletAddress,
      network: CANALIS_AUTH_NETWORK,
      message,
      expiresAtUnixSeconds: expiresAt.toString(),
    };
  }

  async createSession(input: {
    challengeId: unknown;
    walletAddress: unknown;
    signatureBase64: unknown;
  }): Promise<{ token: string; identity: WalletSessionIdentity }> {
    const challengeId = typeof input.challengeId === "string" ? input.challengeId.trim() : "";
    const walletAddress = normalizeWalletAddress(input.walletAddress);
    const signatureBase64 = typeof input.signatureBase64 === "string" ? input.signatureBase64.trim() : "";
    if (!challengeId || !signatureBase64) {
      throw new ApplicationError("VALIDATION_ERROR", "Challenge and wallet signature are required.", 400);
    }

    const challenge = await this.repository.getChallenge(challengeId);
    if (!challenge) {
      throw new ApplicationError("AUTH_CHALLENGE_NOT_FOUND", "Authentication challenge was not found.", 404);
    }
    const now = this.nowUnixSeconds();
    if (challenge.usedAtUnixSeconds !== undefined) {
      throw new ApplicationError("AUTH_CHALLENGE_USED", "Authentication challenge has already been used.", 409);
    }
    if (challenge.expiresAtUnixSeconds < now) {
      throw new ApplicationError("AUTH_CHALLENGE_EXPIRED", "Authentication challenge has expired.", 401);
    }
    if (challenge.walletAddress !== walletAddress) {
      throw new ApplicationError("AUTH_WALLET_MISMATCH", "The signed wallet does not match the challenge.", 401);
    }

    const valid = await this.verifySignature(challenge.message, walletAddress, signatureBase64);
    if (!valid) {
      throw new ApplicationError("AUTH_SIGNATURE_INVALID", "Wallet signature could not be verified.", 401);
    }

    const consumed = await this.repository.consumeChallenge(challenge.id, walletAddress, now);
    if (!consumed) {
      throw new ApplicationError("AUTH_CHALLENGE_USED", "Authentication challenge has already been used.", 409);
    }

    const token = randomBytes(32).toString("base64url");
    const expiresAtUnixSeconds = now + WALLET_SESSION_TTL_SECONDS;
    await this.repository.createSession({
      tokenHash: hashSessionToken(token),
      walletAddress,
      network: challenge.network,
      createdAtUnixSeconds: now,
      expiresAtUnixSeconds,
      lastSeenAtUnixSeconds: now,
    });

    return {
      token,
      identity: {
        walletAddress,
        network: challenge.network,
        expiresAtUnixSeconds: expiresAtUnixSeconds.toString(),
      },
    };
  }

  async authenticate(tokenInput: string | undefined): Promise<WalletSessionIdentity> {
    const token = tokenInput?.trim();
    if (!token) {
      throw new ApplicationError("AUTH_REQUIRED", "Connect and sign in with a wallet to continue.", 401);
    }
    const tokenHash = hashSessionToken(token);
    const session = await this.repository.getSession(tokenHash);
    const now = this.nowUnixSeconds();
    if (!session || session.revokedAtUnixSeconds !== undefined || session.expiresAtUnixSeconds <= now) {
      if (session && session.revokedAtUnixSeconds === undefined) {
        await this.repository.revokeSession(tokenHash, now);
      }
      throw new ApplicationError("AUTH_REQUIRED", "Your wallet session has expired. Sign in again.", 401);
    }
    await this.repository.touchSession(tokenHash, now);
    return {
      walletAddress: session.walletAddress,
      network: session.network,
      expiresAtUnixSeconds: session.expiresAtUnixSeconds.toString(),
    };
  }

  async revoke(tokenInput: string | undefined): Promise<void> {
    const token = tokenInput?.trim();
    if (!token) return;
    await this.repository.revokeSession(hashSessionToken(token), this.nowUnixSeconds());
  }
}
