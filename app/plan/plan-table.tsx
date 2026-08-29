"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import type { SessionType } from "@/lib/planTypes";
import type { PendingChange } from "@/components/data";
import { SESSION_META, SessionBadge } from "@/components/session";
import { IconTick } from "@/components/icons";
import {
  addPendingChange,
  clearPendingChanges,
  removePendingChange,
  savePendingCheckin,
} from "@/app/settings/actions";

// V2 Plan screen (docs/REDESIGN-V2.md §Screen 2): compact table
// (Date | Volume | Detail), today first, tap a row to expand the full session
// card. Edit mode queues PENDING CHANGES (server-stored, survive navigation)
// plus an inline check-in note, applied in ONE regeneration. This replaces the
// old "Suggest changes" card — one editing concept.

export type PlanTableRow = {
  date: string;
  /** "Today" / "Tomorrow" / "Thu" */
  dayLabel: string;
  /** "28 Aug" */
  dateLabel: string;
  /** "15 km" / "45 min" / "Gym" / "Rest" */
  volume: string;
  session_type: SessionType;
  title: string;
  detail: string;
  why: string;
  duration_min: number;
  is_travel_day: boolean;
  isToday: boolean;
  isPast: boolean;
  done: boolean;
};

const TYPE_CHOICES: SessionType[] = [
  "rest",
  "easy",
  "tempo",
  "intervals",
  "long",
  "cross",
  "strength",
  "race",
];

function QueueButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn-secondary min-h-[38px] px-3.5 text-[13px]"
    >
      {pending ? "Queuing…" : label}
    </button>
  );
}

function SaveNoteButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn-secondary min-h-[38px] px-3.5 text-[13px]"
    >
      {pending ? "Saving…" : "Save note"}
    </button>
  );
}

/** Inline per-row (or general) change form → addPendingChange. */
function ChangeForm({
  weekStart,
  date,
  onQueued,
}: {
  weekStart: string;
  date: string | null;
  onQueued: () => void;
}) {
  const [requestedType, setRequestedType] = useState<SessionType | null>(null);
  const [instruction, setInstruction] = useState("");
  const [missing, setMissing] = useState(false);
  const canSubmit = requestedType !== null || instruction.trim() !== "";

  return (
    <form
      action={addPendingChange}
      onSubmit={(e) => {
        if (!canSubmit) {
          e.preventDefault();
          setMissing(true);
          return;
        }
        onQueued();
      }}
      className="flex flex-col gap-2 rounded-xl p-3"
      style={{ background: "var(--raised)" }}
    >
      {date && <input type="hidden" name="date" value={date} />}
      <input type="hidden" name="week_start_date" value={weekStart} />
      <input type="hidden" name="requested_type" value={requestedType ?? ""} />

      {date && (
        <div className="flex flex-wrap gap-1.5">
          {TYPE_CHOICES.map((t) => {
            const active = requestedType === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setRequestedType(active ? null : t);
                  setMissing(false);
                }}
                className="min-h-[32px] rounded-lg px-2.5 text-[12px] font-semibold"
                style={
                  active
                    ? { background: "var(--accent)", color: "var(--on-accent)" }
                    : { background: "var(--surface)", color: "var(--ink-2)", border: "1px solid var(--line)" }
                }
              >
                {SESSION_META[t].label}
              </button>
            );
          })}
        </div>
      )}
      <input
        type="text"
        name="instruction"
        value={instruction}
        onChange={(e) => {
          setInstruction(e.target.value);
          setMissing(false);
        }}
        placeholder={
          date ? "Or say what should change, e.g. shorter — late meeting" : "e.g. fewer hard days this week"
        }
        className="input min-h-[40px]"
        style={{ background: "var(--surface)" }}
      />
      {missing && (
        <p className="text-[12px] font-medium" style={{ color: "var(--danger)" }}>
          Pick a session type or write an instruction first
        </p>
      )}
      <div className="flex justify-end">
        <QueueButton label="Queue change" />
      </div>
    </form>
  );
}

export function PlanTable({
  rows,
  weekStart,
  pendingChanges,
  checkinNote,
  initialEdit,
}: {
  rows: PlanTableRow[];
  weekStart: string;
  pendingChanges: PendingChange[];
  checkinNote: string;
  initialEdit: boolean;
}) {
  const router = useRouter();
  const [editMode, setEditMode] = useState(initialEdit);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [changeFor, setChangeFor] = useState<string | null>(null); // date, or "general"
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const dayLabelFor = (date: string | null) =>
    date === null
      ? "General"
      : (rows.find((r) => r.date === date)?.dayLabel ?? date);

  async function applyChanges() {
    if (applying || pendingChanges.length === 0) return;
    setApplying(true);
    setApplyError(null);
    try {
      const res = await fetch("/api/plan/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply_pending: true }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setApplyError(
          typeof body.error === "string" && body.error
            ? body.error
            : "Couldn't apply the changes — try again in a minute."
        );
        return;
      }
      // The regenerated plan replaces the shopping list — clear stale ticks.
      try {
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith("shopping-ticks-")) localStorage.removeItem(key);
        }
      } catch {
        // localStorage unavailable — nothing to clear.
      }
      setEditMode(false);
      setChangeFor(null);
      router.refresh();
    } catch {
      setApplyError("Couldn't apply the changes — try again in a minute.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <section className="flex flex-col gap-2">
      {/* Table header row: title + edit toggle */}
      <div className="flex items-baseline justify-between">
        <h2 className="overline" style={{ color: "var(--ink-2)" }}>
          This week
        </h2>
        <button
          type="button"
          onClick={() => {
            setEditMode(!editMode);
            setChangeFor(null);
            setApplyError(null);
          }}
          className="min-h-[36px] text-[13px] font-semibold"
          style={{ color: "var(--accent)" }}
        >
          {editMode ? "Done" : "Edit"}
        </button>
      </div>

      {/* The table */}
      <div className="card overflow-hidden">
        <div
          className="grid grid-cols-[92px_64px_1fr] gap-2 border-b px-4 py-2"
          style={{ borderColor: "var(--line)" }}
        >
          <span className="overline" style={{ color: "var(--ink-3)" }}>Date</span>
          <span className="overline" style={{ color: "var(--ink-3)" }}>Volume</span>
          <span className="overline" style={{ color: "var(--ink-3)" }}>Detail</span>
        </div>
        <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
          {rows.map((row) => {
            const isOpen = expanded === row.date;
            const meta = SESSION_META[row.session_type];
            const queuedForRow = pendingChanges.filter((c) => c.date === row.date);
            return (
              <li key={row.date} style={{ borderColor: "var(--line)" }}>
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : row.date)}
                  aria-expanded={isOpen}
                  className="grid w-full grid-cols-[92px_64px_1fr] items-center gap-2 px-4 py-3 text-left"
                  style={{
                    // Today gets a lane bar on the left edge, not a tinted fill.
                    boxShadow: row.isToday ? "inset 3px 0 0 var(--accent)" : undefined,
                    opacity: row.isPast && !row.isToday ? 0.55 : 1,
                  }}
                >
                  <span className="min-w-0">
                    <span
                      className={`block text-[13px] leading-4 ${row.isToday ? "overline" : "font-semibold"}`}
                      style={{ color: row.isToday ? "var(--accent)" : "var(--ink)" }}
                    >
                      {row.dayLabel}
                    </span>
                    <span className="tabular block text-[10.5px]" style={{ color: "var(--ink-3)" }}>
                      {row.dateLabel}
                    </span>
                  </span>
                  <span
                    className="text-[13px] font-semibold tabular leading-4"
                    style={{ color: meta.color }}
                  >
                    {row.volume}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[13px]" style={{ color: "var(--ink-2)" }}>
                      {row.title}
                    </span>
                    {row.done && (
                      <IconTick size={13} strokeWidth={2.8} className="shrink-0" style={{ color: "var(--ok)" }} />
                    )}
                    {row.is_travel_day && (
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: "var(--s-long)" }}
                        aria-label="Travel day"
                      />
                    )}
                    {queuedForRow.length > 0 && (
                      <span
                        className="chip shrink-0"
                        style={{ color: "var(--accent)", background: "var(--accent-soft)" }}
                      >
                        {queuedForRow.length} queued
                      </span>
                    )}
                  </span>
                </button>

                {/* Expanded: the full session card content */}
                {isOpen && (
                  <div
                    className="flex flex-col gap-1.5 border-t px-4 py-3"
                    style={{ borderColor: "var(--line)" }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <SessionBadge type={row.session_type} />
                      {row.duration_min > 0 && (
                        <span className="text-[13px] font-semibold tabular" style={{ color: "var(--ink-2)" }}>
                          {row.duration_min} min
                        </span>
                      )}
                    </div>
                    <h3 className="display text-[16px] leading-[22px]">{row.title}</h3>
                    <p className="text-[14px] leading-[21px]">{row.detail}</p>
                    <p
                      className="border-l-2 pl-2.5 text-[12px] leading-[17px]"
                      style={{ color: "var(--ink-2)", borderColor: meta.color }}
                    >
                      {row.why}
                    </p>
                    {editMode &&
                      (changeFor === row.date ? (
                        <ChangeForm
                          weekStart={weekStart}
                          date={row.date}
                          onQueued={() => setChangeFor(null)}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setChangeFor(row.date)}
                          className="min-h-[36px] self-start text-[13px] font-semibold"
                          style={{ color: "var(--accent)" }}
                        >
                          Change this day
                        </button>
                      ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* Edit mode panel */}
      {editMode && (
        <div className="card flex flex-col gap-3 p-4">
          <div>
            <h3 className="text-[15px] font-semibold">Pending changes</h3>
            <p className="mt-0.5 text-[12px]" style={{ color: "var(--ink-3)" }}>
              Tap a day above to queue a change. Nothing regenerates until you apply — the
              queue is saved, so it survives leaving this screen.
            </p>
          </div>

          {pendingChanges.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {pendingChanges.map((change) => (
                <li
                  key={change.id}
                  className="flex items-center gap-2 rounded-xl px-3 py-2"
                  style={{ background: "var(--raised)" }}
                >
                  <span className="min-w-0 flex-1 text-[13px]">
                    <span className="font-semibold">{dayLabelFor(change.date)}</span>
                    {change.requested_type && (
                      <span style={{ color: "var(--ink-2)" }}>
                        {" "}→ {SESSION_META[change.requested_type as SessionType]?.label ?? change.requested_type}
                      </span>
                    )}
                    {change.instruction && (
                      <span style={{ color: "var(--ink-2)" }}> — {change.instruction}</span>
                    )}
                  </span>
                  <form action={removePendingChange}>
                    <input type="hidden" name="id" value={change.id} />
                    <input type="hidden" name="week_start_date" value={weekStart} />
                    <button
                      type="submit"
                      aria-label={`Remove change for ${dayLabelFor(change.date)}`}
                      className="min-h-[32px] px-1.5 text-[13px] font-semibold"
                      style={{ color: "var(--danger)" }}
                    >
                      Remove
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}

          {/* General (whole-week) instruction */}
          {changeFor === "general" ? (
            <ChangeForm weekStart={weekStart} date={null} onQueued={() => setChangeFor(null)} />
          ) : (
            <button
              type="button"
              onClick={() => setChangeFor("general")}
              className="min-h-[36px] self-start text-[13px] font-semibold"
              style={{ color: "var(--accent)" }}
            >
              Add a whole-week instruction
            </button>
          )}

          {/* Inline check-in note — rides along with the apply */}
          <form action={savePendingCheckin} className="flex flex-col gap-2">
            <label className="text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>
              Check-in note (optional — goes to the coach with the changes)
            </label>
            <textarea
              name="checkin_note"
              defaultValue={checkinNote}
              rows={2}
              placeholder="e.g. Legs still heavy from Saturday."
              className="input min-h-[56px] resize-y py-2 leading-[20px]"
            />
            <input type="hidden" name="week_start_date" value={weekStart} />
            <div className="flex justify-end">
              <SaveNoteButton />
            </div>
          </form>

          {/* Apply — ONE call for the whole batch */}
          <button
            type="button"
            onClick={() => void applyChanges()}
            disabled={applying || pendingChanges.length === 0}
            className="btn-primary"
          >
            {applying ? (
              <>
                <span className="spinner" />
                Applying your changes… (about 30 seconds)
              </>
            ) : (
              "Apply changes — regenerate"
            )}
          </button>
          {pendingChanges.length === 0 && (
            <p className="-mt-1 text-[12px]" style={{ color: "var(--ink-3)" }}>
              Queue at least one change to apply. A saved note rides along with the next apply.
            </p>
          )}
          {applyError && (
            <p
              className="rounded-xl px-3 py-2 text-[13px] font-medium"
              style={{ color: "var(--danger)", background: "var(--danger-soft)" }}
            >
              {applyError}{" "}
              <button
                type="button"
                onClick={() => void applyChanges()}
                className="font-semibold underline underline-offset-2"
              >
                Try again
              </button>
            </p>
          )}
          {pendingChanges.length > 0 && (
            <form action={clearPendingChanges} className="flex justify-end">
              <input type="hidden" name="week_start_date" value={weekStart} />
              <button
                type="submit"
                className="min-h-[36px] text-[13px] font-semibold"
                style={{ color: "var(--ink-3)" }}
              >
                Clear all changes
              </button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
