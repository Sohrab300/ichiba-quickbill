import { describe, expect, it } from "vitest";
import { csvField, csvRow, csvText, paiseToRupees, quoted } from "./csv";
import { istDateOf, istDayRange, istTimeOf, parseIstDate, todayIst } from "./ist-date";

describe("paiseToRupees", () => {
  it("always has two decimals and no grouping", () => {
    expect(paiseToRupees(0)).toBe("0.00");
    expect(paiseToRupees(5)).toBe("0.05");
    expect(paiseToRupees(119000)).toBe("1190.00");
    expect(paiseToRupees(12345678901)).toBe("123456789.01");
  });

  it("keeps the sign of a negative round off", () => {
    expect(paiseToRupees(-40)).toBe("-0.40");
    expect(paiseToRupees(-1234)).toBe("-12.34");
  });
});

describe("csv", () => {
  it("quotes only when needed", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField('Soap, "large"')).toBe('"Soap, ""large"""');
    expect(csvField("two\nlines")).toBe('"two\nlines"');
    expect(csvField(null)).toBe("");
    expect(csvField(18)).toBe("18");
  });

  it("always quotes codes that must stay text, without a formula wrapper", () => {
    expect(csvField(quoted("0401"))).toBe('"0401"');
    expect(csvField(quoted("0012345"))).toBe('"0012345"');
    expect(csvField(quoted('A"B'))).toBe('"A""B"');
    expect(csvField(quoted(null))).toBe("");
    expect(csvField(quoted(""))).toBe("");
    expect(csvRow(["CL1/26-27/000001", quoted("0401"), 18])).toBe('CL1/26-27/000001,"0401",18\r\n');
  });

  it("keeps the formula guard inside quoted codes", () => {
    expect(csvField(quoted(csvText("-12")))).toBe(`"'-12"`);
  });

  it("ends rows with CRLF", () => {
    expect(csvRow(["a", 1, null])).toBe("a,1,\r\n");
  });

  it("neutralises formula-looking text", () => {
    expect(csvText("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvText("-Shampoo")).toBe("'-Shampoo");
    expect(csvText("Shampoo")).toBe("Shampoo");
    expect(csvText(null)).toBe("");
  });
});

describe("IST dates", () => {
  it("maps an IST day to its UTC range", () => {
    const { from, to } = istDayRange("2026-11-15");
    expect(from.toISOString()).toBe("2026-11-14T18:30:00.000Z");
    expect(to.toISOString()).toBe("2026-11-15T18:30:00.000Z");
  });

  it("puts late-evening UTC instants on the next IST day", () => {
    expect(istDateOf("2026-11-14T18:30:00Z")).toBe("2026-11-15");
    expect(istDateOf("2026-11-14T18:29:59Z")).toBe("2026-11-14");
    expect(todayIst(new Date("2026-03-31T19:00:00Z"))).toBe("2026-04-01");
    expect(istTimeOf("2026-11-14T18:30:05Z")).toBe("00:00:05");
  });

  it("accepts only real dates", () => {
    expect(parseIstDate("2026-11-15")).toBe("2026-11-15");
    expect(parseIstDate("2028-02-29")).toBe("2028-02-29");
    expect(parseIstDate("2026-02-29")).toBeNull();
    expect(parseIstDate("2026-13-01")).toBeNull();
    expect(parseIstDate("15-11-2026")).toBeNull();
    expect(parseIstDate(undefined)).toBeNull();
  });
});
