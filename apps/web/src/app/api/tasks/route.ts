import { NextResponse } from "next/server";
import { apiErrorResponse, readJsonBody } from "../../../server/api";
import { getCanalisApplication } from "../../../server/canalis";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const rawLimit = Number(url.searchParams.get("limit") ?? "50");
    const limit = Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : 50;
    const tasks = await getCanalisApplication().listTasks(limit);
    return NextResponse.json({ tasks });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const task = await getCanalisApplication().createTask(body);
    return NextResponse.json(task, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
