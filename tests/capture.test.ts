import { describe, expect, it } from "vitest";
import { validateBrowserCapturePayload, validateCaptureProvenance } from "../worker/capture";
import { MAX_SOURCE_BYTES } from "../worker/source-policy";

const now = Date.parse("2026-08-26T20:00:00.000Z");
const candidate = {
  id: "4385746", number: "023/26",
  official_url: "https://www.marines.mil/News/Messages/Messages-Display/Article/4385746/example/",
  title: "FISCAL YEAR 2027 SELECTIVE RETENTION BONUS PROGRAM"
};

const capture = {
  documentID: "4385746",
  sourceURL: candidate.official_url,
  sourceTitle: `${candidate.title} > United States Marine Corps Flagship`,
  sourceText: `${candidate.title}\nMARADMIN 023/26\nGENTEXT/REMARKS/This is sufficiently long official source text for deterministic parsing.//`,
  capturedAt: "2026-08-26T19:59:00.000Z"
};

describe("browser capture provenance", () => {
  it("accepts a recent bounded payload whose canonical URL and title match catalog metadata", () => {
    const parsed = validateBrowserCapturePayload(capture, now);
    expect(validateCaptureProvenance(parsed, candidate)).toEqual({
      sourceURL: candidate.official_url,
      sourceTitle: capture.sourceTitle,
      capturedAt: capture.capturedAt
    });
  });

  it("rejects stale captures and provenance mismatches", () => {
    expect(() => validateBrowserCapturePayload({ ...capture, capturedAt: "2026-08-01T00:00:00.000Z" }, now)).toThrow("invalid_captured_at");
    expect(() => validateCaptureProvenance(capture, { ...candidate, official_url: candidate.official_url.replace("4385746", "9999999") })).toThrow("source_url_mismatch");
    expect(() => validateCaptureProvenance({ ...capture, sourceTitle: "Different page", sourceText: "Different page MARADMIN 023/26 GENTEXT/REMARKS/long enough source body text for testing.//" }, candidate)).toThrow("source_title_mismatch");
  });

  it("maps malformed and off-domain capture URLs to the stable client error", () => {
    expect(() => validateBrowserCapturePayload({ ...capture, sourceURL: "not a url" }, now)).toThrow("invalid_source_url");
    expect(() => validateBrowserCapturePayload({ ...capture, sourceURL: "https://example.com/source" }, now)).toThrow("invalid_source_url");
    expect(() => validateBrowserCapturePayload({ ...capture, documentID: "x".repeat(81) }, now)).toThrow("invalid_document_id");
    expect(() => validateBrowserCapturePayload({ ...capture, sourceText: "🙂".repeat(Math.ceil(MAX_SOURCE_BYTES / 4) + 1) }, now)).toThrow("invalid_source_text");
  });
});
