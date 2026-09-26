import { v1Json } from "../../../server/developer-api";

export async function GET() {
  return v1Json({
    name: "Canalis Developer API",
    version: "v1",
    authentication: "Authorization: Bearer <cnl_sbx_...|cnl_live_...>",
    idempotency: "Send Idempotency-Key on mutation retries.",
    endpoints: {
      tasks: "/api/v1/tasks",
      task: "/api/v1/tasks/{taskId}",
      execute: "/api/v1/tasks/{taskId}/execute",
      channels: "/api/v1/tasks/{taskId}/channels",
      receipts: "/api/v1/tasks/{taskId}/receipts",
      channelAction: "/api/v1/tasks/{taskId}/channels/{providerId}/action",
      webhooks: "/api/v1/webhooks",
    },
    docs: "https://github.com/EcstaceeLOR/Canalis/blob/main/docs/DEVELOPER_API.md",
  });
}
