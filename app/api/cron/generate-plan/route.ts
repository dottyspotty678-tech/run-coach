import { generateWeeklyPlan } from "@/lib/weeklyPlan";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

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
