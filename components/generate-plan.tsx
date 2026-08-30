"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconRefresh } from "@/components/icons";

type Props = {
  /** True when a plan already exists — regeneration needs the confirm sheet. */
  hasPlan: boolean;
  /** "primary" = big button (empty states); "compact" = header text action. */
  appearance?: "primary" | "compact";
  /**
   * Two-week Plan screen: the Monday (YYYY-MM-DD) this button generates for.
   * Omit for the default boundary-week behaviour (Dashboard) — the request
   * body is then unchanged (no JSON body at all).
   */
  weekStartDate?: string;
  /** Copy for the week being (re)generated, e.g. "next week's". Defaults to "this week's". */
  weekLabel?: string;
};

/**
 * Generate / regenerate the weekly plan (REQUIREMENTS §3.7): confirm sheet
 * when replacing, in-flight spinner with the 30-second label, error + retry.
 */
export function GeneratePlanButton({
  hasPlan,
  appearance = "primary",
  weekStartDate,
  weekLabel = "this week's",
}: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setConfirming(false);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/plan/generate", {
        method: "POST",
        ...(weekStartDate
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ week_start_date: weekStartDate }),
            }
          : {}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(
          typeof body.error === "string" && body.error
            ? body.error
            : "Couldn't generate the plan — try again in a minute."
        );
        return;
      }
      // New plan replaces the old shopping list — clear this week's ticks.
      try {
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith("shopping-ticks-")) localStorage.removeItem(key);
        }
      } catch {
        // localStorage unavailable — nothing to clear.
      }
      router.refresh();
    } catch {
      setError("Couldn't generate the plan — try again in a minute.");
    } finally {
      setLoading(false);
    }
  }

  function handleClick() {
    if (loading) return;
    if (hasPlan) setConfirming(true);
    else void generate();
  }

  return (
    <>
      <div className={appearance === "primary" ? "flex flex-col gap-2" : "flex flex-col items-end gap-1"}>
        {appearance === "primary" ? (
          <button type="button" onClick={handleClick} disabled={loading} className="btn-primary">
            {loading ? (
              <>
                <span className="spinner" />
                Planning your week… (about 30 seconds)
              </>
            ) : hasPlan ? (
              "Regenerate"
            ) : (
              `Generate ${weekLabel} plan`
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleClick}
            disabled={loading}
            className="flex min-h-[44px] items-center gap-1.5 text-[13px] font-semibold disabled:opacity-60"
            style={{ color: "var(--accent)" }}
          >
            {loading ? (
              <>
                <span className="spinner" style={{ width: 13, height: 13 }} />
                Planning your week…
              </>
            ) : (
              <>
                <IconRefresh size={15} strokeWidth={2.2} />
                Regenerate
              </>
            )}
          </button>
        )}
        {error && (
          <p
            className="rounded-xl px-3 py-2 text-[13px] font-medium"
            style={{ color: "var(--danger)", background: "var(--danger-soft)" }}
          >
            {error}{" "}
            <button type="button" onClick={() => void generate()} className="underline underline-offset-2 font-semibold">
              Try again
            </button>
          </p>
        )}
      </div>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Cancel"
            className="absolute inset-0"
            style={{ background: "rgba(0,0,0,0.45)" }}
            onClick={() => setConfirming(false)}
          />
          <div
            className="relative mx-3 mb-3 w-full max-w-lg rounded-2xl p-5 pb-safe"
            style={{ background: "var(--surface)", border: "1px solid var(--line)" }}
          >
            <h2 className="text-[17px] font-semibold">Replace {weekLabel} plan?</h2>
            <p className="mt-1 text-[14px]" style={{ color: "var(--ink-2)" }}>
              This uses an AI call and clears shopping-list ticks.
            </p>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setConfirming(false)} className="btn-secondary flex-1">
                Cancel
              </button>
              <button type="button" onClick={() => void generate()} className="btn-primary flex-1">
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
