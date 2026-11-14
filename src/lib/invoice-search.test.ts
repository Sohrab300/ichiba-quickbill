import { describe, expect, it } from "vitest";
import { startOfTodayIst, toInvoiceNoSearchTerm } from "./invoice-search";

describe("startOfTodayIst", () => {
  it("is 18:30 UTC of the previous day", () => {
    expect(startOfTodayIst(new Date("2026-11-14T10:00:00Z")).toISOString()).toBe("2026-11-13T18:30:00.000Z");
  });

  it("rolls over at midnight IST, not UTC", () => {
    // 23:59 IST on the 14th, then 00:00 IST on the 15th
    expect(startOfTodayIst(new Date("2026-11-14T18:29:59Z")).toISOString()).toBe("2026-11-13T18:30:00.000Z");
    expect(startOfTodayIst(new Date("2026-11-14T18:30:00Z")).toISOString()).toBe("2026-11-14T18:30:00.000Z");
  });

  it("handles month and year ends", () => {
    expect(startOfTodayIst(new Date("2026-12-31T20:00:00Z")).toISOString()).toBe("2026-12-31T18:30:00.000Z");
    expect(startOfTodayIst(new Date("2027-03-31T19:00:00Z")).toISOString()).toBe("2027-03-31T18:30:00.000Z");
  });
});

describe("toInvoiceNoSearchTerm", () => {
  it("upper-cases and keeps invoice-number characters", () => {
    expect(toInvoiceNoSearchTerm(" c1/26-27/000123 ")).toBe("C1/26-27/000123");
    expect(toInvoiceNoSearchTerm("123")).toBe("123");
  });

  it("drops LIKE wildcards and other characters", () => {
    expect(toInvoiceNoSearchTerm("%_\\12,3*")).toBe("123");
    expect(toInvoiceNoSearchTerm("%%")).toBe("");
  });
});
