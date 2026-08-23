import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/service";
import { getTrainingPhase } from "@/lib/trainingPhase";
import {
  isMealEntry,
  isShoppingItem,
  isTrainingDay,
  SESSION_TYPES,
  SHOPPING_CATEGORIES,
  type MealEntry,
  type SessionType,
  type ShoppingItem,
  type TrainingDay,
} from "@/lib/planTypes";
import {
  addDays,
  boundaryWeekStart,
  daysBetween,
  formatDayShort,
  londonDateOf,
  mondayOf,
  todayISO,
  weekDates,
} from "@/components/dates";
import { travelDatesFromEvents, type CalendarEventRow } from "@/components/data";

// Target week for planning: the authoritative week-boundary rule
// (REQUIREMENTS §3.3, implemented in components/dates.ts) — Monday 00:00 to
// Sunday 16:59 Europe/London is "this week"; from Sunday 17:00 London the
// target flips to the upcoming Monday. Generation, storage key and display
// all share this one helper so they can never disagree. The Sunday 18:00 UTC
// cron lands after the 17:00 London flip, so it always plans the week ahead.

type PlanContext = {
  weekStart: string;
  weekDatesList: string[];
  travelDates: string[];
  sections: {
    trainingSummary: string;
    calendarSummary: string;
    raceSummary: string;
    settingsSummary: string;
  };
};

async function buildContext(): Promise<PlanContext> {
  const supabase = createServiceClient();
  const now = new Date();
  const weekStart = boundaryWeekStart(now);
  const weekDatesList = weekDates(weekStart);
  const weekEnd = addDays(weekStart, 7);

  const twentyEightDaysAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: activities }, { data: events }, { data: settings }, { data: raceGoal }] =
    await Promise.all([
      supabase
        .from("strava_activities")
        .select("*")
        .gte("start_date", twentyEightDaysAgo)
        .order("start_date", { ascending: false }),
      supabase
        .from("calendar_events")
        .select("external_id, title, start_time, end_time, is_all_day, is_travel")
        .lt("start_time", `${weekEnd}T00:00:00Z`)
        .gte("end_time", `${weekStart}T00:00:00Z`)
        .order("start_time", { ascending: true }),
      supabase.from("settings").select("*").eq("id", true).maybeSingle(),
      supabase.from("race_goal").select("*").eq("id", true).maybeSingle(),
    ]);

  // Consistency-aware 28-day summary (REQUIREMENTS §3.3): weekly km for each
  // of the last 4 weeks plus the gap since the last run — not one blind total.
  const today = todayISO(now);
  const thisMonday = mondayOf(today);
  const weeklyKm = [0, 0, 0, 0]; // index 0 = the current (partial) week
  for (const a of activities ?? []) {
    const activityDate = londonDateOf(a.start_date);
    const weeksBack = Math.floor(daysBetween(mondayOf(activityDate), thisMonday) / 7);
    if (weeksBack >= 0 && weeksBack < 4) weeklyKm[weeksBack] += a.distance_m / 1000;
  }
  const totalDistanceKm = (activities ?? []).reduce((sum, a) => sum + a.distance_m / 1000, 0);
  const runCount = (activities ?? []).length;
  const lastActivityDate = activities?.[0]?.start_date
    ? londonDateOf(activities[0].start_date)
    : null;
  const gapDays = lastActivityDate ? daysBetween(lastActivityDate, today) : null;

  const trainingSummary = runCount
    ? [
        `${runCount} activities in the last 28 days, totalling ${totalDistanceKm.toFixed(1)} km.`,
        `Weekly volume, most recent first: ${weeklyKm
          .map(
            (km, i) =>
              `${i === 0 ? "this week so far" : `${i} week${i > 1 ? "s" : ""} ago`}: ${km.toFixed(1)} km`
          )
          .join("; ")}.`,
        `Last activity: ${lastActivityDate} (${gapDays} day${gapDays === 1 ? "" : "s"} ago).`,
      ].join("\n")
    : "No Strava activities synced in the last 28 days — treat the runner as returning from a break and ramp up cautiously.";

  const eventRows = (events ?? []) as CalendarEventRow[];
  const travelDates = [...travelDatesFromEvents(eventRows, weekDatesList)].sort();

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

  let raceSummary =
    "No target race set — plan for general fitness and say so in the week summary.";
  if (raceGoal) {
    const { phase, weeksToRace } = getTrainingPhase(
      new Date(raceGoal.race_date),
      raceGoal.distance_km,
      now
    );
    raceSummary = `Target race: ${raceGoal.race_name}, ${raceGoal.distance_km}km on ${raceGoal.race_date}${
      raceGoal.target_time ? ` (target time: ${raceGoal.target_time})` : ""
    }. Currently ${weeksToRace.toFixed(1)} weeks out, training phase: ${phase}.`;
  }

  const settingsSummary = settings
    ? `Weight goal: ${settings.weight_goal}. Dietary restrictions: ${
        settings.dietary_restrictions?.join(", ") || "none"
      }. Disliked ingredients: ${
        settings.disliked_ingredients?.join(", ") || "none"
      }. Household size: ${settings.household_size}.`
    : "No settings configured — assume no restrictions, household size 1, maintaining weight.";

  return {
    weekStart,
    weekDatesList,
    travelDates,
    sections: { trainingSummary, calendarSummary, raceSummary, settingsSummary },
  };
}

// Tool schema mirroring lib/planTypes.ts exactly — one call returns training,
// meals and shopping list together (REQUIREMENTS §5.4: never split the call).
const WEEKLY_PLAN_TOOL = {
  name: "provide_weekly_plan",
  description:
    "Provide the structured weekly training plan, evening meal plan and consolidated shopping list.",
  input_schema: {
    type: "object" as const,
    properties: {
      week_summary: {
        type: "string",
        description:
          "2-3 sentences: the intent of the week, target weekly kilometres, and the training phase. If no race is set, say the plan targets general fitness.",
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
                'Short headline, 60 characters or fewer, e.g. "6 x 800 m at 5k effort".',
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
        description: "Exactly 7 evening-meal entries, one per day, Monday first.",
        items: {
          type: "object",
          properties: {
            date: { type: "string", description: "YYYY-MM-DD" },
            meal_type: {
              type: "string",
              enum: ["home", "travel", "assemble"],
              description:
                "home = a recipe; travel = eating-out guidance (travel days only); assemble = a no-cook or one-pan fallback of 10 minutes or less.",
            },
            prep_time_min: { type: "integer", description: "Minutes; 0 for travel." },
            recipe_name: {
              type: "string",
              description:
                'Plain, appetising name for home/assemble meals; a short label like "Hotel dinner" for travel days.',
            },
            ingredients: {
              type: "array",
              items: { type: "string" },
              description: "Empty for travel days.",
            },
            short_instructions: {
              type: "string",
              description:
                "Home/assemble: a method of 4 short steps or fewer. Travel: 1-2 sentences of sensible ordering guidance tied to training and the weight goal.",
            },
          },
          required: [
            "date",
            "meal_type",
            "prep_time_min",
            "recipe_name",
            "ingredients",
            "short_instructions",
          ],
        },
      },
      shopping_list: {
        type: "array",
        description:
          "Consolidated across the week's home and assemble meals only; empty if every day is a travel day.",
        items: {
          type: "object",
          properties: {
            item: { type: "string" },
            quantity_note: {
              type: "string",
              description: 'Qualitative, e.g. "2 large", "1 bag", "small bunch".',
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

function buildPrompt(context: PlanContext): string {
  const travelLine =
    context.travelDates.length > 0
      ? `Travel days this week (from the calendar): ${context.travelDates.join(", ")}.`
      : "No travel days this week.";

  return `You are a UK running club coach and a practical meal planner for one busy consultant. Produce next week's structured training plan, evening meal plan and shopping list in a single response using the provide_weekly_plan tool.

THE WEEK:
The week starts ${context.weekStart} (Monday). Produce exactly 7 training_days and exactly 7 meals with these consecutive dates: ${context.weekDatesList.join(", ")}.
${travelLine}

TRAINING HISTORY (last 28 days):
${context.sections.trainingSummary}

RACE GOAL:
${context.sections.raceSummary}

CALENDAR THIS WEEK:
${context.sections.calendarSummary}

PERSONAL SETTINGS:
${context.sections.settingsSummary}

TRAINING RULES:
- Phase-appropriate sessions: protect the long run in base/build, sharpen in peak, visibly cut load in taper and race week, prescribe recovery post-race. If no race is set, plan for general fitness and say so in week_summary.
- Ramp sensibly after any gap in the history above — never assume continuity that is not there.
- Hard and long sessions go on non-travel days where possible. Travel days get rest, easy runs, or short hotel-friendly sessions (for example "30 min easy from the hotel — out-and-back, no route needed").
- Set is_travel_day true only for the travel dates listed above.
- duration_min is 0 for rest days. Rest days still get a proper title, detail and why — never an empty entry.

MEAL RULES:
- One evening meal per day. Every travel date listed above must be meal_type "travel": no recipe, empty ingredients, prep_time_min 0, and short_instructions gives 1-2 sentences of sensible eating-out guidance tied to that day's training and the weight goal (suggestive, never preachy).
- Home meals: varied across the week but drawing on a deliberately small shared ingredient pool — maximise reuse of fresh and perishable ingredients across the week's home meals to cut waste.
- Respect the dietary restrictions and disliked ingredients above, and scale wording to the household size.
- Hard-session and long-run days get heartier, carb-forward meals; rest days lighter — stated qualitatively ("bigger portion tonight — long run tomorrow"), never numerically.
- A weekend home day may include one batch-cook whose leftovers cover a named weekday.
- Use "assemble" for a late or rushed evening: a no-cook or one-pan meal of 10 minutes or less.

SHOPPING LIST RULES:
- Consolidate across the week's home and assemble meals only; travel days contribute nothing. If every day is travel, return an empty list.
- Assume a stocked store cupboard: leave out true staples (oil, salt, pepper, common dried herbs and spices).
- quantity_note is qualitative ("2 large", "1 bag", "small bunch") — no weights unless natural (for example "500 g passata").

STYLE RULES (strict):
- UK English throughout (-ise endings) and metric units only (km, min/km).
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
  meals: MealEntry[];
  shopping_list: ShoppingItem[];
};

/**
 * Validates a tool response against the runtime guards in lib/planTypes.ts
 * plus the business rules (dates, travel echo). Returns the validated plan,
 * or a list of human-readable errors to feed back into the retry prompt.
 */
function validatePlan(
  raw: RawPlan,
  context: PlanContext
): { plan: ValidatedPlan | null; errors: string[] } {
  const errors: string[] = [];
  const travelSet = new Set(context.travelDates);

  if (typeof raw.week_summary !== "string" || raw.week_summary.trim() === "") {
    errors.push("week_summary must be a non-empty string.");
  }

  const trainingDays: TrainingDay[] = [];
  if (!Array.isArray(raw.training_days) || raw.training_days.length !== 7) {
    errors.push("training_days must be an array of exactly 7 entries.");
  } else {
    raw.training_days.forEach((d, i) => {
      if (!isTrainingDay(d)) {
        errors.push(
          `training_days[${i}] is malformed — required: date, session_type (${SESSION_TYPES.join(
            "/"
          )}), title, detail, duration_min (number), why, is_travel_day (boolean).`
        );
        return;
      }
      if (d.date !== context.weekDatesList[i]) {
        errors.push(
          `training_days[${i}].date must be ${context.weekDatesList[i]} (got ${d.date}).`
        );
        return;
      }
      // Echo the calendar's travel flags exactly, whatever the model said.
      trainingDays.push({ ...d, is_travel_day: travelSet.has(d.date) });
    });
  }

  const meals: MealEntry[] = [];
  if (!Array.isArray(raw.meals) || raw.meals.length !== 7) {
    errors.push("meals must be an array of exactly 7 entries.");
  } else {
    raw.meals.forEach((m, i) => {
      if (!isMealEntry(m)) {
        errors.push(
          `meals[${i}] is malformed — required: date, meal_type (home/travel/assemble), prep_time_min (number), recipe_name, ingredients (array of strings), short_instructions.`
        );
        return;
      }
      if (m.date !== context.weekDatesList[i]) {
        errors.push(`meals[${i}].date must be ${context.weekDatesList[i]} (got ${m.date}).`);
        return;
      }
      if (travelSet.has(m.date) && m.meal_type !== "travel") {
        errors.push(
          `meals[${i}] (${m.date}) is a travel day and must have meal_type "travel" with empty ingredients and eating-out guidance.`
        );
        return;
      }
      if (m.meal_type === "travel" && m.ingredients.length > 0) {
        errors.push(`meals[${i}] (${m.date}) is a travel meal and must have empty ingredients.`);
        return;
      }
      meals.push(m.meal_type === "travel" ? { ...m, prep_time_min: 0, ingredients: [] } : m);
    });
  }

  const shoppingList: ShoppingItem[] = [];
  if (!Array.isArray(raw.shopping_list)) {
    errors.push("shopping_list must be an array (empty is allowed for an all-travel week).");
  } else {
    raw.shopping_list.forEach((s, i) => {
      if (!isShoppingItem(s)) {
        errors.push(
          `shopping_list[${i}] is malformed — required: item, quantity_note, category (one of: ${SHOPPING_CATEGORIES.join(
            ", "
          )}).`
        );
        return;
      }
      shoppingList.push(s);
    });
  }

  if (errors.length > 0) return { plan: null, errors };
  return {
    plan: {
      week_summary: (raw.week_summary as string).trim(),
      training_days: trainingDays,
      meals,
      shopping_list: shoppingList,
    },
    errors: [],
  };
}

const SESSION_LABELS: Record<SessionType, string> = {
  rest: "Rest",
  easy: "Easy run",
  tempo: "Tempo",
  intervals: "Intervals",
  long: "Long run",
  cross: "Cross-training",
  race: "Race",
};

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
    max_tokens: 8192,
    tools: [WEEKLY_PLAN_TOOL],
    tool_choice: { type: "tool", name: "provide_weekly_plan" },
    messages: [{ role: "user", content: prompt }],
  });

  const toolUse = response.content.find((c) => c.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a structured plan");
  }
  return toolUse.input as RawPlan;
}

/**
 * Generates and stores the week's plan. Generate-then-swap (REQUIREMENTS
 * §3.7): the row is only written after the new plan validates, so a failed
 * generation never deletes or corrupts the previous plan. On a validation
 * failure the Claude call is retried once with the errors appended.
 */
export async function generateWeeklyPlan(options?: { syncNotes?: string[] }) {
  const context = await buildContext();
  const basePrompt = buildPrompt(context);

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
    if (result.plan) validated = result.plan;
    else lastErrors = result.errors;
  }

  if (!validated) {
    // Fail WITHOUT touching the stored row — the previous plan stays intact.
    console.error("Weekly plan generation failed validation twice:", lastErrors);
    throw new Error("The generated plan failed validation — the previous plan is unchanged");
  }

  const supabase = createServiceClient();
  const { error } = await supabase.from("weekly_plans").upsert({
    week_start_date: context.weekStart,
    training_plan_text: renderPlanText(validated),
    training_plan_json: validated.training_days,
    week_summary: validated.week_summary,
    meal_plan_json: validated.meals,
    shopping_list_json: validated.shopping_list,
    input_snapshot_json: { ...context, sync_notes: options?.syncNotes ?? [] },
    generated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Failed to store weekly plan: ${error.message}`);

  return {
    week_start_date: context.weekStart,
    week_summary: validated.week_summary,
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
