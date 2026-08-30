import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/service";
import { getTrainingPhase } from "@/lib/trainingPhase";
import { parseTrainingDays, SESSION_TYPES, type TrainingDay } from "@/lib/planTypes";
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
  getRunnerContext,
  isRun,
  sessionDone,
  travelDatesFromEvents,
  type ActivityRow,
  type CalendarEventRow,
} from "@/components/data";
import { SESSION_META } from "@/components/session";
import { GeneratePlanButton } from "@/components/generate-plan";
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

/** A raw activity type ("TrailRun", "easy", "football") as a fingerpost-friendly label. */
function humaniseActivityType(type: string): string {
  const known = SESSION_TYPES.find((t) => t === type.toLowerCase());
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
      const label = humaniseActivityType(a.type) + (a.source === "manual" ? " (logged manually)" : "");
      return { label, figures };
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
    runnerContext,
    pending,
  ] = await Promise.all([
    getPlanForWeek(thisWeekStart),
    getPlanForWeek(nextWeekStart),
    getRecentActivities(28),
    getEventsForWeek(thisWeekStart),
    getEventsForWeek(nextWeekStart),
    supabase.from("race_goal").select("*").eq("id", true).maybeSingle(),
    getRunnerContext(),
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
        actual: isPast ? actualEntriesFor(day.date, activities) : [],
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
            Generate the week&apos;s training and away-day meals from your calendar and recent
            running.
          </p>
          <GeneratePlanButton hasPlan={false} weekStartDate={thisWeekStart} />
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
              <div className="flex shrink-0 flex-col items-end gap-1">
                <GeneratePlanButton hasPlan appearance="compact" weekStartDate={thisWeekStart} />
                <span className="text-[11px]" style={{ color: "var(--ink-3)" }}>
                  Generated {relativeTime(thisPlan.generated_at, now)}
                </span>
              </div>
            </div>
            <p className="text-[14px] leading-[21px]" style={{ color: "var(--ink-2)" }}>
              {thisPlan.week_summary ||
                "This plan predates the current format — regenerate to get a week summary and day-by-day sessions."}
            </p>
            {thisPlan.revision_note && (
              <p className="text-[12px] leading-[17px]" style={{ color: "var(--ink-3)" }}>
                Revised{thisPlan.revised_at ? ` ${relativeTime(thisPlan.revised_at, now)}` : ""} — you
                asked: <span className="italic">&ldquo;{thisPlan.revision_note}&rdquo;</span>
              </p>
            )}
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

          <section className="flex flex-col gap-2">
            <h2 className="overline" style={{ color: "var(--ink-2)" }}>
              This week&apos;s sessions
            </h2>
            {thisWeekReviewRows.length > 0 ? (
              <ThisWeekReview rows={thisWeekReviewRows} />
            ) : (
              <section className="card flex flex-col gap-2 p-4">
                <p className="whitespace-pre-wrap text-[14px] leading-[21px]">
                  {thisPlan.training_plan_text}
                </p>
                <p className="text-[13px]" style={{ color: "var(--ink-2)" }}>
                  Regenerate to get the day-by-day review.
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
            It generates automatically on Sunday evening, once this week&apos;s running is in. You
            can also generate it now.
          </p>
          <GeneratePlanButton
            hasPlan={false}
            weekStartDate={nextWeekStart}
            weekLabel="next week's"
          />
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
              <div className="flex shrink-0 flex-col items-end gap-1">
                <GeneratePlanButton
                  hasPlan
                  appearance="compact"
                  weekStartDate={nextWeekStart}
                  weekLabel="next week's"
                />
                <span className="text-[11px]" style={{ color: "var(--ink-3)" }}>
                  Generated {relativeTime(nextPlan.generated_at, now)}
                </span>
              </div>
            </div>
            <p className="text-[14px] leading-[21px]" style={{ color: "var(--ink-2)" }}>
              {nextPlan.week_summary ||
                "This plan predates the current format — regenerate to get a week summary and day-by-day sessions."}
            </p>
            {nextPlan.revision_note && (
              <p className="text-[12px] leading-[17px]" style={{ color: "var(--ink-3)" }}>
                Revised{nextPlan.revised_at ? ` ${relativeTime(nextPlan.revised_at, now)}` : ""} — you
                asked: <span className="italic">&ldquo;{nextPlan.revision_note}&rdquo;</span>
              </p>
            )}
            {runnerContext?.injuries && (
              <p className="text-[13px] leading-[18px]" style={{ color: "var(--warn)" }}>
                Working around: {runnerContext.injuries}
              </p>
            )}
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
              <p className="whitespace-pre-wrap text-[14px] leading-[21px]">
                {nextPlan.training_plan_text}
              </p>
              <p className="text-[13px]" style={{ color: "var(--ink-2)" }}>
                Regenerate to get the day-by-day table and editing.
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
