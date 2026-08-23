"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { saveInjuries, saveWeeklyFeedback } from "@/app/settings/actions";

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary">
      {pending ? (
        <>
          <span className="spinner" />
          Saving…
        </>
      ) : (
        label
      )}
    </button>
  );
}

/**
 * The weekly jot (REQUIREMENTS §3.11): one free-text note keyed to the week
 * it describes. Saving the same week overwrites; an empty note clears it.
 */
export function FeedbackForm({
  weekStart,
  initial,
}: {
  weekStart: string;
  initial: string;
}) {
  return (
    <form action={saveWeeklyFeedback} className="flex flex-col gap-3">
      <textarea
        name="feedback"
        defaultValue={initial}
        rows={3}
        placeholder="e.g. Legs felt heavy after Thursday's intervals — the long run was a slog."
        className="input min-h-[88px] resize-y py-2.5 leading-[21px]"
      />
      <input type="hidden" name="week_start_date" value={weekStart} />
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px]" style={{ color: "var(--ink-3)" }}>
          Feeds the next plan — most recent note weighs heaviest.
        </p>
        <SaveButton label={initial ? "Update note" : "Save note"} />
      </div>
    </form>
  );
}

/**
 * Persistent injuries / niggles (REQUIREMENTS §3.11): stays until edited or
 * cleared, and is shown back verbatim so it is obvious what the planner
 * believes. Clear submits an empty value (the planner then reports "none").
 */
export function InjuriesForm({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={saveInjuries} className="flex flex-col gap-3">
      <textarea
        name="injuries"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={2}
        placeholder="e.g. Right calf tight since Tuesday — sore on hills."
        className="input min-h-[68px] resize-y py-2.5 leading-[21px]"
      />
      <div className="flex items-center justify-between gap-3">
        {initial ? (
          <button
            type="button"
            onClick={() => {
              setValue("");
              // Submit the cleared value straight away — "all clear" is a save.
              requestAnimationFrame(() => formRef.current?.requestSubmit());
            }}
            className="min-h-[44px] text-[13px] font-semibold"
            style={{ color: "var(--danger)" }}
          >
            Clear — all healed
          </button>
        ) : (
          <span className="text-[12px]" style={{ color: "var(--ink-3)" }}>
            Stays until you edit or clear it.
          </span>
        )}
        <SaveButton label="Save injuries" />
      </div>
    </form>
  );
}
