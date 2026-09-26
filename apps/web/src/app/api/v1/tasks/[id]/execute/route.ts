import { apiErrorResponse } from "../../../../../../server/api";
import { executeDeveloperTask } from "../../../../../../server/developer-api";
import { requireDeveloperIdentity } from "../../../../../../server/developer";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const identity = await requireDeveloperIdentity(request, ["tasks:execute"]);
    const { id } = await params;
    return await executeDeveloperTask(request, identity, id);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
