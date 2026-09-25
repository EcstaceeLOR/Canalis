import { describe, expect, it } from "vitest";
import { ApplicationError } from "@canalis/application";
import { apiErrorResponse, assertRequestOrigin, readJsonBody } from "./api";

describe("API production boundary", () => {
  it("accepts same-origin mutations and rejects cross-origin mutations", () => {
    expect(() => assertRequestOrigin(new Request("https://canalis.example/api/tasks", {
      method: "POST",
      headers: { origin: "https://canalis.example" },
    }))).not.toThrow();

    expect(() => assertRequestOrigin(new Request("https://canalis.example/api/tasks", {
      method: "POST",
      headers: { origin: "https://attacker.example" },
    }))).toThrow("Cross-origin mutation requests are not allowed.");
  });

  it("centralizes JSON media-type, size, and syntax validation", async () => {
    await expect(readJsonBody(new Request("https://canalis.example/api/tasks", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    }))).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE", status: 415 });

    await expect(readJsonBody(new Request("https://canalis.example/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "70000" },
      body: "{}",
    }))).rejects.toMatchObject({ code: "REQUEST_BODY_TOO_LARGE", status: 413 });

    await expect(readJsonBody(new Request("https://canalis.example/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{bad-json",
    }))).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });

    await expect(readJsonBody(new Request("https://canalis.example/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"name":"safe"}',
    }))).resolves.toEqual({ name: "safe" });
  });

  it("only returns approved error details and emits Retry-After for rate limits", async () => {
    const validation = apiErrorResponse(new ApplicationError(
      "VALIDATION_ERROR",
      "Invalid field.",
      400,
      { field: "budgetUsd" },
    ));
    expect(await validation.json()).toEqual({
      error: { code: "VALIDATION_ERROR", message: "Invalid field.", details: { field: "budgetUsd" } },
    });

    const operational = apiErrorResponse(new ApplicationError(
      "PROVIDER_UNHEALTHY",
      "Provider unavailable.",
      409,
      { credential: "must-not-leak", upstream: "private diagnostic" },
    ));
    expect(await operational.json()).toEqual({
      error: { code: "PROVIDER_UNHEALTHY", message: "Provider unavailable." },
    });

    const limited = apiErrorResponse(new ApplicationError(
      "RATE_LIMITED",
      "Slow down.",
      429,
      { retryAfterSeconds: 17 },
    ));
    expect(limited.headers.get("retry-after")).toBe("17");
  });
});
