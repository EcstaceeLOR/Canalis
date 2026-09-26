import { apiErrorResponse } from "../../../../server/api";
import { createDeveloperTask, listDeveloperTasks } from "../../../../server/developer-api";
import { requireDeveloperIdentity } from "../../../../server/developer";

export async function GET(request: Request) {
  try {
    const identity = await requireDeveloperIdentity(request, ["tasks:read"]);
    return await listDeveloperTasks(request, identity);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const identity = await requireDeveloperIdentity(request, ["tasks:write"]);
    return await createDeveloperTask(request, identity);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
