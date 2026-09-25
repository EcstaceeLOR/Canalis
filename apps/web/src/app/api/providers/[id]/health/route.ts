import { NextResponse } from "next/server";
import { apiErrorResponse } from "../../../../../server/api";
import { getProviderRegistry } from "../../../../../server/canalis";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const registry = await getProviderRegistry();
    return NextResponse.json({ provider: await registry.checkHealth(id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
