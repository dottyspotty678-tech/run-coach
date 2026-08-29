import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/service";
import { getTrainingPhase } from "@/lib/trainingPhase";
import { parseTrainingDays, type TrainingDay } from "@/lib/planTypes";
import {
  addDays,
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
  getPendingChanges,
  getPlanForWeek,
  getRecentActivities,
  getRunnerContext,
  sessionDone,
  travelDatesFromEvents,
  type CalendarEventRow,
} from "@/components/data";
import { GeneratePlanButton } from "@/components/generate-plan";
import { IconChevronRight } from "@/components/icons";
import { PlanTable, type PlanTableRow } from "./plan-table";

// Reads the DB on every request — never serve a stale prerender.
export const dynamic = "force-dynamic";

/** The sketch's Volume column: "15 km", "45 min", "Gym", "Rest". */
function volumeFor(day: TrainingDay): string {
  if (day.session_type === "rest") return "Rest";
  if (day.session_type === "strength") return "Gym";
  const km = `${day.title} ${day.detail}`.match(/(\d+(?:[.,]\d+)?)\s*km\b/i);
  if (km) return `${km[1].replace(",", ".")} km`;
  return day.duration_min > 0 ? `${day.duration_min} min` : "—";
}

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const { edit } = await searchParams;
  const now = new Date();
  const today = todayISO(now);
  const weekStart = boundaryWeekStart(now);
  const dates = weekDates(weekStart);
  const tomorrow = addDays(today, 1);

  const supabase = createServiceClient();
  const [plan, activities, events, raceGoalRes, runnerContext, pending] = await Promise.all([
    getPlanForWeek(weekStart),
    getRecentActivities(28),
    getEventsForWeek(weekStart),
    supabase.from("race_goal").select("*").eq("id", true).maybeSingle(),
    getRunnerContext(),
    getPendingChanges(weekStart),
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

  // V2 table rows: today first, then forward, past days at the end (sketch:
  // Today, Tomorrow, N+2…). On Sunday evening the shown week is next week, so
  // every day is "upcoming" and natural Monday order holds.
  const weekDays = (days ?? []).filter((d) => dates.includes(d.date));
  const upcoming = weekDays.filter((d) => d.date >= today);
  const past = weekDays.filter((d) => d.date < today);
  const rows: PlanTableRow[] = [...upcoming, ...past].map((day) => ({
    date: day.date,
    dayLabel:
      day.date === today
        ? "Today"
        : day.date === tomorrow
          ? "Tomorrow"
          : formatWeekday(day.date),
    dateLabel: formatDateShort(day.date),
    volume: volumeFor(day),
    session_type: day.session_type,
    title: day.title,
    detail: day.detail,
    why: day.why,
    duration_min: day.duration_min,
    is_travel_day: day.is_travel_day,
    isToday: day.date === today,
    isPast: day.date < today,
    done: sessionDone(day.session_type, done.get(day.date)),
  }));

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
      {/* Header */}
      <header className="flex items-start justify-between gap-3 pt-1">
        <div>
          <h1 className="display text-[26px] leading-8">Plan</h1>
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
            Generate the week&apos;s training and away-day meals from your calendar and recent
            running.
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
            {/* Audit read-back: the note behind the current stored plan (U7);
                cleared automatically by the next fresh generation. */}
            {plan.revision_note && (
              <p className="text-[12px] leading-[17px]" style={{ color: "var(--ink-3)" }}>
                Revised{plan.revised_at ? ` ${relativeTime(plan.revised_at, now)}` : ""} — you
                asked: <span className="italic">&ldquo;{plan.revision_note}&rdquo;</span>
              </p>
            )}
            {/* Runner context read-back (§3.11): what the planner is working around. */}
            {runnerContext?.injuries && (
              <p className="text-[13px] leading-[18px]" style={{ color: "var(--warn)" }}>
                Working around: {runnerContext.injuries}
              </p>
            )}
            <Link
              href="/checkin"
              className="flex min-h-[36px] w-fit items-center gap-0.5 text-[13px] font-semibold"
              style={{ color: "var(--accent)" }}
            >
              Check-in — injuries and how the week felt
              <IconChevronRight size={14} strokeWidth={2.4} />
            </Link>
          </section>

          {/* V2 table + edit mode (replaces the day cards and the old
              "Suggest changes" card — one editing concept). */}
          {rows.length > 0 ? (
            <PlanTable
              rows={rows}
              weekStart={weekStart}
              pendingChanges={pending?.changes ?? []}
              checkinNote={pending?.checkin_note ?? ""}
              initialEdit={edit === "1"}
            />
          ) : (
            <section className="card flex flex-col gap-2 p-4">
              <span className="overline" style={{ color: "var(--ink-2)" }}>
                Training
              </span>
              <p className="whitespace-pre-wrap text-[14px] leading-[21px]">{plan.training_plan_text}</p>
              <p className="text-[13px]" style={{ color: "var(--ink-2)" }}>
                Regenerate to get the day-by-day table and editing.
              </p>
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
                <span className="tabular w-16 shrink-0 text-[12px] font-semibold" style={{ color: date === today ? "var(--accent)" : "var(--ink-2)" }}>
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
