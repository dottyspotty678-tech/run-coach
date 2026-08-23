"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

const THRESHOLD = 70;

/**
 * Pull-to-refresh wrapper for the Today screen (REQUIREMENTS §3.2/3.8):
 * pulling down from the top triggers the combined manual sync (both
 * providers, independent — one failing never blocks the other), then
 * refreshes the server-rendered view.
 */
export function PullRefresh({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const startY = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function runSync() {
    setSyncing(true);
    setMessage(null);
    try {
      if (!navigator.onLine) {
        setMessage("You're offline — couldn't sync.");
        return;
      }
      const [strava, microsoft] = await Promise.allSettled([
        fetch("/api/strava/sync", { method: "POST" }),
        fetch("/api/microsoft/sync", { method: "POST" }),
      ]);
      const failed: string[] = [];
      if (strava.status === "rejected" || !strava.value.ok) failed.push("Strava");
      if (microsoft.status === "rejected" || !microsoft.value.ok) failed.push("calendar");
      if (failed.length === 2) setMessage("Couldn't sync — check connections in Settings.");
      else if (failed.length === 1) setMessage(`Couldn't reach ${failed[0]} — other data updated.`);
      router.refresh();
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div
      onTouchStart={(e) => {
        if (window.scrollY <= 0 && !syncing) startY.current = e.touches[0].clientY;
        else startY.current = null;
      }}
      onTouchMove={(e) => {
        if (startY.current === null) return;
        const delta = e.touches[0].clientY - startY.current;
        if (delta > 0 && window.scrollY <= 0) {
          setPull(Math.min(delta * 0.45, 110));
        }
      }}
      onTouchEnd={() => {
        if (pull >= THRESHOLD) void runSync();
        setPull(0);
        startY.current = null;
      }}
    >
      <div
        aria-hidden={!syncing && pull === 0}
        className="flex items-center justify-center overflow-hidden transition-[height] duration-150"
        style={{ height: syncing ? 40 : pull, color: "var(--ink-2)" }}
      >
        {syncing ? (
          <span className="flex items-center gap-2 text-[13px] font-medium">
            <span className="spinner" style={{ width: 14, height: 14 }} />
            Syncing…
          </span>
        ) : (
          pull > 0 && (
            <span className="text-[13px] font-medium">
              {pull >= THRESHOLD ? "Release to sync" : "Pull to sync"}
            </span>
          )
        )}
      </div>
      {message && (
        <p
          className="mx-4 mb-2 rounded-xl px-3 py-2 text-[13px] font-medium"
          style={{ color: "var(--warn)", background: "var(--warn-soft)" }}
        >
          {message}
        </p>
      )}
      {children}
    </div>
  );
}
