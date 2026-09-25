import { ApplicationError } from "@canalis/application";
import { PostgresTransactionRepository } from "@canalis/persistence";
import { getCanalisApplication } from "./canalis";

let repository: PostgresTransactionRepository | undefined;
let initialization: Promise<PostgresTransactionRepository> | undefined;

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

export async function getTransactionRepository(): Promise<PostgresTransactionRepository> {
  if (repository) return repository;
  if (!initialization) {
    initialization = (async () => {
      await getCanalisApplication();
      repository = new PostgresTransactionRepository(databaseUrl());
      return repository;
    })().catch((error) => {
      initialization = undefined;
      throw error;
    });
  }
  return initialization;
}

export async function resetTransactionsForTests(): Promise<void> {
  if (initialization) {
    try {
      await initialization;
    } catch {
      // Ignore initialization failures during cleanup.
    }
  }
  if (repository) await repository.close();
  repository = undefined;
  initialization = undefined;
}
