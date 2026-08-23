import { createClient } from "@supabase/supabase-js";

// Service-role client for all data-table access. Bypasses RLS — the app has
// no auth at all (owner accepted the exposure); cron jobs also have no
// browser session/cookies to use RLS with.
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
