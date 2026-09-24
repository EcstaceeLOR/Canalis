import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

export async function migrateDatabase(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS canalis_schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const migrationDir = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
    const files = (await readdir(migrationDir))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const existing = await sql<{ version: string }[]>`
        SELECT version FROM canalis_schema_migrations WHERE version = ${file}
      `;
      if (existing.length > 0) continue;

      const migration = await readFile(join(migrationDir, file), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(migration);
        await tx`
          INSERT INTO canalis_schema_migrations (version) VALUES (${file})
          ON CONFLICT (version) DO NOTHING
        `;
      });
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const invokedDirectly = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (invokedDirectly) {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.error("DATABASE_URL is required to run Canalis migrations.");
    process.exitCode = 1;
  } else {
    await migrateDatabase(databaseUrl);
    console.log("Canalis database migrations are up to date.");
  }
}
