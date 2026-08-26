import { describe, expect, it } from "vitest";
import { classifyIngestFailure, ingestNextBodies, ingestVerifiedSource } from "../worker/ingest";

function failureDatabase() {
  const batches: Array<Array<{ sql: string; bindings: unknown[] }>> = [];
  const candidate = {
    id: "doc-1", number: "123/26", official_url: "https://www.marines.mil/News/Messages/Messages-Display/123/",
    article_id: "123", title: "Test message"
  };
  const db = {
    prepare(sql: string) {
      return {
        sql,
        bindings: [] as unknown[],
        bind(...bindings: unknown[]) {
          return {
            sql,
            bindings,
            all: async () => ({ results: [candidate] })
          };
        }
      };
    },
    async batch(statements: Array<{ sql: string; bindings: unknown[] }>) {
      batches.push(statements);
      return [];
    }
  };
  return { db: db as unknown as D1Database, batches };
}

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

  it.each([
    [new Error("source_http_429"), "fetch_blocked", false],
    [new Error("message_number_mismatch"), "parse_failed", true]
  ] as const)("writes conservative failure state for %s", async (failure, expectedStatus, clearsIndex) => {
    const { db, batches } = failureDatabase();
    const result = await ingestNextBodies(
      db,
      {} as R2Bucket,
      1,
      async () => { throw failure; }
    );
    const statements = batches.flat();
    expect(statements[0]?.bindings.slice(0, 2)).toEqual([expectedStatus, expectedStatus]);
    expect(statements.some((statement) => statement.sql.includes("DELETE FROM document_relations"))).toBe(clearsIndex);
    expect(statements.some((statement) => statement.sql.includes("UPDATE document_fts SET body=''"))).toBe(clearsIndex);
    expect(result).toEqual(expectedStatus === "fetch_blocked"
      ? { indexed: 0, blocked: 1, failed: 0 }
      : { indexed: 0, blocked: 0, failed: 1 });
  });

  it("does not publish a fetched body when catalog identity changes before the final batch", async () => {
    let batchCount = 0;
    const db = {
      prepare(sql: string) {
        return {
          bind(...bindings: unknown[]) {
            return {
              sql,
              bindings,
              first: async () => ({ id: "doc-1" }),
              run: async () => ({ meta: { changes: 1 } })
            };
          }
        };
      },
      async batch(statements: Array<{ sql: string }>) {
        batchCount += 1;
        const finalPublication = statements.some((statement) => statement.sql.includes("body_status='indexed'"));
        return statements.map((_, index) => ({
          meta: { changes: finalPublication && index === statements.length - 1 ? 0 : 1 }
        }));
      }
    } as unknown as D1Database;
    const archive = { put: async () => undefined } as unknown as R2Bucket;
    const rawSource = `<p>MARADMIN 123/26</p><p>GENTEXT/REMARKS/1. This official body is sufficiently long for deterministic parsing and identity-race validation.//</p>`;

    await expect(ingestVerifiedSource(db, archive, {
      id: "doc-1",
      number: "123/26",
      official_url: "https://www.marines.mil/News/Messages/Messages-Display/123/",
      article_id: "123",
      title: "Test message"
    }, rawSource, "server_fetch", {
      sourceURL: "https://www.marines.mil/News/Messages/Messages-Display/123/",
      sourceTitle: "Test message",
      capturedAt: "2026-08-26T00:00:00.000Z"
    })).rejects.toThrow("catalog_identity_changed");
    expect(batchCount).toBeGreaterThanOrEqual(3);
  });
});
