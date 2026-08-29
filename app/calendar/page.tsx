import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/service";
import { isMicrosoftConnected } from "@/lib/microsoft";
import {
  addDays,
  formatDayShort,
  londonDateOf,
  londonTimeOf,
  todayISO,
} from "@/components/dates";
import type { CalendarEventRow } from "@/components/data";
import { Banner } from "@/components/banner";
import { IconChevronLeft } from "@/components/icons";
import { CalendarSyncButton } from "./sync-button";

// Reads the DB on every request — never serve a stale prerender.
export const dynamic = "force-dynamic";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ ms_error?: string }>;
}) {
  const { ms_error } = await searchParams;
  const connected = await isMicrosoftConnected();
  const supabase = createServiceClient();

  const today = todayISO();
  const horizon = addDays(today, 14);

  const { data } = connected
    ? await supabase
        .from("calendar_events")
        .select("external_id, title, start_time, end_time, is_all_day, is_travel")
        .gte("end_time", `${today}T00:00:00Z`)
        .lt("start_time", `${horizon}T00:00:00Z`)
        .order("start_time", { ascending: true })
    : { data: [] };
  const events = (data as CalendarEventRow[] | null) ?? [];

  // Group by London day over the next 14 days.
  const byDay = new Map<string, CalendarEventRow[]>();
  for (const e of events) {
    const day = londonDateOf(e.start_time);
    const list = byDay.get(day) ?? [];
    list.push(e);
    byDay.set(day, list);
  }
  const days = [...byDay.keys()].filter((d) => d >= today).sort();

  return (
    <main className="flex flex-col gap-4 px-4 pt-3">
      {/* Secondary screen: back affordance in the header */}
      <header className="flex items-center gap-1 pt-1">
        <Link
          href="/plan"
          aria-label="Back to Plan"
          className="-ml-2 flex min-h-[44px] min-w-[44px] items-center justify-center"
          style={{ color: "var(--accent)" }}
        >
          <IconChevronLeft size={22} strokeWidth={2.2} />
        </Link>
        <h1 className="display text-[26px] leading-8">Calendar</h1>
        <div className="ml-auto">{connected && <CalendarSyncButton compact />}</div>
      </header>

      {ms_error && (
        <Banner variant="error">Couldn&apos;t connect the calendar ({ms_error}) — try again.</Banner>
      )}

      {!connected ? (
        <section className="card flex flex-col items-start gap-3 p-5">
          <h2 className="text-[17px] font-semibold">Connect your calendar</h2>
          <p className="text-[14px]" style={{ color: "var(--ink-2)" }}>
            The planner reads the next 14 days to work around travel and busy evenings.
          </p>
          <Link href="/settings#connections" className="btn-primary">
            Open Settings
          </Link>
        </section>
      ) : days.length === 0 ? (
        <section className="card flex flex-col items-start gap-3 p-5">
          <p className="text-[15px] font-medium">No events in the next 14 days</p>
          <CalendarSyncButton />
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          {days.map((day) => (
            <div key={day} className="flex flex-col gap-1.5">
              <h2
                className="overline"
                style={{ color: day === today ? "var(--accent)" : "var(--ink-2)" }}
              >
                {formatDayShort(day)}
                {day === today && " · Today"}
              </h2>
              <ul className="card divide-y" style={{ borderColor: "var(--line)" }}>
                {byDay.get(day)!.map((e) => (
                  <li
                    key={e.external_id}
                    className="flex items-center gap-3 px-4 py-2.5"
                    style={{ borderColor: "var(--line)" }}
                  >
                    <span className="w-12 shrink-0 text-[13px] font-semibold tabular" style={{ color: "var(--ink-2)" }}>
                      {e.is_all_day ? "All day" : londonTimeOf(e.start_time)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
                      {e.title ?? "(untitled)"}
                    </span>
                    {e.is_travel && (
                      <span className="chip shrink-0" style={{ color: "var(--s-long)", background: "var(--s-long-soft)" }}>
                        Travel
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      <footer className="pb-2 text-[12px] leading-[17px]" style={{ color: "var(--ink-3)" }}>
        Days are marked as travel when an event mentions travel, flights, trains or hotels, or
        spans multiple days. The calendar is read-only here — it is an input to the planner,
        not a destination.
      </footer>
    </main>
  );
}
