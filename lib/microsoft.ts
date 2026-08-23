import { createServiceClient } from "@/lib/supabase/service";

const MS_AUTH_BASE = "https://login.microsoftonline.com/common/oauth2/v2.0";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const SCOPES = "offline_access Calendars.Read";

type MsTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds from now
};

export function microsoftAuthorizeUrl(redirectUri: string) {
  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID!,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: SCOPES,
  });
  return `${MS_AUTH_BASE}/authorize?${params.toString()}`;
}

async function requestToken(body: URLSearchParams): Promise<MsTokenResponse> {
  const res = await fetch(`${MS_AUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Microsoft token request failed: ${await res.text()}`);
  return res.json();
}

export async function exchangeMicrosoftCode(code: string, redirectUri: string) {
  return requestToken(
    new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID!,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      scope: SCOPES,
    })
  );
}

async function refreshMicrosoftToken(refreshToken: string) {
  return requestToken(
    new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID!,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: SCOPES,
    })
  );
}

export async function saveMicrosoftTokens(tokens: MsTokenResponse) {
  const supabase = createServiceClient();
  await supabase.from("oauth_tokens").upsert({
    provider: "microsoft",
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  });
}

async function getValidMicrosoftAccessToken(): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("oauth_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("provider", "microsoft")
    .maybeSingle();

  if (!data) return null;

  const expiresAt = new Date(data.expires_at).getTime();
  const isExpiringSoon = expiresAt - Date.now() < 5 * 60 * 1000;

  if (!isExpiringSoon) return data.access_token;

  const refreshed = await refreshMicrosoftToken(data.refresh_token);
  await saveMicrosoftTokens(refreshed);
  return refreshed.access_token;
}

export async function isMicrosoftConnected(): Promise<boolean> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("oauth_tokens")
    .select("provider")
    .eq("provider", "microsoft")
    .maybeSingle();
  return !!data;
}

const TRAVEL_KEYWORDS = [
  "travel", "flight", "fly ", "airport", "train to", "train from",
  "hotel", "drive to", "driving to", "eurostar",
];

type GraphEvent = {
  id: string;
  subject: string | null;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  isAllDay: boolean;
  location?: { displayName?: string };
};

function isTravelEvent(e: GraphEvent): boolean {
  const haystack = `${e.subject ?? ""} ${e.location?.displayName ?? ""}`.toLowerCase();
  if (TRAVEL_KEYWORDS.some((k) => haystack.includes(k))) return true;
  if (e.isAllDay) {
    const spanMs = new Date(e.end.dateTime).getTime() - new Date(e.start.dateTime).getTime();
    if (spanMs > 24 * 60 * 60 * 1000) return true; // multi-day all-day event
  }
  return false;
}

export async function syncCalendarEvents(): Promise<{ synced: number }> {
  const accessToken = await getValidMicrosoftAccessToken();
  if (!accessToken) throw new Error("Microsoft calendar is not connected");

  const now = new Date();
  const fourteenDaysOut = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const params = new URLSearchParams({
    startDateTime: now.toISOString(),
    endDateTime: fourteenDaysOut.toISOString(),
    $top: "100",
    $select: "id,subject,start,end,isAllDay,location",
  });

  const res = await fetch(`${GRAPH_BASE}/me/calendarView?${params.toString()}`, {
    // No Prefer timezone header — Graph then returns dateTimes in UTC,
    // which is what the Z-suffix normalisation below assumes.
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Graph calendar fetch failed: ${await res.text()}`);

  const body = await res.json();
  const events: GraphEvent[] = body.value ?? [];
  const supabase = createServiceClient();

  const rows = events.map((e) => ({
    external_id: e.id,
    title: e.subject,
    start_time: new Date(e.start.dateTime + (e.start.dateTime.endsWith("Z") ? "" : "Z")).toISOString(),
    end_time: new Date(e.end.dateTime + (e.end.dateTime.endsWith("Z") ? "" : "Z")).toISOString(),
    is_all_day: e.isAllDay,
    is_travel: isTravelEvent(e),
    synced_at: new Date().toISOString(),
  }));

  if (rows.length > 0) {
    const { error } = await supabase.from("calendar_events").upsert(rows);
    if (error) throw new Error(`Failed to store calendar events: ${error.message}`);
  }

  return { synced: rows.length };
}
