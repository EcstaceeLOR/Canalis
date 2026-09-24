import {
  ApplicationError,
  WalletAuthService,
  type WalletSessionIdentity,
} from "@canalis/application";
import { PostgresWalletAuthRepository } from "@canalis/persistence";
import { getCanalisApplication } from "./canalis";

export const CANALIS_SESSION_COOKIE = "canalis_session";

let authRepository: PostgresWalletAuthRepository | undefined;
let authService: WalletAuthService | undefined;
let authInitialization: Promise<WalletAuthService> | undefined;

function databaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) {
    throw new ApplicationError(
      "STORAGE_NOT_CONFIGURED",
      "Canalis durable storage is not configured. Set DATABASE_URL to a Postgres connection string.",
      503,
    );
  }
  return value;
}

export async function getWalletAuthService(): Promise<WalletAuthService> {
  if (authService) return authService;
  if (!authInitialization) {
    authInitialization = (async () => {
      // Reuse the canonical application initialization so all migrations are applied first.
      await getCanalisApplication();
      authRepository = new PostgresWalletAuthRepository(databaseUrl());
      authService = new WalletAuthService(authRepository);
      return authService;
    })().catch((error) => {
      authInitialization = undefined;
      throw error;
    });
  }
  return authInitialization;
}

export function sessionTokenFromRequest(request: Request): string | undefined {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return undefined;
  for (const entry of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = entry.trim().split("=");
    if (rawName === CANALIS_SESSION_COOKIE) {
      return decodeURIComponent(rawValue.join("="));
    }
  }
  return undefined;
}

export async function requireWalletSession(request: Request): Promise<WalletSessionIdentity> {
  const service = await getWalletAuthService();
  return service.authenticate(sessionTokenFromRequest(request));
}

export async function revokeWalletSession(request: Request): Promise<void> {
  const service = await getWalletAuthService();
  await service.revoke(sessionTokenFromRequest(request));
}

export function assertWalletOwnsTask(
  task: { task: { owner: string } },
  identity: WalletSessionIdentity,
): void {
  if (task.task.owner !== identity.walletAddress) {
    throw new ApplicationError(
      "FORBIDDEN",
      "This task belongs to a different wallet.",
      403,
    );
  }
}

export async function resetWalletAuthForTests(): Promise<void> {
  if (authInitialization) {
    try {
      await authInitialization;
    } catch {
      // Ignore failed initialization during test cleanup.
    }
  }
  if (authRepository) await authRepository.close();
  authRepository = undefined;
  authService = undefined;
  authInitialization = undefined;
}
