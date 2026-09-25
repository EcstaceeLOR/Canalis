import { describe, expect, it } from "vitest";
import { parseTransactionExportFormat, parseTransactionListQuery } from "../src/index.js";

describe("transaction explorer contracts", () => {
  it("parses filters, pagination, and sort safely", () => {
    const url = new URL("https://canalis.test/api/transactions?q=sig&kind=authorization,settlement&status=confirmed&provider=search&task=task-1&protocol=x402&network=devnet&from=100&to=200&page=2&pageSize=50&sort=amount_desc");
    const query = parseTransactionListQuery(url, "wallet-a");
    expect(query.owner).toBe("wallet-a");
    expect(query.kinds).toEqual(["authorization", "settlement"]);
    expect(query.statuses).toEqual(["confirmed"]);
    expect(query.providerId).toBe("search");
    expect(query.taskId).toBe("task-1");
    expect(query.protocol).toBe("x402");
    expect(query.network).toBe("devnet");
    expect(query.fromUnixSeconds).toBe(100n);
    expect(query.toUnixSeconds).toBe(200n);
    expect(query.page).toBe(2);
    expect(query.pageSize).toBe(50);
    expect(query.sort).toBe("amount_desc");
  });

  it("caps page size and validates export formats", () => {
    const query = parseTransactionListQuery(new URL("https://canalis.test/api/transactions?pageSize=1000"), "wallet-a");
    expect(query.pageSize).toBe(100);
    expect(parseTransactionExportFormat("csv")).toBe("csv");
    expect(parseTransactionExportFormat(null)).toBe("json");
    expect(() => parseTransactionExportFormat("xlsx")).toThrow(/json or csv/i);
  });
});
