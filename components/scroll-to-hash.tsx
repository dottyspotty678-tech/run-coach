"use client";

import { useEffect } from "react";

/**
 * On mount, scroll to the element in location.hash; failing that, to the
 * element flagged with [data-today]. Used by Plan and Food so week-strip taps
 * land on the right day and both screens open on today (REQUIREMENTS §3.3/3.4).
 */
export function ScrollToHash() {
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    const hashTarget = hash ? document.getElementById(hash) : null;
    const target = hashTarget ?? document.querySelector("[data-today]");
    if (target) {
      // Explicit hash: put the day at the top. Default (today): only scroll
      // as far as needed so the week summary stays visible when possible.
      const block = hashTarget ? "start" : "nearest";
      requestAnimationFrame(() => {
        target.scrollIntoView({ block, behavior: "instant" as ScrollBehavior });
      });
    }
  }, []);

  return null;
}
