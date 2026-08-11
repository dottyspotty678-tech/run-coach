import { stravaAuthorizeUrl } from "@/lib/strava";
import { NextResponse } from "next/server";

export async function GET() {
  const redirectUri = new URL("/api/strava/callback", process.env.APP_URL).toString();
  return NextResponse.redirect(stravaAuthorizeUrl(redirectUri));
}
