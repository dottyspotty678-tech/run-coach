import { createClient } from "@supabase/supabase-js";

// Service-role client for all data-table access (not auth). Bypasses RLS —
// the login gate in middleware.ts is the actual security boundary for this
// single-user app, and cron jobs have no browser session/cookies to use RLS with.
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
