import Link from "next/link";
import { isStravaConnected } from "@/lib/strava";
import {
  addDays,
  boundaryWeekStart,
  formatDateShort,
  londonDateOf,
  mondayOf,
  todayISO,
} from "@/components/dates";
import { getRecentActivities, isRun, runKm, type ActivityRow } from "@/components/data";
import { SESSION_META } from "@/components/session";
import type { SessionType } from "@/lib/planTypes";
import { Banner } from "@/components/banner";
import { IconChevronLeft } from "@/components/icons";
import { SyncButton } from "./sync-button";
import { LogSessionButton, ManualActivityActions } from "./log-session";

// Reads the DB on every request — never serve a stale prerender.
export const dynamic = "force-dynamic";

function formatPace(a: ActivityRow): string | null {
  // Pace is a running concept — runs only (U1).
  if (!isRun(a.type) || a.distance_m <= 0) return null;
  const secPerKm = a.duration_s / (a.distance_m / 1000);
  const mins = Math.floor(secPerKm / 60);
  const secs = Math.round(secPerKm % 60);
  return `${mins}:${String(secs).padStart(2, "0")} /km`;
}

/** "WeightTraining" → "Weight training": Strava's camel-case type ids, in the
 *  app's sentence-case voice (design-system copy rule, §4). */
function humaniseType(type: string): string {
  const spaced = type.replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** Manual entries store plan session types ("easy") or free text ("football");
 *  use the session's proper label where one exists. */
function sessionLabel(type: string): string {
  const meta = SESSION_META[type as SessionType];
  return meta ? meta.label : humaniseType(type);
}

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return `${h} h ${String(mins % 60).padStart(2, "0")}`;
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ strava_error?: string }>;
}) {
  const { strava_error } = await searchParams;
  const now = new Date();
  const today = todayISO(now);
  const [connected, activities] = await Promise.all([
    isStravaConnected(),
    getRecentActivities(60), // chart window is wider than the 30-day list
  ]);

  const listActivities = activities.filter(
    (a) => now.getTime() - new Date(a.start_date).getTime() <= 30 * 86400000
  );

  // Weekly RUNNING km for the last 8 weeks (U1 — rides and gym sessions never
  // inflate running volume), current (boundary) week last + highlighted.
  const currentWeek = boundaryWeekStart(now);
  const weekStarts = Array.from({ length: 8 }, (_, i) => addDays(currentWeek, (i - 7) * 7));
  const kmByWeek = new Map<string, number>(weekStarts.map((w) => [w, 0]));
  for (const a of activities) {
    if (!isRun(a.type)) continue;
    const week = mondayOf(londonDateOf(a.start_date));
    if (kmByWeek.has(week)) kmByWeek.set(week, kmByWeek.get(week)! + a.distance_m / 1000);
  }
  const maxKm = Math.max(1, ...kmByWeek.values());

  const last7Km = runKm(activities, 7, now);
  const last28Km = runKm(activities, 28, now);

  // Hand-rolled SVG bars (payload discipline — no chart library).
  const chartW = 320;
  const chartH = 96;
  const gap = 6;
  const barW = (chartW - gap * 7) / 8;

  return (
    <main className="flex flex-col gap-4 px-4 pt-3">
      {/* V2: secondary screen (no tab) reached from the Dashboard volume card —
          back affordance like Calendar. */}
      <header className="flex items-center gap-1 pt-1">
        <Link
          href="/"
          aria-label="Back to Dashboard"
          className="-ml-2 flex min-h-[44px] min-w-[44px] items-center justify-center"
          style={{ color: "var(--accent)" }}
        >
          <IconChevronLeft size={22} strokeWidth={2.2} />
        </Link>
        <h1 className="display text-[26px] leading-8">Activity</h1>
        {/* Manual logging (round 2, U6) works with or without Strava. */}
        <div className="ml-auto">
          <LogSessionButton todayIso={today} />
        </div>
      </header>

      {strava_error && (
        <Banner variant="error">Couldn&apos;t connect Strava ({strava_error}) — try again.</Banner>
      )}

      {!connected && (
        <section className="card flex flex-col items-start gap-3 p-5">
          <h2 className="text-[17px] font-semibold">Connect Strava</h2>
          <p className="text-[14px]" style={{ color: "var(--ink-2)" }}>
            Your recent running drives the weekly plan. Connect Strava to sync the last 30 days —
            or log sessions manually above.
          </p>
          <Link href="/settings#connections" className="btn-primary">
            Open Settings
          </Link>
        </section>
      )}

      {(connected || activities.length > 0) && (
        <>
          {/* Volume chart */}
          <section className="card flex flex-col gap-3 p-4">
            <div className="flex items-end justify-between">
              <h2 className="overline" style={{ color: "var(--ink-2)" }}>
                Weekly running km — last 8 weeks
              </h2>
              <div className="flex gap-4 text-right">
                <span>
                  <span className="display block text-[21px] leading-6">
                    {last7Km.toFixed(0)} km
                  </span>
                  <span className="overline block" style={{ color: "var(--ink-2)" }}>
                    7 days
                  </span>
                </span>
                <span>
                  <span className="display block text-[21px] leading-6">
                    {last28Km.toFixed(0)} km
                  </span>
                  <span className="overline block" style={{ color: "var(--ink-2)" }}>
                    28 days
                  </span>
                </span>
              </div>
            </div>
            <svg
              viewBox={`0 0 ${chartW} ${chartH + 16}`}
              className="w-full"
              role="img"
              aria-label={`Weekly distance for the last 8 weeks, up to ${maxKm.toFixed(0)} km`}
            >
              {weekStarts.map((week, i) => {
                const km = kmByWeek.get(week) ?? 0;
                const h = Math.max(km > 0 ? 3 : 1.5, (km / maxKm) * chartH);
                const x = i * (barW + gap);
                const isCurrent = week === currentWeek;
                return (
                  <g key={week}>
                    <rect
                      x={x}
                      y={chartH - h}
                      width={barW}
                      height={h}
                      rx={3}
                      fill={isCurrent ? "var(--accent)" : "var(--raised)"}
                      stroke={isCurrent ? "none" : "var(--line)"}
                      strokeWidth={isCurrent ? 0 : 1}
                    />
                    {km > 0 && (
                      <text
                        x={x + barW / 2}
                        y={chartH - h - 4}
                        textAnchor="middle"
                        fontSize="9"
                        fill="var(--ink-3)"
                        style={{
                          fontFamily: "var(--font-digits)",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {km.toFixed(0)}
                      </text>
                    )}
                    <text
                      x={x + barW / 2}
                      y={chartH + 12}
                      textAnchor="middle"
                      fontSize="8"
                      fill={isCurrent ? "var(--accent)" : "var(--ink-3)"}
                      fontWeight={isCurrent ? 600 : 400}
                      style={{ fontFamily: "var(--font-digits)" }}
                    >
                      {formatDateShort(week)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </section>

          {/* Activity list */}
          {listActivities.length === 0 ? (
            <section className="card flex flex-col items-start gap-3 p-5">
              <p className="text-[15px] font-medium">No activities in the last 30 days</p>
              <div className="flex flex-wrap gap-2">
                {connected && <SyncButton />}
                <LogSessionButton todayIso={today} appearance="secondary" />
              </div>
            </section>
          ) : (
            <section className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h2 className="overline" style={{ color: "var(--ink-2)" }}>
                  Last 30 days
                </h2>
                {connected && <SyncButton compact />}
              </div>
              <ul className="card divide-y" style={{ borderColor: "var(--line)" }}>
                {listActivities.map((a) => {
                  const date = londonDateOf(a.start_date);
                  const manual = a.source === "manual";
                  // Pace is never shown for manual entries (self-reported duration/distance).
                  const pace = manual ? null : formatPace(a);
                  const run = isRun(a.type);
                  const name = manual
                    ? (a.note?.trim() || sessionLabel(a.type))
                    : (a.name ?? (run ? "Run" : humaniseType(a.type)));
                  return (
                    <li
                      key={a.external_id}
                      className="flex items-center gap-3 px-4 py-3"
                      style={{ borderColor: "var(--line)" }}
                    >
                      <span className="tabular w-14 shrink-0 text-[12px] font-semibold" style={{ color: date === today ? "var(--accent)" : "var(--ink-2)" }}>
                        {formatDateShort(date)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium">{name}</span>
                        <span className="block text-[12px] tabular" style={{ color: "var(--ink-2)" }}>
                          {/* Manual rows are labelled (U6); non-runs carry their
                              type and never show pace (U1). */}
                          {manual && "Logged manually · "}
                          {manual && a.note?.trim() && `${sessionLabel(a.type)} · `}
                          {!manual && !run && `${humaniseType(a.type)} · `}
                          {a.distance_m > 0 && `${(a.distance_m / 1000).toFixed(1)} km · `}
                          {formatDuration(a.duration_s)}
                          {pace ? ` · ${pace}` : ""}
                        </span>
                      </span>
                      {manual && a.manual_id !== undefined && (
                        <ManualActivityActions
                          manualId={a.manual_id}
                          activityDate={date}
                          type={a.type}
                          durationMin={Math.round(a.duration_s / 60)}
                          distanceKm={a.distance_m > 0 ? a.distance_m / 1000 : null}
                          note={a.note ?? null}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}
