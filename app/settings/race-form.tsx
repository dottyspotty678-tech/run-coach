"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { clearRaceGoal, saveRaceGoal } from "./actions";

const PRESETS = [
  { label: "5k", km: 5 },
  { label: "10k", km: 10 },
  { label: "Half", km: 21.1 },
  { label: "Marathon", km: 42.2 },
] as const;

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary">
      {pending ? (
        <>
          <span className="spinner" />
          Saving…
        </>
      ) : (
        "Save race goal"
      )}
    </button>
  );
}

function ClearButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-[44px] text-[13px] font-semibold disabled:opacity-60"
      style={{ color: "var(--danger)" }}
    >
      {pending ? "Clearing…" : "Yes, clear it"}
    </button>
  );
}

/** Parses "95 minutes" or "01:35:00" (Postgres interval renderings) to hh:mm:ss. */
function toHms(interval: string | null): string {
  if (!interval) return "";
  const minMatch = interval.match(/^([\d.]+)\s*minutes?$/);
  if (minMatch) {
    const total = Math.round(Number(minMatch[1]) * 60);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(interval)) return interval;
  return "";
}

function hmsToMinutes(hms: string): number | null {
  const m = hms.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const total = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0);
  return total / 60;
}

export function RaceForm({
  defaults,
  todayIso,
}: {
  defaults: {
    race_name: string;
    distance_km: number | null;
    race_date: string;
    target_time: string | null;
  } | null;
  todayIso: string;
}) {
  const [distance, setDistance] = useState<string>(
    defaults?.distance_km != null ? String(defaults.distance_km) : ""
  );
  const [date, setDate] = useState(defaults?.race_date ?? "");
  const [time, setTime] = useState(toHms(defaults?.target_time ?? null));
  const [timeInvalid, setTimeInvalid] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const dateInPast = date !== "" && date < todayIso;
  const minutes = time.trim() === "" ? null : hmsToMinutes(time.trim());

  return (
    <div className="flex flex-col gap-3">
      <form action={saveRaceGoal} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>
            Race name
          </span>
          <input
            name="race_name"
            defaultValue={defaults?.race_name ?? ""}
            placeholder="Manchester Half"
            required
            className="input"
          />
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>
            Distance
          </span>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => {
              const active = distance !== "" && Number(distance) === p.km;
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setDistance(String(p.km))}
                  className="min-h-[36px] rounded-lg px-3.5 text-[13px] font-semibold"
                  style={
                    active
                      ? { background: "var(--accent)", color: "var(--on-accent)" }
                      : { background: "var(--raised)", color: "var(--ink-2)" }
                  }
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <input
            name="distance_km"
            type="number"
            step="0.1"
            min="1"
            value={distance}
            onChange={(e) => setDistance(e.target.value)}
            placeholder="Custom distance (km)"
            required
            className="input mt-1"
          />
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>
            Race date
          </span>
          <input
            name="race_date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            className="input"
          />
          {dateInPast && (
            <span className="text-[12px] font-medium" style={{ color: "var(--warn)" }}>
              That date is in the past — the plan will treat you as post-race.
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>
            Target time (optional)
          </span>
          <input
            type="text"
            inputMode="numeric"
            placeholder="hh:mm:ss"
            value={time}
            onChange={(e) => {
              setTime(e.target.value);
              setTimeInvalid(false);
            }}
            onBlur={() => setTimeInvalid(time.trim() !== "" && minutes === null)}
            className="input"
          />
          {timeInvalid && (
            <span className="text-[12px] font-medium" style={{ color: "var(--danger)" }}>
              Use hh:mm:ss, e.g. 01:35:00
            </span>
          )}
        </label>
        {/* Server action expects minutes — computed from hh:mm:ss above. */}
        <input type="hidden" name="target_time_minutes" value={minutes ?? ""} />

        <SaveButton />
      </form>

      {defaults && (
        <div className="flex items-center justify-between">
          {!confirmClear ? (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              className="min-h-[44px] text-[13px] font-semibold"
              style={{ color: "var(--danger)" }}
            >
              Clear race
            </button>
          ) : (
            <div className="flex items-center gap-4">
              <span className="text-[13px]" style={{ color: "var(--ink-2)" }}>
                Remove the race goal and plan for general fitness?
              </span>
              <form action={clearRaceGoal}>
                <ClearButton />
              </form>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="min-h-[44px] text-[13px] font-semibold"
                style={{ color: "var(--ink-2)" }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
