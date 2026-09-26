import { apiErrorResponse } from "../../../../../../server/api";
import { getDeveloperReceipts } from "../../../../../../server/developer-api";
import { requireDeveloperIdentity } from "../../../../../../server/developer";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const identity = await requireDeveloperIdentity(request, ["receipts:read"]);
    const { id } = await params;
    return await getDeveloperReceipts(identity, id);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
