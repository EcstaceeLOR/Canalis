import { NextResponse } from "next/server";
import { releaseMetadata } from "../../../lib/release";

export const dynamic = "force-dynamic";

export async function GET() {
  const release = releaseMetadata();
  const durableStorage = Boolean(process.env.DATABASE_URL?.trim());
  const status = durableStorage ? "ok" : "degraded";

  return NextResponse.json(
    {
      status,
      product: "Canalis",
      service: "web",
      release,
      checks: {
        web: "ok",
        durableStorage: durableStorage ? "configured" : "not-configured",
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
