import { NextResponse } from "next/server";
import { assertDatabaseConnection } from "@canalis/persistence";
import { releaseMetadata } from "../../../lib/release";

export const dynamic = "force-dynamic";

export async function GET() {
  const release = releaseMetadata();
  const databaseUrl = process.env.DATABASE_URL?.trim();
  let durableStorage: "connected" | "not-configured" | "unavailable" = "not-configured";
  if (databaseUrl) {
    try {
      await assertDatabaseConnection(databaseUrl);
      durableStorage = "connected";
    } catch {
      durableStorage = "unavailable";
    }
  }
  const status = durableStorage === "connected" ? "ok" : "degraded";

  return NextResponse.json(
    {
      status,
      product: "Canalis",
      service: "web",
      release,
      checks: {
        web: "ok",
        durableStorage,
      },
    },
    {
      status: status === "ok" ? 200 : 503,
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
