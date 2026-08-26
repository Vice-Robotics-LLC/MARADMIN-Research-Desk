import { describe, expect, it } from "vitest";
import { validateCatalogItem, validateCatalogURL } from "../worker/catalog";

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
});
