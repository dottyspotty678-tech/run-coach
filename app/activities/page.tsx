import { createClient } from "@/lib/supabase/server";
import { isStravaConnected } from "@/lib/strava";
import Link from "next/link";
import { SyncButton } from "./sync-button";

function formatDistance(meters: number) {
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatDuration(seconds: number) {
  const mins = Math.round(seconds / 60);
  return `${mins} min`;
}

export default async function ActivitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ strava_error?: string }>;
}) {
  const { strava_error } = await searchParams;
  const connected = await isStravaConnected();
  const supabase = await createClient();

  const { data: activities } = connected
    ? await supabase
        .from("strava_activities")
        .select("*")
        .order("start_date", { ascending: false })
        .limit(20)
    : { data: [] };

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-4 p-6">
      <Link href="/" className="text-sm opacity-70">
        &larr; Back
      </Link>
      <h1 className="text-xl font-semibold">Activities</h1>

      {strava_error && (
        <p className="rounded bg-red-100 p-2 text-sm text-red-700">
          Strava connection failed ({strava_error}). Try again.
        </p>
      )}

      {!connected ? (
        <a
          href="/api/strava/connect"
          className="rounded bg-orange-600 px-3 py-2 text-center text-white"
        >
          Connect Strava
        </a>
      ) : (
        <SyncButton />
      )}

      <ul className="flex flex-col gap-2">
        {(activities ?? []).map((a) => (
          <li key={a.external_id} className="rounded border border-black/10 p-3 dark:border-white/10">
            <div className="font-medium">{a.type}</div>
            <div className="text-sm opacity-70">
              {new Date(a.start_date).toLocaleDateString()} &middot;{" "}
              {formatDistance(a.distance_m)} &middot; {formatDuration(a.duration_s)}
            </div>
          </li>
        ))}
        {connected && (activities ?? []).length === 0 && (
          <li className="text-sm opacity-70">No activities synced yet — tap Sync now.</li>
        )}
      </ul>
    </main>
  );
}
