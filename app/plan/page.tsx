import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/service";
import { getTrainingPhase } from "@/lib/trainingPhase";
import {
  parseTrainingDays,
  SESSION_TYPES,
  type TrainingDay,
  type WeeklyPlanRow,
} from "@/lib/planTypes";
import {
  addDays,
  formatDateShort,
  formatWeekday,
  londonDateOf,
  londonHourOf,
  londonTimeOf,
  mondayOf,
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
  isRun,
  sessionDone,
  travelDatesFromEvents,
  type ActivityRow,
  type CalendarEventRow,
} from "@/components/data";
import { SESSION_META } from "@/components/session";
import { IconChevronRight } from "@/components/icons";
import { PlanWeekToggle } from "./week-toggle";
import { ThisWeekReview, type ReviewRow } from "./this-week-review";
import { NextWeekPlan, type PlanRow } from "./next-week-plan";

// Reads the DB on every request — never serve a stale prerender.
export const dynamic = "force-dynamic";

/** The route card's Volume column: "15 km", "45 min", "Gym", "Rest". */
function volumeFor(day: TrainingDay): string {
  if (day.session_type === "rest") return "Rest";
  if (day.session_type === "strength") return "Gym";
  const km = `${day.title} ${day.detail}`.match(/(\d+(?:[.,]\d+)?)\s*km\b/i);
  if (km) return `${km[1].replace(",", ".")} km`;
  return day.duration_min > 0 ? `${day.duration_min} min` : "—";
}

/** Week-at-a-glance figures for the stat strip — summed from the structured
 *  training days (never parsed from the coach's week_summary prose): total
 *  weekly volume in minutes (duration_min covers every session type, unlike
 *  km) and a count of non-rest sessions. */
function weekStats(days: TrainingDay[] | null): { totalMin: number; sessionCount: number } | null {
  if (!days || days.length === 0) return null;
  let totalMin = 0;
  let sessionCount = 0;
  for (const day of days) {
    if (day.session_type === "rest") continue;
    sessionCount += 1;
    totalMin += day.duration_min;
  }
  return { totalMin, sessionCount };
}

/** 320 min → "5:20" (hours:minutes, tabular). */
function formatHours(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

/**
 * The week_summary block, contained: a one-line stat strip (km, sessions,
 * a "Revised" hint) stands in for the coach's paragraph, which moves behind
 * a "Summary" disclosure — the same details/summary pattern as the Nutrition
 * screen's recipe cards — alongside the revision-note quote when present.
 * Falls back to a short note when the plan predates structured days.
 */
function WeekSummarySection({
  plan,
  days,
  now,
  showCheckinLink = false,
}: {
  plan: WeeklyPlanRow;
  days: TrainingDay[] | null;
  now: Date;
  showCheckinLink?: boolean;
}) {
  const stats = weekStats(days);
  return (
    <>
      {stats ? (
        <details className="group">
          <summary className="flex min-h-[32px] cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
            <span className="stat-strip">
              <span className="text-[15px] font-semibold" style={{ color: "var(--ink)" }}>
                <span className="tabular">{formatHours(stats.totalMin)}</span>{" "}
                <span className="text-[12px] font-medium" style={{ color: "var(--ink-2)" }}>
                  hrs
                </span>
              </span>
              <span className="stat-strip-sep" aria-hidden="true" />
              <span className="text-[15px] font-semibold" style={{ color: "var(--ink)" }}>
                <span className="tabular">{stats.sessionCount}</span>{" "}
                <span className="text-[12px] font-medium" style={{ color: "var(--ink-2)" }}>
                  sessions
                </span>
              </span>
              {plan.revision_note && (
                <span className="chip" style={{ color: "var(--ink-2)", background: "var(--raised)" }}>
                  Revised
                </span>
              )}
            </span>
            <span className="shrink-0 text-[12px] font-semibold" style={{ color: "var(--accent)" }}>
              <span className="group-open:hidden">Summary</span>
              <span className="hidden group-open:inline">Close</span>
            </span>
          </summary>
          <div className="flex flex-col gap-1.5 pt-2">
            {plan.week_summary && (
              <p className="text-[14px] leading-[21px]" style={{ color: "var(--ink-2)" }}>
                {plan.week_summary}
              </p>
            )}
            {plan.revision_note && (
              <p className="text-[12px] leading-[17px]" style={{ color: "var(--ink-3)" }}>
                Revised{plan.revised_at ? ` ${relativeTime(plan.revised_at, now)}` : ""} — you
                asked: <span className="italic">&ldquo;{plan.revision_note}&rdquo;</span>
              </p>
            )}
          </div>
        </details>
      ) : (
        <p className="text-[13px]" style={{ color: "var(--ink-2)" }}>
          Old plan format — regenerate for full details.
        </p>
      )}
      {showCheckinLink && (
        <Link
          href="/checkin"
          className="flex min-h-[36px] w-fit items-center gap-0.5 text-[13px] font-semibold"
          style={{ color: "var(--accent)" }}
        >
          Check-in — injuries and how the week felt
          <IconChevronRight size={14} strokeWidth={2.4} />
        </Link>
      )}
    </>
  );
}

/** "Today" / "Tomorrow" / "Monday" — shared by both weeks' rows. */
function dayLabelFor(date: string, today: string, tomorrow: string): string {
  if (date === today) return "Today";
  if (date === tomorrow) return "Tomorrow";
  return formatWeekday(date);
}

/** "11–17 Aug" (or "29 Aug – 4 Sep" across a month boundary). */
function weekRangeLabel(weekStart: string): string {
  const startLabel = formatDateShort(weekStart);
  const endLabel = formatDateShort(addDays(weekStart, 6));
  const [startDay, startMonth] = startLabel.split(" ");
  const [endDay, endMonth] = endLabel.split(" ");
  return startMonth === endMonth ? `${startDay}–${endDay} ${endMonth}` : `${startLabel} – ${endLabel}`;
}

/** A raw activity type ("TrailRun", "easy", "football") matched against the
 *  plan's fixed session types when possible — feeds both the label and the
 *  logged line's waymark-dot colour below. */
function matchedSessionType(type: string) {
  return SESSION_TYPES.find((t) => t === type.toLowerCase()) ?? null;
}

/** A raw activity type as a fingerpost-friendly label. */
function humaniseActivityType(type: string): string {
  const known = matchedSessionType(type);
  if (known) return SESSION_META[known].label;
  return type.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

/** What was actually logged on one date — Strava + manual, already merged by getRecentActivities. */
function actualEntriesFor(date: string, activities: ActivityRow[]): ReviewRow["actual"] {
  return activities
    .filter((a) => londonDateOf(a.start_date) === date)
    .map((a) => {
      const distanceKm = a.distance_m / 1000;
      const durationMin = Math.round(a.duration_s / 60);
      const figures = [
        isRun(a.type) && distanceKm > 0 ? `${distanceKm.toFixed(1)} km` : null,
        durationMin > 0 ? `${durationMin} min` : null,
      ]
        .filter((v): v is string => v !== null)
        .join(" · ");
      const known = matchedSessionType(a.type);
      return {
        label: humaniseActivityType(a.type),
        figures,
        color: known ? SESSION_META[known].color : "var(--ink-3)",
        manual: a.source === "manual",
      };
    });
}

/** Calendar context strip — travel-flagged events and evening events (17:00+ London), per day. */
function CalendarStrip({
  dates,
  today,
  events,
}: {
  dates: string[];
  today: string;
  events: CalendarEventRow[];
}) {
  const eventTravel = travelDatesFromEvents(events, dates);
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
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="overline" style={{ color: "var(--ink-2)" }}>
          Calendar
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
              <span
                className="tabular w-16 shrink-0 text-[12px] font-semibold"
                style={{ color: date === today ? "var(--accent)" : "var(--ink-2)" }}
              >
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
  );
}

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const { edit } = await searchParams;
  const now = new Date();
  const today = todayISO(now);
  const tomorrow = addDays(today, 1);
  const thisWeekStart = mondayOf(today);
  const nextWeekStart = addDays(thisWeekStart, 7);
  const thisWeekDates = weekDates(thisWeekStart);
  const nextWeekDates = weekDates(nextWeekStart);

  const supabase = createServiceClient();
  const [
    thisPlan,
    nextPlan,
    activities,
    eventsThis,
    eventsNext,
    raceGoalRes,
    pending,
  ] = await Promise.all([
    getPlanForWeek(thisWeekStart),
    getPlanForWeek(nextWeekStart),
    getRecentActivities(28),
    getEventsForWeek(thisWeekStart),
    getEventsForWeek(nextWeekStart),
    supabase.from("race_goal").select("*").eq("id", true).maybeSingle(),
    getPendingChanges(nextWeekStart),
  ]);

  const raceGoal = raceGoalRes.data as {
    race_name: string;
    distance_km: number;
    race_date: string;
  } | null;
  const phaseInfo = raceGoal
    ? getTrainingPhase(new Date(raceGoal.race_date), raceGoal.distance_km, now)
    : null;

  const done = completedCategories(activities);

  // --- This week (the review surface) ---
  const thisDays = parseTrainingDays(thisPlan);
  const thisWeekReviewRows: ReviewRow[] = (thisDays ?? [])
    .filter((d) => thisWeekDates.includes(d.date))
    .map((day) => {
      const isPast = day.date < today;
      return {
        date: day.date,
        dayLabel: dayLabelFor(day.date, today, tomorrow),
        dateLabel: formatDateShort(day.date),
        volume: volumeFor(day),
        session_type: day.session_type,
        title: day.title,
        detail: day.detail,
        why: day.why,
        duration_min: day.duration_min,
        is_travel_day: day.is_travel_day,
        isToday: day.date === today,
        isPast,
        done: sessionDone(day.session_type, done.get(day.date)),
        // Today's already-logged activities matter too (brief §1) — only
        // strictly-future days have nothing to show yet.
        actual: day.date <= today ? actualEntriesFor(day.date, activities) : [],
      };
    });

  // --- Next week (the planning surface) ---
  const nextDays = parseTrainingDays(nextPlan);
  const nextWeekRows: PlanRow[] = (nextDays ?? [])
    .filter((d) => nextWeekDates.includes(d.date))
    .map((day) => ({
      date: day.date,
      dayLabel: dayLabelFor(day.date, today, tomorrow),
      dateLabel: formatDateShort(day.date),
      volume: volumeFor(day),
      session_type: day.session_type,
      title: day.title,
      detail: day.detail,
      why: day.why,
      duration_min: day.duration_min,
      is_travel_day: day.is_travel_day,
    }));

  const thisWeekContent = (
    <>
      {!thisPlan ? (
        <section className="card flex flex-col items-start gap-3 p-5">
          <h2 className="text-[20px] font-semibold">No plan yet for this week</h2>
          <p className="text-[14px]" style={{ color: "var(--ink-2)" }}>
            The coach builds it at your Sunday check-in.
          </p>
          <Link href="/checkin" className="btn-primary">
            Start a check-in
          </Link>
        </section>
      ) : (
        <>
          <section className="card flex flex-col gap-2 p-4">
            <div className="flex items-start justify-between gap-2">
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
              <span className="shrink-0 pt-1 text-[11px]" style={{ color: "var(--ink-3)" }}>
                Generated {relativeTime(thisPlan.generated_at, now)}
              </span>
            </div>
            <WeekSummarySection
              plan={thisPlan}
              days={thisDays}
              now={now}
              showCheckinLink
            />
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="overline" style={{ color: "var(--ink-2)" }}>
              This week&apos;s sessions
            </h2>
            {thisWeekReviewRows.length > 0 ? (
              <ThisWeekReview rows={thisWeekReviewRows} />
            ) : (
              <section className="card flex flex-col gap-2 p-4">
                <p className="line-clamp-4 whitespace-pre-wrap text-[14px] leading-[21px]">
                  {thisPlan.training_plan_text}
                </p>
                <p className="text-[13px]" style={{ color: "var(--ink-2)" }}>
                  Regenerate for the day-by-day view.
                </p>
              </section>
            )}
          </section>
        </>
      )}

      <CalendarStrip dates={thisWeekDates} today={today} events={eventsThis} />
    </>
  );

  const nextWeekContent = (
    <>
      {!nextPlan ? (
        <section className="card flex flex-col items-start gap-3 p-5">
          <h2 className="text-[20px] font-semibold">Next week&apos;s plan isn&apos;t ready yet</h2>
          <p className="text-[14px]" style={{ color: "var(--ink-2)" }}>
            Generates Sunday evening — or ask the coach in a check-in.
          </p>
          <Link href="/checkin" className="btn-primary">
            Start a check-in
          </Link>
        </section>
      ) : (
        <>
          <section className="card flex flex-col gap-2 p-4">
            <div className="flex items-start justify-between gap-2">
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
              <span className="shrink-0 pt-1 text-[11px]" style={{ color: "var(--ink-3)" }}>
                Generated {relativeTime(nextPlan.generated_at, now)}
              </span>
            </div>
            <WeekSummarySection
              plan={nextPlan}
              days={nextDays}
              now={now}
            />
          </section>

          {nextWeekRows.length > 0 ? (
            <NextWeekPlan
              rows={nextWeekRows}
              weekStart={nextWeekStart}
              pendingChanges={pending?.changes ?? []}
              checkinNote={pending?.checkin_note ?? ""}
              initialEdit={edit === "1"}
            />
          ) : (
            <section className="card flex flex-col gap-2 p-4">
              <span className="overline" style={{ color: "var(--ink-2)" }}>
                Training
              </span>
              <p className="line-clamp-4 whitespace-pre-wrap text-[14px] leading-[21px]">
                {nextPlan.training_plan_text}
              </p>
              <p className="text-[13px]" style={{ color: "var(--ink-2)" }}>
                Regenerate for day-by-day editing.
              </p>
            </section>
          )}
        </>
      )}

      <CalendarStrip dates={nextWeekDates} today={today} events={eventsNext} />
    </>
  );

  return (
    <main className="flex flex-col gap-4 px-4 pt-3">
      <header className="pt-1">
        <h1 className="display text-[26px] leading-8">Plan</h1>
      </header>

      <PlanWeekToggle
        initialTab={edit === "1" ? "next" : "this"}
        thisWeek={
          <>
            <p className="text-[12px]" style={{ color: "var(--ink-3)" }}>
              {weekRangeLabel(thisWeekStart)}
            </p>
            {thisWeekContent}
          </>
        }
        nextWeek={
          <>
            <p className="text-[12px]" style={{ color: "var(--ink-3)" }}>
              {weekRangeLabel(nextWeekStart)}
            </p>
            {nextWeekContent}
          </>
        }
      />
    </main>
  );
}
