import Anthropic from "@anthropic-ai/sdk";
import { coachBrief } from "@/lib/coachBrief";
import { createServiceClient } from "@/lib/supabase/service";
import { refreshSeasonPlan } from "@/lib/seasonPlan";
import { PHASE_LABELS, blockLabel, weeksUntil } from "@/lib/season";
import {
  isAwayMealEntry,
  isShoppingItem,
  isTrainingDay,
  SESSION_TYPES,
  SHOPPING_CATEGORIES,
  type AwayMealEntry,
  type RecipeIngredient,
  type SessionType,
  type ShoppingCategory,
  type ShoppingItem,
  type TrainingDay,
} from "@/lib/planTypes";
import {
  addDays,
  boundaryWeekStart,
  daysBetween,
  formatDateShort,
  formatDayShort,
  londonDateOf,
  mondayOf,
  todayISO,
  weekDates,
} from "@/components/dates";
import {
  awayDatesForRange,
  getInjuryHistory,
  getRecentActivities,
  getRecentFeedback,
  getRunnerContext,
  isRun,
  travelDatesFromEvents,
  type CalendarEventRow,
} from "@/components/data";

// Target week for planning: the authoritative week-boundary rule
// (REQUIREMENTS §3.3, implemented in components/dates.ts) — Monday 00:00 to
// Sunday 16:59 Europe/London is "this week"; from Sunday 17:00 London the
// target flips to the upcoming Monday. Generation, storage key and display
// all share this one helper so they can never disagree. The Sunday 18:00 UTC
// cron lands after the 17:00 London flip, so it always plans the week ahead.

type PlanContext = {
  weekStart: string;
  weekDatesList: string[];
  /** Travel-flagged dates — inform TRAINING sessions (unchanged from v1). */
  travelDates: string[];
  /** V2 away/home engine output — governs MEALS (meal-prep model). */
  awayDates: string[];
  /**
   * §3.12: true when awayDates was replaced by the runner's explicit meal
   * nights (voice check-in / Plan screen) — changes the prompt's wording.
   */
  mealDatesExplicit?: boolean;
  sections: {
    trainingSummary: string;
    calendarSummary: string;
    /** v3: the SEASON POSITION block from the target week's season row. */
    seasonSummary: string;
    settingsSummary: string;
    runnerContext: string;
  };
};

async function buildContext(targetWeekStart?: string): Promise<PlanContext> {
  const supabase = createServiceClient();
  const now = new Date();
  // Voice check-in (§3.12) may override the boundary rule: its meeting always
  // plans the week AFTER the one containing today, even before the Sunday
  // 17:00 flip. Everything downstream keys off this one value.
  const weekStart = targetWeekStart ?? boundaryWeekStart(now);
  const weekDatesList = weekDates(weekStart);
  const weekEnd = addDays(weekStart, 7);

  // v3 (docs/SEASON-PLAN.md §5): the season planner runs first, so the
  // position this generation works from is current (races, fitness, holds).
  const season = await refreshSeasonPlan(now);

  const [
    activities,
    { data: events },
    { data: settings },
    runnerContext,
    recentFeedback,
    injuryHistory,
  ] = await Promise.all([
    // Unified stream (round 2, U6): Strava + manually logged sessions.
    getRecentActivities(28),
    supabase
      .from("calendar_events")
      // select("*") so the optional V2 location column is included when it
      // exists and the query still works pre-migration.
      .select("*")
      .lt("start_time", `${weekEnd}T00:00:00Z`)
      .gte("end_time", `${weekStart}T00:00:00Z`)
      .order("start_time", { ascending: true }),
    supabase.from("settings").select("*").eq("id", true).maybeSingle(),
    getRunnerContext(),
    getRecentFeedback(3, weekStart),
    getInjuryHistory(),
  ]);

  // Running vs supporting training (U1): running volume counts ONLY runs.
  const all = activities;
  const runs = all.filter((a) => isRun(a.type));
  const nonRuns = all.filter((a) => !isRun(a.type));
  const manualCount = all.filter((a) => a.source === "manual").length;

  // Consistency-aware 28-day summary (REQUIREMENTS §3.3): running km for each
  // of the last 4 weeks plus the gap since the last run — not one blind total.
  const today = todayISO(now);
  const thisMonday = mondayOf(today);
  const weeklyKm = [0, 0, 0, 0]; // index 0 = the current (partial) week
  for (const a of runs) {
    const activityDate = londonDateOf(a.start_date);
    const weeksBack = Math.floor(daysBetween(mondayOf(activityDate), thisMonday) / 7);
    if (weeksBack >= 0 && weeksBack < 4) weeklyKm[weeksBack] += a.distance_m / 1000;
  }
  const totalRunKm = runs.reduce((sum, a) => sum + a.distance_m / 1000, 0);
  const lastRunDate = runs[0]?.start_date ? londonDateOf(runs[0].start_date) : null;
  const gapDays = lastRunDate ? daysBetween(lastRunDate, today) : null;

  // Rolling 7-day 10% rule (COACH.md §7): compare the last 7 days of running
  // with the 7 before. The flag and the ceiling are stated to the planner so
  // it consolidates rather than progresses after a jump.
  const dayMs = 86400000;
  const kmBetween = (fromDaysAgo: number, toDaysAgo: number) =>
    runs
      .filter((a) => {
        const age = now.getTime() - new Date(a.start_date).getTime();
        return age > toDaysAgo * dayMs && age <= fromDaysAgo * dayMs;
      })
      .reduce((sum, a) => sum + a.distance_m / 1000, 0);
  const last7Km = kmBetween(7, 0);
  const prev7Km = kmBetween(14, 7);
  const loadFlag = prev7Km > 0 && last7Km > prev7Km * 1.1;
  const loadChange = prev7Km > 0 ? Math.round(((last7Km - prev7Km) / prev7Km) * 100) : null;
  const runningCeilingKm = last7Km > 0 ? last7Km * 1.1 : null;
  const loadLines = [
    `Rolling 7-day running volume: last 7 days ${last7Km.toFixed(1)} km; previous 7 days ${prev7Km.toFixed(1)} km${
      loadChange !== null ? ` (${loadChange >= 0 ? "+" : ""}${loadChange}%)` : ""
    }.`,
    loadFlag
      ? `LOAD FLAG: the last 7 days exceeded the previous 7 by more than 10%. Hold next week's running at or below ${last7Km.toFixed(0)} km, add no new stressor, and label the week as consolidation.`
      : prev7Km === 0
        ? "No running in the previous 7-day window — re-entry rules apply (easy only, below the earlier level)."
        : `No load flag. Running ceiling for the week: ${runningCeilingKm!.toFixed(0)} km (last 7 days + 10%).`,
  ];

  // (v3: the streak-based "Mesocycle:" line is gone — block position now
  // arrives structurally from the season plan, see SEASON POSITION below.)

  // Supporting sessions summary, e.g. "2 x WeightTraining; 1 x Ride (40 km)".
  const nonRunByType = new Map<string, { count: number; km: number }>();
  for (const a of nonRuns) {
    const entry = nonRunByType.get(a.type) ?? { count: 0, km: 0 };
    entry.count += 1;
    entry.km += a.distance_m / 1000;
    nonRunByType.set(a.type, entry);
  }
  const nonRunSummary =
    nonRuns.length > 0
      ? `Plus ${nonRuns.length} non-running session${nonRuns.length === 1 ? "" : "s"} (supporting training, not running volume): ${[...nonRunByType.entries()]
          .map(([type, e]) => `${e.count} x ${type}${e.km >= 1 ? ` (${e.km.toFixed(0)} km)` : ""}`)
          .join("; ")}.`
      : "No non-running sessions in the last 28 days.";

  // Dates in user-facing style (m-1): "15 Aug", never raw ISO.
  const trainingSummary = runs.length
    ? [
        `${runs.length} runs in the last 28 days, totalling ${totalRunKm.toFixed(1)} km.`,
        `Weekly running volume, most recent first: ${weeklyKm
          .map(
            (km, i) =>
              `${i === 0 ? "this week so far" : `${i} week${i > 1 ? "s" : ""} ago`}: ${km.toFixed(1)} km`
          )
          .join("; ")}.`,
        `Last run: ${formatDateShort(lastRunDate!)} (${gapDays} day${gapDays === 1 ? "" : "s"} ago).`,
        ...loadLines,
        nonRunSummary,
        ...(manualCount > 0
          ? [`${manualCount} of these sessions were logged manually (not on Strava).`]
          : []),
      ].join("\n")
    : `No runs synced in the last 28 days — treat the runner as returning from a break and ramp up cautiously.\n${nonRunSummary}`;

  const eventRows = (events ?? []) as CalendarEventRow[];
  const travelDates = [...travelDatesFromEvents(eventRows, weekDatesList)].sort();
  // V2: the away/home engine (hotel spans + non-home locations) drives meals.
  const awayDates = [...awayDatesForRange(eventRows, weekDatesList)].sort();

  const calendarSummary =
    eventRows.length > 0
      ? eventRows
          .map(
            (e) =>
              `${e.start_time} - ${e.end_time}: ${e.title ?? "(untitled)"}${
                e.is_travel ? " [travel]" : ""
              }`
          )
          .join("\n")
      : "No calendar events for the week — assume evenings after 18:00 and weekends are free unless told otherwise.";

  // SEASON POSITION (v3): phase, block position, band, focus and races come
  // from the planner's row for this week — the model applies COACH.md §5 to
  // that position and never re-derives it.
  const seasonRow = season.weeks.find((w) => w.week_start_date === weekStart) ?? null;
  let seasonSummary: string;
  if (!seasonRow) {
    seasonSummary =
      "No season plan is available for this week (no races and no plan rows) — plan for general fitness in a 3:1 pattern, keep running volume within the ceiling above, and say so in the week summary.";
  } else {
    const pointing = season.races.find((r) => r.id === seasonRow.race_id) ?? null;
    const inWeek = season.races.find((r) => r.id === seasonRow.race_in_week_id) ?? null;
    const raceLine = (r: (typeof season.races)[number], weeksAway: number) =>
      `${r.name} (${r.priority}), ${r.distance_km} km on ${formatDayShort(r.race_date)} — ${
        weeksAway <= 0 ? "this week" : `${weeksAway} week${weeksAway === 1 ? "" : "s"} away`
      }${r.target_time ? `, target ${r.target_time}` : ""}`;
    seasonSummary = [
      `Phase: ${PHASE_LABELS[seasonRow.phase].toLowerCase()} — block position: ${blockLabel(seasonRow)}${
        seasonRow.block_position === "1" || seasonRow.block_position === "2" || seasonRow.block_position === "3"
          ? " (progressive)"
          : ""
      }.`,
      `Running volume band for the week: ${seasonRow.volume_low_km.toFixed(0)}–${seasonRow.volume_high_km.toFixed(0)} km (prescribe inside it; the LOAD FLAG above still overrides downward).`,
      `Focus: ${seasonRow.focus}.`,
      pointing
        ? `Next race: ${raceLine(pointing, weeksUntil(weekStart, pointing.race_date))}.`
        : "Next race: none scheduled — general fitness.",
      inWeek
        ? `Race inside this week: ${inWeek.name} (${inWeek.priority}), ${inWeek.distance_km} km on ${formatDayShort(inWeek.race_date)}.`
        : "No race falls inside this week.",
      `Stability: ${seasonRow.stability} (${
        seasonRow.stability === "pinned"
          ? "this week's structure is fixed"
          : seasonRow.stability === "firm"
            ? "structure fixed, band may drift ±10%"
            : "provisional — far weeks recompute"
      }).`,
    ].join("\n");
  }

  const settingsSummary = settings
    ? `Weight goal: ${settings.weight_goal}. Dietary restrictions: ${
        settings.dietary_restrictions?.join(", ") || "none"
      }. Disliked ingredients: ${
        settings.disliked_ingredients?.join(", ") || "none"
      }. Household size: ${settings.household_size}.`
    : "No settings configured — assume no restrictions, household size 1, maintaining weight.";

  // Context from the runner (U4 + round 2 U5): current injuries are worked
  // around now; historical injuries call for permanent structural caution.
  const injuriesLine = runnerContext?.injuries?.trim()
    ? `Current injuries or niggles (work around these NOW — reduce impact or intensity, avoid aggravating sessions): ${runnerContext.injuries.trim()}`
    : "Current injuries or niggles: none reported.";
  const pastInjuriesLines =
    injuryHistory.length > 0
      ? injuryHistory
          .map((i) => `- ${i.description}${i.period ? ` (${i.period})` : ""}`)
          .join("\n")
      : "- None recorded.";
  const feedbackLines =
    recentFeedback.length > 0
      ? recentFeedback
          .map(
            (f, i) =>
              `- Week starting ${formatDateShort(f.week_start_date)}${
                i === 0 ? " (most recent — weight this heaviest)" : ""
              }: "${f.feedback.trim()}"`
          )
          .join("\n")
      : "- No feedback recorded for recent weeks.";
  const runnerContextSection = `${injuriesLine}
Past injuries (history, not current problems — be structurally cautious about these: temper how quickly related loads and session types ramp, favour gradual progression where they could recur):
${pastInjuriesLines}
How recent weeks felt, most recent first:
${feedbackLines}`;

  return {
    weekStart,
    weekDatesList,
    travelDates,
    awayDates,
    sections: {
      trainingSummary,
      calendarSummary,
      seasonSummary,
      settingsSummary,
      runnerContext: runnerContextSection,
    },
  };
}

// Evidence-grounded coaching principles (U3), distilled from
// docs/evidence-base.md — the source of truth for future updates. Cited items
// (code-comment only; never surfaced in the app):
// - Item 7 (Haugen et al. 2022), 8 (Stöggl & Sperlich 2015), 9 (Oliveira et
//   al. 2024) and 10 (Muñoz/Seiler 2014): ~80% of running volume at low
//   intensity (polarised distribution), for recreational runners too.
// - Item 11 (Llanos-Lagos et al. 2024, building on Blagrove 2018): strength
//   training 2x/week with substantive loading improves running economy.
// - Item 5 (IOC REDs consensus 2023): never aggressive energy restriction
//   alongside high mileage — the safety layer behind the no-calorie rule.
// - Items 1 (AND/DC/ACSM 2016), 2 (ISSN nutrient timing 2017) and 6 (ACSM
//   fluid replacement 2007): carbohydrate-forward fuelling around hard/long
//   sessions and sensible hydration, kept qualitative in this app.
// Fallback only: docs/COACH.md (via coachBrief) is the live brief and
// supersedes this block whenever the file is readable.
export const EVIDENCE_PRINCIPLES = `TRAINING AND NUTRITION PRINCIPLES (evidence-based — follow these):
- Keep roughly 80% of the week's running volume at low, conversational intensity; concentrate hard work into one or two quality sessions (polarised intensity distribution).
- Two gym-based strength sessions per week with substantive loading support running economy — they complement the running, they do not replace it.
- Never pair high running mileage with aggressive energy restriction. Even when the weight goal is "lose", keep meals satisfying and fuel hard days properly — under-fuelling harms both health and performance.
- Fuelling and hydration guidance stays qualitative: carb-forward meals before and after hard or long sessions, drink sensibly around training. No numbers, ever.`;

// Tool schema mirroring lib/planTypes.ts exactly — one call returns training,
// meals and shopping list together (REQUIREMENTS §5.4: never split the call).
const WEEKLY_PLAN_TOOL = {
  name: "provide_weekly_plan",
  description:
    "Provide the structured weekly training plan, away-day meal-prep recipes and consolidated shopping list.",
  input_schema: {
    type: "object" as const,
    properties: {
      week_summary: {
        type: "string",
        description:
          "2-3 sentences: the intent of the week, target weekly kilometres, and the training phase. Any total volume you state MUST equal what the seven training_days entries actually add up to — recount the sessions before writing it (tester finding f-1: a summary once claimed 4.5-5 km against ~14 km of prescribed sessions). If no race is set, say the plan targets general fitness.",
      },
      training_days: {
        type: "array",
        description: "Exactly 7 entries, one per day, Monday first.",
        items: {
          type: "object",
          properties: {
            date: { type: "string", description: "YYYY-MM-DD" },
            session_type: { type: "string", enum: [...SESSION_TYPES] },
            title: {
              type: "string",
              description:
                'The session in AT MOST 3 words — "Easy run", "Long ride", "Rest", "Intervals" — a couple more only when one day folds multiple sessions ("Climbing + gym strength"). Never a sentence; specifics (distance, structure, context) belong in detail.',
            },
            detail: {
              type: "string",
              description: "1-3 sentences of instruction, including duration or distance.",
            },
            duration_min: {
              type: "integer",
              description: "Estimated minutes; 0 for rest days.",
            },
            why: {
              type: "string",
              description: "One sentence linking the session to phase, calendar or recovery.",
            },
            is_travel_day: {
              type: "boolean",
              description: "True only for the travel dates given in the prompt.",
            },
          },
          required: [
            "date",
            "session_type",
            "title",
            "detail",
            "duration_min",
            "why",
            "is_travel_day",
          ],
        },
      },
      meals: {
        type: "array",
        description:
          "Meal-prep recipes for AWAY days only: exactly one entry per away date listed in the prompt, dates matching exactly. Home days get NO meals. Empty array when the week has no away days.",
        items: {
          type: "object",
          properties: {
            date: { type: "string", description: "YYYY-MM-DD — must be one of the away dates." },
            recipe_name: {
              type: "string",
              description: 'Plain, appetising name, e.g. "Chorizo and butter bean stew".',
            },
            prep_time_min: {
              type: "integer",
              description: "Minutes to prep/cook ahead at home before travelling.",
            },
            ingredients: {
              type: "array",
              description: "Every ingredient with a qualitative quantity.",
              items: {
                type: "object",
                properties: {
                  item: {
                    type: "string",
                    description:
                      "The bare ingredient name only — NO amounts, counts or preparation quantities here.",
                  },
                  quantity: {
                    type: "string",
                    description:
                      'ALL amount information, complete, in this one field — e.g. "2 fillets", "1 bag", "500 g". Never split or repeat quantity info into item.',
                  },
                },
                required: ["item", "quantity"],
              },
            },
            method: {
              type: "string",
              description:
                "Full cooking method, at most 4 short steps — written for cooking ahead at home.",
            },
          },
          required: ["date", "recipe_name", "prep_time_min", "ingredients", "method"],
        },
      },
      shopping_list: {
        type: "array",
        description:
          "Exactly the away-day meals' ingredients, consolidated across recipes. Empty when there are no away days.",
        items: {
          type: "object",
          properties: {
            item: {
              type: "string",
              description: "The bare item name only — no amounts here.",
            },
            quantity_note: {
              type: "string",
              description:
                'ALL amount information to buy, complete, in this one field — e.g. "2 fillets", "1 bag", "small bunch". Never split or repeat it into item.',
            },
            category: { type: "string", enum: [...SHOPPING_CATEGORIES] },
          },
          required: ["item", "quantity_note", "category"],
        },
      },
    },
    required: ["week_summary", "training_days", "meals", "shopping_list"],
  },
};

/** Revision context (round 2, U7): the stored plan being revised plus the runner's notes. */
type RevisionRequest = {
  note: string;
  currentPlanJson: string;
};

// ---------------------------------------------------------------------------
// Voice check-in standing agreements (§3.12). A confirmed Sunday check-in is
// a commitment for its week: every later generation of that week — the
// Sunday cron's fresh plan, the manual Generate button, pending-batch
// revisions — must keep honouring its changes and no-cook days, or the cron
// would silently regenerate them away (and a later revision would re-add a
// meal on a no-cook away day, since away dates come fresh from the calendar).
// ---------------------------------------------------------------------------

type AppliedCheckin = { notes: string[]; noCookDates: string[]; mealDates: string[] };

async function loadAppliedCheckin(weekStart: string): Promise<AppliedCheckin | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("voice_checkins")
    .select("proposal_json")
    .eq("week_start_date", weekStart)
    .eq("status", "applied")
    .order("applied_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  // Degrade open (matching the other optional tables): no migration, no rows
  // or malformed JSON just means no standing agreements.
  if (error || !data || !isRecord(data.proposal_json)) return null;
  const p = data.proposal_json;
  const notes: string[] = [];
  const weekSet = new Set(weekDates(weekStart));
  if (Array.isArray(p.plan_changes)) {
    for (const c of p.plan_changes) {
      if (!isRecord(c) || typeof c.instruction !== "string" || !c.instruction.trim()) continue;
      const date = typeof c.date === "string" ? c.date : null;
      // A coach proposal can carry changes for the week in progress too —
      // those are not THIS week's standing agreements.
      if (date && !weekSet.has(date)) continue;
      notes.push(date ? `- ${formatDayShort(date)} (${date}): ${c.instruction}` : `- General: ${c.instruction}`);
    }
  }
  const noCookDates = Array.isArray(p.no_cook_dates)
    ? p.no_cook_dates.filter((d): d is string => typeof d === "string")
    : [];
  const mealDates = Array.isArray(p.meal_dates)
    ? p.meal_dates.filter((d): d is string => typeof d === "string")
    : [];
  if (notes.length === 0 && noCookDates.length === 0 && mealDates.length === 0) return null;
  return { notes, noCookDates, mealDates };
}

function checkinBlockFor(checkin: AppliedCheckin, mealsExplicit: boolean): string {
  const lines = [...checkin.notes];
  if (mealsExplicit) {
    // Meal days are fully defined above; restating stale meal/no-cook
    // agreements here would contradict them and confuse the model.
    return lines.length > 0
      ? `

STANDING AGREEMENTS FROM THE RUNNER'S SUNDAY CHECK-IN (already confirmed — honour ALL of these in this plan, whatever else changes):
${lines.join("\n")}`
      : "";
  }
  if (checkin.mealDates.length > 0) {
    lines.push(
      `- Prep-ahead dinners on exactly: ${checkin.mealDates.map(formatDateShort).join(", ")} (already reflected in the meal days above).`
    );
  }
  if (checkin.noCookDates.length > 0) {
    lines.push(
      `- No prepped meal on: ${checkin.noCookDates.map(formatDateShort).join(", ")} (already excluded from the away days above).`
    );
  }
  return `

STANDING AGREEMENTS FROM THE RUNNER'S SUNDAY CHECK-IN (already confirmed — honour ALL of these in this plan, whatever else changes):
${lines.join("\n")}`;
}

function buildPrompt(
  context: PlanContext,
  revision?: RevisionRequest | null,
  checkinBlock = ""
): string {
  const travelLine =
    context.travelDates.length > 0
      ? `Travel days this week (from the calendar — these shape TRAINING sessions): ${context.travelDates.join(", ")}.`
      : "No travel days this week.";
  const awayLine = context.mealDatesExplicit
    ? context.awayDates.length > 0
      ? `Meal nights this week (the runner asked for a prep-ahead dinner on EXACTLY these dates, whether or not they are away — these are the ONLY days that get meals): ${context.awayDates.join(", ")}.`
      : "The runner asked for no prepped meals this week — return an empty meals array and an empty shopping list."
    : context.awayDates.length > 0
      ? `Away days this week (nights away from home — these are the ONLY days that get meals, prepped ahead): ${context.awayDates.join(", ")}.`
      : "No away days this week — return an empty meals array and an empty shopping list.";

  // U7: when revising, the current plan and the notes lead the prompt, with a
  // keep-stable instruction — the point is a tweak, not a fresh plan.
  const revisionBlock = revision
    ? `

REVISION REQUEST:
A plan for this week already exists and the runner has reviewed it. Revise that plan rather than writing a new one.
The runner's revision notes: "${revision.note}"
The current plan, as stored:
${revision.currentPlanJson}

Revision rules:
- Change ONLY what the notes require, plus the minimum knock-on adjustments needed to keep the week coherent (for example, moving the long run may mean swapping the adjacent rest day, or moving its carb-forward meal with it).
- Keep everything else stable: the same dates, and identical session types, titles, details, whys, meals and shopping items for days the notes do not implicate. Do not reword or "improve" unchanged content.
- Still return the complete week in full through the tool: all 7 training_days, one meal per away day and the full shopping list, unchanged entries included verbatim.`
    : "";

  return `You are a UK running club coach and a practical meal-prep planner for one busy consultant. Produce next week's structured training plan, away-day meal-prep recipes and shopping list in a single response using the provide_weekly_plan tool.

THE WEEK:
The week starts ${context.weekStart} (Monday). Produce exactly 7 training_days with these consecutive dates: ${context.weekDatesList.join(", ")}. Produce exactly one meal for each away day listed below, and no meals for any other day.
${travelLine}
${awayLine}${checkinBlock}${revisionBlock}

TRAINING HISTORY (last 28 days):
${context.sections.trainingSummary}

SEASON POSITION (from the season plan — apply the coaching brief's §5 rules to THIS position; do not re-derive phase, block position or volume):
${context.sections.seasonSummary}

CALENDAR THIS WEEK:
${context.sections.calendarSummary}

PERSONAL SETTINGS:
${context.sections.settingsSummary}

CONTEXT FROM THE RUNNER:
${context.sections.runnerContext}

${coachBrief(EVIDENCE_PRINCIPLES)}

TRAINING RULES:
- The SEASON POSITION above is authoritative: prescribe total running volume INSIDE the stated band (the band already respects the 10% rule; a LOAD FLAG still pushes it down, never up), and shape the week for the stated phase — protect the long run in base/build, sharpen in peak, visibly cut load in taper and race week, easy only in recovery. When the position says general fitness, say so in week_summary.
- Block position drives the week's shape: progressive weeks (1, 2, 3) carry the phase's normal quality sessions; "down" and "recovery" weeks get AT MOST ONE quality session (threshold-biased, shorter than usual), a long run 20–30% shorter, and are labelled plainly as consolidation/recovery in week_summary; taper and race week follow the brief's §5 exactly.
- A B-priority race inside the week gets a 3–4 day mini-taper: easy running only on the three days before it, no other quality session that week, the race itself is the week's hard effort (session_type "race").
- A C-priority race inside the week replaces that day's quality session (session_type "race") and eases the day before; the week otherwise keeps its phase and band.
- An A race inside the week means race week: two or three short easy runs, one brief race-pace touch early, rest the day before, strength stops mid-week.
- Ramp sensibly after any gap in the history above — never assume continuity that is not there. Only running counts as running volume; rides and gym work are supporting training.
- Respect the runner's context above: work around any injuries or niggles (reduce impact or intensity, avoid aggravating session types) and respond to how recent weeks felt — if last week felt too hard, ease this week's load; if it felt easy, progress gently.
- Include exactly two strength sessions this week (session_type "strength"): one on a weekday and one on a weekend day, defaulting to Tuesday and Saturday unless the calendar makes those impossible — then the nearest sensible weekday/weekend day.
- Strength sessions are ALWAYS gym-based: assume access to a proper gym even when travelling (hotel gym or one nearby). Never prescribe bodyweight-only or hotel-room workarounds. A short strength session may share its day with an easy run — keep session_type "strength" and fold the run into the detail.
- Hard and long running sessions go on non-travel days where possible. Travel days get rest, easy runs, strength (gyms travel with you), or short hotel-friendly runs (for example "30 min easy from the hotel — out-and-back, no route needed").
- Set is_travel_day true only for the travel dates listed above.
- duration_min is 0 for rest days. Rest days still get a proper title, detail and why — never an empty entry.
- Any total volume stated in week_summary MUST equal what the seven training_days actually add up to — recount the sessions before writing it (f-1).

MEAL-PREP RULES (v2 — meals exist ONLY for the away days listed above):
- One real recipe per away day, nothing for home days. Do not produce eating-out guidance, restaurant advice or placeholder meals anywhere — that model is retired.
- This is meal prep: the runner cooks everything at home BEFORE travelling and takes the food along. Every recipe must survive that — batch-friendly, transportable, and good reheated or eaten cold. No dishes that only work straight from the pan.
- Every ingredient gets a qualitative quantity ("2 fillets", "1 bag"; natural weights like "500 g passata" are fine). Never calories, macros or points.
- Reuse overlapping fresh and perishable ingredients across the away-day recipes to cut waste; respect the dietary restrictions and disliked ingredients above; scale portions to what one person needs while away (household size matters only for what is cooked, not the travel portions).
- Match heartiness to that day's training qualitatively (carb-forward the evening before hard or long sessions), never numerically.
- method is at most 4 short steps, written for one prep session at home.

SHOPPING LIST RULES:
- The list is exactly the away-day recipes' ingredients, consolidated across recipes: every item must trace to an away-day recipe, and every recipe ingredient must appear (merged where recipes share it).
- quantity_note is the amount to buy — qualitative ("2 fillets", "1 bag", "small bunch"); natural weights fine.
- Assume a stocked store cupboard: leave out true staples (oil, salt, pepper, common dried herbs and spices).
- If there are no away days, return an empty list.

STYLE RULES (strict):
- title is the session in AT MOST 3 words (a couple more only for a multi-session day). It is a label on a small phone row, never a sentence — everything else goes in detail.
- UK English throughout: -ise endings, chilli not chili, yoghurt not yogurt. Metric units only (km, min/km).
- Write any date inside text in the style "15 Aug" — never as an ISO date like 2026-08-15.
- Coach voice: concise, practical, direct instructions with one line of rationale — like a good club coach texting, not a fitness influencer. No exclamation marks. No emoji.
- Qualitative guidance only: never mention calories, kilojoules, macros, points or body-weight targets, and make no medical claims.
- Recipe names plain and appetising; methods at most 4 short steps, written for a tired person at 20:30.`;
}

type RawPlan = {
  week_summary: unknown;
  training_days: unknown;
  meals: unknown;
  shopping_list: unknown;
};

type ValidatedPlan = {
  week_summary: string;
  training_days: TrainingDay[];
  meals: AwayMealEntry[];
  shopping_list: ShoppingItem[];
};

// ---------------------------------------------------------------------------
// Coercion (fix round 1, C-1): validation catches malformed structure, it does
// not fight the model. Minor deviations are clamped to the nearest valid value
// and logged as warnings; hard failures remain only for missing days/dates.
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function coerceString(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return fallback;
}

function coerceMinutes(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

/** Nearest valid session type for an off-enum value. */
function coerceSessionType(v: unknown, warnings: string[]): SessionType {
  if (typeof v === "string") {
    const s = v.toLowerCase().trim();
    if ((SESSION_TYPES as readonly string[]).includes(s)) return s as SessionType;
    warnings.push(`Coerced unknown session_type "${v}"`);
    if (s.includes("strength") || s.includes("gym") || s.includes("weight")) return "strength";
    if (s.includes("interval") || s.includes("speed") || s.includes("track")) return "intervals";
    if (s.includes("tempo") || s.includes("threshold")) return "tempo";
    if (s.includes("long")) return "long";
    if (s.includes("race")) return "race";
    if (s.includes("rest") || s.includes("off")) return "rest";
    if (s.includes("cross") || s.includes("bike") || s.includes("swim")) return "cross";
  } else {
    warnings.push("Coerced missing session_type");
  }
  return "easy";
}

const SESSION_LABELS: Record<SessionType, string> = {
  rest: "Rest",
  easy: "Easy run",
  tempo: "Tempo",
  intervals: "Intervals",
  long: "Long run",
  cross: "Cross-training",
  strength: "Strength",
  race: "Race",
};

function coerceTrainingDay(
  raw: Record<string, unknown>,
  date: string,
  isTravel: boolean,
  warnings: string[]
): TrainingDay {
  const session_type = coerceSessionType(raw.session_type, warnings);
  const title = coerceString(raw.title, SESSION_LABELS[session_type]);
  return {
    date,
    session_type,
    title,
    detail: coerceString(raw.detail, title),
    duration_min: coerceMinutes(raw.duration_min),
    why: coerceString(raw.why),
    // Echo the calendar's travel flags exactly, whatever the model said.
    is_travel_day: isTravel,
  };
}

/** V2: coerce a recipe ingredient list — strings become {item, quantity: ""}. */
function coerceIngredients(raw: unknown, date: string, warnings: string[]): RecipeIngredient[] {
  if (!Array.isArray(raw)) {
    warnings.push(`Meal for ${date} has no ingredients array`);
    return [];
  }
  const out: RecipeIngredient[] = [];
  for (const i of raw) {
    if (typeof i === "string") {
      if (i.trim()) out.push({ item: i.trim(), quantity: "" });
      continue;
    }
    if (isRecord(i)) {
      const item = coerceString(i.item ?? i.name).trim();
      if (!item) continue;
      out.push({ item, quantity: coerceString(i.quantity ?? i.quantity_note).trim() });
    }
  }
  return out;
}

/** V2 meal-prep recipe for an away day. */
function coerceAwayMeal(
  raw: Record<string, unknown>,
  date: string,
  warnings: string[]
): AwayMealEntry {
  return {
    date,
    recipe_name: coerceString(raw.recipe_name, "Prep-ahead dinner"),
    prep_time_min: coerceMinutes(raw.prep_time_min),
    ingredients: coerceIngredients(raw.ingredients, date, warnings),
    // Accept the old field name as a fallback if the model reaches for it.
    method: coerceString(raw.method, coerceString(raw.short_instructions)),
  };
}

// m-5 helpers: fuzzy ingredient matching for the shopping-list scrub. An item
// matches an ingredient when every significant word of the shorter phrase
// appears in the longer one ("tinned tuna" ↔ "tinned tuna (1-2 tins)").
function ingredientWords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function matchesAnyIngredient(item: string, ingredients: string[]): boolean {
  const itemWords = ingredientWords(item);
  if (itemWords.length === 0) return false;
  return ingredients.some((ing) => {
    const ingWords = ingredientWords(ing);
    if (ingWords.length === 0) return false;
    const [shorter, longer] =
      itemWords.length <= ingWords.length ? [itemWords, ingWords] : [ingWords, itemWords];
    const longerSet = new Set(longer);
    return shorter.every((w) => longerSet.has(w));
  });
}

/**
 * Validates a tool response. Structure-level problems (missing arrays, wrong
 * day counts, wrong date sets) are hard errors fed back into the retry
 * prompt; everything else is coerced with a warning.
 */
function validatePlan(
  raw: RawPlan,
  context: PlanContext
): { plan: ValidatedPlan | null; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const travelSet = new Set(context.travelDates);

  let weekSummary = "";
  if (typeof raw.week_summary === "string" && raw.week_summary.trim() !== "") {
    weekSummary = raw.week_summary.trim();
  } else {
    warnings.push("week_summary missing — used a generic fallback");
    weekSummary = "Training and meals for the week ahead.";
  }

  // Training days: hard-fail only when the 7 expected dates cannot be matched.
  const trainingDays: TrainingDay[] = [];
  if (!Array.isArray(raw.training_days)) {
    errors.push("training_days must be an array of exactly 7 entries, Monday first.");
  } else {
    const byDate = new Map<string, Record<string, unknown>>();
    for (const d of raw.training_days) {
      if (isRecord(d) && typeof d.date === "string") byDate.set(d.date, d);
    }
    for (const date of context.weekDatesList) {
      const entry = byDate.get(date);
      if (!entry) {
        errors.push(`training_days is missing an entry for ${date}.`);
        continue;
      }
      trainingDays.push(coerceTrainingDay(entry, date, travelSet.has(date), warnings));
    }
  }

  // Meals (V2): one recipe per AWAY date, nothing else. Missing away-date
  // recipes are hard errors (retried); meals for non-away dates are dropped
  // with a warning — home days have no meals by definition.
  const meals: AwayMealEntry[] = [];
  const awaySet = new Set(context.awayDates);
  if (!Array.isArray(raw.meals)) {
    errors.push(
      "meals must be an array with exactly one recipe per away date (empty when there are no away days)."
    );
  } else {
    const byDate = new Map<string, Record<string, unknown>>();
    for (const m of raw.meals) {
      if (isRecord(m) && typeof m.date === "string") {
        if (awaySet.has(m.date)) byDate.set(m.date, m);
        else warnings.push(`Dropped meal for ${m.date} — not an away day (home days get no meals)`);
      }
    }
    for (const date of context.awayDates) {
      const entry = byDate.get(date);
      if (!entry) {
        errors.push(`meals is missing a recipe for away day ${date}.`);
        continue;
      }
      meals.push(coerceAwayMeal(entry, date, warnings));
    }
  }

  // Shopping list: never a hard failure beyond "not an array" — bad items are
  // repaired or dropped.
  const shoppingList: ShoppingItem[] = [];
  if (!Array.isArray(raw.shopping_list)) {
    errors.push("shopping_list must be an array (empty when there are no away days).");
  } else {
    for (const s of raw.shopping_list) {
      if (!isRecord(s)) continue;
      const item = coerceString(s.item).trim();
      if (!item) {
        warnings.push("Dropped a shopping item with no name");
        continue;
      }
      let category = s.category as ShoppingCategory;
      if (!SHOPPING_CATEGORIES.includes(category)) {
        warnings.push(`Coerced shopping category "${String(s.category)}" to other`);
        category = "other";
      }
      shoppingList.push({ item, quantity_note: coerceString(s.quantity_note), category });
    }
  }

  if (errors.length > 0) return { plan: null, errors, warnings };

  // V2 shopping scrub (m-5 lineage): the list is exactly the away recipes'
  // ingredients — drop anything that traces to no recipe (and everything when
  // there are no away days), and warn when a recipe ingredient never made it
  // onto the list.
  const recipeIngredientNames = meals.flatMap((m) => m.ingredients.map((i) => i.item));
  const scrubbedShopping = shoppingList.filter((s) => {
    const traced =
      recipeIngredientNames.length > 0 && matchesAnyIngredient(s.item, recipeIngredientNames);
    if (!traced) {
      warnings.push(
        `Dropped shopping item "${s.item}" — it does not trace to any away-day recipe ingredient`
      );
    }
    return traced;
  });
  for (const name of recipeIngredientNames) {
    if (!scrubbedShopping.some((s) => matchesAnyIngredient(s.item, [name]))) {
      warnings.push(`Recipe ingredient "${name}" has no shopping-list item`);
    }
  }

  // Soft checks (warn only — never fail generation).
  const strengthCount = trainingDays.filter((d) => d.session_type === "strength").length;
  if (strengthCount !== 2) {
    warnings.push(`Plan has ${strengthCount} strength sessions (expected 2 — U2)`);
  }

  // Final assertion with the shared runtime guards — coercion should make
  // these pass by construction. (Callback parameters are typed as unknown so
  // the negated type guards do not narrow the elements to never.)
  const guardFailures = [
    ...trainingDays
      .filter((d: unknown) => !isTrainingDay(d))
      .map((d) => `training day ${(d as TrainingDay).date}`),
    ...meals
      .filter((m: unknown) => !isAwayMealEntry(m))
      .map((m) => `meal ${(m as AwayMealEntry).date}`),
    ...scrubbedShopping
      .filter((s: unknown) => !isShoppingItem(s))
      .map((s) => `shopping item ${(s as ShoppingItem).item}`),
  ];
  if (guardFailures.length > 0) {
    return {
      plan: null,
      errors: [`Internal guard failure after coercion: ${guardFailures.join(", ")}`],
      warnings,
    };
  }

  return {
    plan: {
      week_summary: weekSummary,
      training_days: trainingDays,
      meals,
      shopping_list: scrubbedShopping,
    },
    errors: [],
    warnings,
  };
}

/** Plain-text render of the structured plan, kept for the legacy training_plan_text column. */
function renderPlanText(plan: ValidatedPlan): string {
  const days = plan.training_days
    .map((d) => {
      const header = `${formatDayShort(d.date)} — ${SESSION_LABELS[d.session_type]}${
        d.duration_min > 0 ? ` (${d.duration_min} min)` : ""
      }${d.is_travel_day ? " [travel day]" : ""}: ${d.title}`;
      return `${header}\n${d.detail}\nWhy: ${d.why}`;
    })
    .join("\n\n");
  return `${plan.week_summary}\n\n${days}`;
}

async function callClaude(prompt: string): Promise<RawPlan> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 12288,
    tools: [WEEKLY_PLAN_TOOL],
    tool_choice: { type: "tool", name: "provide_weekly_plan" },
    messages: [{ role: "user", content: prompt }],
  });

  // A truncated tool call produces incomplete input — surface that cause
  // explicitly rather than failing as a mysterious validation error (C-1).
  if (response.stop_reason === "max_tokens") {
    throw new Error("Plan generation hit the output token limit — the response was truncated");
  }

  const toolUse = response.content.find((c) => c.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error(
      `Claude did not return a structured plan (stop_reason: ${response.stop_reason ?? "unknown"})`
    );
  }
  return toolUse.input as RawPlan;
}

/**
 * Generates and stores the week's plan. Generate-then-swap (REQUIREMENTS
 * §3.7): the row is only written after the new plan validates, so a failed
 * generation never deletes or corrupts the previous plan. On a validation
 * failure the Claude call is retried once with the errors appended.
 */
export async function generateWeeklyPlan(options?: {
  syncNotes?: string[];
  /**
   * Round 2 (U7): when set, this generation is a REVISION — the stored plan
   * for the target week is fed back into the prompt with the note and a
   * keep-stable instruction, and the note is stored on the resulting row.
   */
  revisionNote?: string;
  /**
   * Voice check-in (§3.12): away dates the runner needs no prepped meal for
   * (eating out, catered). Removed from the away set BEFORE prompting and
   * validation, so those days simply carry no meal.
   */
  skipMealDates?: string[];
  /**
   * §3.12: the runner's explicit meal nights — REPLACES the away-day set
   * entirely (meals on exactly these dates, whether away or not).
   */
  mealDates?: string[];
  /**
   * Voice check-in (§3.12): plan/revise this Monday's week instead of the
   * boundary-rule week. YYYY-MM-DD, must be a Monday.
   */
  targetWeekStart?: string;
  /**
   * §3.12: true when this call IS the check-in apply — its revision note
   * already carries the proposal, so the standing-agreement fold is skipped.
   */
  fromVoiceCheckin?: boolean;
}) {
  const context = await buildContext(options?.targetWeekStart);

  // §3.12: fold the week's confirmed check-in (if any) into every other
  // generation path, so the Sunday cron and later revisions keep honouring
  // what was agreed by voice.
  const checkin = options?.fromVoiceCheckin ? null : await loadAppliedCheckin(context.weekStart);

  // Explicit meal nights (call option first, then the standing check-in,
  // then the stored plan's own snapshot) replace the away-derived meal days
  // wholesale — and SUPERSEDE any earlier no-cook agreement: the runner's
  // latest explicit list is the whole truth. The snapshot inheritance is
  // load-bearing: without it, ANY later regeneration of the week (a title
  // cleanup, a session tweak) silently reverted to away-day logic and wiped
  // the requested meals.
  let explicitMealDates = options?.mealDates?.length
    ? options.mealDates
    : checkin?.mealDates.length
      ? checkin.mealDates
      : null;
  if (!explicitMealDates) {
    const { data: prevRow } = await createServiceClient()
      .from("weekly_plans")
      .select("input_snapshot_json")
      .eq("week_start_date", context.weekStart)
      .maybeSingle();
    const snap = prevRow?.input_snapshot_json as Record<string, unknown> | null | undefined;
    if (snap?.mealDatesExplicit === true && Array.isArray(snap.awayDates)) {
      const inherited = snap.awayDates.filter((d): d is string => typeof d === "string");
      if (inherited.length > 0) explicitMealDates = inherited;
    }
  }
  if (explicitMealDates) {
    const week = new Set(context.weekDatesList);
    context.awayDates = [...new Set(explicitMealDates.filter((d) => week.has(d)))].sort();
    context.mealDatesExplicit = true;
  }
  const checkinBlock = checkin ? checkinBlockFor(checkin, explicitMealDates !== null) : "";

  const skipMeals = new Set([
    ...(options?.skipMealDates ?? []),
    ...(explicitMealDates ? [] : (checkin?.noCookDates ?? [])),
  ]);
  if (skipMeals.size > 0) {
    context.awayDates = context.awayDates.filter((d) => !skipMeals.has(d));
  }

  // U7: load the plan being revised. If none exists (note sent against an
  // empty week) fall back to a normal generation — the note still applies as
  // guidance via the revision block only when there is a plan to hold stable.
  const revisionNote = options?.revisionNote?.trim() || null;
  let revision: RevisionRequest | null = null;
  if (revisionNote) {
    const supabaseRead = createServiceClient();
    const { data: stored } = await supabaseRead
      .from("weekly_plans")
      .select("training_plan_text, training_plan_json, week_summary, meal_plan_json, shopping_list_json")
      .eq("week_start_date", context.weekStart)
      .maybeSingle();
    if (stored) {
      revision = {
        note: revisionNote,
        currentPlanJson: JSON.stringify(
          stored.training_plan_json
            ? {
                week_summary: stored.week_summary,
                training_days: stored.training_plan_json,
                meals: stored.meal_plan_json,
                shopping_list: stored.shopping_list_json,
              }
            : // Legacy plan: the text render is the best available basis.
              { plan_text: stored.training_plan_text, meals: stored.meal_plan_json },
          null,
          1
        ),
      };
    } else {
      console.warn("Revision requested but no stored plan for", context.weekStart, "— generating fresh with the note");
    }
  }

  // A revision note against an empty week must not be dropped (voice check-in
  // bug): fold it into the fresh generation as explicit runner requests.
  const freshNoteBlock =
    revisionNote && !revision
      ? `

RUNNER'S REQUESTS FOR THIS WEEK (no stored plan exists yet — write the fresh plan applying ALL of these):
${revisionNote}`
      : "";

  const basePrompt = buildPrompt(context, revision, checkinBlock + freshNoteBlock);

  let validated: ValidatedPlan | null = null;
  let lastErrors: string[] = [];

  for (let attempt = 0; attempt < 2 && !validated; attempt++) {
    const prompt =
      attempt === 0
        ? basePrompt
        : `${basePrompt}\n\nYOUR PREVIOUS RESPONSE FAILED VALIDATION. Fix every one of these problems and respond again with the full corrected plan:\n${lastErrors
            .map((e) => `- ${e}`)
            .join("\n")}`;

    const raw = await callClaude(prompt);
    const result = validatePlan(raw, context);
    if (result.warnings.length > 0) {
      console.warn("Weekly plan generation warnings:", result.warnings);
    }
    if (result.plan) validated = result.plan;
    else lastErrors = result.errors;
  }

  if (!validated) {
    // Fail WITHOUT touching the stored row — the previous plan stays intact.
    const detail = lastErrors.join(" | ");
    console.error("Weekly plan generation failed validation twice:", lastErrors);
    throw new Error(
      `The generated plan failed validation twice (previous plan unchanged): ${detail}`
    );
  }

  const supabase = createServiceClient();
  const nowIso = new Date().toISOString();
  const basePayload = {
    week_start_date: context.weekStart,
    training_plan_text: renderPlanText(validated),
    training_plan_json: validated.training_days,
    week_summary: validated.week_summary,
    meal_plan_json: validated.meals,
    shopping_list_json: validated.shopping_list,
    input_snapshot_json: { ...context, sync_notes: options?.syncNotes ?? [] },
    generated_at: nowIso,
  };
  // U7 audit trail: a revision stores its note + timestamp; a fresh
  // generation clears them (the note is shown "until the next generation").
  const { error } = await supabase.from("weekly_plans").upsert({
    ...basePayload,
    revision_note: revision ? revision.note : null,
    revised_at: revision ? nowIso : null,
  });
  if (error) {
    // Round 2b migration not run yet? Never brick generation over the audit
    // columns — retry without them.
    console.warn("weekly_plans upsert with revision columns failed, retrying without:", error.message);
    const { error: retryError } = await supabase.from("weekly_plans").upsert(basePayload);
    if (retryError) throw new Error(`Failed to store weekly plan: ${retryError.message}`);
  }

  return {
    week_start_date: context.weekStart,
    week_summary: validated.week_summary,
    revised: revision !== null,
  };
}

/** The stored plan for the current (boundary-rule) week, or null. */
export async function getCurrentWeeklyPlan() {
  const supabase = createServiceClient();
  const weekStart = boundaryWeekStart(new Date());
  const { data } = await supabase
    .from("weekly_plans")
    .select("*")
    .eq("week_start_date", weekStart)
    .maybeSingle();
  return data;
}
