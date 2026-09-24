import { NextResponse } from "next/server";
import { apiErrorResponse } from "../../../../server/api";
import { getCanalisApplication } from "../../../../server/canalis";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const task = await getCanalisApplication().getTask(id);
    return NextResponse.json(task);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
