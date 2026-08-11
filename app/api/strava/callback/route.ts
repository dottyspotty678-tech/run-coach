import { exchangeStravaCode, saveStravaTokens } from "@/lib/strava";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  const activitiesUrl = new URL("/activities", request.url);

  if (error || !code) {
    activitiesUrl.searchParams.set("strava_error", error ?? "missing_code");
    return NextResponse.redirect(activitiesUrl);
  }

  try {
    const tokens = await exchangeStravaCode(code);
    await saveStravaTokens(tokens);
  } catch {
    activitiesUrl.searchParams.set("strava_error", "token_exchange_failed");
    return NextResponse.redirect(activitiesUrl);
  }

  return NextResponse.redirect(activitiesUrl);
}
