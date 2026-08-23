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
  type MealType,
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
  travelDates: string[];
  sections: {
    trainingSummary: string;
    calendarSummary: string;
    raceSummary: string;
    settingsSummary: string;
    runnerContext: string;
  };
};

async function buildContext(): Promise<PlanContext> {
  const supabase = createServiceClient();
  const now = new Date();
  const weekStart = boundaryWeekStart(now);
  const weekDatesList = weekDates(weekStart);
  const weekEnd = addDays(weekStart, 7);

  const twentyEightDaysAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { data: activities },
    { data: events },
    { data: settings },
    { data: raceGoal },
    runnerContext,
    recentFeedback,
  ] = await Promise.all([
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
    getRunnerContext(),
    getRecentFeedback(3, weekStart),
  ]);

  // Running vs supporting training (U1): running volume counts ONLY runs.
  const all = activities ?? [];
  const runs = all.filter((a) => isRun(a.type));
  const nonRuns = all.filter((a) => !isRun(a.type));

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
        nonRunSummary,
      ].join("\n")
    : `No runs synced in the last 28 days — treat the runner as returning from a break and ramp up cautiously.\n${nonRunSummary}`;

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
    raceSummary = `Target race: ${raceGoal.race_name}, ${raceGoal.distance_km}km on ${formatDateShort(
      raceGoal.race_date
    )} (${raceGoal.race_date.slice(0, 4)})${
      raceGoal.target_time ? `, target time ${raceGoal.target_time}` : ""
    }. Currently ${weeksToRace.toFixed(1)} weeks out, training phase: ${phase}.`;
  }

  const settingsSummary = settings
    ? `Weight goal: ${settings.weight_goal}. Dietary restrictions: ${
        settings.dietary_restrictions?.join(", ") || "none"
      }. Disliked ingredients: ${
        settings.disliked_ingredients?.join(", ") || "none"
      }. Household size: ${settings.household_size}.`
    : "No settings configured — assume no restrictions, household size 1, maintaining weight.";

  // Context from the runner (U4): persistent injuries + recent week feedback,
  // most recent weighted heaviest.
  const injuriesLine = runnerContext?.injuries?.trim()
    ? `Current injuries or niggles: ${runnerContext.injuries.trim()}`
    : "Current injuries or niggles: none reported.";
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
  const runnerContextSection = `${injuriesLine}\nHow recent weeks felt, most recent first:\n${feedbackLines}`;

  return {
    weekStart,
    weekDatesList,
    travelDates,
    sections: {
      trainingSummary,
      calendarSummary,
      raceSummary,
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
const EVIDENCE_PRINCIPLES = `TRAINING AND NUTRITION PRINCIPLES (evidence-based — follow these):
- Keep roughly 80% of the week's running volume at low, conversational intensity; concentrate hard work into one or two quality sessions (polarised intensity distribution).
- Two gym-based strength sessions per week with substantive loading support running economy — they complement the running, they do not replace it.
- Never pair high running mileage with aggressive energy restriction. Even when the weight goal is "lose", keep meals satisfying and fuel hard days properly — under-fuelling harms both health and performance.
- Fuelling and hydration guidance stays qualitative: carb-forward meals before and after hard or long sessions, drink sensibly around training. No numbers, ever.`;

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

CONTEXT FROM THE RUNNER:
${context.sections.runnerContext}

${EVIDENCE_PRINCIPLES}

TRAINING RULES:
- Phase-appropriate sessions: protect the long run in base/build, sharpen in peak, visibly cut load in taper and race week, prescribe recovery post-race. If no race is set, plan for general fitness and say so in week_summary.
- Ramp sensibly after any gap in the history above — never assume continuity that is not there. Only running counts as running volume; rides and gym work are supporting training.
- Respect the runner's context above: work around any injuries or niggles (reduce impact or intensity, avoid aggravating session types) and respond to how recent weeks felt — if last week felt too hard, ease this week's load; if it felt easy, progress gently.
- Include exactly two strength sessions this week (session_type "strength"): one on a weekday and one on a weekend day, defaulting to Tuesday and Saturday unless the calendar makes those impossible — then the nearest sensible weekday/weekend day.
- Strength sessions are ALWAYS gym-based: assume access to a proper gym even when travelling (hotel gym or one nearby). Never prescribe bodyweight-only or hotel-room workarounds. A short strength session may share its day with an easy run — keep session_type "strength" and fold the run into the detail.
- Hard and long running sessions go on non-travel days where possible. Travel days get rest, easy runs, strength (gyms travel with you), or short hotel-friendly runs (for example "30 min easy from the hotel — out-and-back, no route needed").
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
  meals: MealEntry[];
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

function coerceMeal(
  raw: Record<string, unknown>,
  date: string,
  isTravel: boolean,
  warnings: string[]
): MealEntry {
  let meal_type: MealType;
  if (isTravel) {
    if (raw.meal_type !== "travel") warnings.push(`Coerced ${date} meal to travel (travel day)`);
    meal_type = "travel";
  } else if (
    raw.meal_type === "home" ||
    raw.meal_type === "travel" ||
    raw.meal_type === "assemble"
  ) {
    meal_type = raw.meal_type;
  } else {
    warnings.push(`Coerced unknown meal_type "${String(raw.meal_type)}" on ${date} to home`);
    meal_type = "home";
  }
  const ingredients =
    meal_type === "travel"
      ? []
      : Array.isArray(raw.ingredients)
        ? raw.ingredients.map((i) => coerceString(i)).filter(Boolean)
        : [];
  return {
    date,
    meal_type,
    prep_time_min: meal_type === "travel" ? 0 : coerceMinutes(raw.prep_time_min),
    recipe_name: coerceString(raw.recipe_name, meal_type === "travel" ? "Eating out" : "Dinner"),
    ingredients,
    short_instructions: coerceString(raw.short_instructions),
  };
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

  // Meals: same date-matching rule.
  const meals: MealEntry[] = [];
  if (!Array.isArray(raw.meals)) {
    errors.push("meals must be an array of exactly 7 entries, Monday first.");
  } else {
    const byDate = new Map<string, Record<string, unknown>>();
    for (const m of raw.meals) {
      if (isRecord(m) && typeof m.date === "string") byDate.set(m.date, m);
    }
    for (const date of context.weekDatesList) {
      const entry = byDate.get(date);
      if (!entry) {
        errors.push(`meals is missing an entry for ${date}.`);
        continue;
      }
      meals.push(coerceMeal(entry, date, travelSet.has(date), warnings));
    }
  }

  // Shopping list: never a hard failure beyond "not an array" — bad items are
  // repaired or dropped.
  const shoppingList: ShoppingItem[] = [];
  if (!Array.isArray(raw.shopping_list)) {
    errors.push("shopping_list must be an array (empty is allowed for an all-travel week).");
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
    ...meals.filter((m: unknown) => !isMealEntry(m)).map((m) => `meal ${(m as MealEntry).date}`),
    ...shoppingList
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
      shopping_list: shoppingList,
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
