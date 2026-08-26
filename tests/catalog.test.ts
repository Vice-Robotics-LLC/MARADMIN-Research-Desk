import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { DOCUMENT_UPSERT_SQL, validateCatalogItem, validateCatalogURL } from "../worker/catalog";

const validItem = {
  catalogID: "4385746", number: "023/26", sequence: 23, numberYear: 2026,
  publicationYear: 2026, publicationMonth: 1, title: "FISCAL YEAR 2027 SELECTIVE RETENTION BONUS PROGRAM",
  officialURL: "https://www.marines.mil/News/Messages/Messages-Display/Article/4385746/example/",
  articleID: "4385746", publishedAt: "2026-01-22T20:01:49.000Z", sourceStatus: "active",
  firstSeenAt: "2026-01-22T20:01:49.000Z", lastVerifiedAt: "2026-08-26T00:00:00.000Z", revision: 8
};

describe("catalog trust boundary", () => {
  it("pins synchronization to the exact public catalog endpoint", () => {
    expect(validateCatalogURL("https://maradmin-api.vicerobotics.com/v1/catalog/bootstrap").href)
      .toBe("https://maradmin-api.vicerobotics.com/v1/catalog/bootstrap");
    expect(() => validateCatalogURL("https://example.com/v1/catalog/bootstrap")).toThrow("catalog_source_not_allowed");
    expect(() => validateCatalogURL("https://maradmin-api.vicerobotics.com/v1/catalog/other")).toThrow("catalog_source_not_allowed");
  });

  it("validates every field and canonical official URL before persistence", () => {
    expect(validateCatalogItem(validItem)).toMatchObject({ catalogID: "4385746", number: "023/26" });
    expect(() => validateCatalogItem({ ...validItem, officialURL: "https://example.com/News/Messages/Messages-Display/1/" }))
      .toThrow("invalid_catalog_item");
    expect(() => validateCatalogItem({ ...validItem, officialURL: undefined })).toThrow("invalid_catalog_item");
    expect(() => validateCatalogItem({ ...validItem, officialURL: { href: validItem.officialURL } })).toThrow("invalid_catalog_item");
    expect(() => validateCatalogItem({ ...validItem, number: "23/26" })).toThrow("invalid_catalog_item");
    expect(() => validateCatalogItem({ ...validItem, title: "" })).toThrow("invalid_catalog_item");
  });

  it("invalidates an indexed body when catalog source identity changes", () => {
    const database = new DatabaseSync(":memory:");
    database.exec(`CREATE TABLE documents (
      id TEXT PRIMARY KEY, number TEXT NOT NULL, sequence INTEGER NOT NULL, number_year INTEGER NOT NULL,
      publication_year INTEGER NOT NULL, publication_month INTEGER NOT NULL, title TEXT NOT NULL,
      official_url TEXT NOT NULL UNIQUE, article_id TEXT NOT NULL, published_at TEXT NOT NULL,
      source_status TEXT NOT NULL, catalog_revision INTEGER NOT NULL,
      body_status TEXT NOT NULL DEFAULT 'metadata_only',
      current_source_hash TEXT, body_retrieved_at TEXT, parser_version TEXT,
      first_seen_at TEXT NOT NULL, last_verified_at TEXT NOT NULL
    )`);
    const statement = database.prepare(DOCUMENT_UPSERT_SQL);
    const values = (item: typeof validItem) => [
      item.catalogID, item.number, item.sequence, item.numberYear, item.publicationYear,
      item.publicationMonth, item.title, item.officialURL, item.articleID, item.publishedAt,
      item.sourceStatus, item.revision, item.firstSeenAt, item.lastVerifiedAt
    ] as const;
    statement.run(...values(validItem));
    database.prepare(`UPDATE documents SET body_status='indexed', current_source_hash='trusted-hash',
      body_retrieved_at='2026-08-26T01:00:00.000Z', parser_version='plain-v1' WHERE id=?`).run(validItem.catalogID);

    statement.run(...values({ ...validItem, title: "Metadata correction only", revision: 9 }));
    expect(database.prepare("SELECT body_status, current_source_hash FROM documents WHERE id=?").get(validItem.catalogID))
      .toMatchObject({ body_status: "indexed", current_source_hash: "trusted-hash" });

    statement.run(...values({
      ...validItem,
      number: "024/26",
      officialURL: "https://www.marines.mil/News/Messages/Messages-Display/Article/4385747/reassigned/",
      articleID: "4385747",
      revision: 10
    }));
    expect(database.prepare(`SELECT number, official_url, article_id, body_status, current_source_hash,
      body_retrieved_at, parser_version FROM documents WHERE id=?`).get(validItem.catalogID)).toMatchObject({
      number: "024/26",
      article_id: "4385747",
      body_status: "stale",
      current_source_hash: null,
      body_retrieved_at: null,
      parser_version: null
    });
    database.close();
  });
});
