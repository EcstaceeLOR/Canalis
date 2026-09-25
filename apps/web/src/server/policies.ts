import { ApplicationError } from "@canalis/application";
import { PostgresPolicyRepository } from "@canalis/persistence";
import { getCanalisApplication } from "./canalis";

let repository: PostgresPolicyRepository | undefined;
let initialization: Promise<PostgresPolicyRepository> | undefined;

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

export async function getPolicyRepository(): Promise<PostgresPolicyRepository> {
  if (repository) return repository;
  if (!initialization) {
    initialization = (async () => {
      await getCanalisApplication();
      repository = new PostgresPolicyRepository(databaseUrl());
      return repository;
    })().catch((error) => {
      initialization = undefined;
      throw error;
    });
  }
  return initialization;
}

export async function resetPolicyRepositoryForTests(): Promise<void> {
  if (initialization) {
    try { await initialization; } catch { /* cleanup only */ }
  }
  if (repository) await repository.close();
  repository = undefined;
  initialization = undefined;
}
