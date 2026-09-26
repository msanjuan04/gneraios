"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { tinykeys } from "tinykeys";

type Bindings = Record<string, (event: KeyboardEvent) => void>;

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * Atajos globales. Mientras se escribe en un campo solo funcionan los que usan
 * un modificador ($mod+K), para no robar letras.
 */
export function useHotkeys(bindings: Bindings) {
  // Los handlers se leen siempre frescos; las teclas solo se registran si cambian.
  const handlers = useRef(bindings);
  useLayoutEffect(() => {
    handlers.current = bindings;
  });
  const keys = Object.keys(bindings).join("|");

  useEffect(() => {
    const wrapped: Bindings = {};
    for (const key of keys.split("|").filter(Boolean)) {
      const usesModifier = key.includes("$mod") || key.includes("Control") || key.includes("Meta");
      wrapped[key] = (event) => {
        if (!usesModifier && isTyping(event.target)) return;
        handlers.current[key]?.(event);
      };
    }
    return tinykeys(window, wrapped);
  }, [keys]);
}
