import { NextResponse } from "next/server";
import { apiErrorResponse, readJsonBody } from "../../../server/api";
import { getCanalisApplication } from "../../../server/canalis";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const rawLimit = Number(url.searchParams.get("limit") ?? "50");
    const limit = Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : 50;
    const application = await getCanalisApplication();
    const tasks = await application.listTasks(limit);
    return NextResponse.json({ tasks });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const application = await getCanalisApplication();
    const task = await application.createTask(body);
    return NextResponse.json(task, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
