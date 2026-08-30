"use client";

import { useState } from "react";
import type { SessionType } from "@/lib/planTypes";
import { SESSION_META, SessionBadge } from "@/components/session";
import { LogSessionButton } from "@/app/activities/log-session";
import { RouteLine, WaymarkNode } from "./route-node";

// This week (the review surface — brief §2): the route card, read-only.
// Collapsed rows are a split-sheet of what actually happened — a past (or
// today-logged) day shows ONLY the logged activity/activities, a past day
// with nothing logged shows one quiet line, and a day that hasn't happened
// yet (or today before anything's logged) still shows the day's instruction.
// The planned session's full detail (title/detail/why) only appears once a
// day is expanded, alongside the logged activities for comparison. No
// batch-edit UI lives here.

export type ReviewRow = {
  date: string;
  /** "Today" / "Tomorrow" / "Monday" */
  dayLabel: string;
  /** "11 Aug" */
  dateLabel: string;
  /** "15 km" / "45 min" / "Gym" / "Rest" — the PLANNED volume. */
  volume: string;
  session_type: SessionType;
  title: string;
  detail: string;
  why: string;
  duration_min: number;
  is_travel_day: boolean;
  isToday: boolean;
  isPast: boolean;
  /** Type-aware completion tick (sessionDone) — unchanged matching rules. */
  done: boolean;
  /** What was actually logged that day (Strava + manual, merged) — [] when
   *  nothing (always [] for days later than today). */
  actual: { label: string; figures: string; color: string; manual: boolean }[];
};

/** One logged activity: a waymark dot in its matched session colour, the
 *  label, and its own figures right-aligned — the "row's volume column"
 *  repeated per line so several activities stack cleanly. */
function ActualLine({ entry }: { entry: ReviewRow["actual"][number] }) {
  return (
    <span className="flex min-w-0 items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: entry.color }}
          aria-hidden="true"
        />
        <span className="text-[13px] leading-[17px]" style={{ color: "var(--ink)" }}>
          {entry.label}
        </span>
      </span>
      {entry.figures && (
        <span className="tabular shrink-0 pl-2 text-[12.5px] font-medium" style={{ color: "var(--ink-2)" }}>
          {entry.figures}
        </span>
      )}
    </span>
  );
}

/** A colour-only signal always gets a text label alongside (accessibility
 *  rule) — a small screen-reader-only travel marker, visually just a dot. */
function TravelDot() {
  return (
    <span
      className="h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ background: "var(--s-long)" }}
      aria-label="Travel day"
    />
  );
}

export function ThisWeekReview({ rows }: { rows: ReviewRow[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="card overflow-hidden">
      <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
        {rows.map((row) => {
          const isOpen = expanded === row.date;
          const meta = SESSION_META[row.session_type];
          const isRestDay = row.session_type === "rest";
          const hasActual = row.actual.length > 0;

          // Collapsed state machine (brief §1/§3): a closed day (isPast) or
          // today-once-something's-logged shows the logged activities only;
          // a closed day with nothing shows one quiet line; anything else
          // (future days, or today before it's logged) still shows the plan.
          const showLogged = hasActual && (row.isPast || row.isToday);
          const showEmpty = row.isPast && !hasActual;
          const showPlanned = !showLogged && !showEmpty;
          // The one nuance worth a signal collapsed: something was logged but
          // it doesn't match what was planned (sessionDone false) — everything
          // else (a plain match, or genuinely nothing) is already legible from
          // the content alone, so no extra chip clutters those cases.
          const showMismatch = row.isPast && hasActual && !row.done && !isRestDay;

          return (
            <li key={row.date} style={{ borderColor: "var(--line)" }}>
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : row.date)}
                aria-expanded={isOpen}
                className="relative grid w-full grid-cols-[24px_64px_1fr_auto] items-start gap-x-2 gap-y-1.5 py-3 pl-4 pr-4 text-left"
              >
                <RouteLine />
                <span className="pt-0.5">
                  <WaymarkNode color={meta.color} ringed={row.isToday} />
                </span>
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

                {showPlanned && (
                  <>
                    <span className="flex min-w-0 items-center gap-1.5">
                      {/* Titles are ≤3-word labels by contract — wrap, never clip. */}
                      <span className="text-[13px] leading-[17px]" style={{ color: "var(--ink)" }}>
                        {row.title}
                      </span>
                      {row.is_travel_day && <TravelDot />}
                    </span>
                    <span
                      className="tabular pt-0.5 text-[12.5px] font-medium leading-4"
                      style={{ color: "var(--ink-2)" }}
                    >
                      {row.volume}
                    </span>
                  </>
                )}

                {showEmpty && (
                  <span className="col-span-2 col-start-3 flex items-center gap-1.5 pt-0.5">
                    <span className="text-[13px]" style={{ color: "var(--ink-3)" }}>
                      {isRestDay ? "Rest day" : "Nothing logged"}
                    </span>
                    {row.is_travel_day && <TravelDot />}
                  </span>
                )}

                {showLogged && (
                  <span className="col-span-2 col-start-3 flex flex-col gap-1">
                    {row.actual.map((entry, i) => (
                      <ActualLine key={i} entry={entry} />
                    ))}
                  </span>
                )}
              </button>

              {isOpen && (
                <div
                  className="flex flex-col gap-1.5 border-t px-4 py-3"
                  style={{ borderColor: "var(--line)" }}
                >
                  {hasActual && (
                    <span className="flex items-center gap-2">
                      <span className="overline" style={{ color: "var(--ink-2)" }}>
                        Planned
                      </span>
                      {showMismatch && (
                        <span className="chip" style={{ color: "var(--danger)", background: "var(--danger-soft)" }}>
                          Missed
                        </span>
                      )}
                    </span>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <SessionBadge type={row.session_type} />
                    {row.duration_min > 0 && (
                      <span className="display text-[15px]" style={{ color: "var(--ink)" }}>
                        {row.duration_min} <span style={{ color: "var(--ink-2)" }}>min</span>
                      </span>
                    )}
                  </div>
                  <h3 className="display text-[19px] leading-[23px]">{row.title}</h3>
                  <p className="text-[14px] leading-[21px]">{row.detail}</p>
                  <p className="path-aside text-[12px] leading-[17px]" style={{ color: meta.color }}>
                    <span style={{ color: "var(--ink-2)" }}>{row.why}</span>
                  </p>

                  {hasActual && (
                    <div className="flex flex-col gap-1 border-t pt-2" style={{ borderColor: "var(--line)" }}>
                      <span className="overline" style={{ color: "var(--ink-2)" }}>
                        What you did
                      </span>
                      {row.actual.map((entry, i) => (
                        <ActualLine key={i} entry={entry} />
                      ))}
                    </div>
                  )}

                  {/* Past days: backfill a session that never reached Strava.
                      Pre-filled with this date and the planned type; the sheet
                      writes through addManualActivity, which revalidates /plan
                      so the collapsed row updates on save. */}
                  {row.isPast && (
                    <div className="pt-1.5">
                      <LogSessionButton
                        todayIso={row.date}
                        defaultType={row.session_type === "rest" ? "" : row.session_type}
                        appearance="secondary"
                        label={hasActual ? "Log another session" : `Log a session for ${row.dateLabel}`}
                      />
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
