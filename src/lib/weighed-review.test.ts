import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseWeighedReview } from "../../scripts/lib/weighed-review";

describe("parseWeighedReview (scripts/flag-weighed-items.ts)", () => {
  it("flags only rows whose last column is Y", () => {
    const csv = [
      "item_code,name,selling_price,group,sold_by_weight (Y/N)",
      '7011708,TOMATO P/KG,70.00,1 - name says per KG,Y',
      '7009261,"AVOCADO HASS IMPORTED IN KG","1,400.00",1 - name says per KG,y',
      "7000001,SHAMPOO 200 ML,199.00,2 - maybe,",
      "7000002,ONION BAG 1 KG,60.00,2 - maybe,N",
      "7011708,TOMATO P/KG,70.00,dup,Y",
      ",NO CODE,1.00,x,Y",
      "7000003,WEIRD,1.00,x,maybe",
      "",
    ].join("\r\n");
    const r = parseWeighedReview(csv);
    expect(r.flagged.map((f) => f.itemCode)).toEqual(["7011708", "7009261"]);
    expect(r.flagged[1].name).toBe("AVOCADO HASS IMPORTED IN KG");
    expect(r.notFlagged).toBe(2);
    expect(r.problems.map((p) => p.line)).toEqual([7, 8]);
  });

  it("refuses a file without the expected header", () => {
    expect(() => parseWeighedReview("7011708,TOMATO,Y\n")).toThrow(/header/);
  });

  // data/ is git-ignored, so this only runs where the reviewed list exists (e.g. the admin's Mac).
  it.skipIf(!existsSync("data/weighed-items-review.csv"))("reads the reviewed list in data/", () => {
    const r = parseWeighedReview(readFileSync("data/weighed-items-review.csv", "utf8"));
    expect(r.problems).toEqual([]);
    expect(r.flagged.length).toBeGreaterThan(0); // 126 after the full review on 15 Nov 2026
    expect(r.flagged.some((f) => f.itemCode === "7011708")).toBe(true);
  });
});
