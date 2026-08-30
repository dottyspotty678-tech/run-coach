import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { createServiceClient } from "@/lib/supabase/service";
import { generateWeeklyPlan } from "@/lib/weeklyPlan";
import { getTrainingPhase } from "@/lib/trainingPhase";
import { isTrainingDay, parseAwayMeals } from "@/lib/planTypes";
import {
  awayDatesForRange,
  getEventsForWeek,
  getLatestAppliedCheckin,
  getPlanForWeek,
  getRecentActivities,
  getRecentFeedback,
  getRunnerContext,
  isRun,
} from "@/components/data";
import {
  addDays,
  boundaryWeekStart,
  formatDateShort,
  formatDayShort,
  londonDateOf,
  londonTimeOf,
  mondayOf,
  todayISO,
  weekDates,
} from "@/components/dates";

// Voice check-in engine (REQUIREMENTS §3.12): the Sunday meeting's server
// side. The ElevenLabs agent gathers three parts (week review + niggles,
// schedule gaps, no-cook days); ONE Claude call turns them into a concrete
// proposal; on spoken confirmation the proposal is applied through the
// existing feedback/injuries/revision paths.

// ---------------------------------------------------------------------------
// Briefing — dynamic variables injected into the agent's prompt.
// ---------------------------------------------------------------------------

export type VoiceSessionKind = "checkin" | "coach";

export type VoiceBriefing = {
  session: VoiceSessionKind;
  /** Plan (boundary) week the changes will target. */
  planWeek: string;
  /** Week the feedback describes — the week containing today. */
  describedWeek: string;
  /** "revise" when this week's check-in is already applied; "coach" for Ask Coach (§3.12). */
  mode: "full" | "revise" | "coach";
  dynamicVariables: Record<string, string>;
};

export async function buildVoiceBriefing(
  now = new Date(),
  session: VoiceSessionKind = "checkin"
): Promise<VoiceBriefing> {
  const today = todayISO(now);
  const describedWeek = mondayOf(today);
  // Check-in: always forward-looking — reviews the week containing today and
  // plans the week AFTER it, regardless of the Sunday 17:00 boundary rule
  // (a 15:00 Sunday check-in must not brief on the week that is already
  // over). Ask Coach: the week you are operating IN — the boundary week
  // (current week midweek; flips to the new week Sunday 17:00).
  const planWeek = session === "coach" ? boundaryWeekStart(now) : addDays(describedWeek, 7);
  const planDates = weekDates(planWeek);

  const supabaseRead = createServiceClient();
  const [activities, context, plan, events, appliedCheckin, recentFeedback, raceGoalRes] =
    await Promise.all([
      getRecentActivities(7),
      getRunnerContext(),
      getPlanForWeek(planWeek),
      getEventsForWeek(planWeek),
      getLatestAppliedCheckin([planWeek]),
      getRecentFeedback(3),
      supabaseRead.from("race_goal").select("*").eq("id", true).maybeSingle(),
    ]);
  const raceGoal = raceGoalRes.data as {
    race_name: string;
    distance_km: number;
    race_date: string;
    target_time: string | null;
  } | null;
  let raceLine = "no target race set — training for general fitness";
  if (raceGoal) {
    const { phase, weeksToRace } = getTrainingPhase(
      new Date(raceGoal.race_date),
      raceGoal.distance_km,
      now
    );
    raceLine = `${raceGoal.race_name}, ${raceGoal.distance_km} km on ${formatDateShort(raceGoal.race_date)}${
      raceGoal.target_time ? `, target ${raceGoal.target_time}` : ""
    } — ${weeksToRace.toFixed(1)} weeks out, ${phase.replace("_", " ")} phase`;
  }
  const mode: "full" | "revise" | "coach" =
    session === "coach" ? "coach" : appliedCheckin ? "revise" : "full";
  const recordedFeedback =
    recentFeedback.find((f) => f.week_start_date === describedWeek)?.feedback ??
    "none recorded yet";

  const weekReview =
    activities.length > 0
      ? activities
          .map((a) => {
            const km = a.distance_m > 0 ? `, ${(a.distance_m / 1000).toFixed(1)} km` : "";
            const mins = a.duration_s > 0 ? `, ${Math.round(a.duration_s / 60)} min` : "";
            return `${formatDayShort(londonDateOf(a.start_date))}: ${a.type}${km}${mins}${
              isRun(a.type) ? "" : " (supporting)"
            }`;
          })
          .join("\n")
      : "No sessions recorded in the last 7 days.";

  const trainingDays = Array.isArray(plan?.training_plan_json)
    ? plan.training_plan_json.filter(isTrainingDay)
    : [];
  const meals = parseAwayMeals(plan) ?? [];
  const plannedWeek =
    trainingDays.length > 0
      ? [
          plan?.week_summary ?? "",
          ...trainingDays.map(
            (d) =>
              `${formatDayShort(d.date)}: ${d.title}${d.duration_min > 0 ? ` (${d.duration_min} min)` : ""}`
          ),
          meals.length > 0
            ? `Prep-ahead meals planned for: ${meals.map((m) => formatDayShort(m.date)).join(", ")}.`
            : "No away-day meals planned.",
        ]
          .filter(Boolean)
          .join("\n")
      : "No plan generated yet for next week.";

  const scheduleLines = events.map((e) => {
    const day = formatDayShort(londonDateOf(e.start_time));
    const time = e.is_all_day ? "all day" : londonTimeOf(e.start_time);
    return `${day} ${time}: ${e.title ?? "(untitled)"}${e.is_travel ? " [travel]" : ""}`;
  });
  const awayDates = [...awayDatesForRange(events, planDates)].sort();
  if (awayDates.length > 0) {
    scheduleLines.push(`Nights away from home: ${awayDates.map(formatDateShort).join(", ")}.`);
  }
  const nextWeekSchedule =
    scheduleLines.length > 0 ? scheduleLines.join("\n") : "The calendar is empty for next week.";

  return {
    session,
    planWeek,
    describedWeek,
    mode,
    dynamicVariables: {
      today: formatDateShort(today),
      race_goal: raceLine,
      greeting:
        mode === "coach"
          ? "Hi — what can I do for you? Your week, how you're feeling, or anything about training."
          : mode === "revise"
            ? "Evening — you've already done this week's check-in. Want me to run through what's set and change anything?"
            : "Evening — got a few minutes for your Sunday check-in? Let's start with the week you've just had.",
      meeting_mode: mode,
      recorded_feedback: recordedFeedback,
      week_review: weekReview,
      current_injuries: context?.injuries?.trim() || "none reported",
      planned_week: plannedWeek,
      next_week_schedule: nextWeekSchedule,
    },
  };
}

// ---------------------------------------------------------------------------
// Analysis — one Claude call turning meeting answers into a proposal.
// ---------------------------------------------------------------------------

export type CheckinAnswers = {
  training_feedback: string;
  injury_update: string;
  schedule_notes: string;
  /** Which nights need a prepped dinner / which need no cooking (free text). */
  meal_nights: string;
};

const ProposalSchema = z.object({
  spoken_summary: z
    .string()
    .describe(
      "What the voice agent reads back to the runner: the proposed changes to next week's training and meals in 2-5 short spoken sentences. Coach voice, UK English, dates as '15 Aug', no lists or markdown. If nothing needs changing, say so plainly."
    ),
  week_feedback_note: z
    .string()
    .describe(
      "1-3 sentence feedback note for the week just trained, written from the runner's answers in their spirit. Empty string only if they gave no usable feedback."
    ),
  injuries_current: z
    .string()
    .describe(
      "The FULL updated 'current injuries / niggles' text after this meeting: carry over ongoing ones, add new ones, drop resolved ones. Empty string means injury-free."
    ),
  plan_changes: z
    .array(
      z.object({
        date: z
          .string()
          .nullable()
          .describe("YYYY-MM-DD within the plan week the change targets, or null for a general instruction."),
        instruction: z.string().describe("One concrete change to next week's training, coach-to-coach."),
      })
    )
    .describe(
      "Concrete training changes required by the runner's answers: availability clashes that move or soften sessions, AND every activity the runner declared they WILL do (climbing, a long ride, football, an extra gym session) — each declared activity gets a plan_change putting it into that day's session (cross for sport, strength for gym; two on one day fold into one entry) with the running week rebalanced around it. Empty only when the runner declared nothing and the plan already fits."
    ),
  no_cook_dates: z
    .array(z.string())
    .describe(
      "YYYY-MM-DD dates within the plan week the runner said they need no cooked/prepped meal. Empty if none. Resolve day names against the plan week's dates."
    ),
  meal_dates: z
    .array(z.string())
    .describe(
      "YYYY-MM-DD dates within the plan week the runner EXPLICITLY wants a prepped dinner for (e.g. 'recipes for Tuesday and Wednesday only' -> exactly those two dates). Empty when they didn't specify meal nights — meals then follow the away-day logic. When set, these dates fully define the meal plan."
    ),
  calendar_additions: z
    .array(
      z.object({
        date: z.string().describe("YYYY-MM-DD within the plan week."),
        title: z.string().describe("Short event title in the runner's terms, e.g. 'Client dinner'."),
        start_time: z
          .string()
          .nullable()
          .describe("24h HH:MM London time, or null for an all-day entry (trips, days away)."),
        end_time: z
          .string()
          .nullable()
          .describe("24h HH:MM London end time; null when unknown (a sensible default is applied) or all-day."),
        is_travel: z
          .boolean()
          .describe("True for travel/nights away from home — this drives travel-day training and away-day meals."),
        location: z
          .string()
          .nullable()
          .describe("Place name if the runner said one (e.g. 'Leeds'), else null."),
      })
    )
    .describe(
      "Concrete commitments from the schedule answers that are NOT already in the calendar context. Only real, dated commitments — never inferred ones. Empty when the calendar already covers everything mentioned."
    ),
});

export type CheckinProposal = z.infer<typeof ProposalSchema>;

function analysisPrompt(
  briefing: VoiceBriefing,
  answers: CheckinAnswers
): string {
  const planDates = weekDates(briefing.planWeek);
  return `You are the planning brain behind a UK running coach app's Sunday voice check-in. The voice agent has just finished the meeting. Turn the runner's answers into a concrete, minimal proposal.

${briefing.session === "coach" ? "THE WEEK BEING ADJUSTED (an Ask Coach session about the week in progress)" : "NEXT WEEK (the plan week)"} starts ${briefing.planWeek} (Monday); its dates are ${planDates.join(", ")}. Resolve any day names in the answers against these dates. The feedback note describes the week starting ${briefing.describedWeek}.

WHAT THE APP ALREADY KNOWS:
Last week's recorded training:
${briefing.dynamicVariables.week_review}
Current injuries on file: ${briefing.dynamicVariables.current_injuries}
Next week's plan as stored:
${briefing.dynamicVariables.planned_week}
Next week's calendar:
${briefing.dynamicVariables.next_week_schedule}

THE RUNNER'S ANSWERS FROM THE MEETING:
How training went and how they feel: "${answers.training_feedback}"
Niggles / injuries: "${answers.injury_update}"
Schedule for next week beyond the calendar: "${answers.schedule_notes}"
Meal nights (which dinners to plan / which not): "${answers.meal_nights}"

RULES:
- Propose the MINIMUM set of changes the answers actually require — availability clashes move sessions, fatigue or niggles soften them, freed-up days may restore quality. Do not redesign a week that already fits.
- Declared activities are plan changes, never mere context: when the runner says they WILL do something (climbing, a long cycle, football, a gym session), emit a plan_change for that date telling the plan to schedule it as that day's session — sport counts as cross-training, gym as strength, and a sport plus a gym session on the same day fold into one entry — and to rebalance the week's running around it. The runner saying it happens means it happens; the plan must show it.
- Injuries: work around anything current (that judgement happens at regeneration — your job is an accurate injuries_current text and, where clearly needed, a protective plan_change).
- meal_dates: when the runner names the nights they want dinners planned ("Tuesday and Wednesday only"), set meal_dates to exactly those dates — that fully defines the week's meal plan. Leave empty when they didn't specify.
- no_cook_dates: only dates the runner explicitly does not need food planned for. These remove that day's prep-ahead meal (used when no full meal_dates list was given).
- calendar_additions: extract each concrete, dated commitment from the schedule answer that the calendar context does not already show (dinners, trips, freed evenings are NOT events — only real commitments). Mark trips/nights away is_travel true with the location if given. These are written to the runner's calendar and feed travel-day and away-day planning, so accuracy beats completeness. Mention in spoken_summary anything you're adding to the calendar.
- Never invent commitments, sessions or injuries not in the context or answers. Never medical advice, calories or macros.
- spoken_summary is heard, not read: short sentences, no formatting, UK English, dates like "15 Aug".${
    briefing.session === "coach"
      ? `
- THIS IS A MID-WEEK COACH SESSION: change only what the runner raised, and only days from today onward — never rewrite days already trained. Leave week_feedback_note EMPTY unless they described how training is feeling (that note is a mid-week update for the week in progress). Carry injuries_current over verbatim unless they reported a change.`
      : ""
  }${
    briefing.mode === "revise"
      ? `
- THIS IS A REVISE MEETING: a check-in for this week is already applied. Propose only what the runner asked to change now. Leave week_feedback_note EMPTY unless they revisited how the week felt (empty keeps the recorded note). Carry injuries_current over verbatim unless they changed it. calendar_additions holds only NEW commitments from this conversation — previously added events are kept automatically.`
      : ""
  }`;
}

export async function analyseCheckin(
  briefing: VoiceBriefing,
  answers: CheckinAnswers
): Promise<{ proposalId: string; proposal: CheckinProposal }> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  // Voice latency matters here (the agent is holding the call open), so this
  // runs at medium effort — the heavy planning happens later in the existing
  // regeneration engine, not in this call.
  const response = await anthropic.messages.parse({
    model: "claude-opus-5",
    max_tokens: 16000,
    output_config: {
      effort: "medium",
      format: zodOutputFormat(ProposalSchema),
    },
    messages: [{ role: "user", content: analysisPrompt(briefing, answers) }],
  });
  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error(`Check-in analysis returned no structured proposal (stop_reason: ${response.stop_reason})`);
  }

  // Clamp model-supplied dates to the plan week — anything else is dropped.
  const valid = new Set(weekDates(briefing.planWeek));
  const proposal: CheckinProposal = {
    ...parsed,
    plan_changes: parsed.plan_changes.map((c) => ({
      ...c,
      date: c.date && valid.has(c.date) ? c.date : null,
    })),
    no_cook_dates: parsed.no_cook_dates.filter((d) => valid.has(d)),
    meal_dates: parsed.meal_dates.filter((d) => valid.has(d)),
    calendar_additions: parsed.calendar_additions.filter(
      (e) => valid.has(e.date) && e.title.trim() !== ""
    ),
  };

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("voice_checkins")
    .insert({
      week_start_date: briefing.planWeek,
      described_week: briefing.describedWeek,
      // mode rides inside answers_json (no migration): apply reads it to
      // decide whether calendar events replace (full) or append (revise).
      answers_json: { ...answers, mode: briefing.mode, session: briefing.session },
      proposal_json: proposal,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to store check-in proposal: ${error.message}`);

  return { proposalId: String(data.id), proposal };
}

// ---------------------------------------------------------------------------
// Apply — after the runner's spoken confirmation.
// ---------------------------------------------------------------------------

/** `${date}T${time}` interpreted as Europe/London wall clock → UTC ISO. */
function londonToUtcIso(date: string, time: string): string {
  const utcGuess = new Date(`${date}T${time}:00Z`);
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(fmt.formatToParts(utcGuess).map((x) => [x.type, x.value]));
  const wall = new Date(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
  const offsetMs = wall.getTime() - utcGuess.getTime();
  return new Date(utcGuess.getTime() - offsetMs).toISOString();
}

/**
 * Writes the proposal's calendar additions for the week, idempotently: this
 * week's previous check-in events are replaced wholesale, so a corrected
 * re-run never leaves stale entries. Runs BEFORE regeneration so the plan
 * engine sees the new events (travel days, away nights) in its context.
 */
async function writeCalendarAdditions(
  weekStart: string,
  additions: CheckinProposal["calendar_additions"],
  replace: boolean
): Promise<number> {
  const supabase = createServiceClient();
  const weekEnd = addDays(weekStart, 7);
  // Full meeting: this week's check-in events are replaced wholesale.
  // Revise meeting: earlier events stand; new ones append.
  if (replace) {
    await supabase
      .from("calendar_events")
      .delete()
      .like("external_id", "checkin:%")
      .gte("start_time", londonToUtcIso(weekStart, "00:00"))
      .lt("start_time", londonToUtcIso(weekEnd, "00:00"));
  }
  if (additions.length === 0) return 0;

  const rows = additions.map((e) => {
    const allDay = !e.start_time;
    const start = allDay ? londonToUtcIso(e.date, "00:00") : londonToUtcIso(e.date, e.start_time!);
    const end = allDay
      ? londonToUtcIso(addDays(e.date, 1), "00:00")
      : e.end_time
        ? londonToUtcIso(e.date, e.end_time)
        : new Date(new Date(start).getTime() + 2 * 60 * 60 * 1000).toISOString();
    return {
      external_id: `checkin:${crypto.randomUUID()}`,
      title: e.title,
      start_time: start,
      end_time: end,
      is_all_day: allDay,
      is_travel: e.is_travel,
      location: e.location,
    };
  });
  const { error } = await supabase.from("calendar_events").upsert(rows);
  if (error) {
    // Pre-V2 schema without the location column — same degrade as the
    // Microsoft sync: retry without it rather than losing the events.
    console.warn("calendar_events insert with location failed, retrying without:", error.message);
    const { error: retryError } = await supabase.from("calendar_events").upsert(
      rows.map((r) => {
        const { location, ...rest } = r;
        void location;
        return rest;
      })
    );
    if (retryError) throw new Error(`Failed to write check-in calendar events: ${retryError.message}`);
  }
  return rows.length;
}

export async function applyCheckin(proposalId: string): Promise<{ spoken_result: string }> {
  const supabase = createServiceClient();
  const { data: row, error } = await supabase
    .from("voice_checkins")
    .select("*")
    .eq("id", proposalId)
    .maybeSingle();
  if (error || !row) throw new Error("Check-in proposal not found — run submit_checkin again.");
  if (row.status === "applied") return { spoken_result: "Those changes were already applied." };

  // Proposals stored before the calendar feature lack the field — default it.
  const rawProposal = row.proposal_json as Record<string, unknown>;
  if (!Array.isArray(rawProposal.calendar_additions)) rawProposal.calendar_additions = [];
  if (!Array.isArray(rawProposal.meal_dates)) rawProposal.meal_dates = [];
  const proposal = ProposalSchema.parse(rawProposal);
  const done: string[] = [];

  // 1. Feedback note for the week just trained (same path as the check-in form).
  if (proposal.week_feedback_note.trim()) {
    await supabase.from("weekly_feedback").upsert({
      week_start_date: row.described_week,
      feedback: proposal.week_feedback_note.trim(),
      updated_at: new Date().toISOString(),
    });
    done.push("saved your week's feedback");
  }

  // 2. Current injuries text — the full post-meeting truth (may clear it).
  await supabase.from("runner_context").upsert({
    id: true,
    injuries: proposal.injuries_current.trim(),
    updated_at: new Date().toISOString(),
  });
  done.push(
    proposal.injuries_current.trim() ? "updated your injury notes" : "recorded you as injury-free"
  );

  // 3. Calendar first (idempotent per week), so regeneration sees the events.
  const weekStart = String(row.week_start_date);
  // Only a FULL Sunday meeting owns the week's check-in events outright;
  // revise and coach sessions append so earlier events stand.
  const meetingMode = String(
    (row.answers_json as Record<string, unknown> | null)?.mode ?? "full"
  );
  const eventCount = await writeCalendarAdditions(
    weekStart,
    proposal.calendar_additions,
    meetingMode === "full"
  );
  if (eventCount > 0) {
    done.push(`added ${eventCount} event${eventCount === 1 ? "" : "s"} to your calendar`);
  }

  // 4. One revision regenerates training + meals when anything changed. New
  // calendar events count as changes — travel/away days shift the plan.
  const hasChanges =
    proposal.plan_changes.length > 0 ||
    proposal.no_cook_dates.length > 0 ||
    proposal.meal_dates.length > 0 ||
    eventCount > 0;
  if (hasChanges) {
    const lines = proposal.plan_changes.map((c) =>
      c.date ? `- ${formatDayShort(c.date)} (${c.date}): ${c.instruction}` : `- General: ${c.instruction}`
    );
    if (proposal.meal_dates.length > 0) {
      lines.push(
        `- Prep-ahead dinners on exactly: ${proposal.meal_dates.map(formatDateShort).join(", ")} — these dates fully define the meal plan.`
      );
    }
    if (proposal.no_cook_dates.length > 0) {
      lines.push(
        `- No cooked meal needed on: ${proposal.no_cook_dates.map(formatDateShort).join(", ")} (these days carry no prep-ahead meal).`
      );
    }
    await generateWeeklyPlan({
      revisionNote: `From the Sunday voice check-in — apply ALL of these together:\n${lines.join("\n")}`,
      skipMealDates: proposal.no_cook_dates,
      ...(proposal.meal_dates.length > 0 ? { mealDates: proposal.meal_dates } : {}),
      // Revise the week this proposal was built against, not the boundary week.
      targetWeekStart: weekStart,
      // The note above IS this proposal — skip the standing-agreement fold.
      fromVoiceCheckin: true,
    });
    done.push("updated next week's training and meal plan");
  }

  await supabase
    .from("voice_checkins")
    .update({ status: "applied", applied_at: new Date().toISOString() })
    .eq("id", proposalId);

  return {
    spoken_result: `All done — ${done.join(", ")}. ${
      hasChanges
        ? "The plan and food screens are up to date."
        : "Next week's plan didn't need changing."
    }`,
  };
}
