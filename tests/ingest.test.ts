import { describe, expect, it } from "vitest";
import { classifyIngestFailure } from "../worker/ingest";

describe("ingest retry classification", () => {
  it.each([
    new Error("source_fetch_blocked"),
    new Error("source_http_429"),
    new Error("source_http_502"),
    new Error("source_empty")
  ])("keeps transport failures retryable", (error) => {
    expect(classifyIngestFailure(error)).toBe("fetch_blocked");
  });

  it("keeps request timeouts retryable", () => {
    const error = new Error("timed out");
    error.name = "AbortError";
    expect(classifyIngestFailure(error)).toBe("fetch_blocked");

    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    expect(classifyIngestFailure(timeout)).toBe("fetch_blocked");
  });

  it.each([
    new Error("message_number_mismatch"),
    new Error("unsupported_content_type"),
    new Error("source_too_large"),
    new Error("unsafe_redirect")
  ])("keeps deterministic parser and policy failures out of the retry queue", (error) => {
    expect(classifyIngestFailure(error)).toBe("parse_failed");
  });
});
