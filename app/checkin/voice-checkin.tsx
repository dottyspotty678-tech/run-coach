"use client";

import { useVoiceSession, VoiceLiveStatus } from "@/components/voice-session";

// Sunday voice meeting card (§3.12). Session mechanics live in the shared
// useVoiceSession hook; this file is just the check-in surface.

export function VoiceCheckin({ revising = false }: { revising?: boolean }) {
  const { phase, agentMode, working, result, error, start, end } = useVoiceSession("checkin");

  if (phase === "idle" || phase === "error" || phase === "done") {
    return (
      <div className="card flex flex-col gap-3 p-4">
        <p className="text-[13px] leading-[19px]" style={{ color: "var(--ink-2)" }}>
          {revising
            ? "Redo this week's check-in by voice."
            : "A short voice meeting to plan next week."}
        </p>
        {phase === "done" && (
          <p
            className="rounded-lg px-3 py-2.5 text-[13px] font-medium"
            style={{ color: "var(--ok)", background: "var(--ok-soft)" }}
          >
            {result ?? "Meeting ended. Anything you confirmed has been applied."}
          </p>
        )}
        {phase === "error" && error && (
          <p
            className="rounded-lg px-3 py-2.5 text-[13px] font-medium"
            style={{ color: "var(--danger)", background: "var(--danger-soft)" }}
          >
            {error}
          </p>
        )}
        <button type="button" className="btn-primary" onClick={start}>
          {phase !== "idle" ? "Start again" : revising ? "Revise check-in" : "Start Sunday check-in"}
        </button>
      </div>
    );
  }

  return (
    <div className="card p-4">
      <VoiceLiveStatus phase={phase} agentMode={agentMode} working={working} onEnd={end} />
    </div>
  );
}
