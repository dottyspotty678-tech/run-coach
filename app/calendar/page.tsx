import { createServiceClient } from "@/lib/supabase/service";
import { isMicrosoftConnected } from "@/lib/microsoft";
import Link from "next/link";
import { CalendarSyncButton } from "./sync-button";

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ ms_error?: string }>;
}) {
  const { ms_error } = await searchParams;
  const connected = await isMicrosoftConnected();
  const supabase = createServiceClient();

  const { data: events } = connected
    ? await supabase
        .from("calendar_events")
        .select("*")
        .gte("start_time", new Date().toISOString())
        .order("start_time", { ascending: true })
        .limit(50)
    : { data: [] };

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-4 p-6">
      <Link href="/" className="text-sm opacity-70">
        &larr; Back
      </Link>
      <h1 className="text-xl font-semibold">Calendar</h1>

      {ms_error && (
        <p className="rounded bg-red-100 p-2 text-sm text-red-700">
          Microsoft connection failed ({ms_error}). Try again.
        </p>
      )}

      {!connected ? (
        <a
          href="/api/microsoft/connect"
          className="rounded bg-blue-700 px-3 py-2 text-center text-white"
        >
          Connect Microsoft calendar
        </a>
      ) : (
        <CalendarSyncButton />
      )}

      <ul className="flex flex-col gap-2">
        {(events ?? []).map((e) => (
          <li
            key={e.external_id}
            className="rounded border border-black/10 p-3 dark:border-white/10"
          >
            <div className="font-medium">
              {e.title ?? "(untitled)"}
              {e.is_travel && (
                <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                  travel
                </span>
              )}
            </div>
            <div className="text-sm opacity-70">
              {e.is_all_day
                ? `${new Date(e.start_time).toLocaleDateString("en-GB")} (all day)`
                : `${formatTime(e.start_time)} – ${formatTime(e.end_time)}`}
            </div>
          </li>
        ))}
        {connected && (events ?? []).length === 0 && (
          <li className="text-sm opacity-70">
            No upcoming events synced yet — tap Sync now.
          </li>
        )}
      </ul>
    </main>
  );
}
