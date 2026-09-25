import { ApplicationError } from "@canalis/application";
import { PostgresTaskWorkspaceRepository } from "@canalis/persistence";
import { getCanalisApplication } from "./canalis";

let repository: PostgresTaskWorkspaceRepository | undefined;
let initialization: Promise<PostgresTaskWorkspaceRepository> | undefined;

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

export async function getTaskWorkspaceRepository(): Promise<PostgresTaskWorkspaceRepository> {
  if (repository) return repository;
  if (!initialization) {
    initialization = (async () => {
      await getCanalisApplication();
      repository = new PostgresTaskWorkspaceRepository(databaseUrl());
      return repository;
    })().catch((error) => {
      initialization = undefined;
      throw error;
    });
  }
  return initialization;
}

export async function resetTaskWorkspaceForTests(): Promise<void> {
  if (initialization) {
    try {
      await initialization;
    } catch {
      // Ignore failed initialization during cleanup.
    }
  }
  if (repository) await repository.close();
  repository = undefined;
  initialization = undefined;
}
