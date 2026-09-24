import { NextResponse } from "next/server";
import { apiErrorResponse, readJsonBody } from "../../../server/api";
import { getCanalisApplication } from "../../../server/canalis";

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const application = await getCanalisApplication();
    const created = await application.createTask(body);
    const executed = await application.executeTask(created.task.id);
    return NextResponse.json(executed, {
      headers: {
        Deprecation: "true",
        Link: '</api/tasks>; rel="successor-version"',
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
