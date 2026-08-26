import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
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
    database.exec(readFileSync(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8"));
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

  it("isolates a reused official URL instead of aborting valid catalog writes", () => {
    const database = new DatabaseSync(":memory:");
    database.exec(readFileSync(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8"));
    const statement = database.prepare(DOCUMENT_UPSERT_SQL);
    const values = (item: typeof validItem) => [
      item.catalogID, item.number, item.sequence, item.numberYear, item.publicationYear,
      item.publicationMonth, item.title, item.officialURL, item.articleID, item.publishedAt,
      item.sourceStatus, item.revision, item.firstSeenAt, item.lastVerifiedAt
    ] as const;
    statement.run(...values(validItem));
    expect(() => statement.run(...values({ ...validItem, catalogID: "different-id", number: "024/26" }))).not.toThrow();
    const followup = {
      ...validItem,
      catalogID: "valid-followup",
      number: "025/26",
      officialURL: "https://www.marines.mil/News/Messages/Messages-Display/Article/4385748/followup/",
      articleID: "4385748"
    };
    statement.run(...values(followup));
    expect(() => statement.run(...values({ ...validItem, officialURL: followup.officialURL, articleID: followup.articleID }))).not.toThrow();

    expect(database.prepare("SELECT id FROM documents ORDER BY id").all()).toHaveLength(2);
    expect(database.prepare("SELECT id FROM documents WHERE official_url=?").get(validItem.officialURL))
      .toMatchObject({ id: validItem.catalogID });
    expect(database.prepare("SELECT id FROM documents WHERE official_url=?").get(followup.officialURL))
      .toMatchObject({ id: followup.catalogID });
    database.close();
  });

  it("backfills a unique indexed row lookup for the existing FTS corpus", () => {
    const database = new DatabaseSync(":memory:");
    database.exec(readFileSync(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8"));
    const statement = database.prepare(DOCUMENT_UPSERT_SQL);
    statement.run(
      validItem.catalogID, validItem.number, validItem.sequence, validItem.numberYear,
      validItem.publicationYear, validItem.publicationMonth, validItem.title, validItem.officialURL,
      validItem.articleID, validItem.publishedAt, validItem.sourceStatus, validItem.revision,
      validItem.firstSeenAt, validItem.lastVerifiedAt
    );
    database.prepare("INSERT INTO document_fts(document_id, number, title, body) VALUES (?, ?, ?, '')")
      .run(validItem.catalogID, validItem.number, validItem.title);
    database.exec(readFileSync(new URL("../migrations/0007_fts_row_mapping.sql", import.meta.url), "utf8"));

    expect(database.prepare(`SELECT m.document_id, m.fts_rowid, f.document_id AS indexed_document_id
      FROM document_fts_rows m JOIN document_fts f ON f.rowid=m.fts_rowid`).get()).toMatchObject({
      document_id: validItem.catalogID,
      indexed_document_id: validItem.catalogID
    });
    database.close();
  });
});
