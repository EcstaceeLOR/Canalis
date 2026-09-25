import { describe, expect, it } from "vitest";
import { channelActionFor, parseChannelListQuery } from "../src/channel-workspace.js";

describe("channel workspace policy", () => {
  it("parses bounded channel filters", () => {
    const query = parseChannelListQuery(new URL("https://canalis.test/api/channels?status=recoverable&page=2&pageSize=500&q=abc&provider=search"), "payer");
    expect(query).toEqual({ owner: "payer", search: "abc", status: "recoverable", providerId: "search", page: 2, pageSize: 100 });
  });

  it("blocks terminal and ambiguous rebroadcasts", () => {
    expect(channelActionFor({ status: "distributed", taskStatus: "completed", cumulativeAuthorizedAtomic: 5n, expiresAtUnixSeconds: 20n, nowUnixSeconds: 10n })).toBeNull();
    expect(channelActionFor({ status: "failed", taskStatus: "completed", cumulativeAuthorizedAtomic: 5n, expiresAtUnixSeconds: 20n, nowUnixSeconds: 10n })).toBe("inspect");
    expect(channelActionFor({ status: "open", taskStatus: "completed", cumulativeAuthorizedAtomic: 5n, expiresAtUnixSeconds: 20n, nowUnixSeconds: 10n, recoveryStage: "finalization-ambiguous" })).toBe("inspect");
  });

  it("allows only the correct safe terminal action", () => {
    expect(channelActionFor({ status: "open", taskStatus: "completed", cumulativeAuthorizedAtomic: 30n, expiresAtUnixSeconds: 20n, nowUnixSeconds: 10n })).toBe("finalize");
    expect(channelActionFor({ status: "open", taskStatus: "cancelled", cumulativeAuthorizedAtomic: 0n, expiresAtUnixSeconds: 20n, nowUnixSeconds: 10n })).toBe("recover");
    expect(channelActionFor({ status: "open", taskStatus: "active", cumulativeAuthorizedAtomic: 30n, expiresAtUnixSeconds: 20n, nowUnixSeconds: 10n })).toBeNull();
    expect(channelActionFor({ status: "open", taskStatus: "active", cumulativeAuthorizedAtomic: 0n, expiresAtUnixSeconds: 9n, nowUnixSeconds: 10n })).toBe("recover");
  });
});
