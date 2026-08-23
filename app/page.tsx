import Link from "next/link";
import { getTrainingPhase } from "@/lib/trainingPhase";
import { createServiceClient } from "@/lib/supabase/service";
import { isStravaConnected } from "@/lib/strava";
import { isMicrosoftConnected } from "@/lib/microsoft";
import {
  parseTrainingDays,
  parseMeals,
  parseLegacyMeals,
  type TrainingDay,
} from "@/lib/planTypes";
import {
  boundaryWeekStart,
  formatDayShort,
  isSundayEvening,
  londonParts,
  mondayOf,
  relativeTime,
  todayISO,
  weekDates,
} from "@/components/dates";
import {
  completedCategories,
  getEventsForWeek,
  getPlanForWeek,
  getRecentActivities,
  getRecentFeedback,
  getRunnerContext,
  getSyncStatus,
  lastSuccessfulSync,
  runKm,
  sessionDone,
  travelDatesFromEvents,
} from "@/components/data";
import { SESSION_META, SessionBadge, MealBadge } from "@/components/session";
import { Banner } from "@/components/banner";
import { GeneratePlanButton } from "@/components/generate-plan";
import { PullRefresh } from "@/components/pull-refresh";
import { LogSessionButton } from "@/app/activities/log-session";
import { IconChevronRight, IconTick } from "@/components/icons";

// Reads the DB on every request — never serve a stale prerender.
export const dynamic = "force-dynamic";

type RaceGoalRow = {
  race_name: string;
  distance_km: number;
  race_date: string;
  target_time: string | null;
};

export default async function TodayPage() {
  const now = new Date();
  const today = todayISO(now);
  const heroWeekStart = mondayOf(today); // week that contains today
  const stripWeekStart = boundaryWeekStart(now); // week the strip/banner shows

  const supabase = createServiceClient();
  const [
    heroPlan,
    stripPlan,
    activities,
    stravaConnected,
    microsoftConnected,
    syncStatus,
    events,
    raceGoalRes,
    runnerContext,
    recentFeedback,
  ] = await Promise.all([
    getPlanForWeek(heroWeekStart),
    stripWeekStart === heroWeekStart
      ? Promise.resolve(null)
      : getPlanForWeek(stripWeekStart),
    getRecentActivities(28),
    isStravaConnected(),
    isMicrosoftConnected(),
    getSyncStatus(),
    getEventsForWeek(stripWeekStart),
    supabase.from("race_goal").select("*").eq("id", true).maybeSingle(),
    getRunnerContext(),
    getRecentFeedback(1),
  ]);

  const shownStripPlan = stripWeekStart === heroWeekStart ? heroPlan : stripPlan;
  const raceGoal = (raceGoalRes.data as RaceGoalRow | null) ?? null;

  // --- Hero: today's session ---
  const heroDays = parseTrainingDays(heroPlan);
  const todaySession = heroDays?.find((d) => d.date === today) ?? null;
  const heroMeals = parseMeals(heroPlan);
  const todayMeal = heroMeals?.find((m) => m.date === today) ?? null;
  const legacyMeal = heroMeals
    ? null
    : parseLegacyMeals(heroPlan).find((m) => m.date === today) ?? null;

  // --- Context chips ---
  const stripDates = weekDates(stripWeekStart);
  const eventTravelDates = travelDatesFromEvents(events, stripDates);
  const isTravelToday = todaySession
    ? todaySession.is_travel_day
    : eventTravelDates.has(today);

  const phaseInfo = raceGoal
    ? getTrainingPhase(new Date(raceGoal.race_date), raceGoal.distance_km, now)
    : null;
  const raceChip =
    raceGoal && phaseInfo && phaseInfo.weeksToRace > 0 && phaseInfo.weeksToRace <= 12
      ? phaseInfo.weeksToRace * 7 <= 14
        ? `${Math.max(1, Math.round(phaseInfo.weeksToRace * 7))} days to ${raceGoal.race_name}`
        : `${Math.round(phaseInfo.weeksToRace)} weeks to ${raceGoal.race_name}`
      : null;

  // --- Snapshot stats (running only — U1) ---
  const last7Km = runKm(activities, 7, now);
  const last28Km = runKm(activities, undefined, now);
  const done = completedCategories(activities);

  // --- Banners ---
  const lastSync = lastSuccessfulSync(syncStatus);
  const syncStale =
    lastSync !== null && now.getTime() - new Date(lastSync).getTime() > 24 * 3600000;
  const stravaBroken = !stravaConnected || !!syncStatus.strava?.last_error;
  const microsoftBroken = !microsoftConnected || !!syncStatus.microsoft?.last_error;

  // --- Sunday evening (m-2 rework): from 17:00 the whole app already shows
  // next week, so "plan ready" frames the week strip instead of shouting from
  // a separate banner about the same week the user is looking at.
  const sundayEvening = isSundayEvening(now);
  const planReady = sundayEvening && shownStripPlan !== null;

  // --- Check-in (§3.11): Sunday nudge when this week's note is still empty.
  const isSunday = londonParts(now).weekday === 7;
  const hasThisWeeksFeedback = recentFeedback.some(
    (f) => f.week_start_date === heroWeekStart
  );
  const showCheckinNudge = isSunday && !hasThisWeeksFeedback;

  // --- Strip sessions (travel fallback from events when plan is old-format) ---
  const stripDays = parseTrainingDays(shownStripPlan);
  const stripByDate = new Map<string, TrainingDay>(
    (stripDays ?? []).map((d) => [d.date, d])
  );

  const hasAnyPlan = heroPlan !== null;

  return (
    <PullRefresh>
      <main className="flex flex-col gap-4 px-4 pt-3">
        {/* Header */}
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5 pt-1">
          <h1 className="text-[22px] font-semibold leading-7">{formatDayShort(today)}</h1>
          <div className="flex flex-wrap gap-1.5">
            {isTravelToday && (
              <span className="chip" style={{ color: "var(--s-long)", background: "var(--s-long-soft)" }}>
                Travel day
              </span>
            )}
            {phaseInfo?.phase === "race_week" && (
              <span className="chip" style={{ color: "var(--accent)", background: "var(--accent-soft)" }}>
                Race week
              </span>
            )}
            {raceChip && (
              <span className="chip" style={{ color: "var(--ink-2)", background: "var(--raised)" }}>
                {raceChip}
              </span>
            )}
          </div>
        </header>

        {/* Banners */}
        {showCheckinNudge && (
          <Banner variant="info" href="/checkin" linkLabel="Check in">
            How did this week feel? A 30-second note shapes next week's plan
          </Banner>
        )}
        {stravaBroken && (
          <Banner variant="warn" href="/settings#connections" linkLabel="Settings">
            {stravaConnected ? "Strava sync failing — reconnect" : "Strava disconnected — reconnect"} in Settings
          </Banner>
        )}
        {microsoftBroken && (
          <Banner variant="warn" href="/settings#connections" linkLabel="Settings">
            {microsoftConnected ? "Calendar sync failing — reconnect" : "Calendar disconnected — reconnect"} in Settings
          </Banner>
        )}
        {!stravaBroken && !microsoftBroken && syncStale && (
          <Banner variant="warn">
            Data last synced {relativeTime(lastSync, now)} — pull down to refresh
          </Banner>
        )}

        {/* Hero: today's session */}
        {!hasAnyPlan ? (
          <section className="card flex flex-col items-start gap-3 p-5">
            <h2 className="text-[20px] font-semibold">No plan yet for this week</h2>
            <p className="text-[14px]" style={{ color: "var(--ink-2)" }}>
              Generate the week's training and meals from your calendar and recent running.
            </p>
            <GeneratePlanButton hasPlan={false} />
          </section>
        ) : todaySession ? (
          <section className="card flex flex-col gap-2.5 p-5">
            <div className="flex items-center justify-between gap-2">
              <SessionBadge type={todaySession.session_type} />
              {todaySession.duration_min > 0 && (
                <span className="text-[13px] font-semibold tabular" style={{ color: "var(--ink-2)" }}>
                  {todaySession.duration_min} min
                </span>
              )}
            </div>
            <h2 className="text-[28px] font-semibold leading-[34px]">{todaySession.title}</h2>
            <p className="text-[15px] leading-[22px]">{todaySession.detail}</p>
            <p
              className="border-l-2 pl-3 text-[13px] leading-[18px]"
              style={{ color: "var(--ink-2)", borderColor: SESSION_META[todaySession.session_type].color }}
            >
              {todaySession.why}
            </p>
            {/* U6: sessions that never reach Strava can be logged from here. */}
            {todaySession.session_type !== "rest" &&
              !sessionDone(todaySession.session_type, done.get(today)) && (
                <div className="-mb-2 flex justify-end">
                  <LogSessionButton
                    todayIso={today}
                    defaultType={todaySession.session_type}
                    label="Done but not on Strava? Log it"
                  />
                </div>
              )}
          </section>
        ) : (
          <section className="card flex flex-col gap-2 p-5">
            <span className="overline" style={{ color: "var(--ink-2)" }}>
              This week's plan
            </span>
            <p className="text-[15px] leading-[22px] line-clamp-4 whitespace-pre-wrap">
              {heroPlan?.training_plan_text}
            </p>
            <p className="text-[13px]" style={{ color: "var(--ink-2)" }}>
              This plan predates day-by-day sessions — regenerate from the Plan tab to get them.
            </p>
            <Link
              href="/plan"
              className="text-[14px] font-semibold underline-offset-2"
              style={{ color: "var(--accent)" }}
            >
              View the full plan
            </Link>
          </section>
        )}

        {/* Tonight's meal */}
        {(todayMeal || legacyMeal) && (
          <Link href={`/food#d${today}`} className="card block p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="overline" style={{ color: "var(--ink-2)" }}>
                Tonight
              </span>
              <span className="flex items-center gap-2">
                {todayMeal && <MealBadge type={todayMeal.meal_type} />}
                {todayMeal && todayMeal.meal_type !== "travel" && (
                  <span className="text-[13px] font-semibold tabular" style={{ color: "var(--ink-2)" }}>
                    {todayMeal.prep_time_min} min
                  </span>
                )}
              </span>
            </div>
            <h3 className="mt-1.5 text-[17px] font-semibold leading-6">
              {(todayMeal ?? legacyMeal)!.recipe_name}
            </h3>
            <p className="mt-1 text-[14px] line-clamp-2" style={{ color: "var(--ink-2)" }}>
              {firstLine((todayMeal ?? legacyMeal)!.short_instructions)}
            </p>
          </Link>
        )}

        {/* Check-in row (§3.11): one tap to the jot screen, and the injuries
            read-back so it is always obvious what the planner believes. */}
        <Link href="/checkin" className="card flex min-h-[52px] items-center gap-3 px-4 py-2.5">
          <span className="min-w-0 flex-1">
            <span className="overline block" style={{ color: "var(--ink-2)" }}>
              Check-in
            </span>
            <span
              className="block truncate text-[13px]"
              style={{ color: runnerContext?.injuries ? "var(--warn)" : "var(--ink-3)" }}
            >
              {runnerContext?.injuries
                ? `Working around: ${runnerContext.injuries}`
                : hasThisWeeksFeedback
                  ? "This week's note is in — edit any time"
                  : "Injuries and how the week felt"}
            </span>
          </span>
          <IconChevronRight size={16} strokeWidth={2.2} className="shrink-0" style={{ color: "var(--ink-3)" }} />
        </Link>

        {/* Week strip — from Sunday 17:00 this is next week (§3.3), so the
            "plan ready" message frames the strip rather than duplicating it
            in a banner (m-2). */}
        <section className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <h2 className="overline" style={{ color: "var(--ink-2)" }}>
              {sundayEvening ? "Next week" : "This week"}
            </h2>
            {planReady && (
              <Link
                href="/plan"
                className="text-[13px] font-semibold"
                style={{ color: "var(--accent)" }}
              >
                Plan ready — review it
              </Link>
            )}
            {sundayEvening && !planReady && (
              <span className="text-[12px]" style={{ color: "var(--ink-3)" }}>
                No plan yet — generating this evening
              </span>
            )}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {stripDates.map((date, i) => {
              const day = stripByDate.get(date);
              const meta = day ? SESSION_META[day.session_type] : null;
              const isToday = date === today;
              const travel = day ? day.is_travel_day : eventTravelDates.has(date);
              const isDone = sessionDone(day?.session_type, done.get(date));
              return (
                <Link
                  key={date}
                  href={`/plan#d${date}`}
                  className="flex min-h-[64px] flex-col items-center justify-between rounded-xl px-0.5 py-1.5"
                  style={{
                    background: isToday ? "var(--accent-soft)" : "var(--surface)",
                    border: `1px solid ${isToday ? "var(--accent)" : "var(--line)"}`,
                  }}
                >
                  <span
                    className="text-[10px] font-semibold"
                    style={{ color: isToday ? "var(--accent)" : "var(--ink-3)" }}
                  >
                    {["M", "T", "W", "T", "F", "S", "S"][i]}
                  </span>
                  <span
                    className="text-[10px] font-bold leading-3"
                    style={{ color: meta ? meta.color : "var(--ink-3)" }}
                  >
                    {meta ? meta.abbrev : "–"}
                  </span>
                  <span className="flex h-3 items-center gap-0.5">
                    {isDone && (
                      <IconTick size={11} strokeWidth={3} className="shrink-0" style={{ color: "var(--ok)" }} />
                    )}
                    {travel && (
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: "var(--s-long)" }}
                        aria-label="Travel day"
                      />
                    )}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>

        {/* Snapshot row */}
        <section className="grid grid-cols-3 gap-1.5">
          <div className="card flex flex-col gap-0.5 p-3">
            <span className="text-[20px] font-semibold tabular leading-6">
              {last7Km.toFixed(0)}
              <span className="text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>
                {" "}km
              </span>
            </span>
            <span className="text-[11px]" style={{ color: "var(--ink-2)" }}>
              Last 7 days
            </span>
          </div>
          <div className="card flex flex-col gap-0.5 p-3">
            <span className="text-[20px] font-semibold tabular leading-6">
              {last28Km.toFixed(0)}
              <span className="text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>
                {" "}km
              </span>
            </span>
            <span className="text-[11px]" style={{ color: "var(--ink-2)" }}>
              Last 28 days
            </span>
          </div>
          <div className="card flex flex-col gap-0.5 p-3">
            <span className="text-[20px] font-semibold leading-6 capitalize">
              {phaseInfo ? phaseInfo.phase.replace("_", " ") : "General"}
            </span>
            <span className="text-[11px]" style={{ color: "var(--ink-2)" }}>
              {phaseInfo ? "Phase" : "Fitness"}
            </span>
          </div>
        </section>
      </main>
    </PullRefresh>
  );
}

function firstLine(text: string): string {
  const line = text.split(/\n|\. /)[0];
  return line.length < text.length ? `${line.replace(/\.$/, "")}.` : line;
}
