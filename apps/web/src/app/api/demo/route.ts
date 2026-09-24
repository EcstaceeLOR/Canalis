import { NextResponse } from "next/server";
import {
  demoProviderIds,
  runDemoTask,
  type DemoProviderId,
} from "../../../lib/demo";
import { jsonSafe } from "../../../lib/money";

function isDemoProviderId(value: unknown): value is DemoProviderId {
  return (
    typeof value === "string" &&
    demoProviderIds.includes(value as DemoProviderId)
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const allowedProviders = Array.isArray(body.allowedProviders)
      ? body.allowedProviders.filter(isDemoProviderId)
      : undefined;

    const result = await runDemoTask({
      owner: typeof body.owner === "string" ? body.owner : undefined,
      budgetUsd:
        typeof body.budgetUsd === "string" ? body.budgetUsd : "1.00",
      maxPerCallUsd:
        typeof body.maxPerCallUsd === "string" ? body.maxPerCallUsd : "0.25",
      allowedProviders,
    });

    return NextResponse.json(jsonSafe(result));
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to run Canalis demo.",
      },
      { status: 400 },
    );
  }
}
