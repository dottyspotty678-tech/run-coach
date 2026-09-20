import Link from "next/link";
import { isStravaConnected } from "@/lib/strava";
import { isMicrosoftConnected } from "@/lib/microsoft";
import { parseTrainingDays, parseAwayMeals } from "@/lib/planTypes";
import {
  addDays,
  daysBetween,
  formatDayShort,
  londonDateOf,
  londonParts,
  mondayOf,
  relativeTime,
  todayISO,
  weekDates,
} from "@/components/dates";
import {
  awayDatesForRange,
  completedCategories,
  getEventsForWeek,
  getLatestAppliedCheckin,
  getNextRaces,
  getPlanForWeek,
  getRecentActivities,
  getRecentFeedback,
  getSeasonWeek,
  getSyncStatus,
  lastSuccessfulSync,
  runKm,
  sessionDone,
  travelDatesFromEvents,
} from "@/components/data";
import { SESSION_META, SessionBadge } from "@/components/session";
import { Banner } from "@/components/banner";
import { PullRefresh } from "@/components/pull-refresh";
import { LogSessionButton } from "@/app/activities/log-session";
import { AskCoachTile } from "@/components/ask-coach";
import {
  IconActivity,
  IconChevronRight,
  IconFlag,
  IconTick,
} from "@/components/icons";

// Reads the DB on every request — never serve a stale prerender.
export const dynamic = "force-dynamic";

// V2 Dashboard (docs/REDESIGN-V2.md §Screen 1): hero, away-day dinner card,
// 7-day volume lookback (opens Activity history), 2x2 quick actions.
export default async function DashboardPage() {
  const now = new Date();
  const today = todayISO(now);
  const heroWeekStart = mondayOf(today); // week that contains today

  const [
    heroPlan,
    activities,
    stravaConnected,
    microsoftConnected,
    syncStatus,
    events,
    seasonRow,
    nextRaces,
    recentFeedback,
    prevWeekEvents,
    appliedCheckin,
  ] = await Promise.all([
    getPlanForWeek(heroWeekStart),
    getRecentActivities(28),
    isStravaConnected(),
    isMicrosoftConnected(),
    getSyncStatus(),
    getEventsForWeek(heroWeekStart),
    // v3: season position + next race replace the single race goal.
    getSeasonWeek(heroWeekStart),
    getNextRaces(today, 1),
    getRecentFeedback(1),
    // Away spans can be opened by a hotel check-in event in the PREVIOUS week
    // (the span runs to the day before check-out), so include last week's
    // events when deriving today's away status.
    getEventsForWeek(addDays(heroWeekStart, -7)),
    // §3.12 done state: only a check-in run DURING this week counts — such a
    // run targets NEXT week. Last Sunday's check-in (which targets this week)
    // must not show as done, so the tile resets to its default every Monday.
    getLatestAppliedCheckin([addDays(heroWeekStart, 7)]),
  ]);

  const nextRace = nextRaces[0] ?? null;

  // --- Hero: today's session ---
  const heroDays = parseTrainingDays(heroPlan);
  const todaySession = heroDays?.find((d) => d.date === today) ?? null;

  // --- Dinner card (V2): ONLY when today is an AWAY day with a planned meal.
  // Home days have no meal planning; legacy v1 rows render on Nutrition only.
  const awayEvents = [
    ...prevWeekEvents,
    ...events.filter((e) => !prevWeekEvents.some((p) => p.external_id === e.external_id)),
  ];
  const awayToday = awayDatesForRange(awayEvents, [today]).has(today);
  const awayMeals = parseAwayMeals(heroPlan);
  const dinner = awayToday
    ? (awayMeals?.find((m) => m.date === today) ?? null)
    : null;

  // --- Context chips ---
  const heroDates = weekDates(heroWeekStart);
  const eventTravelDates = travelDatesFromEvents(events, heroDates);
  const isTravelToday = todaySession
    ? todaySession.is_travel_day
    : eventTravelDates.has(today);

  // Season row (v3): race week when the planner says so (A race week, or a B
  // race inside a progressive week); the countdown chip tracks the next race.
  const isRaceWeek = seasonRow?.phase === "race_week" || seasonRow?.block_position === "race";
  const daysToRace = nextRace ? daysBetween(today, nextRace.race_date) : null;
  const raceChip =
    nextRace && daysToRace !== null && daysToRace > 0 && daysToRace <= 84
      ? daysToRace <= 14
        ? `${daysToRace} days to ${nextRace.name}`
        : `${Math.round(daysToRace / 7)} weeks to ${nextRace.name}`
      : null;

  // --- Volume lookback (running only — U1) + sessions-done summary ---
  const last7Km = runKm(activities, 7, now);
  const done = completedCategories(activities);
  const plannedSoFar = (heroDays ?? []).filter(
    (d) => d.date <= today && d.session_type !== "rest"
  );
  const doneSoFar = plannedSoFar.filter((d) => sessionDone(d.session_type, done.get(d.date)));
  const activityCount7 = activities.filter(
    (a) => now.getTime() - new Date(a.start_date).getTime() <= 7 * 86400000
  ).length;

  // --- Banners (quieter than the hero in V2) ---
  const lastSync = lastSuccessfulSync(syncStatus);
  const syncStale =
    lastSync !== null && now.getTime() - new Date(lastSync).getTime() > 24 * 3600000;
  const stravaBroken = !stravaConnected || !!syncStatus.strava?.last_error;
  const microsoftBroken = !microsoftConnected || !!syncStatus.microsoft?.last_error;

  // Check-in nudge: Sunday, and this week's note is still empty.
  const isSunday = londonParts(now).weekday === 7;
  const hasThisWeeksFeedback = recentFeedback.some(
    (f) => f.week_start_date === heroWeekStart
  );
  // Complete = a voice check-in applied this week OR a typed note for the week
  // containing today. Both are keyed to the current week, so both reset on
  // Monday without any extra state.
  const checkinComplete = appliedCheckin !== null || hasThisWeeksFeedback;
  const showCheckinNudge = isSunday && !checkinComplete;

  const hasAnyPlan = heroPlan !== null;

  return (
    <PullRefresh>
      <main className="flex flex-col gap-4 px-4 pt-3">
        {/* Header */}
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5 pt-1">
          {/* The date is set like a fingerpost blade — tall, condensed,
              uppercase. */}
          <h1 className="display text-[24px] uppercase leading-7 tracking-[0.04em]">
            {formatDayShort(today)}
          </h1>
          <div className="flex flex-wrap gap-1.5">
            {isTravelToday && (
              <span className="chip" style={{ color: "var(--s-long)", background: "var(--s-long-soft)" }}>
                Travel day
              </span>
            )}
            {isRaceWeek && (
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

        {/* Banners — quiet in V2, the hero dominates */}
        {showCheckinNudge && (
          <Banner quiet variant="info" href="/checkin" linkLabel="Check in">
            How did this week feel? A 30-second note shapes next week&apos;s plan
          </Banner>
        )}
        {stravaBroken && (
          <Banner quiet variant="warn" href="/settings#connections" linkLabel="Settings">
            {stravaConnected ? "Strava sync failing" : "Strava disconnected"} — reconnect in Settings
          </Banner>
        )}
        {microsoftBroken && (
          <Banner quiet variant="warn" href="/settings#connections" linkLabel="Settings">
            {microsoftConnected ? "Calendar sync failing" : "Calendar disconnected"} — reconnect in Settings
          </Banner>
        )}
        {!stravaBroken && !microsoftBroken && syncStale && (
          <Banner quiet variant="warn">
            Data last synced {relativeTime(lastSync, now)} — pull down to refresh
          </Banner>
        )}

        {/* Hero: today's session */}
        {!hasAnyPlan ? (
          <section className="card flex flex-col items-start gap-3 p-5">
            <h2 className="text-[20px] font-semibold">No plan yet for this week</h2>
            <p className="text-[14px]" style={{ color: "var(--ink-2)" }}>
              Built from your calendar and recent running.
            </p>
            <Link href="/checkin" className="btn-primary">
              Start a check-in
            </Link>
          </section>
        ) : todaySession ? (
          /* The hero is tonight's waymark: the session badge as the disc on
             the post, a fingerpost title, and the "why" as a dashed footpath
             aside in the session's colour. */
          <section className="card flex flex-col gap-2.5 p-5">
            <div className="flex items-center justify-between gap-2">
              <SessionBadge type={todaySession.session_type} />
              {todaySession.duration_min > 0 && (
                <span className="display text-[19px]" style={{ color: "var(--ink)" }}>
                  {todaySession.duration_min}
                  <span className="text-[13px]" style={{ color: "var(--ink-2)" }}>
                    {" "}min
                  </span>
                </span>
              )}
            </div>
            <h2 className="display text-[28px] leading-[32px]">{todaySession.title}</h2>
            <p className="text-[15px] leading-[22px]">{todaySession.detail}</p>
            <p
              className="path-aside text-[13px] leading-[18px]"
              style={{ color: SESSION_META[todaySession.session_type].color }}
            >
              <span style={{ color: "var(--ink-2)" }}>{todaySession.why}</span>
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
              This week&apos;s plan
            </span>
            <p className="text-[15px] leading-[22px] line-clamp-4 whitespace-pre-wrap">
              {heroPlan?.training_plan_text}
            </p>
            <p className="text-[13px]" style={{ color: "var(--ink-2)" }}>
              Old plan format — regenerate on the Plan tab.
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

        {/* Tonight's dinner — away days only (V2 meal-prep model) */}
        {dinner && (
          <Link href={`/food#d${today}`} className="card block p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="overline" style={{ color: "var(--ink-2)" }}>
                Tonight — away
              </span>
              {dinner.prep_time_min > 0 && (
                <span className="text-[13px] font-semibold tabular" style={{ color: "var(--ink-2)" }}>
                  {dinner.prep_time_min} min prep
                </span>
              )}
            </div>
            <h3 className="mt-1.5 text-[17px] font-semibold leading-6">{dinner.recipe_name}</h3>
            <p className="mt-1 text-[13px]" style={{ color: "var(--ink-2)" }}>
              Prepped ahead — recipe on Nutrition
            </p>
          </Link>
        )}

        {/* Volume lookback — opens the Activity history screen */}
        <Link href="/activities" className="card flex items-center gap-3 p-4">
          <span className="min-w-0 flex-1">
            <span className="overline block" style={{ color: "var(--ink-2)" }}>
              Training volume — last 7 days
            </span>
            {/* Distance as fingerpost lettering — "KESWICK 4½". */}
            <span className="display mt-1 block text-[32px] font-bold leading-9">
              {last7Km.toFixed(0)}
              <span className="text-[14px] font-semibold tracking-[0.06em]" style={{ color: "var(--ink-2)" }}>
                {" "}KM RUN
              </span>
            </span>
            <span className="mt-0.5 flex items-center gap-1 text-[12px]" style={{ color: "var(--ink-2)" }}>
              {plannedSoFar.length > 0 ? (
                <>
                  <IconTick size={12} strokeWidth={2.8} style={{ color: "var(--ok)" }} />
                  {doneSoFar.length} of {plannedSoFar.length} planned sessions done this week
                </>
              ) : (
                `${activityCount7} ${activityCount7 === 1 ? "session" : "sessions"} in the last 7 days`
              )}
            </span>
          </span>
          <IconChevronRight size={16} strokeWidth={2.2} className="shrink-0" style={{ color: "var(--ink-3)" }} />
        </Link>

        {/* Quick actions (2x2) */}
        <section className="grid grid-cols-2 gap-1.5">
          <LogSessionButton todayIso={today} appearance="tile" label="Log a session">
            <IconActivity size={18} strokeWidth={2} />
          </LogSessionButton>
          <Link href="/settings#race" className="card flex min-h-[64px] items-center gap-2.5 px-3.5 py-3">
            <span className="shrink-0" style={{ color: "var(--accent)" }}>
              <IconFlag size={18} strokeWidth={2} />
            </span>
            <span className="text-[14px] font-semibold leading-[18px]">
              {nextRace ? "Races" : "Add a goal race"}
            </span>
          </Link>
          <Link href="/checkin" className="card flex min-h-[64px] items-center gap-2.5 px-3.5 py-3">
            <span
              className="shrink-0"
              style={{ color: checkinComplete ? "var(--ok)" : "var(--accent)" }}
            >
              <IconTick size={18} strokeWidth={2.2} />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-[14px] font-semibold leading-[18px]">
                {checkinComplete
                  ? "Check-in complete"
                  : isSunday
                    ? "Sunday check-in due"
                    : "Add a check-in"}
              </span>
              {checkinComplete && (
                <span className="text-[11px] leading-[15px]" style={{ color: "var(--ink-3)" }}>
                  {appliedCheckin
                    ? `${formatDayShort(londonDateOf(appliedCheckin.applied_at))} · tap to revise`
                    : "This week · tap to revise"}
                </span>
              )}
            </span>
          </Link>
          <AskCoachTile />
        </section>
      </main>
    </PullRefresh>
  );
}
