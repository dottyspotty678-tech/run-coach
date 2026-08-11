import { createServiceClient } from "@/lib/supabase/service";

const STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token";
const STRAVA_API_BASE = "https://www.strava.com/api/v3";

type StravaTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix seconds
};

export function stravaAuthorizeUrl(redirectUri: string) {
  const params = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    scope: "read,activity:read_all",
  });
  return `https://www.strava.com/oauth/authorize?${params.toString()}`;
}

export async function exchangeStravaCode(code: string): Promise<StravaTokenResponse> {
  const res = await fetch(STRAVA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Strava token exchange failed: ${await res.text()}`);
  return res.json();
}

async function refreshStravaToken(refreshToken: string): Promise<StravaTokenResponse> {
  const res = await fetch(STRAVA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Strava token refresh failed: ${await res.text()}`);
  return res.json();
}

export async function saveStravaTokens(tokens: StravaTokenResponse) {
  const supabase = createServiceClient();
  await supabase.from("oauth_tokens").upsert({
    provider: "strava",
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: new Date(tokens.expires_at * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  });
}

async function getValidStravaAccessToken(): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("oauth_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("provider", "strava")
    .maybeSingle();

  if (!data) return null;

  const expiresAt = new Date(data.expires_at).getTime();
  const isExpiringSoon = expiresAt - Date.now() < 5 * 60 * 1000; // refresh 5 min ahead

  if (!isExpiringSoon) return data.access_token;

  const refreshed = await refreshStravaToken(data.refresh_token);
  await saveStravaTokens(refreshed);
  return refreshed.access_token;
}

export async function isStravaConnected(): Promise<boolean> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("oauth_tokens")
    .select("provider")
    .eq("provider", "strava")
    .maybeSingle();
  return !!data;
}

export async function syncStravaActivities(): Promise<{ synced: number }> {
  const accessToken = await getValidStravaAccessToken();
  if (!accessToken) throw new Error("Strava is not connected");

  const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
  const res = await fetch(
    `${STRAVA_API_BASE}/athlete/activities?after=${thirtyDaysAgo}&per_page=100`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Strava activities fetch failed: ${await res.text()}`);

  const activities = await res.json();
  const supabase = createServiceClient();

  const rows = activities.map((a: Record<string, unknown>) => ({
    external_id: a.id,
    type: a.type,
    distance_m: a.distance,
    duration_s: a.moving_time,
    start_date: a.start_date,
    average_pace: a.average_speed,
    raw_json: a,
    synced_at: new Date().toISOString(),
  }));

  if (rows.length > 0) {
    const { error } = await supabase.from("strava_activities").upsert(rows);
    if (error) throw new Error(`Failed to store activities: ${error.message}`);
  }

  return { synced: rows.length };
}
