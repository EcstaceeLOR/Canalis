import { describe, expect, it } from "vitest";
import {
  WalletAuthService,
  type PersistedWalletChallenge,
  type PersistedWalletSession,
  type WalletAuthRepository,
} from "../src/index.js";

const WALLET = "11111111111111111111111111111111";
const DOMAIN = "canalis.example";

class MemoryAuthRepository implements WalletAuthRepository {
  challenges = new Map<string, PersistedWalletChallenge>();
  sessions = new Map<string, PersistedWalletSession>();

  async createChallenge(challenge: PersistedWalletChallenge) {
    this.challenges.set(challenge.id, challenge);
  }
  async getChallenge(challengeId: string) {
    return this.challenges.get(challengeId) ?? null;
  }
  async consumeChallenge(challengeId: string, walletAddress: string, usedAtUnixSeconds: bigint) {
    const challenge = this.challenges.get(challengeId);
    if (!challenge || challenge.walletAddress !== walletAddress || challenge.usedAtUnixSeconds !== undefined) return false;
    this.challenges.set(challengeId, { ...challenge, usedAtUnixSeconds });
    return true;
  }
  async createSession(session: PersistedWalletSession) {
    this.sessions.set(session.tokenHash, session);
  }
  async getSession(tokenHash: string) {
    return this.sessions.get(tokenHash) ?? null;
  }
  async touchSession(tokenHash: string, lastSeenAtUnixSeconds: bigint) {
    const session = this.sessions.get(tokenHash);
    if (session) this.sessions.set(tokenHash, { ...session, lastSeenAtUnixSeconds });
  }
  async revokeSession(tokenHash: string, revokedAtUnixSeconds: bigint) {
    const session = this.sessions.get(tokenHash);
    if (session) this.sessions.set(tokenHash, { ...session, revokedAtUnixSeconds });
  }
}

describe("WalletAuthService", () => {
  it("creates a domain-bound one-time challenge and a hashed session", async () => {
    const repository = new MemoryAuthRepository();
    let now = 1_800_000_000n;
    const service = new WalletAuthService(
      repository,
      () => now,
      async (_message, wallet, signature) => wallet === WALLET && signature === "valid-signature",
    );

    const challenge = await service.createChallenge(WALLET, DOMAIN);
    expect(challenge.message).toContain(`Domain: ${DOMAIN}`);
    expect(challenge.message).toContain(`Wallet: ${WALLET}`);
    expect(challenge.message).toContain("Network: solana:devnet");
    expect(challenge.message).toContain("cannot submit a transaction or move funds");

    const created = await service.createSession({
      challengeId: challenge.challengeId,
      walletAddress: WALLET,
      signatureBase64: "valid-signature",
      domain: DOMAIN,
    });
    expect(created.identity.walletAddress).toBe(WALLET);
    expect(created.identity.network).toBe("solana:devnet");
    const stored = [...repository.sessions.values()][0]!;
    expect(stored.tokenHash).not.toBe(created.token);
    expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/);

    now += 30n;
    const identity = await service.authenticate(created.token);
    expect(identity.walletAddress).toBe(WALLET);
    expect([...repository.sessions.values()][0]!.lastSeenAtUnixSeconds).toBe(now);
  });

  it("rejects challenge redemption on a different host", async () => {
    const repository = new MemoryAuthRepository();
    const service = new WalletAuthService(repository, () => 1_800_000_000n, async () => true);
    const challenge = await service.createChallenge(WALLET, DOMAIN);
    await expect(service.createSession({
      challengeId: challenge.challengeId,
      walletAddress: WALLET,
      signatureBase64: "valid-signature",
      domain: "preview.canalis.example",
    })).rejects.toMatchObject({ code: "AUTH_SIGNATURE_INVALID" });
    expect(repository.sessions.size).toBe(0);
  });

  it("rejects replayed challenges and expired sessions", async () => {
    const repository = new MemoryAuthRepository();
    let now = 1_800_000_000n;
    const service = new WalletAuthService(repository, () => now, async () => true);
    const challenge = await service.createChallenge(WALLET, DOMAIN);
    const created = await service.createSession({
      challengeId: challenge.challengeId,
      walletAddress: WALLET,
      signatureBase64: "valid-signature",
      domain: DOMAIN,
    });

    await expect(service.createSession({
      challengeId: challenge.challengeId,
      walletAddress: WALLET,
      signatureBase64: "valid-signature",
      domain: DOMAIN,
    })).rejects.toMatchObject({ code: "AUTH_CHALLENGE_USED" });

    now += 24n * 60n * 60n + 1n;
    await expect(service.authenticate(created.token)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("rejects expired challenges before creating a session", async () => {
    const repository = new MemoryAuthRepository();
    let now = 1_800_000_000n;
    const service = new WalletAuthService(repository, () => now, async () => true);
    const challenge = await service.createChallenge(WALLET, DOMAIN);
    now += 5n * 60n + 1n;
    await expect(service.createSession({
      challengeId: challenge.challengeId,
      walletAddress: WALLET,
      signatureBase64: "valid-signature",
      domain: DOMAIN,
    })).rejects.toMatchObject({ code: "AUTH_CHALLENGE_EXPIRED" });
    expect(repository.sessions.size).toBe(0);
  });
});
