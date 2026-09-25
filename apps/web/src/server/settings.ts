import { ApplicationError } from "@canalis/application";
import { PostgresSettingsRepository } from "@canalis/persistence";
import { getCanalisApplication } from "./canalis";

let repository: PostgresSettingsRepository | undefined;
let initialization: Promise<PostgresSettingsRepository> | undefined;

function databaseUrl() {
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

export async function getSettingsRepository(): Promise<PostgresSettingsRepository> {
  if (repository) return repository;
  if (!initialization) {
    initialization = (async () => {
      await getCanalisApplication();
      repository = new PostgresSettingsRepository(databaseUrl());
      return repository;
    })().catch((error) => {
      initialization = undefined;
      throw error;
    });
  }
  return initialization;
}

export async function resetSettingsForTests(): Promise<void> {
  if (initialization) {
    try { await initialization; } catch { /* ignore failed init */ }
  }
  if (repository) await repository.close();
  repository = undefined;
  initialization = undefined;
}
