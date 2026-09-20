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

/**
 * Watch sync (docs/WATCH-SYNC.md §2): one structured workout step. A plain
 * step has exactly one of minutes/km and an optional pace range ("m:ss" per
 * km); a repeat holds plain steps only (depth 1) and runs 1–20 times.
 */
export type WorkoutStep =
  | {
      kind: "step";
      label?: string;
      minutes?: number;
      km?: number;
      pace_low?: string;
      pace_high?: string;
    }
  | { kind: "repeat"; times: number; steps: WorkoutStep[] };

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
  /** Structured steps for running days (watch sync). Absent on older plans. */
  steps?: WorkoutStep[];
};

const PACE_RE = /^\d{1,2}:\d{2}$/;

function finitePositive(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Runtime guard for a single step (plain or one-level repeat). */
export function isWorkoutStep(v: unknown): v is WorkoutStep {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  if (r.kind === "repeat") {
    return (
      typeof r.times === "number" &&
      Array.isArray(r.steps) &&
      r.steps.every((s) => isWorkoutStep(s) && (s as { kind: string }).kind === "step")
    );
  }
  if (r.kind !== "step") return false;
  const hasMinutes = typeof r.minutes === "number";
  const hasKm = typeof r.km === "number";
  return hasMinutes !== hasKm; // exactly one of the two
}

/**
 * Coerce model output into valid steps: malformed steps are dropped, a step
 * with both minutes and km keeps minutes, paces must be "m:ss", repeat times
 * clamp to 1–20 and nested repeats are dropped (depth 1 only). Returns [] when
 * nothing usable remains — the day then pushes to the watch as prose.
 */
export function coerceWorkoutSteps(raw: unknown): WorkoutStep[] {
  if (!Array.isArray(raw)) return [];
  const plain = (v: unknown): WorkoutStep | null => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
    const r = v as Record<string, unknown>;
    if (r.kind === "repeat" || Array.isArray(r.steps)) return null; // no nesting
    const minutes = finitePositive(r.minutes);
    const km = finitePositive(r.km);
    if (minutes === null && km === null) return null;
    const step: WorkoutStep = { kind: "step" };
    if (typeof r.label === "string" && r.label.trim()) step.label = r.label.trim();
    if (minutes !== null) step.minutes = Math.round(minutes * 10) / 10;
    else step.km = Math.round(km! * 100) / 100;
    const lo = typeof r.pace_low === "string" && PACE_RE.test(r.pace_low.trim()) ? r.pace_low.trim() : null;
    const hi = typeof r.pace_high === "string" && PACE_RE.test(r.pace_high.trim()) ? r.pace_high.trim() : null;
    if (lo || hi) {
      step.pace_low = lo ?? hi!;
      step.pace_high = hi ?? lo!;
    }
    return step;
  };
  const out: WorkoutStep[] = [];
  for (const v of raw) {
    if (typeof v !== "object" || v === null || Array.isArray(v)) continue;
    const r = v as Record<string, unknown>;
    if (r.kind === "repeat" || Array.isArray(r.steps)) {
      const times = finitePositive(r.times);
      const inner = Array.isArray(r.steps)
        ? r.steps.map(plain).filter((s): s is WorkoutStep => s !== null)
        : [];
      if (inner.length === 0) continue;
      out.push({ kind: "repeat", times: Math.min(20, Math.max(1, Math.round(times ?? 1))), steps: inner });
      continue;
    }
    const step = plain(v);
    if (step) out.push(step);
  }
  return out;
}

/** Estimated minutes for steps (km steps use the pace-range midpoint, else 5:00/km). */
export function estimateStepMinutes(steps: WorkoutStep[]): number {
  const paceMinutes = (p: string | undefined): number | null => {
    if (!p || !PACE_RE.test(p)) return null;
    const [m, s] = p.split(":").map(Number);
    return m + s / 60;
  };
  const one = (s: WorkoutStep): number => {
    if (s.kind === "repeat") return s.times * s.steps.reduce((acc, x) => acc + one(x), 0);
    if (s.minutes !== undefined) return s.minutes;
    const lo = paceMinutes(s.pace_low);
    const hi = paceMinutes(s.pace_high);
    const pace = lo !== null && hi !== null ? (lo + hi) / 2 : (lo ?? hi ?? 5);
    return (s.km ?? 0) * pace;
  };
  return steps.reduce((acc, s) => acc + one(s), 0);
}

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
    SESSION_TYPES.includes(v.session_type as SessionType) &&
    (v.steps === undefined || (Array.isArray(v.steps) && v.steps.every(isWorkoutStep)))
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
