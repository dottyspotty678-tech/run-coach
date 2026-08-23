import { microsoftAuthorizeUrl } from "@/lib/microsoft";
import { NextResponse } from "next/server";

export async function GET() {
  const redirectUri = new URL("/api/microsoft/callback", process.env.APP_URL).toString();
  return NextResponse.redirect(microsoftAuthorizeUrl(redirectUri));
}
