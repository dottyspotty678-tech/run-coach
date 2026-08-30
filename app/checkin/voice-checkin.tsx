"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Conversation } from "@elevenlabs/client";

// Sunday voice meeting (REQUIREMENTS §3.12). The browser only ever holds a
// short-lived signed URL; the two client tools relay the agent's calls to our
// PIN-gated API routes and return the JSON straight back to the agent.

type Phase = "idle" | "connecting" | "live" | "done" | "error";

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

export function VoiceCheckin() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [agentMode, setAgentMode] = useState<"speaking" | "listening">("listening");
  const [working, setWorking] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const conversationRef = useRef<Conversation | null>(null);
  const appliedRef = useRef(false);

  // Never leave the mic open on navigation.
  useEffect(() => {
    return () => {
      conversationRef.current?.endSession().catch(() => {});
    };
  }, []);

  async function start() {
    setPhase("connecting");
    setError(null);
    setResult(null);
    appliedRef.current = false;
    try {
      // Mic permission first — a denied prompt should fail before any session.
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const startData = await post("/api/checkin/voice/start", {});

      const conversation = await Conversation.startSession({
        signedUrl: String(startData.signed_url),
        connectionType: "websocket",
        dynamicVariables: startData.dynamic_variables as Record<string, string>,
        clientTools: {
          // The SDK relays string returns to the agent as the tool result.
          submit_checkin: async (params: unknown): Promise<string> => {
            setWorking("Working out next week's plan…");
            try {
              return JSON.stringify(await post("/api/checkin/voice/analyse", params));
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
          // Confirmed changes have rewritten the plan — refresh server data.
          if (appliedRef.current) router.refresh();
        },
        onError: (message) => {
          setError(typeof message === "string" ? message : "The call hit a problem.");
          setPhase("error");
        },
      });
      conversationRef.current = conversation;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the meeting.");
      setPhase("error");
    }
  }

  async function end() {
    try {
      await conversationRef.current?.endSession();
    } finally {
      conversationRef.current = null;
      setPhase("done");
      if (appliedRef.current) router.refresh();
    }
  }

  if (phase === "idle" || phase === "error" || phase === "done") {
    return (
      <div className="card flex flex-col gap-3 p-4">
        <p className="text-[13px] leading-[19px]" style={{ color: "var(--ink-2)" }}>
          A five-minute voice meeting: how the week went, what&apos;s coming up, which nights
          need no cooking — then the coach confirms next week&apos;s training and meals with you
          before anything changes.
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
          {phase === "idle" ? "Start Sunday check-in" : "Start again"}
        </button>
      </div>
    );
  }

  return (
    <div className="card flex flex-col gap-3 p-4" aria-live="polite">
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
            style={{
              background: agentMode === "speaking" ? "var(--accent)" : "var(--ok)",
            }}
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
      <button type="button" className="btn-secondary" onClick={end}>
        End meeting
      </button>
    </div>
  );
}
