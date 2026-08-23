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
import { getRecentActivities, type ActivityRow } from "@/components/data";
import { Banner } from "@/components/banner";
import { SyncButton } from "./sync-button";

// Reads the DB on every request — never serve a stale prerender.
export const dynamic = "force-dynamic";

function formatPace(a: ActivityRow): string | null {
  if (a.type !== "Run" || a.distance_m <= 0) return null;
  const secPerKm = a.duration_s / (a.distance_m / 1000);
  const mins = Math.floor(secPerKm / 60);
  const secs = Math.round(secPerKm % 60);
  return `${mins}:${String(secs).padStart(2, "0")} /km`;
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

  // Weekly km for the last 8 weeks, current (boundary) week last + highlighted.
  const currentWeek = boundaryWeekStart(now);
  const weekStarts = Array.from({ length: 8 }, (_, i) => addDays(currentWeek, (i - 7) * 7));
  const kmByWeek = new Map<string, number>(weekStarts.map((w) => [w, 0]));
  for (const a of activities) {
    const week = mondayOf(londonDateOf(a.start_date));
    if (kmByWeek.has(week)) kmByWeek.set(week, kmByWeek.get(week)! + a.distance_m / 1000);
  }
  const maxKm = Math.max(1, ...kmByWeek.values());

  const last7Km = activities
    .filter((a) => now.getTime() - new Date(a.start_date).getTime() <= 7 * 86400000)
    .reduce((s, a) => s + a.distance_m / 1000, 0);
  const last28Km = activities
    .filter((a) => now.getTime() - new Date(a.start_date).getTime() <= 28 * 86400000)
    .reduce((s, a) => s + a.distance_m / 1000, 0);

  // Hand-rolled SVG bars (payload discipline — no chart library).
  const chartW = 320;
  const chartH = 96;
  const gap = 6;
  const barW = (chartW - gap * 7) / 8;

  return (
    <main className="flex flex-col gap-4 px-4 pt-3">
      <header className="pt-1">
        <h1 className="text-[22px] font-semibold leading-7">Activity</h1>
      </header>

      {strava_error && (
        <Banner variant="error">Couldn't connect Strava ({strava_error}) — try again.</Banner>
      )}

      {!connected ? (
        <section className="card flex flex-col items-start gap-3 p-5">
          <h2 className="text-[17px] font-semibold">Connect Strava</h2>
          <p className="text-[14px]" style={{ color: "var(--ink-2)" }}>
            Your recent running drives the weekly plan. Connect Strava to sync the last 30 days.
          </p>
          <Link href="/settings#connections" className="btn-primary">
            Open Settings
          </Link>
        </section>
      ) : (
        <>
          {/* Volume chart */}
          <section className="card flex flex-col gap-3 p-4">
            <div className="flex items-end justify-between">
              <h2 className="overline" style={{ color: "var(--ink-2)" }}>
                Weekly km — last 8 weeks
              </h2>
              <div className="flex gap-4 text-right">
                <span>
                  <span className="block text-[17px] font-semibold tabular leading-5">
                    {last7Km.toFixed(0)} km
                  </span>
                  <span className="block text-[11px]" style={{ color: "var(--ink-2)" }}>
                    7 days
                  </span>
                </span>
                <span>
                  <span className="block text-[17px] font-semibold tabular leading-5">
                    {last28Km.toFixed(0)} km
                  </span>
                  <span className="block text-[11px]" style={{ color: "var(--ink-2)" }}>
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
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        {km.toFixed(0)}
                      </text>
                    )}
                    <text
                      x={x + barW / 2}
                      y={chartH + 12}
                      textAnchor="middle"
                      fontSize="8.5"
                      fill={isCurrent ? "var(--accent)" : "var(--ink-3)"}
                      fontWeight={isCurrent ? 700 : 400}
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
              <SyncButton />
            </section>
          ) : (
            <section className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h2 className="overline" style={{ color: "var(--ink-2)" }}>
                  Last 30 days
                </h2>
                <SyncButton compact />
              </div>
              <ul className="card divide-y" style={{ borderColor: "var(--line)" }}>
                {listActivities.map((a) => {
                  const date = londonDateOf(a.start_date);
                  const pace = formatPace(a);
                  const name = a.name ?? (a.type === "Run" ? "Run" : a.type);
                  return (
                    <li
                      key={a.external_id}
                      className="flex items-center gap-3 px-4 py-3"
                      style={{ borderColor: "var(--line)" }}
                    >
                      <span className="w-14 shrink-0 text-[13px] font-semibold" style={{ color: date === today ? "var(--accent)" : "var(--ink-2)" }}>
                        {formatDateShort(date)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium">{name}</span>
                        <span className="block text-[12px] tabular" style={{ color: "var(--ink-2)" }}>
                          {(a.distance_m / 1000).toFixed(1)} km · {formatDuration(a.duration_s)}
                          {pace ? ` · ${pace}` : ""}
                        </span>
                      </span>
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
