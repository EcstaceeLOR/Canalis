import { describe, expect, it } from "vitest";
import { parseActivityListQuery, productErrorDescriptor } from "../src/index.js";

describe("activity query", () => {
  it("parses bounded filters and pagination", () => {
    const query = parseActivityListQuery(new URL("https://canalis.local/activity?category=provider,recovery&severity=critical,warning&state=open&unread=1&page=2&pageSize=500"));
    expect(query.categories).toEqual(["provider", "recovery"]);
    expect(query.severities).toEqual(["critical", "warning"]);
    expect(query.state).toBe("open");
    expect(query.unreadOnly).toBe(true);
    expect(query.page).toBe(2);
    expect(query.pageSize).toBe(100);
  });

  it("ignores unknown filter values", () => {
    const query = parseActivityListQuery(new URL("https://canalis.local/activity?category=unknown&severity=nope&state=weird"));
    expect(query.categories).toBeUndefined();
    expect(query.severities).toBeUndefined();
    expect(query.state).toBeUndefined();
  });
});

describe("product error guidance", () => {
  it("turns ambiguous settlement into an explicit inspect-before-retry instruction", () => {
    const descriptor = productErrorDescriptor("CHANNEL_FINALIZATION_AMBIGUOUS");
    expect(descriptor.severity).toBe("critical");
    expect(descriptor.message.toLowerCase()).not.toContain("stack");
    expect(descriptor.guidance.toLowerCase()).toContain("do not retry automatically");
  });

  it("provides safe generic guidance for unrecognized codes", () => {
    const descriptor = productErrorDescriptor("SOMETHING_NEW");
    expect(descriptor.title).toBe("Canalis needs attention");
    expect(descriptor.guidance).toContain("review its current state");
  });
});
