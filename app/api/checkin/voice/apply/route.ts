import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { applyCheckin } from "@/lib/voiceCheckin";

// The confirm_checkin client tool lands here after the runner's spoken yes:
// writes the feedback note and injuries, and (when the proposal carries
// changes) runs ONE plan revision so the Plan and Nutrition screens update.

export const maxDuration = 180;

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { proposal_id?: unknown };
    const proposalId = typeof body.proposal_id === "string" ? body.proposal_id.trim() : "";
    if (!proposalId) {
      return NextResponse.json({ error: "proposal_id is required." }, { status: 400 });
    }

    const result = await applyCheckin(proposalId);
    for (const path of ["/", "/plan", "/food", "/checkin", "/calendar"]) revalidatePath(path);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Voice check-in apply failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Couldn't apply the check-in — ${message}` }, { status: 500 });
  }
}
