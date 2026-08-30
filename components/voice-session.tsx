"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Conversation } from "@elevenlabs/client";

// Shared voice-session engine (§3.12): drives both the Sunday check-in card
// and the Dashboard's Ask Coach sheet. The browser only ever holds a signed
// URL; the client tools relay the agent's calls to the PIN-gated API routes,
// tagging them with the session type so analysis targets the right week.

export type VoicePhase = "idle" | "connecting" | "live" | "done" | "error";

export type VoiceSessionType = "checkin" | "coach";

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(typeof json.error === "string" ? json.error : `Request failed (${res.status})`);
  }
  return json;
}

export function useVoiceSession(session: VoiceSessionType) {
  const router = useRouter();
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [agentMode, setAgentMode] = useState<"speaking" | "listening">("listening");
  const [working, setWorking] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const conversationRef = useRef<Conversation | null>(null);
  const appliedRef = useRef(false);
  // Generation counter: ending (or unmounting) bumps it, so an in-flight
  // start that resolves afterwards knows it was cancelled and hangs up
  // immediately instead of running an orphaned session.
  const generationRef = useRef(0);

  // Never leave the mic open on navigation.
  useEffect(() => {
    return () => {
      generationRef.current += 1;
      conversationRef.current?.endSession().catch(() => {});
    };
  }, []);

  async function start() {
    const generation = ++generationRef.current;
    setPhase("connecting");
    setError(null);
    setResult(null);
    appliedRef.current = false;
    try {
      // Mic permission first — a denied prompt should fail before any
      // session. Stop the probe tracks immediately: this stream exists only
      // to surface the prompt, and leaving it running kept the microphone
      // recording after the session ended.
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach((t) => t.stop());
      const startData = await post("/api/checkin/voice/start", { session });

      const conversation = await Conversation.startSession({
        signedUrl: String(startData.signed_url),
        connectionType: "websocket",
        dynamicVariables: startData.dynamic_variables as Record<string, string>,
        clientTools: {
          // The SDK relays string returns to the agent as the tool result.
          submit_checkin: async (params: unknown): Promise<string> => {
            setWorking("Working out the plan…");
            try {
              const body = { ...(params as Record<string, unknown>), session };
              return JSON.stringify(await post("/api/checkin/voice/analyse", body));
            } catch (e) {
              return JSON.stringify({ error: e instanceof Error ? e.message : "Analysis failed." });
            } finally {
              setWorking(null);
            }
          },
          confirm_checkin: async (params: unknown): Promise<string> => {
            setWorking("Applying the changes…");
            try {
              const applied = await post("/api/checkin/voice/apply", params);
              appliedRef.current = true;
              setResult(typeof applied.spoken_result === "string" ? applied.spoken_result : null);
              return JSON.stringify(applied);
            } catch (e) {
              return JSON.stringify({
                error: e instanceof Error ? e.message : "Applying the changes failed.",
              });
            } finally {
              setWorking(null);
            }
          },
        },
        onModeChange: ({ mode }) => setAgentMode(mode),
        onStatusChange: ({ status }) => {
          if (status === "connected") setPhase("live");
        },
        onDisconnect: () => {
          conversationRef.current = null;
          setPhase((p) => (p === "error" ? p : "done"));
          // Confirmed changes have rewritten data — refresh server components.
          if (appliedRef.current) router.refresh();
        },
        onError: (message) => {
          setError(typeof message === "string" ? message : "The call hit a problem.");
          setPhase("error");
        },
      });
      // Cancelled while connecting (End tapped, sheet closed, unmount):
      // hang up the just-established session rather than letting it run on.
      if (generationRef.current !== generation) {
        conversation.endSession().catch(() => {});
        return;
      }
      conversationRef.current = conversation;
    } catch (e) {
      if (generationRef.current !== generation) return;
      setError(e instanceof Error ? e.message : "Couldn't start the session.");
      setPhase("error");
    }
  }

  async function end() {
    generationRef.current += 1; // invalidate any in-flight start
    try {
      await conversationRef.current?.endSession();
    } finally {
      conversationRef.current = null;
      setPhase("done");
      if (appliedRef.current) router.refresh();
    }
  }

  return { phase, agentMode, working, result, error, start, end };
}

/** The in-call status block shared by every voice surface. */
export function VoiceLiveStatus({
  phase,
  agentMode,
  working,
  onEnd,
}: {
  phase: VoicePhase;
  agentMode: "speaking" | "listening";
  working: string | null;
  onEnd: () => void;
}) {
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      {phase === "connecting" ? (
        <p className="flex items-center gap-2 text-[14px] font-medium">
          <span className="spinner" aria-hidden />
          Connecting…
        </p>
      ) : (
        <p className="flex items-center gap-2 text-[14px] font-medium">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: agentMode === "speaking" ? "var(--accent)" : "var(--ok)" }}
          />
          {working ?? (agentMode === "speaking" ? "Coach is speaking" : "Listening to you")}
        </p>
      )}
      {working && (
        <p className="flex items-center gap-2 text-[13px]" style={{ color: "var(--ink-2)" }}>
          <span className="spinner" aria-hidden />
          This can take a minute — stay on the line.
        </p>
      )}
      <button type="button" className="btn-secondary" onClick={onEnd}>
        End session
      </button>
    </div>
  );
}
