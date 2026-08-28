// Structured weekly-plan types — the contract between plan generation (backend)
// and the UI. Shapes follow docs/REQUIREMENTS.md §3.3 (training), §3.4 (meals)
// and §3.5 (shopping list) exactly. The UI renders a fallback when a stored
// plan predates this format (plain training_plan_text + legacy meal entries).

// ---------------------------------------------------------------------------
// Training (§3.3) — weekly_plans.training_plan_json: TrainingDay[7], Monday-first
// ---------------------------------------------------------------------------

export type SessionType =
  | "rest"
  | "easy"
  | "tempo"
  | "intervals"
  | "long"
  | "cross"
  | "strength" // gym-based strength session (added in fix round 1, U2)
  | "race";

export const SESSION_TYPES: readonly SessionType[] = [
  "rest",
  "easy",
  "tempo",
  "intervals",
  "long",
  "cross",
  "strength",
  "race",
];

export type TrainingDay = {
  /** YYYY-MM-DD */
  date: string;
  session_type: SessionType;
  /** Short headline, ≤ 60 chars, e.g. "6 × 800 m at 5k effort" */
  title: string;
  /** 1–3 sentences of instruction, including duration or distance */
  detail: string;
  /** Integer estimate in minutes; 0 for rest */
  duration_min: number;
  /** One sentence linking the session to phase, calendar or recovery */
  why: string;
  /** Echoed from the calendar input */
  is_travel_day: boolean;
};

// ---------------------------------------------------------------------------
// Meals — v2 (REDESIGN-V2.md §Screen 3): meal-prep model. Meals exist ONLY
// for AWAY days (home days get none) and are real prep-ahead recipes cooked
// at home before travelling. weekly_plans.meal_plan_json for v2 plans is
// AwayMealEntry[] (one per away date; empty array when the week has no away
// days). The v1 MealEntry / LegacyMealEntry shapes below remain so old
// stored rows keep rendering through the existing fallbacks.
// ---------------------------------------------------------------------------

export type RecipeIngredient = {
  item: string;
  /** Qualitative quantity ("2 fillets", "1 bag"; natural weights fine). */
  quantity: string;
};

export type AwayMealEntry = {
  /** YYYY-MM-DD — an away date within the plan week. */
  date: string;
  recipe_name: string;
  /** Integer minutes to prep/cook ahead at home. */
  prep_time_min: number;
  ingredients: RecipeIngredient[];
  /** Full method, at most 4 short steps. */
  method: string;
};

export function isRecipeIngredient(v: unknown): v is RecipeIngredient {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    typeof (v as Record<string, unknown>).item === "string" &&
    typeof (v as Record<string, unknown>).quantity === "string"
  );
}

export function isAwayMealEntry(v: unknown): v is AwayMealEntry {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.date === "string" &&
    typeof r.recipe_name === "string" &&
    typeof r.method === "string" &&
    typeof r.prep_time_min === "number" &&
    Array.isArray(r.ingredients) &&
    r.ingredients.every(isRecipeIngredient)
  );
}

/**
 * v2 away-day meals, or null when the stored plan is not v2 format (v1 and
 * legacy rows fall back to parseMeals / parseLegacyMeals). An empty array is
 * a valid v2 result: a week with no away days.
 */
export function parseAwayMeals(plan: WeeklyPlanRow | null | undefined): AwayMealEntry[] | null {
  const raw = plan?.meal_plan_json;
  if (!Array.isArray(raw)) return null;
  if (raw.length === 0) return [];
  const meals = raw.filter(isAwayMealEntry);
  return meals.length === raw.length ? meals : null;
}

// ---------------------------------------------------------------------------
// Meals — v1 (superseded by the v2 model above; kept for old stored rows)
// ---------------------------------------------------------------------------

export type MealType = "home" | "travel" | "assemble";

export type MealEntry = {
  /** YYYY-MM-DD */
  date: string;
  meal_type: MealType;
  /** Integer minutes; 0 for travel */
  prep_time_min: number;
  recipe_name: string;
  /** Empty for travel days */
  ingredients: string[];
  short_instructions: string;
};

/** Pre-redesign meal entry (no meal_type / prep_time_min). */
export type LegacyMealEntry = {
  date: string;
  recipe_name: string;
  ingredients: string[];
  short_instructions: string;
};

// ---------------------------------------------------------------------------
// Shopping list (§3.5) — weekly_plans.shopping_list_json: ShoppingItem[]
// ---------------------------------------------------------------------------

export type ShoppingCategory =
  | "fruit & veg"
  | "meat & fish"
  | "dairy"
  | "store cupboard"
  | "bakery"
  | "other";

export const SHOPPING_CATEGORIES: readonly ShoppingCategory[] = [
  "fruit & veg",
  "meat & fish",
  "dairy",
  "bakery",
  "store cupboard",
  "other",
];

export type ShoppingItem = {
  item: string;
  /** Qualitative, e.g. "2 large", "1 bag", "small bunch" */
  quantity_note: string;
  category: ShoppingCategory;
};

// ---------------------------------------------------------------------------
// The weekly_plans row as the UI reads it (new columns optional — old rows
// and the pre-migration schema lack them).
// ---------------------------------------------------------------------------

export type WeeklyPlanRow = {
  week_start_date: string;
  training_plan_text: string;
  meal_plan_json: unknown;
  input_snapshot_json: unknown;
  generated_at: string;
  /** New structured columns — may be absent/null on old plans. */
  training_plan_json?: unknown;
  week_summary?: string | null;
  shopping_list_json?: unknown;
  /**
   * Review-and-revise (round 2, U7): the note the runner gave when the plan
   * was last revised, shown until the next generation. Null when the stored
   * plan is a fresh generation (or pre-migration).
   */
  revision_note?: string | null;
  revised_at?: string | null;
};

// ---------------------------------------------------------------------------
// Runtime guards — shared by UI rendering and backend validation.
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function isTrainingDay(v: unknown): v is TrainingDay {
  return (
    isRecord(v) &&
    typeof v.date === "string" &&
    typeof v.title === "string" &&
    typeof v.detail === "string" &&
    typeof v.why === "string" &&
    typeof v.duration_min === "number" &&
    typeof v.is_travel_day === "boolean" &&
    SESSION_TYPES.includes(v.session_type as SessionType)
  );
}

export function isMealEntry(v: unknown): v is MealEntry {
  return (
    isRecord(v) &&
    typeof v.date === "string" &&
    typeof v.recipe_name === "string" &&
    typeof v.short_instructions === "string" &&
    Array.isArray(v.ingredients) &&
    typeof v.prep_time_min === "number" &&
    (v.meal_type === "home" || v.meal_type === "travel" || v.meal_type === "assemble")
  );
}

export function isLegacyMealEntry(v: unknown): v is LegacyMealEntry {
  return (
    isRecord(v) &&
    typeof v.date === "string" &&
    typeof v.recipe_name === "string" &&
    typeof v.short_instructions === "string" &&
    Array.isArray(v.ingredients)
  );
}

export function isShoppingItem(v: unknown): v is ShoppingItem {
  return (
    isRecord(v) &&
    typeof v.item === "string" &&
    typeof v.quantity_note === "string" &&
    SHOPPING_CATEGORIES.includes(v.category as ShoppingCategory)
  );
}

/** Structured training days, or null when the plan is old-format. */
export function parseTrainingDays(plan: WeeklyPlanRow | null | undefined): TrainingDay[] | null {
  const raw = plan?.training_plan_json;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const days = raw.filter(isTrainingDay);
  return days.length === raw.length ? days : null;
}

/** Structured meals, or null when entries lack the new fields. */
export function parseMeals(plan: WeeklyPlanRow | null | undefined): MealEntry[] | null {
  const raw = plan?.meal_plan_json;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const meals = raw.filter(isMealEntry);
  return meals.length === raw.length ? meals : null;
}

/** Legacy meal entries (best-effort) for old-format fallback rendering. */
export function parseLegacyMeals(plan: WeeklyPlanRow | null | undefined): LegacyMealEntry[] {
  const raw = plan?.meal_plan_json;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isLegacyMealEntry);
}

/** Shopping list, or null when absent (old plans). */
export function parseShoppingList(plan: WeeklyPlanRow | null | undefined): ShoppingItem[] | null {
  const raw = plan?.shopping_list_json;
  if (!Array.isArray(raw)) return null;
  return raw.filter(isShoppingItem);
}
