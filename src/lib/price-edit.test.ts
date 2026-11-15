import { describe, expect, it } from "vitest";
import { outsidePress, pendingPriceChange, ScanBurstDetector, SCAN_KEY_GAP_MS } from "./price-edit";

const soap = { unitPrice: 4500, mrp: 5000 }; // ₹45.00, MRP ₹50.00
const edited = { ...soap, editedPrice: 4000 };

describe("press outside the price popover", () => {
  it("closes when nothing new and valid was typed", () => {
    for (const text of ["45.00", "45", "", "abc", "0", "50.01"]) {
      expect(outsidePress({ kind: "edit" }, soap, text)).toEqual({ next: "close" });
    }
    expect(outsidePress({ kind: "edit" }, edited, "40.00")).toEqual({ next: "close" }); // = current price
  });

  it("asks 'Save new price ₹X?' when a valid different price was typed", () => {
    expect(outsidePress({ kind: "edit" }, soap, "42.50")).toEqual({ next: "confirm", price: 4250 });
    expect(outsidePress({ kind: "edit" }, soap, "50")).toEqual({ next: "confirm", price: 5000 }); // = MRP
    // Back to the catalog price on an edited line is a change too.
    expect(outsidePress({ kind: "edit" }, edited, "45")).toEqual({ next: "confirm", price: 4500 });
  });

  it("keeps asking until Save or Discard is chosen", () => {
    expect(outsidePress({ kind: "confirm", price: 4250 }, soap, "42.50")).toEqual({ next: "stay" });
  });

  it("pendingPriceChange matches", () => {
    expect(pendingPriceChange(soap, "1,0.5")).toBe(1050);
    expect(pendingPriceChange({ unitPrice: 4500, mrp: null }, "46")).toBeNull(); // no MRP: only lower
  });
});

describe("scanner burst in the price box", () => {
  /** Feeds keys `gap` ms apart; returns what the detector reported on the last key. */
  function type(d: ScanBurstDetector, keys: string[], gap: number, start = 1000): (string | null)[] {
    return keys.map((k, i) => d.key(k, start + i * gap));
  }
  const scan = [..."8901234567890", "Enter"];

  it("hands over a fast burst ending with Enter", () => {
    expect(type(new ScanBurstDetector(), scan, 8).at(-1)).toBe("8901234567890");
    expect(type(new ScanBurstDetector(), [..."7021317", "Enter"], SCAN_KEY_GAP_MS).at(-1)).toBe("7021317");
  });

  it("ignores a person typing a price", () => {
    expect(type(new ScanBurstDetector(), [..."42.50", "Enter"], 120)).toEqual(Array(6).fill(null));
    // Fast but too short (e.g. two keys rolled together, then Enter).
    expect(type(new ScanBurstDetector(), ["4", "2", "Enter"], 10).at(-1)).toBeNull();
    // A slow Enter after fast digits.
    const d = new ScanBurstDetector();
    type(d, [..."123456"], 10);
    expect(d.key("Enter", 1000 + 5 * 10 + 300)).toBeNull();
  });

  it("only counts the burst, not what was typed before it", () => {
    const d = new ScanBurstDetector();
    type(d, [..."42"], 200, 0); // the cashier typed "42"
    expect(type(d, scan, 5, 2000).at(-1)).toBe("8901234567890");
  });

  it("ignores held keys and keeps Shift (capital letters) inside a burst", () => {
    const d = new ScanBurstDetector();
    expect(["1", "1", "1", "1"].map((k, i) => d.key(k, i * 30, i > 0)).concat(d.key("Enter", 120))).toEqual(Array(5).fill(null));
    const e = new ScanBurstDetector();
    expect(type(e, ["Shift", "A", "B", "1", "2", "Enter"], 5).at(-1)).toBe("AB12");
  });
});
