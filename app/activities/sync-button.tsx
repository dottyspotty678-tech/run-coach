"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconRefresh } from "@/components/icons";

export function SyncButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSync() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/strava/sync", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(typeof body.error === "string" ? body.error : "Couldn't reach Strava");
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't reach Strava");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={compact ? "flex flex-col items-end gap-1" : "flex flex-col gap-1"}>
      <button
        type="button"
        onClick={handleSync}
        disabled={loading}
        className={
          compact
            ? "flex min-h-[44px] items-center gap-1.5 text-[13px] font-semibold disabled:opacity-60"
            : "btn-secondary"
        }
        style={compact ? { color: "var(--accent)" } : undefined}
      >
        {loading ? (
          <>
            <span className="spinner" style={{ width: 13, height: 13 }} />
            Syncing…
          </>
        ) : (
          <>
            <IconRefresh size={15} strokeWidth={2.2} />
            Sync now
          </>
        )}
      </button>
      {error && (
        <p className="text-[13px] font-medium" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
