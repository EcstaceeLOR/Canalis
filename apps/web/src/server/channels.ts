import { ApplicationError } from "@canalis/application";
import { PostgresChannelWorkspaceRepository } from "@canalis/persistence";
import { getCanalisApplication } from "./canalis";

let repository: PostgresChannelWorkspaceRepository | undefined;
let initialization: Promise<PostgresChannelWorkspaceRepository> | undefined;

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

export async function getChannelWorkspaceRepository(): Promise<PostgresChannelWorkspaceRepository> {
  if (repository) return repository;
  if (!initialization) {
    initialization = (async () => {
      await getCanalisApplication();
      repository = new PostgresChannelWorkspaceRepository(databaseUrl());
      return repository;
    })().catch((error) => {
      initialization = undefined;
      throw error;
    });
  }
  return initialization;
}

export async function resetChannelWorkspaceForTests(): Promise<void> {
  if (initialization) {
    try { await initialization; } catch { /* ignored during cleanup */ }
  }
  if (repository) await repository.close();
  repository = undefined;
  initialization = undefined;
}
