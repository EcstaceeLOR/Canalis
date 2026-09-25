import { NextResponse } from "next/server";
import { apiErrorResponse, readJsonBody } from "../../../../server/api";
import { getProviderRegistry } from "../../../../server/canalis";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const registry = await getProviderRegistry();
    return NextResponse.json({ provider: await registry.get(id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const registry = await getProviderRegistry();
    const body = await readJsonBody(request);
    return NextResponse.json({ provider: await registry.update(id, body) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
