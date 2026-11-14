"use client";

import { useEffect, useLayoutEffect, useReducer, useRef, useSyncExternalStore } from "react";
import { cartReducer, cartStorageKey, loadCart, newCart, newIdempotencyKey, saveCart, type Cart } from "@/lib/cart";

const noopSubscribe = () => () => {};

/** false during SSR and hydration, true afterwards (no effect + setState round trip). */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );
}

/** Never rendered: the billing screen waits for hydration before showing the cart. */
const SERVER_CART: Cart = newCart("00000000-0000-4000-8000-000000000000");

function initCart(userId: string): Cart {
  if (typeof window === "undefined") return SERVER_CART;
  return loadCart(userId) ?? newCart(newIdempotencyKey());
}

/**
 * The cart for the signed-in user on this device, restored from and saved to localStorage.
 *
 * `cart` is an empty placeholder until hydration has finished (the server cannot see
 * localStorage, so rendering the restored cart earlier would mismatch the server HTML).
 * `cartRef` always holds the latest committed real cart, for async code (scan queue, checkout).
 */
export function useCart(userId: string) {
  const hydrated = useHydrated();
  const [cart, dispatch] = useReducer(cartReducer, userId, initCart);
  const cartRef = useRef(cart);

  useLayoutEffect(() => {
    cartRef.current = cart;
  }, [cart]);

  useEffect(() => {
    if (hydrated) saveCart(userId, cart);
  }, [hydrated, userId, cart]);

  // Two tabs of the same login share one saved cart. Follow the other tab's changes, so this tab
  // can never edit (or re-send) a cart whose key the other tab has already sent.
  useEffect(() => {
    if (!hydrated) return;
    const key = cartStorageKey(userId);
    const onStorage = (e: StorageEvent) => {
      if (e.storageArea !== window.localStorage || (e.key !== key && e.key !== null)) return;
      dispatch({ type: "replace", cart: loadCart(userId) ?? newCart(newIdempotencyKey()) });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [hydrated, userId]);

  return { cart: hydrated ? cart : SERVER_CART, dispatch, cartRef, hydrated };
}
