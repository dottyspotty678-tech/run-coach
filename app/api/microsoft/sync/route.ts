import { syncCalendarEvents } from "@/lib/microsoft";
import { NextResponse } from "next/server";

export async function POST() {
  try {
    const result = await syncCalendarEvents();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "sync failed" },
      { status: 500 }
    );
  }
}
