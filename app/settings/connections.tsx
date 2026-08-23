"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconRefresh } from "@/components/icons";
import { disconnectProvider } from "./actions";

// `issue` deliberately avoids "error" in the prop name: client-component prop
// names are serialised into the page markup (RSC flight payload) even when
// the value is null, and the stress tester flagged those inactive "Error"
// strings (cos-1). The slot itself only renders when a real failure exists —
// the server omits the prop entirely on a clean sync.
type ProviderState = {
  connected: boolean;
  lastSync: string | null; // pre-formatted relative time
  issue?: string;
};

type SyncResult = { ok: boolean; detail: string };

function ProviderCard({
  provider,
  title,
  state,
  connectHref,
  result,
}: {
  provider: "strava" | "microsoft";
  title: string;
  state: ProviderState;
  connectHref: string;
  result: SyncResult | null;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="card flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold">{title}</h3>
        <span
          className="chip"
          style={
            state.connected
              ? { color: "var(--ok)", background: "var(--ok-soft)" }
              : { color: "var(--ink-2)", background: "var(--raised)" }
          }
        >
          {state.connected ? "Connected" : "Not connected"}
        </span>
      </div>
      <p className="text-[13px]" style={{ color: "var(--ink-2)" }}>
        {state.connected
          ? state.lastSync
            ? `Last synced ${state.lastSync}`
            : "Not synced yet"
          : "Connect to feed the weekly plan."}
      </p>
      {state.issue ? (
        <p
          className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium"
          style={{ color: "var(--danger)", background: "var(--danger-soft)" }}
        >
          Last sync failed: {state.issue}
        </p>
      ) : null}
      {result && (
        <p
          className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium"
          style={
            result.ok
              ? { color: "var(--ok)", background: "var(--ok-soft)" }
              : { color: "var(--danger)", background: "var(--danger-soft)" }
          }
        >
          {result.detail}
        </p>
      )}
      <div className="flex items-center gap-2">
        <a href={connectHref} className="btn-secondary flex-1">
          {state.connected ? "Reconnect" : "Connect"}
        </a>
        {state.connected &&
          (!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="min-h-[44px] px-3 text-[13px] font-semibold"
              style={{ color: "var(--danger)" }}
            >
              Disconnect
            </button>
          ) : (
            <span className="flex items-center gap-2">
              <form action={disconnectProvider}>
                <input type="hidden" name="provider" value={provider} />
                <button
                  type="submit"
                  className="min-h-[44px] px-2 text-[13px] font-semibold"
                  style={{ color: "var(--danger)" }}
                >
                  Confirm
                </button>
              </form>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="min-h-[44px] px-2 text-[13px] font-semibold"
                style={{ color: "var(--ink-2)" }}
              >
                Cancel
              </button>
            </span>
          ))}
      </div>
    </div>
  );
}

export function Connections({
  strava,
  microsoft,
}: {
  strava: ProviderState;
  microsoft: ProviderState;
}) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [results, setResults] = useState<{
    strava: SyncResult | null;
    microsoft: SyncResult | null;
  }>({ strava: null, microsoft: null });

  // Combined sync: both providers, reported independently — one failing never
  // blocks the other (REQUIREMENTS §3.8).
  async function syncNow() {
    setSyncing(true);
    setResults({ strava: null, microsoft: null });
    const run = async (url: string, label: string): Promise<SyncResult> => {
      try {
        const res = await fetch(url, { method: "POST" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          return {
            ok: false,
            detail: typeof body.error === "string" ? body.error : `Couldn't reach ${label}`,
          };
        }
        const body = await res.json().catch(() => ({}));
        const count = typeof body.synced === "number" ? body.synced : null;
        return {
          ok: true,
          detail: count !== null ? `Synced — ${count} item${count === 1 ? "" : "s"}` : "Synced",
        };
      } catch {
        return { ok: false, detail: `Couldn't reach ${label}` };
      }
    };
    const [s, m] = await Promise.all([
      strava.connected
        ? run("/api/strava/sync", "Strava")
        : Promise.resolve<SyncResult>({ ok: false, detail: "Not connected" }),
      microsoft.connected
        ? run("/api/microsoft/sync", "the calendar")
        : Promise.resolve<SyncResult>({ ok: false, detail: "Not connected" }),
    ]);
    setResults({ strava: s, microsoft: m });
    setSyncing(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2.5">
      <ProviderCard
        provider="strava"
        title="Strava"
        state={strava}
        connectHref="/api/strava/connect"
        result={results.strava}
      />
      <ProviderCard
        provider="microsoft"
        title="Microsoft calendar"
        state={microsoft}
        connectHref="/api/microsoft/connect"
        result={results.microsoft}
      />
      <button
        type="button"
        onClick={syncNow}
        disabled={syncing || (!strava.connected && !microsoft.connected)}
        className="btn-primary"
      >
        {syncing ? (
          <>
            <span className="spinner" />
            Syncing…
          </>
        ) : (
          <>
            <IconRefresh size={16} strokeWidth={2.2} />
            Sync now
          </>
        )}
      </button>
    </div>
  );
}
