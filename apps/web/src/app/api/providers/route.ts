import { NextResponse } from "next/server";
import { apiErrorResponse } from "../../../server/api";
import { getCanalisApplication } from "../../../server/canalis";

export async function GET() {
  try {
    const application = await getCanalisApplication();
    const providers = await application.listProviders();
    return NextResponse.json({ providers });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
