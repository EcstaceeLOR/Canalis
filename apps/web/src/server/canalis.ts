import {
  ApplicationError,
  CanalisApplication,
  ProviderRegistry,
} from "@canalis/application";
import {
  migrateDatabase,
  PostgresCanalisRepository,
} from "@canalis/persistence";

let repository: PostgresCanalisRepository | undefined;
let application: CanalisApplication | undefined;
let providerRegistry: ProviderRegistry | undefined;
let initialization: Promise<CanalisApplication> | undefined;

export async function getCanalisApplication(): Promise<CanalisApplication> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new ApplicationError(
      "STORAGE_NOT_CONFIGURED",
      "Canalis durable storage is not configured. Set DATABASE_URL to a Postgres connection string.",
      503,
    );
  }

  if (application) return application;

  if (!initialization) {
    initialization = (async () => {
      await migrateDatabase(databaseUrl);
      repository = new PostgresCanalisRepository(databaseUrl);
      application = new CanalisApplication(repository);
      providerRegistry = new ProviderRegistry(repository);
      return application;
    })().catch((error) => {
      initialization = undefined;
      throw error;
    });
  }

  return initialization;
}

export async function getProviderRegistry(): Promise<ProviderRegistry> {
  await getCanalisApplication();
  if (!providerRegistry) {
    throw new ApplicationError(
      "STORAGE_NOT_CONFIGURED",
      "Canalis provider registry is not initialized.",
      503,
    );
  }
  return providerRegistry;
}

export async function resetCanalisApplicationForTests(): Promise<void> {
  if (initialization) {
    try {
      await initialization;
    } catch {
      // Ignore initialization failures during test cleanup.
    }
  }
  if (repository) await repository.close();
  repository = undefined;
  application = undefined;
  providerRegistry = undefined;
  initialization = undefined;
}
