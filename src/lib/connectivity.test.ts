import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getConnectivity,
  reportRequestFailed,
  reportRequestSucceeded,
  resetConnectivityForTests,
  subscribeConnectivity,
} from "./connectivity";

let onLine = true;

beforeEach(() => {
  vi.useFakeTimers();
  onLine = true;
  vi.stubGlobal("navigator", {
    get onLine() {
      return onLine;
    },
  });
  vi.stubGlobal("window", new EventTarget());
  resetConnectivityForTests();
});

afterEach(() => {
  resetConnectivityForTests();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("connectivity", () => {
  it("is online by default", () => {
    expect(getConnectivity()).toBe("online");
  });

  it("is offline whenever the browser says so", () => {
    onLine = false;
    expect(getConnectivity()).toBe("offline");
    reportRequestFailed();
    expect(getConnectivity()).toBe("offline");
  });

  it("is unreachable after a failed request, until a request succeeds", () => {
    const listener = vi.fn();
    subscribeConnectivity(listener);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    reportRequestFailed();
    expect(getConnectivity()).toBe("unreachable");
    expect(listener).toHaveBeenCalledTimes(1);

    reportRequestSucceeded();
    expect(getConnectivity()).toBe("online");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("probes the server and clears itself once it answers", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    reportRequestFailed();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getConnectivity()).toBe("unreachable");

    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("/manifest.webmanifest");
    expect(getConnectivity()).toBe("online");
  });

  it("notifies on the browser's online/offline events", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeConnectivity(listener);
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    window.dispatchEvent(new Event("offline"));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
