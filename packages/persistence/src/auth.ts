import type {
  PersistedWalletChallenge,
  PersistedWalletSession,
  WalletAuthRepository,
} from "@canalis/application";
import postgres, { type Sql } from "postgres";

function big(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  return BigInt(String(value));
}

function mapChallenge(row: Record<string, unknown>): PersistedWalletChallenge {
  return {
    id: String(row.id),
    walletAddress: String(row.wallet_address),
    domain: String(row.domain),
    network: String(row.network),
    message: String(row.message),
    createdAtUnixSeconds: big(row.created_at_unix),
    expiresAtUnixSeconds: big(row.expires_at_unix),
    ...(row.used_at_unix !== null && row.used_at_unix !== undefined
      ? { usedAtUnixSeconds: big(row.used_at_unix) }
      : {}),
  };
}

function mapSession(row: Record<string, unknown>): PersistedWalletSession {
  return {
    tokenHash: String(row.token_hash),
    walletAddress: String(row.wallet_address),
    network: String(row.network),
    createdAtUnixSeconds: big(row.created_at_unix),
    expiresAtUnixSeconds: big(row.expires_at_unix),
    lastSeenAtUnixSeconds: big(row.last_seen_at_unix),
    ...(row.revoked_at_unix !== null && row.revoked_at_unix !== undefined
      ? { revokedAtUnixSeconds: big(row.revoked_at_unix) }
      : {}),
  };
}

export class PostgresWalletAuthRepository implements WalletAuthRepository {
  private readonly sql: Sql;

  constructor(databaseUrl: string) {
    if (!databaseUrl.trim()) throw new Error("databaseUrl is required");
    this.sql = postgres(databaseUrl, { max: 3, prepare: false });
  }

  async createChallenge(challenge: PersistedWalletChallenge): Promise<void> {
    await this.sql`
      INSERT INTO wallet_auth_challenges (
        id, wallet_address, domain, network, message,
        created_at_unix, expires_at_unix, used_at_unix
      ) VALUES (
        ${challenge.id}, ${challenge.walletAddress}, ${challenge.domain},
        ${challenge.network}, ${challenge.message},
        ${challenge.createdAtUnixSeconds.toString()},
        ${challenge.expiresAtUnixSeconds.toString()},
        ${challenge.usedAtUnixSeconds?.toString() ?? null}
      )
    `;
  }

  async getChallenge(challengeId: string): Promise<PersistedWalletChallenge | null> {
    const rows = await this.sql<Record<string, unknown>[]>`
      SELECT * FROM wallet_auth_challenges
      WHERE id = ${challengeId}
      LIMIT 1
    `;
    return rows[0] ? mapChallenge(rows[0]) : null;
  }

  async consumeChallenge(
    challengeId: string,
    walletAddress: string,
    usedAtUnixSeconds: bigint,
  ): Promise<boolean> {
    const rows = await this.sql<{ id: string }[]>`
      UPDATE wallet_auth_challenges
      SET used_at_unix = ${usedAtUnixSeconds.toString()}
      WHERE id = ${challengeId}
        AND wallet_address = ${walletAddress}
        AND used_at_unix IS NULL
        AND expires_at_unix >= ${usedAtUnixSeconds.toString()}
      RETURNING id
    `;
    return rows.length === 1;
  }

  async createSession(session: PersistedWalletSession): Promise<void> {
    await this.sql`
      INSERT INTO wallet_sessions (
        token_hash, wallet_address, network, created_at_unix,
        expires_at_unix, last_seen_at_unix, revoked_at_unix
      ) VALUES (
        ${session.tokenHash}, ${session.walletAddress}, ${session.network},
        ${session.createdAtUnixSeconds.toString()},
        ${session.expiresAtUnixSeconds.toString()},
        ${session.lastSeenAtUnixSeconds.toString()},
        ${session.revokedAtUnixSeconds?.toString() ?? null}
      )
    `;
  }

  async getSession(tokenHash: string): Promise<PersistedWalletSession | null> {
    const rows = await this.sql<Record<string, unknown>[]>`
      SELECT * FROM wallet_sessions
      WHERE token_hash = ${tokenHash}
      LIMIT 1
    `;
    return rows[0] ? mapSession(rows[0]) : null;
  }

  async touchSession(tokenHash: string, lastSeenAtUnixSeconds: bigint): Promise<void> {
    await this.sql`
      UPDATE wallet_sessions
      SET last_seen_at_unix = ${lastSeenAtUnixSeconds.toString()}
      WHERE token_hash = ${tokenHash} AND revoked_at_unix IS NULL
    `;
  }

  async revokeSession(tokenHash: string, revokedAtUnixSeconds: bigint): Promise<void> {
    await this.sql`
      UPDATE wallet_sessions
      SET revoked_at_unix = COALESCE(revoked_at_unix, ${revokedAtUnixSeconds.toString()})
      WHERE token_hash = ${tokenHash}
    `;
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
