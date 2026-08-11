import { stravaAuthorizeUrl } from "@/lib/strava";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const redirectUri = new URL("/api/strava/callback", request.url).toString();
  return NextResponse.redirect(stravaAuthorizeUrl(redirectUri));
}
