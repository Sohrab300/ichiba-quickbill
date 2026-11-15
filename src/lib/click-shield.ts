/**
 * Swallows the click (and double-click) that follows a press, so the press only closes a popover
 * and never reaches the button under it (Cash/UPI/Card, +/−, Clear cart…). The popover unmounts
 * between the pointerdown and the click, so the shield lives here, outside React.
 *
 * Armed from a pointerdown handler, it blocks every click/dblclick on `target` (capture phase,
 * before React and any other listener) until the next gesture starts: the next pointerdown or
 * keydown disarms it first, and a popover that is still open simply arms it again. A press that
 * never becomes a click (a drag or scroll) therefore cannot leave it armed for a later click.
 * Safe to import from client components; does nothing until arm() is called.
 */
export interface ClickShield {
  arm(): void;
  disarm(): void;
  readonly armed: boolean;
}

// Options object, not `true`: the same in browsers, and Node's EventTarget (tests) only matches
// capture listeners on removal this way.
const CAPTURE = { capture: true } as const;

export function createClickShield(target: EventTarget): ClickShield {
  let armed = false;
  const block = (e: Event) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const disarm = () => {
    if (!armed) return;
    armed = false;
    target.removeEventListener("click", block, CAPTURE);
    target.removeEventListener("dblclick", block, CAPTURE);
    target.removeEventListener("pointerdown", disarm, CAPTURE);
    target.removeEventListener("keydown", disarm, CAPTURE);
  };
  return {
    arm() {
      if (armed) return;
      armed = true;
      target.addEventListener("click", block, CAPTURE);
      target.addEventListener("dblclick", block, CAPTURE);
      target.addEventListener("pointerdown", disarm, CAPTURE);
      target.addEventListener("keydown", disarm, CAPTURE);
    },
    disarm,
    get armed() {
      return armed;
    },
  };
}

let windowShield: ClickShield | null = null;

/** Blocks the click that follows the current press (see createClickShield). Browser only. */
export function shieldNextClick(): void {
  windowShield ??= createClickShield(window);
  windowShield.arm();
}
