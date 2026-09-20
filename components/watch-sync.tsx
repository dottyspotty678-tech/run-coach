"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconRefresh, IconTick } from "@/components/icons";
import { pushWeekToWatch } from "@/app/settings/actions";

// Watch sync UI (docs/WATCH-SYNC.md §4, DESIGN.md §8f): the Plan week card's
// one-line status + Send/Resend, and the Settings intervals.icu card. Status
// strings are decided server-side from the watch_sync row (watch-status.ts);
// this file only renders them and fires the manual push.

export type WatchStatus =
  | { kind: "never" }
  | { kind: "ok"; breakdown: string; syncedRelative: string }
  | { kind: "issue"; text: string; lastGoodRelative: string | null };

function usePush(weekStart: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function push() {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const result = await pushWeekToWatch(weekStart);
      if (!result.ok) setFailure(result.error ?? "Couldn't reach intervals.icu");
      // The action revalidates /plan and /settings; refresh picks up the new row.
      router.refresh();
    } catch {
      setFailure("Couldn't reach intervals.icu");
    } finally {
      setBusy(false);
    }
  }

  return { busy, failure, push };
}

/** Plan week card: "On watch · 3 runs, 2 gym · synced 2 min ago" + Send/Resend. */
export function WatchSyncLine({ weekStart, status }: { weekStart: string; status: WatchStatus }) {
  const { busy, failure, push } = usePush(weekStart);
  const tone =
    status.kind === "ok" ? "var(--ok)" : status.kind === "issue" ? "var(--danger)" : "var(--ink-3)";

  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] font-medium"
          style={{ color: tone }}
        >
          {status.kind === "ok" && <IconTick size={12} strokeWidth={2.8} className="shrink-0" />}
          <span className="min-w-0 truncate">
            {status.kind === "ok" && `On watch · ${status.breakdown} · synced ${status.syncedRelative}`}
            {status.kind === "never" && "Not on watch yet"}
            {status.kind === "issue" &&
              `Watch: ${status.text}${status.lastGoodRelative ? ` · last good push ${status.lastGoodRelative}` : ""}`}
          </span>
        </span>
        <button
          type="button"
          onClick={() => void push()}
          disabled={busy}
          className="flex min-h-[32px] shrink-0 items-center gap-1 rounded-full border px-2.5 text-[12px] font-semibold disabled:opacity-60"
          style={{ color: "var(--accent)", borderColor: "var(--line)", background: "var(--surface)" }}
        >
          {busy ? (
            <>
              <span className="spinner" style={{ width: 12, height: 12 }} />
              Sending…
            </>
          ) : (
            <>
              <IconRefresh size={12} strokeWidth={2.4} />
              {status.kind === "ok" ? "Resend" : "Send"}
            </>
          )}
        </button>
      </div>
      {failure && (
        <p className="text-[12px] font-medium" style={{ color: "var(--danger)" }}>
          {failure}
        </p>
      )}
    </div>
  );
}

/** Settings → Connections: the intervals.icu card, matching the Strava/Microsoft cards. */
export function WatchCard({
  configured,
  weekStart,
  pushedRelative,
  eventsPushed,
  issue,
}: {
  configured: boolean;
  weekStart: string;
  pushedRelative: string | null;
  eventsPushed: number;
  /** Last push failure — omitted by the server when clean (cos-1). */
  issue?: string;
}) {
  const { busy, failure, push } = usePush(weekStart);

  return (
    <div className="card flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold">intervals.icu → Coros</h3>
        <span
          className="chip"
          style={
            configured
              ? { color: "var(--ok)", background: "var(--ok-soft)" }
              : { color: "var(--ink-2)", background: "var(--raised)" }
          }
        >
          {configured ? "Connected" : "Not configured"}
        </span>
      </div>
      <p className="text-[13px]" style={{ color: "var(--ink-2)" }}>
        {!configured
          ? "Add INTERVALS_ICU_API_KEY in Vercel"
          : pushedRelative
            ? `This week sent ${pushedRelative} · ${eventsPushed} workout${eventsPushed === 1 ? "" : "s"}`
            : "This week not sent yet"}
      </p>
      {issue ? (
        <p
          className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium"
          style={{ color: "var(--danger)", background: "var(--danger-soft)" }}
        >
          Last push failed: {issue}
        </p>
      ) : null}
      {failure && (
        <p
          className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium"
          style={{ color: "var(--danger)", background: "var(--danger-soft)" }}
        >
          {failure}
        </p>
      )}
      {configured && (
        <button type="button" onClick={() => void push()} disabled={busy} className="btn-secondary">
          {busy ? (
            <>
              <span className="spinner" />
              Sending…
            </>
          ) : (
            <>
              <IconRefresh size={16} strokeWidth={2.2} />
              Send this week
            </>
          )}
        </button>
      )}
      <p className="text-[12px]" style={{ color: "var(--ink-3)" }}>
        Coros picks it up via intervals.icu&apos;s planned-workout upload.
      </p>
    </div>
  );
}
