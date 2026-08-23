"use client";

import { useEffect, useRef, useState } from "react";
import { IconBackspace } from "@/components/icons";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

/**
 * Custom 4-digit keypad (REQUIREMENTS §3.1): no system keyboard, auto-submit
 * on the fourth digit, shake-and-clear on a wrong PIN, server-driven lockout
 * countdown after repeated failures.
 *
 * Interface (implemented by the backend): POST /api/pin/verify with
 * { pin: string } → 200 (cookie set → redirect), 401 (wrong PIN),
 * 429 + { retryAfterSeconds: number } (locked out).
 */
export function PinPad() {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shaking, setShaking] = useState(false);
  const [lockout, setLockout] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  function startLockout(seconds: number) {
    if (timer.current) clearInterval(timer.current);
    setLockout(seconds);
    timer.current = setInterval(() => {
      setLockout((s) => {
        if (s <= 1) {
          if (timer.current) clearInterval(timer.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }

  async function submit(fullPin: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pin/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: fullPin }),
      });

      if (res.ok) {
        // Cookie is set — enter the app at the originally requested path
        // when the middleware passed one along, otherwise Today.
        const params = new URLSearchParams(window.location.search);
        const next = params.get("next");
        const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
        window.location.replace(target);
        return;
      }

      setPin("");
      if (res.status === 429) {
        const body = (await res.json().catch(() => ({}))) as {
          retryAfterSeconds?: number;
        };
        startLockout(
          typeof body.retryAfterSeconds === "number" && body.retryAfterSeconds > 0
            ? Math.ceil(body.retryAfterSeconds)
            : 30
        );
      } else {
        setShaking(true);
        setError("Wrong PIN — try again");
        setTimeout(() => setShaking(false), 450);
      }
    } catch {
      setPin("");
      setError("Couldn't check the PIN — are you offline?");
    } finally {
      setBusy(false);
    }
  }

  function press(digit: string) {
    if (busy || lockout > 0 || pin.length >= 4) return;
    setError(null);
    const next = pin + digit;
    setPin(next);
    if (next.length === 4) void submit(next);
  }

  function erase() {
    if (busy || lockout > 0) return;
    setError(null);
    setPin((p) => p.slice(0, -1));
  }

  const disabled = busy || lockout > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-between px-6 pt-safe pb-safe"
      style={{ background: "var(--bg)" }}
    >
      {/* Secondary-screen back affordance (no-op when unauthenticated — the
          gate simply renders again). */}
      <header className="w-full pt-2">
        <a
          href="/"
          className="flex min-h-[44px] w-fit items-center text-[13px] font-semibold"
          style={{ color: "var(--ink-2)" }}
        >
          Back
        </a>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-8">
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-[22px] font-semibold">Run Coach</h1>
          <p className="text-[13px]" style={{ color: "var(--ink-2)" }}>
            Enter your PIN
          </p>
        </div>

        {/* Dots */}
        <div className={`flex gap-4 ${shaking ? "pin-shake" : ""}`} aria-label="PIN entry" role="status">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className="h-4 w-4 rounded-full border-2 transition-colors"
              style={
                i < pin.length
                  ? { background: "var(--accent)", borderColor: "var(--accent)" }
                  : { borderColor: "var(--ink-3)" }
              }
            />
          ))}
        </div>

        {/* Status line — fixed height so nothing shifts */}
        <p
          className="h-5 text-[13px] font-medium"
          style={{ color: lockout > 0 ? "var(--warn)" : "var(--danger)" }}
          aria-live="polite"
        >
          {lockout > 0
            ? `Too many attempts — try again in ${lockout} s`
            : (error ?? " ")}
        </p>
      </div>

      {/* Keypad */}
      <div className="mb-6 grid w-full max-w-[300px] grid-cols-3 gap-3">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => press(k)}
            disabled={disabled}
            className="mx-auto flex h-[72px] w-[72px] items-center justify-center rounded-full text-[26px] font-medium transition-transform active:scale-95 disabled:opacity-40"
            style={{ background: "var(--raised)" }}
          >
            {k}
          </button>
        ))}
        <span aria-hidden="true" />
        <button
          type="button"
          onClick={() => press("0")}
          disabled={disabled}
          className="mx-auto flex h-[72px] w-[72px] items-center justify-center rounded-full text-[26px] font-medium transition-transform active:scale-95 disabled:opacity-40"
          style={{ background: "var(--raised)" }}
        >
          0
        </button>
        <button
          type="button"
          onClick={erase}
          disabled={disabled || pin.length === 0}
          aria-label="Delete"
          className="mx-auto flex h-[72px] w-[72px] items-center justify-center rounded-full transition-transform active:scale-95 disabled:opacity-40"
          style={{ color: "var(--ink-2)" }}
        >
          <IconBackspace size={26} strokeWidth={1.7} />
        </button>
      </div>
    </div>
  );
}
