import { exchangeMicrosoftCode, saveMicrosoftTokens } from "@/lib/microsoft";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  const calendarUrl = new URL("/calendar", process.env.APP_URL);

  if (error || !code) {
    calendarUrl.searchParams.set("ms_error", error ?? "missing_code");
    return NextResponse.redirect(calendarUrl);
  }

  try {
    const redirectUri = new URL("/api/microsoft/callback", process.env.APP_URL).toString();
    const tokens = await exchangeMicrosoftCode(code, redirectUri);
    await saveMicrosoftTokens(tokens);
  } catch {
    calendarUrl.searchParams.set("ms_error", "token_exchange_failed");
    return NextResponse.redirect(calendarUrl);
  }

  return NextResponse.redirect(calendarUrl);
}
