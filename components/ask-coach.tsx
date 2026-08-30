"use client";

import { useState } from "react";
import { useVoiceSession, VoiceLiveStatus } from "@/components/voice-session";
import { IconMic } from "@/components/icons";

// Ask Coach (§3.12): the Dashboard's free-form voice session. No script —
// revise upcoming sessions, report how you're feeling or a niggle (the plan
// adapts on confirmation), or just ask about training, nutrition and the
// build to the race. Rendered as a quick-action tile that opens a sheet.

export function AskCoachTile() {
  const [open, setOpen] = useState(false);
  const { phase, agentMode, working, result, error, start, end } = useVoiceSession("coach");

  function openAndStart() {
    setOpen(true);
    if (phase === "idle" || phase === "done" || phase === "error") void start();
  }

  async function close() {
    if (phase === "live" || phase === "connecting") await end();
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={openAndStart}
        className="card flex min-h-[64px] w-full items-center gap-2.5 px-3.5 py-3 text-left"
      >
        <span className="shrink-0" style={{ color: "var(--accent)" }}>
          <IconMic size={18} strokeWidth={2} />
        </span>
        <span className="text-[14px] font-semibold leading-[18px]">Ask Coach</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0"
            style={{ background: "rgba(0,0,0,0.45)" }}
            onClick={close}
          />
          <div
            className="relative mx-3 mb-3 flex w-full max-w-lg flex-col gap-3 rounded-2xl p-5 pb-safe"
            style={{ background: "var(--surface)", border: "1px solid var(--line)" }}
          >
            <div className="flex items-center gap-2">
              <span style={{ color: "var(--accent)" }}>
                <IconMic size={18} strokeWidth={2.2} />
              </span>
              <h2 className="text-[17px] font-semibold">Ask Coach</h2>
            </div>

            {phase === "live" || phase === "connecting" ? (
              <VoiceLiveStatus phase={phase} agentMode={agentMode} working={working} onEnd={close} />
            ) : (
              <>
                {phase === "done" && (
                  <p
                    className="rounded-lg px-3 py-2.5 text-[13px] font-medium"
                    style={{ color: "var(--ok)", background: "var(--ok-soft)" }}
                  >
                    {result ?? "Session ended. Anything you confirmed has been applied."}
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
                <div className="flex gap-2">
                  <button type="button" className="btn-secondary flex-1" onClick={close}>
                    Close
                  </button>
                  <button type="button" className="btn-primary flex-1" onClick={() => void start()}>
                    {phase === "idle" ? "Start talking" : "Start again"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
