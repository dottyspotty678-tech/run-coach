"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import type { RacePriority } from "@/lib/season";
import { addRace, deleteRace, recordRaceResult, updateRace } from "./actions";

// V3 Settings → Races (docs/SEASON-PLAN.md §6, DESIGN.md §8e): the list that
// replaces the single race-goal form. A/B/C priorities shape the season
// (§2); every write re-runs the planner server-side.

export type RaceListItem = {
  id: number;
  name: string;
  distance_km: number;
  race_date: string;
  priority: RacePriority;
  target_time: string | null;
  result_time: string | null;
  result_notes: string | null;
};

const PRESETS = [
  { label: "5k", km: 5 },
  { label: "10k", km: 10 },
  { label: "Half", km: 21.1 },
  { label: "Marathon", km: 42.2 },
] as const;

/** Priority chips reuse session-type tokens: A = race (accent), B = long, C = rest. */
export const PRIORITY_META: Record<RacePriority, { label: string; color: string; soft: string; hint: string }> = {
  A: { label: "A", color: "var(--s-race)", soft: "var(--s-race-soft)", hint: "Anchors the season — full taper and recovery" },
  B: { label: "B", color: "var(--s-long)", soft: "var(--s-long-soft)", hint: "Raced hard mid-build — mini-taper, down week after" },
  C: { label: "C", color: "var(--s-rest)", soft: "var(--s-rest-soft)", hint: "Training race — swaps that day's quality session" },
};

export function PriorityChip({ priority }: { priority: RacePriority }) {
  const meta = PRIORITY_META[priority];
  return (
    <span className="chip" style={{ color: meta.color, background: meta.soft }}>
      {meta.label}
    </span>
  );
}

/** "01:25:00" → "1:25:00"; "00:42:10" → "42:10". Postgres interval text in, race-clock out. */
export function formatRaceTime(interval: string | null | undefined): string | null {
  if (!interval) return null;
  const m = interval.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return interval;
  const h = Number(m[1]);
  const mm = m[2];
  const ss = m[3] ?? "00";
  return h > 0 ? `${h}:${mm}:${ss}` : `${Number(mm)}:${ss}`;
}

/** "21.1" → "21.1 km"; "42.2" → "42.2 km"; whole numbers drop the decimal. */
export function formatDistance(km: number): string {
  return `${Number.isInteger(km) ? km : km.toFixed(1)} km`;
}

function formatRaceDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function isValidHms(value: string): boolean {
  return value.trim() === "" || /^\d{1,2}:\d{2}(:\d{2})?$/.test(value.trim());
}

function SubmitButton({ label, primary = false }: { label: string; primary?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={primary ? "btn-primary" : "btn-secondary min-h-[40px] px-3.5 text-[14px]"}
    >
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

/** The shared add/edit fields — server-action field names per DESIGN.md §8e. */
function RaceFields({ initial }: { initial?: RaceListItem }) {
  const [distance, setDistance] = useState(initial ? String(initial.distance_km) : "");
  const [priority, setPriority] = useState<RacePriority>(initial?.priority ?? "A");
  const [target, setTarget] = useState(formatRaceTime(initial?.target_time) ?? "");
  const [targetInvalid, setTargetInvalid] = useState(false);

  return (
    <>
      <label className="flex flex-col gap-1">
        <span className="text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>
          Race
        </span>
        <input
          name="name"
          defaultValue={initial?.name ?? ""}
          placeholder="Manchester Half"
          required
          className="input"
        />
      </label>

      <div className="flex flex-col gap-1.5">
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
                className="chip min-h-[32px]"
                style={
                  active
                    ? { color: "var(--on-accent)", background: "var(--accent)" }
                    : { color: "var(--ink-2)", background: "var(--raised)" }
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
          inputMode="decimal"
          value={distance}
          onChange={(e) => setDistance(e.target.value)}
          placeholder="Custom distance (km)"
          required
          className="input tabular"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>
            Date
          </span>
          <input
            name="race_date"
            type="date"
            defaultValue={initial?.race_date ?? ""}
            required
            className="input tabular"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>
            Target (optional)
          </span>
          <input
            name="target_time"
            type="text"
            inputMode="numeric"
            placeholder="hh:mm:ss"
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              setTargetInvalid(false);
            }}
            onBlur={() => setTargetInvalid(!isValidHms(target))}
            aria-invalid={targetInvalid || undefined}
            className="input tabular"
            style={targetInvalid ? { borderColor: "var(--danger)" } : undefined}
          />
        </label>
      </div>

      {/* Priority — segmented control; the meaning is one line under it. */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>
          Priority
        </span>
        <div
          className="grid grid-cols-3 gap-1 rounded-[10px] p-1"
          style={{ background: "var(--raised)" }}
          role="radiogroup"
          aria-label="Race priority"
        >
          {(["A", "B", "C"] as RacePriority[]).map((p) => {
            const active = priority === p;
            return (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setPriority(p)}
                className="display flex min-h-[38px] items-center justify-center gap-1.5 rounded-[8px] text-[15px]"
                style={
                  active
                    ? { background: "var(--surface)", color: PRIORITY_META[p].color, border: "1px solid var(--line)" }
                    : { color: "var(--ink-2)" }
                }
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: active ? PRIORITY_META[p].color : "var(--ink-3)" }}
                  aria-hidden="true"
                />
                {p}
              </button>
            );
          })}
        </div>
        <span className="text-[12px]" style={{ color: "var(--ink-3)" }}>
          {PRIORITY_META[priority].hint}
        </span>
        <input type="hidden" name="priority" value={priority} />
      </div>
    </>
  );
}

function ResultForm({ race, onDone }: { race: RaceListItem; onDone: () => void }) {
  const [time, setTime] = useState(formatRaceTime(race.result_time) ?? "");
  const [invalid, setInvalid] = useState(false);
  return (
    <form
      action={recordRaceResult}
      onSubmit={(e) => {
        if (!isValidHms(time)) {
          e.preventDefault();
          setInvalid(true);
          return;
        }
        onDone();
      }}
      className="flex flex-col gap-2 rounded-[10px] p-3"
      style={{ background: "var(--raised)" }}
    >
      <input type="hidden" name="id" value={race.id} />
      <div className="grid grid-cols-[120px_1fr] gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium" style={{ color: "var(--ink-2)" }}>
            Finish time
          </span>
          <input
            name="result_time"
            type="text"
            inputMode="numeric"
            placeholder="hh:mm:ss"
            value={time}
            onChange={(e) => {
              setTime(e.target.value);
              setInvalid(false);
            }}
            aria-invalid={invalid || undefined}
            className="input tabular min-h-[40px]"
            style={{ background: "var(--surface)", ...(invalid ? { borderColor: "var(--danger)" } : {}) }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium" style={{ color: "var(--ink-2)" }}>
            Notes
          </span>
          <input
            name="result_notes"
            type="text"
            defaultValue={race.result_notes ?? ""}
            placeholder="How it went, in a line"
            className="input min-h-[40px]"
            style={{ background: "var(--surface)" }}
          />
        </label>
      </div>
      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onDone}
          className="min-h-[40px] px-2 text-[13px] font-semibold"
          style={{ color: "var(--ink-2)" }}
        >
          Cancel
        </button>
        <SubmitButton label={race.result_time ? "Update result" : "Save result"} />
      </div>
    </form>
  );
}

function RaceRow({ race, isPast }: { race: RaceListItem; isPast: boolean }) {
  const [mode, setMode] = useState<"view" | "edit" | "delete" | "result">("view");
  const target = formatRaceTime(race.target_time);
  const result = formatRaceTime(race.result_time);

  if (mode === "edit") {
    return (
      <li style={{ borderColor: "var(--line)" }}>
        <form action={updateRace} onSubmit={() => setMode("view")} className="flex flex-col gap-3 p-4">
          <input type="hidden" name="id" value={race.id} />
          <RaceFields initial={race} />
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setMode("view")}
              className="min-h-[40px] px-2 text-[13px] font-semibold"
              style={{ color: "var(--ink-2)" }}
            >
              Cancel
            </button>
            <SubmitButton label="Save race" />
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3" style={{ borderColor: "var(--line)", opacity: isPast && !result ? 0.85 : 1 }}>
      <div className="flex items-start gap-3">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <PriorityChip priority={race.priority} />
            <span className="truncate text-[15px] font-semibold leading-5">{race.name}</span>
          </span>
          <span className="tabular mt-1 block text-[12px]" style={{ color: "var(--ink-2)" }}>
            {formatDistance(race.distance_km)} · {formatRaceDate(race.race_date)}
            {target && !isPast ? ` · target ${target}` : ""}
          </span>
          {isPast && (
            <span className="mt-1 flex flex-wrap items-baseline gap-x-2 text-[13px]">
              {result ? (
                <>
                  <span className="tabular font-semibold" style={{ color: "var(--ok)" }}>
                    {result}
                  </span>
                  {target && (
                    <span className="tabular text-[12px]" style={{ color: "var(--ink-3)" }}>
                      target {target}
                    </span>
                  )}
                  {race.result_notes && (
                    <span className="min-w-0 truncate" style={{ color: "var(--ink-2)" }}>
                      {race.result_notes}
                    </span>
                  )}
                </>
              ) : (
                <span style={{ color: "var(--ink-3)" }}>No result yet</span>
              )}
            </span>
          )}
        </span>

        {mode === "delete" ? (
          <span className="flex shrink-0 items-center gap-2">
            <form action={deleteRace} onSubmit={() => setMode("view")}>
              <input type="hidden" name="id" value={race.id} />
              <button
                type="submit"
                className="min-h-[36px] px-1.5 text-[13px] font-semibold"
                style={{ color: "var(--danger)" }}
              >
                Delete
              </button>
            </form>
            <button
              type="button"
              onClick={() => setMode("view")}
              className="min-h-[36px] px-1.5 text-[13px] font-semibold"
              style={{ color: "var(--ink-2)" }}
            >
              Keep
            </button>
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-2">
            {isPast && mode !== "result" && (
              <button
                type="button"
                onClick={() => setMode("result")}
                className="min-h-[36px] px-1.5 text-[13px] font-semibold"
                style={{ color: "var(--accent)" }}
              >
                {result ? "Result" : "Add result"}
              </button>
            )}
            <button
              type="button"
              onClick={() => setMode("edit")}
              className="min-h-[36px] px-1.5 text-[13px] font-semibold"
              style={{ color: isPast ? "var(--ink-2)" : "var(--accent)" }}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => setMode("delete")}
              className="min-h-[36px] px-1.5 text-[13px] font-semibold"
              style={{ color: "var(--ink-3)" }}
            >
              Delete
            </button>
          </span>
        )}
      </div>

      {mode === "result" && <ResultForm race={race} onDone={() => setMode("view")} />}
    </li>
  );
}

export function Races({ races, todayIso }: { races: RaceListItem[]; todayIso: string }) {
  const [adding, setAdding] = useState(false);
  const upcoming = races.filter((r) => r.race_date >= todayIso);
  const past = races.filter((r) => r.race_date < todayIso).sort((a, b) => b.race_date.localeCompare(a.race_date));

  return (
    <div className="flex flex-col gap-3">
      {adding ? (
        <form action={addRace} onSubmit={() => setAdding(false)} className="card flex flex-col gap-3 p-4">
          <h3 className="display text-[19px] leading-6">Add a race</h3>
          <RaceFields />
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="min-h-[44px] px-2 text-[13px] font-semibold"
              style={{ color: "var(--ink-2)" }}
            >
              Cancel
            </button>
            <SubmitButton label="Add race" primary />
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="btn-secondary self-start">
          Add a race
        </button>
      )}

      {races.length === 0 && !adding ? (
        <p className="card p-4 text-[13px]" style={{ color: "var(--ink-2)" }}>
          No races yet — the season runs as general fitness blocks.
        </p>
      ) : (
        <>
          {upcoming.length > 0 && (
            <ul className="card divide-y" style={{ borderColor: "var(--line)" }}>
              {upcoming.map((race) => (
                <RaceRow key={race.id} race={race} isPast={false} />
              ))}
            </ul>
          )}
          {past.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <h3 className="overline" style={{ color: "var(--ink-3)" }}>
                Raced
              </h3>
              <ul className="card divide-y" style={{ borderColor: "var(--line)" }}>
                {past.map((race) => (
                  <RaceRow key={race.id} race={race} isPast />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
