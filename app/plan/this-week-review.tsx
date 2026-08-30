"use client";

import { useState } from "react";
import type { SessionType } from "@/lib/planTypes";
import { SESSION_META, SessionBadge } from "@/components/session";
import { IconTick } from "@/components/icons";
import { RouteLine, WaymarkNode } from "./route-node";

// This week (the review surface — brief §2): the route card, read-only.
// Past days show the planned session alongside a Done/Missed state and what
// was actually logged; today is ringed in heather; future days of this week
// read as plain upcoming entries. No batch-edit UI lives here.

export type ReviewRow = {
  date: string;
  /** "Today" / "Tomorrow" / "Monday" */
  dayLabel: string;
  /** "11 Aug" */
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
  /** Type-aware completion tick (sessionDone) — unchanged matching rules. */
  done: boolean;
  /** What was actually logged that day (Strava + manual, merged) — [] when nothing. */
  actual: { label: string; figures: string }[];
};

export function ThisWeekReview({ rows }: { rows: ReviewRow[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="card overflow-hidden">
      <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
        {rows.map((row) => {
          const isOpen = expanded === row.date;
          const meta = SESSION_META[row.session_type];
          const showStatus = row.isPast && row.session_type !== "rest";
          const showActual = row.isPast && row.actual.length > 0;
          const titleColor = row.isToday ? "var(--ink)" : row.isPast ? "var(--ink-2)" : "var(--ink)";

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
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[13px]" style={{ color: titleColor }}>
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
                </span>
                <span
                  className="tabular pt-0.5 text-[12.5px] font-medium leading-4"
                  style={{ color: "var(--ink-2)" }}
                >
                  {row.volume}
                </span>

                {/* The review line: done/missed + what actually happened. */}
                {(showStatus || showActual) && (
                  <span className="col-start-3 col-span-2 flex flex-col items-start gap-1 pt-0.5">
                    {showStatus && (
                      <span
                        className="chip"
                        style={
                          row.done
                            ? { color: "var(--ok)", background: "var(--ok-soft)" }
                            : { color: "var(--danger)", background: "var(--danger-soft)" }
                        }
                      >
                        {row.done ? "Done" : "Missed"}
                      </span>
                    )}
                    {showActual && (
                      <span className="text-[12px] leading-[16px]" style={{ color: "var(--ink-2)" }}>
                        Logged:{" "}
                        {row.actual.map((a, i) => (
                          <span key={i}>
                            {i > 0 && "; "}
                            {a.label}
                            {a.figures && (
                              <>
                                {" "}
                                <span className="tabular">{a.figures}</span>
                              </>
                            )}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                )}
              </button>

              {isOpen && (
                <div
                  className="flex flex-col gap-1.5 border-t px-4 py-3"
                  style={{ borderColor: "var(--line)" }}
                >
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
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
