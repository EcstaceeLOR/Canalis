import { NextResponse } from "next/server";
import { apiErrorResponse, readJsonBody } from "../../../server/api";
import { getProviderRegistry } from "../../../server/canalis";

export async function GET() {
  try {
    const registry = await getProviderRegistry();
    return NextResponse.json({ providers: await registry.list() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const registry = await getProviderRegistry();
    const body = await readJsonBody(request);
    const provider = await registry.create(body);
    return NextResponse.json({ provider }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
