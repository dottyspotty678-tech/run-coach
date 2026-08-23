import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/service";
import { getTrainingPhase } from "@/lib/trainingPhase";
import { parseTrainingDays } from "@/lib/planTypes";
import {
  boundaryWeekStart,
  formatDateShort,
  formatWeekday,
  londonDateOf,
  londonHourOf,
  londonTimeOf,
  relativeTime,
  todayISO,
  weekDates,
} from "@/components/dates";
import {
  completedCategories,
  getEventsForWeek,
  getPlanForWeek,
  getRecentActivities,
  sessionDone,
  travelDatesFromEvents,
  type CalendarEventRow,
} from "@/components/data";
import { SESSION_META, SessionBadge } from "@/components/session";
import { GeneratePlanButton } from "@/components/generate-plan";
import { ScrollToHash } from "@/components/scroll-to-hash";
import { IconChevronRight, IconTick } from "@/components/icons";

// Reads the DB on every request — never serve a stale prerender.
export const dynamic = "force-dynamic";

export default async function PlanPage() {
  const now = new Date();
  const today = todayISO(now);
  const weekStart = boundaryWeekStart(now);
  const dates = weekDates(weekStart);

  const supabase = createServiceClient();
  const [plan, activities, events, raceGoalRes] = await Promise.all([
    getPlanForWeek(weekStart),
    getRecentActivities(28),
    getEventsForWeek(weekStart),
    supabase.from("race_goal").select("*").eq("id", true).maybeSingle(),
  ]);

  const raceGoal = raceGoalRes.data as {
    race_name: string;
    distance_km: number;
    race_date: string;
  } | null;
  const phaseInfo = raceGoal
    ? getTrainingPhase(new Date(raceGoal.race_date), raceGoal.distance_km, now)
    : null;

  const days = parseTrainingDays(plan);
  const done = completedCategories(activities);
  const eventTravel = travelDatesFromEvents(events, dates);

  // Calendar context strip: per day, travel-flagged events and evening events
  // (starting 17:00 or later London time).
  const contextEvents = new Map<string, CalendarEventRow[]>();
  for (const e of events) {
    if (!e.is_travel && (e.is_all_day || londonHourOf(e.start_time) < 17)) continue;
    const date = londonDateOf(e.start_time);
    if (!dates.includes(date)) continue;
    const list = contextEvents.get(date) ?? [];
    list.push(e);
    contextEvents.set(date, list);
  }

  return (
    <main className="flex flex-col gap-4 px-4 pt-3">
      <ScrollToHash />

      {/* Header */}
      <header className="flex items-start justify-between gap-3 pt-1">
        <div>
          <h1 className="text-[22px] font-semibold leading-7">Plan</h1>
          {plan && (
            <p className="mt-0.5 text-[12px]" style={{ color: "var(--ink-3)" }}>
              Generated {relativeTime(plan.generated_at, now)}
            </p>
          )}
        </div>
        {plan && <GeneratePlanButton hasPlan appearance="compact" />}
      </header>

      {!plan ? (
        <section className="card flex flex-col items-start gap-3 p-5">
          <h2 className="text-[20px] font-semibold">No plan yet for this week</h2>
          <p className="text-[14px]" style={{ color: "var(--ink-2)" }}>
            Generate the week's training and meals from your calendar and recent running.
          </p>
          <GeneratePlanButton hasPlan={false} />
        </section>
      ) : (
        <>
          {/* Week summary */}
          <section className="card flex flex-col gap-2 p-4">
            <div className="flex flex-wrap gap-1.5">
              {phaseInfo && (
                <span className="chip capitalize" style={{ color: "var(--accent)", background: "var(--accent-soft)" }}>
                  {phaseInfo.phase.replace("_", " ")}
                </span>
              )}
              {phaseInfo && phaseInfo.weeksToRace > 0 && (
                <span className="chip" style={{ color: "var(--ink-2)", background: "var(--raised)" }}>
                  {Math.round(phaseInfo.weeksToRace)} weeks to race
                </span>
              )}
              {!phaseInfo && (
                <span className="chip" style={{ color: "var(--ink-2)", background: "var(--raised)" }}>
                  General fitness
                </span>
              )}
            </div>
            <p className="text-[14px] leading-[21px]" style={{ color: "var(--ink-2)" }}>
              {plan.week_summary ||
                "This plan predates the current format — regenerate to get a week summary and day-by-day sessions."}
            </p>
          </section>

          {/* Day cards */}
          {days ? (
            <section className="flex flex-col gap-2">
              {days
                .filter((d) => dates.includes(d.date))
                .map((day) => {
                  const isToday = day.date === today;
                  const meta = SESSION_META[day.session_type];
                  return (
                    <article
                      key={day.date}
                      id={`d${day.date}`}
                      data-today={isToday ? "" : undefined}
                      className="card flex flex-col gap-1.5 p-4"
                      style={isToday ? { borderColor: "var(--accent)" } : undefined}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-semibold" style={{ color: isToday ? "var(--accent)" : "var(--ink-2)" }}>
                          {formatWeekday(day.date)}{" "}
                          <span style={{ color: "var(--ink-3)" }}>{formatDateShort(day.date)}</span>
                          {isToday && " · Today"}
                        </span>
                        <span className="flex items-center gap-1.5">
                          {sessionDone(day.session_type, done.get(day.date)) && (
                            <IconTick size={15} strokeWidth={2.6} style={{ color: "var(--ok)" }} />
                          )}
                          {day.is_travel_day && (
                            <span className="chip" style={{ color: "var(--s-long)", background: "var(--s-long-soft)" }}>
                              Travel
                            </span>
                          )}
                          <SessionBadge type={day.session_type} />
                        </span>
                      </div>
                      <h2 className="text-[17px] font-semibold leading-6">{day.title}</h2>
                      <p className="text-[14px] leading-[21px]">{day.detail}</p>
                      <div className="flex items-baseline justify-between gap-2">
                        <p
                          className="border-l-2 pl-2.5 text-[12px] leading-[17px]"
                          style={{ color: "var(--ink-2)", borderColor: meta.color }}
                        >
                          {day.why}
                        </p>
                        {day.duration_min > 0 && (
                          <span className="shrink-0 text-[13px] font-semibold tabular" style={{ color: "var(--ink-2)" }}>
                            {day.duration_min} min
                          </span>
                        )}
                      </div>
                    </article>
                  );
                })}
            </section>
          ) : (
            <section className="card flex flex-col gap-2 p-4">
              <span className="overline" style={{ color: "var(--ink-2)" }}>
                Training
              </span>
              <p className="whitespace-pre-wrap text-[14px] leading-[21px]">{plan.training_plan_text}</p>
            </section>
          )}
        </>
      )}

      {/* Calendar context strip */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="overline" style={{ color: "var(--ink-2)" }}>
            Calendar this week
          </h2>
          <Link
            href="/calendar"
            className="flex min-h-[44px] items-center gap-0.5 text-[13px] font-semibold"
            style={{ color: "var(--accent)" }}
          >
            Full calendar
            <IconChevronRight size={14} strokeWidth={2.4} />
          </Link>
        </div>
        <div className="card divide-y" style={{ borderColor: "var(--line)" }}>
          {dates.map((date) => {
            const dayEvents = contextEvents.get(date) ?? [];
            return (
              <div key={date} className="flex gap-3 px-4 py-2.5" style={{ borderColor: "var(--line)" }}>
                <span className="w-16 shrink-0 text-[13px] font-semibold" style={{ color: date === today ? "var(--accent)" : "var(--ink-2)" }}>
                  {formatDateShort(date)}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  {dayEvents.length === 0 ? (
                    <span className="text-[13px]" style={{ color: "var(--ink-3)" }}>
                      {eventTravel.has(date) ? "Travelling" : "Evening free"}
                    </span>
                  ) : (
                    dayEvents.map((e) => (
                      <span key={e.external_id} className="flex items-center gap-1.5 text-[13px]">
                        {!e.is_all_day && (
                          <span className="tabular shrink-0" style={{ color: "var(--ink-3)" }}>
                            {londonTimeOf(e.start_time)}
                          </span>
                        )}
                        <span className="truncate">{e.title ?? "(untitled)"}</span>
                        {e.is_travel && (
                          <span className="chip shrink-0" style={{ color: "var(--s-long)", background: "var(--s-long-soft)" }}>
                            Travel
                          </span>
                        )}
                      </span>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
