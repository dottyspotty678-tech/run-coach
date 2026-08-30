import { NextResponse } from "next/server";
import { analyseCheckin, buildVoiceBriefing, type CheckinAnswers } from "@/lib/voiceCheckin";

// The submit_checkin client tool lands here: the meeting's answers go through
// one Claude call and come back as a stored proposal + the summary the agent
// reads back for confirmation. Calling again (after "actually, can we…")
// simply creates a fresh proposal.

export const maxDuration = 120;

function field(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  return typeof v === "string" ? v.trim().slice(0, 4000) : "";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const answers: CheckinAnswers = {
      training_feedback: field(body, "training_feedback"),
      injury_update: field(body, "injury_update"),
      schedule_notes: field(body, "schedule_notes"),
      // v3 agents send meal_nights; accept the old field from a stale agent.
      meal_nights: field(body, "meal_nights") || field(body, "no_cook_days"),
    };
    if (!answers.training_feedback && !answers.schedule_notes && !answers.meal_nights) {
      return NextResponse.json({ error: "No check-in answers provided." }, { status: 400 });
    }

    const briefing = await buildVoiceBriefing();
    const { proposalId, proposal } = await analyseCheckin(briefing, answers);
    return NextResponse.json({
      proposal_id: proposalId,
      spoken_summary: proposal.spoken_summary,
    });
  } catch (err) {
    console.error("Voice check-in analysis failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Couldn't analyse the check-in — ${message}` }, { status: 500 });
  }
}
