import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/service";
import { getTrainingPhase } from "@/lib/trainingPhase";

// Target week for planning. On Sunday this is the UPCOMING Monday, not the
// week that ends tonight — the Sunday-evening cron exists to plan the week
// ahead, and calendar events synced from "now" mostly fall in that week too.
function getWeekStart(now: Date): string {
  const d = new Date(now);
  const day = d.getDay(); // 0 = Sunday
  const diffToMonday = day === 0 ? 1 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

async function buildContext() {
  const supabase = createServiceClient();
  const now = new Date();
  const weekStart = getWeekStart(now);
  const weekStartDate = new Date(weekStart);
  const weekEndDate = new Date(weekStartDate);
  weekEndDate.setDate(weekEndDate.getDate() + 7);

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
        .select("*")
        .gte("start_time", weekStartDate.toISOString())
        .lt("start_time", weekEndDate.toISOString())
        .order("start_time", { ascending: true }),
      supabase.from("settings").select("*").eq("id", true).maybeSingle(),
      supabase.from("race_goal").select("*").eq("id", true).maybeSingle(),
    ]);

  const totalDistanceKm = (activities ?? []).reduce((sum, a) => sum + a.distance_m / 1000, 0);
  const runCount = (activities ?? []).length;
  const lastActivityDate = activities?.[0]?.start_date ?? null;

  const trainingSummary = runCount
    ? `${runCount} activities in the last 28 days, totalling ${totalDistanceKm.toFixed(
        1
      )} km. Most recent: ${lastActivityDate}.`
    : "No Strava activities synced in the last 28 days.";

  const calendarSummary =
    events && events.length > 0
      ? events
          .map(
            (e) =>
              `${e.start_time} - ${e.end_time}: ${e.title ?? "(untitled)"}${
                e.is_travel ? " [travel]" : ""
              }`
          )
          .join("\n")
      : "No calendar connected yet — assume evenings after 18:00 and weekends are free unless told otherwise.";

  let raceSummary = "No target race set.";
  if (raceGoal) {
    const { phase, weeksToRace } = getTrainingPhase(new Date(raceGoal.race_date), raceGoal.distance_km);
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
    sections: { trainingSummary, calendarSummary, raceSummary, settingsSummary },
  };
}

const WEEKLY_PLAN_TOOL = {
  name: "provide_weekly_plan",
  description: "Provide the week's training usage plan and 7-day meal plan.",
  input_schema: {
    type: "object" as const,
    properties: {
      training_plan_text: {
        type: "string",
        description:
          "Day-by-day narrative for the week covering how to use evenings/weekends for training, appropriate to the current training phase.",
      },
      meal_plan: {
        type: "array",
        description: "Exactly 7 entries, one per day of the week starting Monday.",
        items: {
          type: "object",
          properties: {
            date: { type: "string", description: "YYYY-MM-DD" },
            recipe_name: { type: "string" },
            ingredients: { type: "array", items: { type: "string" } },
            short_instructions: { type: "string" },
          },
          required: ["date", "recipe_name", "ingredients", "short_instructions"],
        },
      },
    },
    required: ["training_plan_text", "meal_plan"],
  },
};

export async function generateWeeklyPlan() {
  const context = await buildContext();

  const prompt = `You are a running coach and meal planner. Using the context below, produce this week's training-usage plan and a 7-day meal plan.

TRAINING (last 28 days):
${context.sections.trainingSummary}

RACE GOAL:
${context.sections.raceSummary}

CALENDAR THIS WEEK:
${context.sections.calendarSummary}

PERSONAL SETTINGS:
${context.sections.settingsSummary}

Guidance:
- The training plan should be phase-appropriate (e.g. protect long-run time in a build phase, ease off in taper).
- Meals should be varied day-to-day but reuse overlapping ingredients across the week to minimise food waste.
- On travel days, don't assume home cooking is possible — suggest something simple or eating out sensibly.
- Align meals with the weight goal without calorie counting — just sensible qualitative guidance.
- The week starts ${context.weekStart} (Monday). Produce exactly 7 meal_plan entries with consecutive dates starting from that Monday.`;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 4096,
    tools: [WEEKLY_PLAN_TOOL],
    tool_choice: { type: "tool", name: "provide_weekly_plan" },
    messages: [{ role: "user", content: prompt }],
  });

  const toolUse = response.content.find((c) => c.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a structured plan");
  }

  const result = toolUse.input as {
    training_plan_text: string;
    meal_plan: unknown[];
  };

  const supabase = createServiceClient();
  const { error } = await supabase.from("weekly_plans").upsert({
    week_start_date: context.weekStart,
    training_plan_text: result.training_plan_text,
    meal_plan_json: result.meal_plan,
    input_snapshot_json: context,
    generated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Failed to store weekly plan: ${error.message}`);

  return result;
}

export async function getCurrentWeeklyPlan() {
  const supabase = createServiceClient();
  const weekStart = getWeekStart(new Date());
  const { data } = await supabase
    .from("weekly_plans")
    .select("*")
    .eq("week_start_date", weekStart)
    .maybeSingle();
  return data;
}
