import {
  ApplicationError,
  CanalisApplication,
} from "@canalis/application";
import { PostgresCanalisRepository } from "@canalis/persistence";

let repository: PostgresCanalisRepository | undefined;
let application: CanalisApplication | undefined;

export function getCanalisApplication(): CanalisApplication {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new ApplicationError(
      "STORAGE_NOT_CONFIGURED",
      "Canalis durable storage is not configured. Set DATABASE_URL to a Postgres connection string.",
      503,
    );
  }

  if (!application) {
    repository = new PostgresCanalisRepository(databaseUrl);
    application = new CanalisApplication(repository);
  }
  return application;
}

export async function resetCanalisApplicationForTests(): Promise<void> {
  if (repository) await repository.close();
  repository = undefined;
  application = undefined;
}
