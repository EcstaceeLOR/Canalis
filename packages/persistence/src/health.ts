import postgres from "postgres";

export async function assertDatabaseConnection(databaseUrl: string): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const sql = postgres(databaseUrl, {
      max: 1,
      prepare: false,
      // Neon branches can need several seconds to wake after scaling to zero.
      connect_timeout: 10,
      idle_timeout: 1,
    });
    try {
      await sql`SELECT 1 AS healthy`;
      return;
    } catch (error) {
      lastError = error;
    } finally {
      await sql.end({ timeout: 2 });
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw lastError;
}
