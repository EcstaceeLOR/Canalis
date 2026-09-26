import { apiErrorResponse } from "../../../../../../server/api";
import { getDeveloperChannels } from "../../../../../../server/developer-api";
import { requireDeveloperIdentity } from "../../../../../../server/developer";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const identity = await requireDeveloperIdentity(request, ["channels:read"]);
    const { id } = await params;
    return await getDeveloperChannels(identity, id);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
