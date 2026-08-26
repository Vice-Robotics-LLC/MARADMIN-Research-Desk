import { MAX_SOURCE_BYTES, validateOfficialURL } from "./source-policy.ts";

export type BrowserCapture = { documentID: string; sourceText: string; sourceURL: string; sourceTitle: string; capturedAt: string };
export type CaptureCandidate = { id: string; number: string; official_url: string; title: string };

function normalized(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

export function validateBrowserCapturePayload(input: unknown, now = Date.now()): BrowserCapture {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid_json");
  const { documentID, sourceText, sourceURL, sourceTitle, capturedAt } = input as Record<string, unknown>;
  if (typeof documentID !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(documentID)) throw new Error("invalid_document_id");
  if (typeof sourceText !== "string" || sourceText.length < 40 || new TextEncoder().encode(sourceText).byteLength > MAX_SOURCE_BYTES) throw new Error("invalid_source_text");
  if (typeof sourceURL !== "string") throw new Error("invalid_source_url");
  try { validateOfficialURL(sourceURL); } catch { throw new Error("invalid_source_url"); }
  if (typeof sourceTitle !== "string" || sourceTitle.trim().length < 1 || sourceTitle.length > 600) throw new Error("invalid_source_title");
  const captured = typeof capturedAt === "string" ? Date.parse(capturedAt) : Number.NaN;
  if (!Number.isFinite(captured) || captured > now + 300_000 || captured < now - 7 * 86_400_000) throw new Error("invalid_captured_at");
  return { documentID, sourceText, sourceURL, sourceTitle: sourceTitle.trim(), capturedAt: new Date(captured).toISOString() };
}

export function validateCaptureProvenance(capture: BrowserCapture, candidate: CaptureCandidate): { sourceURL: string; sourceTitle: string; capturedAt: string } {
  const canonicalCaptureURL = validateOfficialURL(capture.sourceURL).href;
  if (canonicalCaptureURL !== validateOfficialURL(candidate.official_url).href) throw new Error("source_url_mismatch");
  const expectedTitle = normalized(candidate.title);
  if (!normalized(capture.sourceTitle).includes(expectedTitle) || !normalized(capture.sourceText).includes(expectedTitle)) throw new Error("source_title_mismatch");
  return { sourceURL: canonicalCaptureURL, sourceTitle: capture.sourceTitle, capturedAt: capture.capturedAt };
}
