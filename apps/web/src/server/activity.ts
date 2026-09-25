import { ApplicationError } from "@canalis/application";
import { PostgresActivityRepository } from "@canalis/persistence";
import { getCanalisApplication } from "./canalis";

let repository: PostgresActivityRepository | undefined;
let initialization: Promise<PostgresActivityRepository> | undefined;

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

export async function getActivityRepository(): Promise<PostgresActivityRepository> {
  if (repository) return repository;
  if (!initialization) {
    initialization = (async () => {
      await getCanalisApplication();
      repository = new PostgresActivityRepository(databaseUrl());
      return repository;
    })().catch((error) => {
      initialization = undefined;
      throw error;
    });
  }
  return initialization;
}

export async function resetActivityRepositoryForTests(): Promise<void> {
  if (initialization) {
    try { await initialization; } catch { /* cleanup only */ }
  }
  if (repository) await repository.close();
  repository = undefined;
  initialization = undefined;
}
