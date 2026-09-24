import { NextResponse } from "next/server";
import { apiErrorResponse } from "../../../../../server/api";
import { getCanalisApplication } from "../../../../../server/canalis";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const application = await getCanalisApplication();
    const task = await application.executeTask(id);
    return NextResponse.json(task);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
