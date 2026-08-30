import { NextResponse } from "next/server";
import { ensureVoiceAgent, getSignedUrl } from "@/lib/elevenlabs";
import { buildVoiceBriefing } from "@/lib/voiceCheckin";

// Starts a Sunday voice check-in (REQUIREMENTS §3.12): ensures the ElevenLabs
// agent exists, builds the briefing the agent opens with, and returns a
// short-lived signed WebSocket URL. Behind the PIN middleware like every
// other /api route; the ElevenLabs API key never leaves the server.

export const maxDuration = 60;

export async function POST() {
  try {
    const [agentId, briefing] = await Promise.all([ensureVoiceAgent(), buildVoiceBriefing()]);
    const signedUrl = await getSignedUrl(agentId);
    return NextResponse.json({
      signed_url: signedUrl,
      dynamic_variables: briefing.dynamicVariables,
      plan_week: briefing.planWeek,
      described_week: briefing.describedWeek,
    });
  } catch (err) {
    console.error("Voice check-in start failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Couldn't start the check-in — ${message}` }, { status: 500 });
  }
}
