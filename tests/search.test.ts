import { describe, expect, it } from "vitest";
import { boundedLimit, buildFtsQuery, buildFtsTokens, buildStrictFtsQuery, isDisallowedPeopleQuery, isMessageCentricQuery, normalizeSnippet, rowToSummary } from "../worker/search";

describe("bounded catalog search", () => {
  it("builds an FTS expression from at most twelve quoted tokens", () => {
    const query = buildFtsQuery("Reenlistment bonus / supply MOS 3043 and rank E-5 eligibility guidance");

    expect(query).toBe('"Reenlistment" OR "bonus" OR "supply" OR "MOS" OR "3043" OR "and" OR "rank" OR "E-5" OR "eligibility" OR "guidance"');
    expect(query.match(/\bOR\b/g)).toHaveLength(9);
    expect(query).not.toContain("--");
    expect(query).not.toMatch(/(^|\s)1\s*=\s*1/);
  });

  it("bounds long or adversarial token streams and quotes SQL metacharacters", () => {
    const manyTokens = Array.from({ length: 20 }, (_, index) => `term${index}`).join(" ");
    const query = buildFtsQuery(`${manyTokens} " OR 1=1 --`);

    expect(query.split(" OR ")).toHaveLength(12);
    expect(query).toContain('"term0"');
    expect(query).toContain('"term11"');
    expect(query).not.toContain("--");
    expect(query).not.toContain('" OR 1=1');
    expect(query).toMatch(/^"[^"]+"(?: OR "[^"]+")*$/);
  });

  it("requires at least one searchable alphanumeric token", () => {
    expect(() => buildFtsQuery("   --- !!! ")).toThrow("query_required");
    expect(() => buildFtsQuery("")).toThrow("query_required");
  });

  it("builds an all-term expression for the precision-first search pass", () => {
    expect(buildFtsTokens("selective retention bonus 3044")).toEqual(['"selective"', '"retention"', '"bonus"', '"3044"']);
    expect(buildStrictFtsQuery("selective retention bonus 3044")).toBe('"selective" "retention" "bonus" "3044"');
  });

  it("allows policy and identifier research while rejecting name-only people searches", () => {
    expect(isMessageCentricQuery("selective retention bonus 3044")).toBe(true);
    expect(isMessageCentricQuery("MARADMIN 023/26")).toBe(true);
    expect(isMessageCentricQuery("John Smith")).toBe(false);
  });

  it("rejects explicit people lookup patterns while preserving message-number research", () => {
    expect(isDisallowedPeopleQuery("Find officer John Smith orders")).toBe(true);
    expect(isDisallowedPeopleQuery("Find John Smith orders")).toBe(true);
    expect(isDisallowedPeopleQuery("find john smith orders")).toBe(true);
    expect(isDisallowedPeopleQuery("Who is John Smith orders")).toBe(true);
    expect(isDisallowedPeopleQuery("Where is John Smith retention")).toBe(true);
    expect(isDisallowedPeopleQuery("find current selective retention bonus guidance")).toBe(false);
    expect(isDisallowedPeopleQuery("name: John Smith retention")).toBe(true);
    expect(isDisallowedPeopleQuery("Officer John Smith promotion board")).toBe(true);
    expect(isDisallowedPeopleQuery("John Smith promotion board")).toBe(false);
    expect(isDisallowedPeopleQuery("john smith rank")).toBe(false);
    expect(isDisallowedPeopleQuery("john smith, orders")).toBe(false);
    expect(isDisallowedPeopleQuery("John Smith retention")).toBe(false);
    expect(isDisallowedPeopleQuery("john smith bonus")).toBe(false);
    expect(isDisallowedPeopleQuery("John Smith guidance")).toBe(false);
    expect(isDisallowedPeopleQuery("Smith retention")).toBe(false);
    expect(isDisallowedPeopleQuery("J Smith retention")).toBe(false);
    expect(isDisallowedPeopleQuery("Smith guidance")).toBe(false);
    expect(isDisallowedPeopleQuery("email retention")).toBe(true);
    expect(isDisallowedPeopleQuery("e-mail retention")).toBe(true);
    expect(isDisallowedPeopleQuery("POC retention")).toBe(true);
    expect(isDisallowedPeopleQuery("DSN retention")).toBe(true);
    expect(isDisallowedPeopleQuery("telephone retention")).toBe(true);
    expect(isDisallowedPeopleQuery("fax retention")).toBe(true);
    expect(isDisallowedPeopleQuery("extension retention")).toBe(true);
    expect(isDisallowedPeopleQuery("1234567890 retention")).toBe(true);
    expect(isDisallowedPeopleQuery("1234567890")).toBe(true);
    expect(isDisallowedPeopleQuery("305-492-2854 retention")).toBe(true);
    expect(isDisallowedPeopleQuery("2024-2025 promotion policy")).toBe(false);
    expect(isDisallowedPeopleQuery("2024 2025 promotion policy")).toBe(false);
    expect(isDisallowedPeopleQuery("MARADMIN 023/26 John Smith")).toBe(false);
    expect(isDisallowedPeopleQuery("MARADMIN 023/26")).toBe(false);
    expect(isDisallowedPeopleQuery("FY27 selective retention bonus 3044")).toBe(false);
    expect(isDisallowedPeopleQuery("Selective Retention Bonus")).toBe(false);
    expect(isDisallowedPeopleQuery("Marine Corps promotion board results")).toBe(false);
    expect(isDisallowedPeopleQuery("permanent change of station orders")).toBe(false);
    expect(isDisallowedPeopleQuery("document retention policy")).toBe(false);
    expect(isDisallowedPeopleQuery("medical guidance")).toBe(false);
    expect(isDisallowedPeopleQuery("MARADMIN 512/25 promotion of sergeants")).toBe(false);
    expect(isDisallowedPeopleQuery("promotion board schedule announcement, promotion and board")).toBe(false);
    expect(isDisallowedPeopleQuery("reenlistment bonus infantry riflemen")).toBe(false);
    expect(isDisallowedPeopleQuery("promotion board results okinawa")).toBe(false);
  });

  it("clamps result limits to a positive ceiling", () => {
    expect(boundedLimit(null)).toBe(10);
    expect(boundedLimit("0")).toBe(1);
    expect(boundedLimit("999", 20)).toBe(20);
    expect(boundedLimit("not-a-number")).toBe(10);
    expect(boundedLimit("999", Number.NaN)).toBe(20);
    expect(boundedLimit("not-a-number", 4)).toBe(4);
  });

  it("strips markup markers, masks contacts, and bounds snippets", () => {
    const snippet = normalizeSnippet(`<mark>Call</mark> 703-784-0557 or <mark>email@example.mil</mark>`);
    expect(snippet).toBe("Call [phone redacted] or [email redacted]");
    expect(normalizeSnippet("x".repeat(701))).toHaveLength(700);
    expect(normalizeSnippet(null)).toBeNull();
  });

  it("maps database rows to the stable public summary shape", () => {
    expect(rowToSummary({
      id: "doc-1",
      number: "123/26",
      title: "Selective reenlistment bonus",
      official_url: "https://www.marines.mil/News/Messages/Messages-Display/1/",
      article_id: "1",
      published_at: "2026-08-25T00:00:00.000Z",
      source_status: "verified",
      body_status: "metadata_only",
      current_source_hash: null,
      snippet: null,
      rank: 0
    })).toEqual({
      id: "doc-1",
      number: "123/26",
      title: "Selective reenlistment bonus",
      officialURL: "https://www.marines.mil/News/Messages/Messages-Display/1/",
      articleID: "1",
      publishedAt: "2026-08-25T00:00:00.000Z",
      sourceStatus: "verified",
      bodyStatus: "metadata_only",
      sourceHash: null,
      snippet: null,
      rank: 0
    });
  });

  it("never exposes a body snippet for a non-indexed status", () => {
    expect(rowToSummary({
      id: "doc-stale", number: "124/26", title: "Stale guidance", official_url: "https://www.marines.mil/News/Messages/Messages-Display/2/",
      article_id: "2", published_at: "2026-08-25T00:00:00.000Z", source_status: "active", body_status: "stale",
      current_source_hash: "old-hash", snippet: "old body text", rank: 0
    }).snippet).toBeNull();
  });
});
