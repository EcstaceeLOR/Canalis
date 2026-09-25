import { NextResponse } from "next/server";
import {
  parseTransactionExportFormat,
  parseTransactionListQuery,
  type TransactionRecord,
} from "@canalis/application";
import { apiErrorResponse } from "../../../../server/api";
import { requireWalletSession } from "../../../../server/auth";
import { getTransactionRepository } from "../../../../server/transactions";

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(records: TransactionRecord[], summary: Record<string, unknown>): string {
  const headers = [
    "id", "kind", "plane", "status", "taskId", "taskName", "providerId", "providerName",
    "protocol", "network", "mint", "amountAtomic", "previousCumulativeAtomic", "cumulativeAtomic",
    "requestId", "authorizationId", "paymentReference", "responseHash", "channelAddress", "signature",
    "timestampUnixSeconds",
  ];
  const lines = [headers.join(",")];
  for (const record of records) {
    const row = headers.map((header) => csvCell((record as unknown as Record<string, unknown>)[header]));
    lines.push(row.join(","));
  }
  lines.push("");
  lines.push("summaryMetric,value");
  for (const [key, value] of Object.entries(summary)) lines.push(`${csvCell(key)},${csvCell(value)}`);
  return `${lines.join("\n")}\n`;
}

export async function GET(request: Request) {
  try {
    const identity = await requireWalletSession(request);
    const url = new URL(request.url);
    const format = parseTransactionExportFormat(url.searchParams.get("format"));
    const query = parseTransactionListQuery(url, identity.walletAddress);
    const repository = await getTransactionRepository();
    const result = await repository.exportAll(query);
    const stamp = new Date().toISOString().slice(0, 10);

    if (format === "csv") {
      return new NextResponse(csv(result.records, result.summary as unknown as Record<string, unknown>), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="canalis-transactions-${stamp}.csv"`,
          "cache-control": "private, no-store",
        },
      });
    }

    return new NextResponse(JSON.stringify({ exportedAt: new Date().toISOString(), ...result }, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="canalis-transactions-${stamp}.json"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
