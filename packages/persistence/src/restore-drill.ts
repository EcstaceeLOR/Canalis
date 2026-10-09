import { randomUUID } from "node:crypto";
import postgres from "postgres";

const DRILL_TABLE = "canalis_restore_drill";

if (process.env.CANALIS_ALLOW_RESTORE_DRILL !== "preview") {
  throw new Error("Refusing restore drill: set CANALIS_ALLOW_RESTORE_DRILL=preview for an isolated non-production database.");
}

const databaseUrl = process.env.DATABASE_URL_UNPOOLED?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL_UNPOOLED is required for the restore drill.");

const sql = postgres(databaseUrl, { max: 1, prepare: false });
try {
  await sql.unsafe(`CREATE TABLE IF NOT EXISTS ${DRILL_TABLE} (id TEXT PRIMARY KEY, payload JSONB NOT NULL)`);
  const marker = randomUUID();
  await sql`INSERT INTO canalis_restore_drill (id, payload) VALUES (${marker}, ${sql.json({ restored: true, scope: "preview" })})`;

  const backup = await sql<{ id: string; payload: { restored: boolean; scope: string } }[]>`
    SELECT id, payload FROM canalis_restore_drill ORDER BY id
  `;
  await sql.unsafe(`DROP TABLE ${DRILL_TABLE}`);
  await sql.unsafe(`CREATE TABLE ${DRILL_TABLE} (id TEXT PRIMARY KEY, payload JSONB NOT NULL)`);
  for (const row of backup) {
    await sql`INSERT INTO canalis_restore_drill (id, payload) VALUES (${row.id}, ${sql.json(row.payload)})`;
  }

  const [restored] = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count FROM canalis_restore_drill WHERE id = ${marker} AND payload->>'restored' = 'true'
  `;
  if (restored?.count !== "1") throw new Error("Restore drill verification failed.");
  await sql.unsafe(`DROP TABLE ${DRILL_TABLE}`);
  console.log(`Non-production logical restore drill passed (${backup.length} row${backup.length === 1 ? "" : "s"} restored and verified).`);
} finally {
  await sql.unsafe(`DROP TABLE IF EXISTS ${DRILL_TABLE}`).catch(() => undefined);
  await sql.end({ timeout: 5 });
}
