import { parseTransactionExplorerQuery } from "@canalis/application";
import { apiErrorResponse } from "../../../../server/api";
import { requireWalletSession } from "../../../../server/auth";
import { getTransactionExplorerRepository } from "../../../../server/transactions";

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function GET(request: Request) {
  try {
    const identity = await requireWalletSession(request);
    const url = new URL(request.url);
    const format = url.searchParams.get("format") === "json" ? "json" : "csv";
    const query = parseTransactionExplorerQuery(url, identity.walletAddress);
    const repository = await getTransactionExplorerRepository();
    const exported = await repository.exportEvents(query);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");

    if (format === "json") {
      return new Response(
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            wallet: identity.walletAddress,
            filters: {
              search: query.search ?? null,
              taskId: query.taskId ?? null,
              providerId: query.providerId ?? null,
              protocol: query.protocol ?? null,
              status: query.status ?? null,
              network: query.network ?? null,
              eventType: query.eventType ?? null,
              layer: query.layer ?? null,
              createdFromUnixSeconds: query.createdFromUnixSeconds?.toString() ?? null,
              createdToUnixSeconds: query.createdToUnixSeconds?.toString() ?? null,
            },
            ...exported,
          },
          null,
          2,
        ),
        {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "content-disposition": `attachment; filename="canalis-transactions-${stamp}.json"`,
            "cache-control": "no-store",
          },
        },
      );
    }

    const headers = [
      "id",
      "created_at_unix",
      "event_type",
      "layer",
      "status",
      "task_id",
      "task_name",
      "provider_id",
      "provider_name",
      "protocol",
      "network",
      "mint",
      "amount_atomic",
      "cumulative_atomic",
      "authorized_delta_atomic",
      "settled_delta_atomic",
      "recovered_atomic",
      "channel_address",
      "receipt_hash",
      "signature",
      "request_id",
      "authorization_id",
      "payment_reference",
      "source_flow_id",
      "metadata_json",
    ];
    const lines = [headers.join(",")];
    for (const event of exported.events) {
      lines.push(
        [
          event.id,
          event.createdAtUnixSeconds,
          event.eventType,
          event.layer,
          event.status,
          event.taskId,
          event.taskName,
          event.providerId,
          event.providerName,
          event.protocol,
          event.network,
          event.mint,
          event.amountAtomic,
          event.cumulativeAtomic ?? "",
          event.authorizedDeltaAtomic,
          event.settledDeltaAtomic,
          event.recoveredAtomic,
          event.channelAddress ?? "",
          event.receiptHash ?? "",
          event.signature ?? "",
          event.requestId ?? "",
          event.authorizationId ?? "",
          event.paymentReference ?? "",
          event.sourceFlowId ?? "",
          JSON.stringify(event.metadata),
        ].map(csvCell).join(","),
      );
    }
    lines.push(
      [
        "TOTAL",
        "",
        "summary",
        "",
        exported.truncated ? "truncated" : "complete",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        exported.summary.authorizedAtomic,
        exported.summary.settledAtomic,
        exported.summary.recoveredAtomic,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        JSON.stringify({ totalEvents: exported.summary.totalEvents, truncated: exported.truncated }),
      ].map(csvCell).join(","),
    );

    return new Response(lines.join("\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="canalis-transactions-${stamp}.csv"`,
        "cache-control": "no-store",
        "x-canalis-export-truncated": exported.truncated ? "1" : "0",
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
