import { ApplicationError } from "@canalis/application";
import { PostgresProviderRegistryRepository } from "@canalis/persistence";
import { getCanalisApplication } from "./canalis";

let repository: PostgresProviderRegistryRepository | undefined;
let initialization: Promise<PostgresProviderRegistryRepository> | undefined;

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

export async function getProviderRegistryRepository(): Promise<PostgresProviderRegistryRepository> {
  if (repository) return repository;
  if (!initialization) {
    initialization = (async () => {
      await getCanalisApplication();
      repository = new PostgresProviderRegistryRepository(databaseUrl());
      return repository;
    })().catch((error) => {
      initialization = undefined;
      throw error;
    });
  }
  return initialization;
}

export async function resetProviderRegistryForTests(): Promise<void> {
  if (initialization) {
    try {
      await initialization;
    } catch {
      // Ignore initialization failures during test cleanup.
    }
  }
  if (repository) await repository.close();
  repository = undefined;
  initialization = undefined;
}
