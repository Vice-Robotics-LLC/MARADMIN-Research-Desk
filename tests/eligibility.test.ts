import { describe, expect, it } from "vitest";
import { assessSections, validateContext } from "../worker/eligibility";

const context = { rank: "E-5", mos: "3043", component: "active" as const };

function section(text: string, id = "doc-123") {
  return {
    id,
    number: "123/26",
    title: "Selective reenlistment bonus",
    official_url: "https://www.marines.mil/News/Messages/Messages-Display/123/",
    published_at: "2026-08-25T00:00:00.000Z",
    current_source_hash: "abc123",
    body_retrieved_at: "2026-08-26T00:00:00.000Z",
    marker: "1.",
    text
  };
}

describe("conservative MARADMIN eligibility", () => {
  it("accepts only bounded, normalized context fields", () => {
    expect(validateContext({
      rank: " E-5 ", mos: "3043", component: "active", zone: "b", yearsOfService: 8,
      unexpected: "discard me"
    })).toEqual({ rank: "E-5", mos: "3043", component: "active", zone: "B", yearsOfService: 8 });

    expect(validateContext({ rank: "E-5", mos: "30A3", component: "unknown", zone: "Z", yearsOfService: 61 })).toEqual({ rank: "E-5" });
    expect(validateContext({ component: ["active"] })).toEqual({});
    expect(validateContext({ rank: "E", yearsOfService: 5.5 })).toEqual({});
    expect(validateContext(null)).toEqual({});
    expect(validateContext(["E-5"])).toEqual({});
  });

  it("returns supported only when every supplied context field matches explicit positive language", () => {
    const result = assessSections([
      section("Marines in the active component with MOS 3043 and rank E-5 are eligible and may receive this benefit.")
    ], context);

    expect(result.status).toBe("supported");
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({
      documentID: "doc-123",
      number: "123/26",
      officialURL: "https://www.marines.mil/News/Messages/Messages-Display/123/",
      section: "1.",
      sourceHash: "abc123",
      retrievedAt: "2026-08-26T00:00:00.000Z"
    });
    expect(result.disclaimer).toContain("not an official");
  });

  it("returns not_supported only for explicit exclusion language", () => {
    const result = assessSections([
      section("Marines in the active component with MOS 3043 and rank E-5 are not eligible for this benefit.")
    ], context);

    expect(result.status).toBe("not_supported");
    expect(result.rationale).toContain("explicit exclusion");
    expect(result.evidence[0]?.excerpt).toContain("not eligible");
  });

  it("does not overstate an exclusion that matches only part of the supplied context", () => {
    const result = assessSections([
      section("Marines in the active component are not eligible, while other categories are addressed separately.")
    ], context);

    expect(result.status).toBe("unknown");
    expect(result.rationale).toContain("does not establish");
  });

  it("scans matching exclusions beyond the five displayed evidence excerpts", () => {
    const rows = Array.from({ length: 6 }, (_, index) => section(
      index === 5
        ? "Marines in the active component with MOS 3043 and rank E-5 are not eligible for this exception."
        : "Marines in the active component with MOS 3043 and rank E-5 are eligible under this paragraph.",
      `doc-${index}`
    ));

    const result = assessSections(rows, context);
    expect(result.status).toBe("not_supported");
    expect(result.evidence).toHaveLength(5);
  });

  it("scans every selected document even when the combined evidence exceeds 500 sections", () => {
    const rows = Array.from({ length: 600 }, (_, index) => section(
      index === 599
        ? "Marines in the active component with MOS 3043 and rank E-5 are not eligible for this exception."
        : "Marines in the active component with MOS 3043 and rank E-5 are eligible under this paragraph.",
      `doc-${Math.floor(index / 200) + 1}`
    ));

    const result = assessSections(rows, context, ["doc-1", "doc-2", "doc-3"]);
    expect(result.status).toBe("not_supported");
  });

  it("does not return supported when a selected document has no indexed evidence", () => {
    const result = assessSections([
      section("Marines in the active component with MOS 3043 and rank E-5 are eligible.", "doc-indexed")
    ], context, ["doc-indexed", "doc-metadata-only"]);

    expect(result.status).toBe("unknown");
    expect(result.rationale).toContain("does not have indexed evidence");
  });

  it("returns unknown when matching text does not establish eligibility", () => {
    const result = assessSections([
      section("This administrative message references the active component, MOS 3043, and rank E-5 for background only.")
    ], context);

    expect(result.status).toBe("unknown");
    expect(result.rationale).toContain("does not establish");
    expect(result.evidence).toHaveLength(1);
  });

  it("uses canonical token boundaries instead of substring rank matches", () => {
    const result = assessSections([
      section("Eligible Marines should review the active component guidance for MOS 3043; the prose does not name a rank.")
    ], context);
    expect(result.status).toBe("unknown");
    expect(result.evidence).toHaveLength(1);
  });

  it("does not infer a decision when no context is supplied", () => {
    const result = assessSections([
      section("All Marines may receive this benefit when otherwise authorized by policy.")
    ], {});

    expect(result.status).toBe("unknown");
    expect(result.missingContext).toEqual(["rank, MOS, component, zone, or years of service"]);
  });

  it("masks contact details in returned evidence", () => {
    const result = assessSections([
      section("Marines in the active component with MOS 3043 and rank E-5 are eligible. Contact office@example.mil or 703-784-0557.")
    ], context);

    expect(result.status).toBe("supported");
    expect(result.evidence[0]?.excerpt).toContain("[email redacted]");
    expect(result.evidence[0]?.excerpt).toContain("[phone redacted]");
    expect(result.evidence[0]?.excerpt).not.toContain("office@example.mil");
    expect(result.evidence[0]?.excerpt).not.toContain("703-784-0557");
  });
});
