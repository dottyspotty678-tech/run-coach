import { createServiceClient } from "@/lib/supabase/service";

// Per-provider sync bookkeeping (REQUIREMENTS §3.8). The UI reads the
// sync_status table via components/data.ts getSyncStatus:
// { provider, last_synced_at, last_error }.

export type SyncProvider = "strava" | "microsoft";

export async function recordSyncSuccess(provider: SyncProvider): Promise<void> {
  try {
    const supabase = createServiceClient();
    await supabase.from("sync_status").upsert({
      provider,
      last_synced_at: new Date().toISOString(),
      last_error: null,
    });
  } catch {
    // Status bookkeeping must never fail the sync itself.
  }
}

export async function recordSyncError(provider: SyncProvider, message: string): Promise<void> {
  try {
    const supabase = createServiceClient();
    // Only last_error in the payload: on conflict, PostgREST updates just the
    // provided columns, so a failure never blanks the last success time.
    await supabase.from("sync_status").upsert({ provider, last_error: message });
  } catch {
    // Ditto.
  }
}
