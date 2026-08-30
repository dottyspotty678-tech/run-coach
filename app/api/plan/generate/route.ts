import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { generateWeeklyPlan } from "@/lib/weeklyPlan";
import { isStravaConnected, syncStravaActivities } from "@/lib/strava";
import { isMicrosoftConnected, syncCalendarEvents } from "@/lib/microsoft";
import { boundaryWeekStart, formatDayShort, londonDateOf, mondayOf, todayISO } from "@/components/dates";
import { getPendingChanges, type PendingChangesRow } from "@/components/data";

// Manual plan generation (REQUIREMENTS §3.7). Server-enforced guardrails,
// tracked in the generation_log table so they survive serverless restarts:
// - minimum 2 minutes between manual generations → 429
// - maximum 8 manual generations per calendar day (Europe/London) → 429
// The Sunday cron is exempt (it calls generateWeeklyPlan directly).
const MIN_INTERVAL_MS = 2 * 60 * 1000;
const MAX_PER_DAY = 8;

/**
 * V2 (§Screen 2): serialise the queued batch into one revision note. Dated
 * structured requests first, then general instructions, then the inline
 * check-in as context.
 */
function serialisePending(pending: PendingChangesRow, extraNote?: string): string {
  const lines: string[] = [];
  for (const c of pending.changes) {
    const parts: string[] = [];
    if (c.requested_type) parts.push(`change the session to "${c.requested_type}"`);
    if (c.instruction) parts.push(c.instruction);
    const what = parts.join(" — ");
    lines.push(c.date ? `- ${formatDayShort(c.date)} (${c.date}): ${what}` : `- General: ${what}`);
  }
  if (extraNote) lines.push(`- General: ${extraNote}`);
  let out = `Apply ALL of these requested changes together:\n${lines.join("\n")}`;
  if (pending.checkin_note.trim()) {
    out += `\nThe runner also added this check-in note (context for judgement, not a direct instruction): "${pending.checkin_note.trim()}"`;
  }
  return out;
}

export async function POST(request: Request) {
  const supabase = createServiceClient();
  let logId: number | null = null;

  // U7 (round 2): an optional JSON body { revision_note: string } turns this
  // generation into a revision of the stored plan — same rate limits, same
  // generate-then-swap. No body (the plain Generate button) = fresh plan.
  // V2 (§Screen 2): { apply_pending: true } instead applies the queued batch
  // of pending changes in ONE revision call, clearing the queue on success.
  // Two-week Plan screen: an optional `week_start_date` (YYYY-MM-DD, clamped
  // to its Monday) targets that week explicitly — the Plan screen sends next
  // week's Monday for the planning-surface (Next week) generate/apply calls.
  // Omitted, this is byte-identical to the previous behaviour: pending
  // changes load for (and generation targets) the boundary week.
  let revisionNote: string | undefined;
  let applyPending = false;
  let weekStartDateInput: string | undefined;
  let mealDates: string[] | undefined;
  try {
    const body = (await request.json()) as {
      revision_note?: unknown;
      apply_pending?: unknown;
      week_start_date?: unknown;
      meal_dates?: unknown;
    };
    if (typeof body?.revision_note === "string" && body.revision_note.trim()) {
      revisionNote = body.revision_note.trim().slice(0, 2000);
    }
    applyPending = body?.apply_pending === true;
    if (typeof body?.week_start_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.week_start_date)) {
      weekStartDateInput = mondayOf(body.week_start_date);
    }
    // §3.12: explicit meal nights — meals on exactly these dates.
    if (Array.isArray(body?.meal_dates)) {
      mealDates = body.meal_dates
        .filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d))
        .slice(0, 7);
    }
  } catch {
    // No/invalid JSON body — a normal generation.
  }
  const targetWeekStart = weekStartDateInput ?? boundaryWeekStart(new Date());

  try {
    // Load the pending batch up front — an empty queue is a 400, not a spent
    // generation.
    let pending: PendingChangesRow | null = null;
    if (applyPending) {
      pending = await getPendingChanges(targetWeekStart);
      if (!pending || (pending.changes.length === 0 && !pending.checkin_note.trim())) {
        return NextResponse.json({ error: "No pending changes to apply." }, { status: 400 });
      }
    }
    // Look back 48 h — more than enough to cover both limits.
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data: recent, error: logError } = await supabase
      .from("generation_log")
      .select("requested_at")
      .eq("source", "manual")
      .gte("requested_at", since)
      .order("requested_at", { ascending: false });

    if (!logError && recent) {
      const last = recent[0]?.requested_at;
      if (last && Date.now() - new Date(last).getTime() < MIN_INTERVAL_MS) {
        return NextResponse.json(
          { error: "Easy tiger — you can regenerate again in a moment." },
          { status: 429 }
        );
      }
      const today = todayISO();
      const todayCount = recent.filter((r) => londonDateOf(r.requested_at) === today).length;
      if (todayCount >= MAX_PER_DAY) {
        return NextResponse.json(
          {
            error:
              "That's the daily limit on regenerations — the plan refreshes automatically on Sunday.",
          },
          { status: 429 }
        );
      }
    }
    // If the log table is missing (migration not yet run) the limits degrade
    // open rather than blocking the core feature.

    // Record the attempt before the Claude call — failed calls cost money too.
    // The row id is kept so the failure reason can be written back (C-1:
    // last error queryable via `select * from generation_log order by id desc`).
    const { data: logRow } = await supabase
      .from("generation_log")
      .insert({ source: "manual" })
      .select("id")
      .maybeSingle();
    logId = (logRow as { id: number } | null)?.id ?? null;

    // Fresh input, best-effort (§3.7): sync both providers first, but a sync
    // failure never blocks generation — proceed on cached data and note the
    // staleness in the stored input snapshot.
    const syncNotes: string[] = [];
    const [stravaConnected, microsoftConnected] = await Promise.all([
      isStravaConnected(),
      isMicrosoftConnected(),
    ]);
    const results = await Promise.allSettled([
      stravaConnected ? syncStravaActivities() : Promise.resolve(null),
      microsoftConnected ? syncCalendarEvents() : Promise.resolve(null),
    ]);
    if (!stravaConnected) syncNotes.push("Strava not connected — activity data may be stale.");
    else if (results[0].status === "rejected")
      syncNotes.push("Strava sync failed before generation — activity data may be stale.");
    if (!microsoftConnected) syncNotes.push("Calendar not connected — travel data may be stale.");
    else if (results[1].status === "rejected")
      syncNotes.push("Calendar sync failed before generation — travel data may be stale.");

    // Apply flow step (a): persist the inline check-in through the existing
    // weekly_feedback path BEFORE generating, keyed (like saveWeeklyFeedback)
    // to the Monday of the week being described — today's week.
    if (pending?.checkin_note.trim()) {
      await supabase.from("weekly_feedback").upsert({
        week_start_date: mondayOf(todayISO()),
        feedback: pending.checkin_note.trim(),
        updated_at: new Date().toISOString(),
      });
    }

    // Apply flow step (b): ONE regeneration through the revise semantics,
    // with the whole batch serialised into the revision context.
    const effectiveRevisionNote = pending ? serialisePending(pending, revisionNote) : revisionNote;
    const result = await generateWeeklyPlan({
      syncNotes,
      revisionNote: effectiveRevisionNote,
      ...(weekStartDateInput ? { targetWeekStart: weekStartDateInput } : {}),
      ...(mealDates?.length ? { mealDates } : {}),
    });

    // Apply flow step (c): clear the queue on success ONLY — a failed
    // generation throws before this line and the batch survives for a retry.
    if (pending) {
      await supabase.from("pending_changes").delete().eq("week_start_date", pending.week_start_date);
    }

    return NextResponse.json({ ...result, applied: pending !== null });
  } catch (err) {
    console.error("Manual plan generation failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    // Make the failure queryable after the fact (C-1).
    if (logId !== null) {
      await supabase.from("generation_log").update({ error: message }).eq("id", logId);
    }
    // Single-user app behind the PIN gate: surfacing the real error in the
    // body is an accepted trade-off — it is the only way to diagnose without
    // Vercel log access.
    return NextResponse.json(
      { error: `Couldn't generate the plan — ${message}` },
      { status: 500 }
    );
  }
}
