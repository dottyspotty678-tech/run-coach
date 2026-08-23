"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Plan review-and-revise (round 2, U7). Framing: generate → review → revise →
 * done. This card sits after the day cards as the finishing step — review
 * what's above, ask for one targeted change if needed, then the week is set.
 * POSTs { revision_note } to /api/plan/generate (contract: DESIGN.md §8c);
 * a real ~30 s generation, so the in-flight state mirrors GeneratePlanButton.
 */
export function RevisePlan({
  revisionNote,
  revisedAtRelative,
}: {
  /** The note behind the currently stored plan, when it was a revision. */
  revisionNote: string | null;
  revisedAtRelative: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revise() {
    const trimmed = note.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/plan/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision_note: trimmed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(
          typeof body.error === "string" && body.error
            ? body.error
            : "Couldn't revise the plan — try again in a minute."
        );
        return;
      }
      // The revised plan replaces the shopping list — clear stale ticks,
      // matching GeneratePlanButton behaviour.
      try {
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith("shopping-ticks-")) localStorage.removeItem(key);
        }
      } catch {
        // localStorage unavailable — nothing to clear.
      }
      setOpen(false);
      setNote("");
      router.refresh();
    } catch {
      setError("Couldn't revise the plan — try again in a minute.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card flex flex-col gap-2 p-4">
      <span className="overline" style={{ color: "var(--ink-2)" }}>
        Happy with the week?
      </span>

      {/* Audit read-back: shown until the next generation clears it. */}
      {revisionNote && (
        <p className="text-[13px] leading-[19px]" style={{ color: "var(--ink-2)" }}>
          Revised{revisedAtRelative ? ` ${revisedAtRelative}` : ""} — you asked:{" "}
          <span className="italic">&ldquo;{revisionNote}&rdquo;</span>
        </p>
      )}

      {!open ? (
        <>
          <p className="text-[14px] leading-[21px]" style={{ color: "var(--ink-2)" }}>
            {revisionNote
              ? "Review the changes above — if it reads right, you're set for the week."
              : "Review the sessions above. If something doesn't fit, ask for one targeted change — otherwise you're set."}
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="btn-secondary self-start"
          >
            Suggest changes
          </button>
        </>
      ) : (
        <div className="flex flex-col gap-2.5">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="e.g. Move the long run to Sunday — Saturday's now busy."
            className="input min-h-[68px] resize-y py-2.5 leading-[21px]"
            disabled={loading}
          />
          <p className="text-[12px]" style={{ color: "var(--ink-3)" }}>
            Uses one AI call. Only what you mention changes — the rest of the week stays put.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              disabled={loading}
              className="btn-secondary flex-1"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void revise()}
              disabled={loading || note.trim() === ""}
              className="btn-primary flex-1"
            >
              {loading ? (
                <>
                  <span className="spinner" />
                  Revising your week… (about 30 seconds)
                </>
              ) : (
                "Revise plan"
              )}
            </button>
          </div>
          {error && (
            <p
              className="rounded-xl px-3 py-2 text-[13px] font-medium"
              style={{ color: "var(--danger)", background: "var(--danger-soft)" }}
            >
              {error}{" "}
              <button
                type="button"
                onClick={() => void revise()}
                className="font-semibold underline underline-offset-2"
              >
                Try again
              </button>
            </p>
          )}
        </div>
      )}
    </section>
  );
}
