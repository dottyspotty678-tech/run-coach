import { generateWeeklyPlan } from "@/lib/weeklyPlan";
import { NextResponse } from "next/server";

export async function POST() {
  try {
    const result = await generateWeeklyPlan();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "generation failed" },
      { status: 500 }
    );
  }
}
