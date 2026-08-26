import { describe, expect, it } from "vitest";
import { validateContextForm } from "../src/App";

describe("eligibility form validation", () => {
  it("normalizes valid fields and reports the exact fields used", () => {
    expect(validateContextForm({ rank: " e-5 ", mos: "3044", component: "active", zone: " b ", yearsOfService: "6" }))
      .toEqual({
        context: { rank: "E-5", mos: "3044", component: "active", zone: "B", yearsOfService: 6 },
        errors: {},
        usedFields: ["Rank", "MOS", "Component", "Zone", "Years of service"]
      });
  });

  it("rejects every invalid non-empty field instead of silently omitting it", () => {
    const result = validateContextForm({ rank: "E5", mos: "30A4", component: "", zone: "Z", yearsOfService: "6.5" });
    expect(result.context).toEqual({});
    expect(result.usedFields).toEqual([]);
    expect(Object.keys(result.errors)).toEqual(["rank", "mos", "zone", "yearsOfService"]);
  });
});
