import { describe, expect, it, vi } from "vitest";
import { createClickShield } from "./click-shield";

// While the price popover is open, a press outside only closes it: the click that follows must
// never reach the button under it (Cash/UPI/Card, Clear cart, +/−…).
//
// Models the browser's order for one event: window capture (the shield) → document capture
// (the open popover's outside-press handler) → the button's React handler, which runs only if
// nothing earlier cancelled the event.

function setup() {
  const win = new EventTarget();
  const shield = createClickShield(win);
  const pay = vi.fn(); // a payment button's onClick
  let popoverOpen = false;
  const press = () => {
    win.dispatchEvent(new Event("pointerdown", { cancelable: true }));
    if (popoverOpen) shield.arm(); // PriceEditPopover: swallow the press and the click after it
  };
  const click = (type = "click") => {
    const e = new Event(type, { cancelable: true });
    win.dispatchEvent(e);
    if (!e.defaultPrevented) pay(type);
  };
  return {
    shield,
    pay,
    press,
    click,
    key: () => win.dispatchEvent(new Event("keydown")),
    setPopoverOpen: (open: boolean) => (popoverOpen = open),
  };
}

describe("click shield", () => {
  it("swallows the click and double-click of a press outside the popover", () => {
    const t = setup();
    t.setPopoverOpen(true);
    t.press();
    t.setPopoverOpen(false); // nothing to save: the press closed it
    t.click();
    t.click("dblclick");
    expect(t.pay).not.toHaveBeenCalled();
  });

  it("lets the next press through (the first click only closes the popover)", () => {
    const t = setup();
    t.setPopoverOpen(true);
    t.press();
    t.setPopoverOpen(false);
    t.click(); // closed the popover, did not pay
    t.press(); // the cashier clicks Cash again
    t.click();
    expect(t.pay).toHaveBeenCalledTimes(1);
    expect(t.shield.armed).toBe(false);
  });

  it("blocks every click while 'Save new price?' is showing, until Save or Discard", () => {
    const t = setup();
    t.setPopoverOpen(true); // stays open: it is asking
    for (let i = 0; i < 3; i++) {
      t.press();
      t.click();
      t.click("dblclick");
    }
    expect(t.pay).not.toHaveBeenCalled();
    t.setPopoverOpen(false); // Save / Discard chosen
    t.press();
    t.click();
    expect(t.pay).toHaveBeenCalledTimes(1);
  });

  it("never stays armed into a later gesture (a drag that made no click, or a key press)", () => {
    const t = setup();
    t.setPopoverOpen(true);
    t.press(); // a drag: no click follows
    t.setPopoverOpen(false);
    t.key(); // e.g. Enter on a focused button
    t.click();
    expect(t.pay).toHaveBeenCalledTimes(1);
  });
});
