import {
  parseAwayMeals,
  parseLegacyMeals,
  parseMeals,
  parseShoppingList,
  type AwayMealEntry,
  type LegacyMealEntry,
  type MealEntry,
} from "@/lib/planTypes";
import {
  boundaryWeekStart,
  formatDateShort,
  formatWeekday,
  todayISO,
} from "@/components/dates";
import { getPlanForWeek } from "@/components/data";
import { MealBadge } from "@/components/session";
import { GeneratePlanButton } from "@/components/generate-plan";
import { ScrollToHash } from "@/components/scroll-to-hash";
import { ShoppingList } from "./shopping-list";

// Reads the DB on every request — never serve a stale prerender.
export const dynamic = "force-dynamic";

// V2 Nutrition (docs/REDESIGN-V2.md §Screen 3): meal-prep model. Recipes exist
// ONLY for away days (prepped/cooked at home before travelling); home days
// have no meal planning. Layout: "Next away days" list (tap for the full
// recipe), then the shopping list with the sketch's Item | Volume columns.

function AwayMealCard({ meal, isToday }: { meal: AwayMealEntry; isToday: boolean }) {
  return (
    <details
      id={`d${meal.date}`}
      data-today={isToday ? "" : undefined}
      className="card group"
      style={isToday ? { borderColor: "var(--accent)" } : undefined}
    >
      <summary className="flex min-h-[56px] cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="w-16 shrink-0">
          <span
            className="block text-[13px] font-semibold leading-4"
            style={{ color: isToday ? "var(--accent)" : "var(--ink-2)" }}
          >
            {isToday ? "Today" : formatWeekday(meal.date)}
          </span>
          <span className="tabular block text-[10.5px]" style={{ color: "var(--ink-3)" }}>
            {formatDateShort(meal.date)}
          </span>
        </span>
        <span className="min-w-0 flex-1 text-[15px] font-semibold leading-5">
          {meal.recipe_name}
        </span>
        {meal.prep_time_min > 0 && (
          <span className="tabular shrink-0 text-[12px] font-semibold" style={{ color: "var(--ink-2)" }}>
            {meal.prep_time_min} min
          </span>
        )}
        <span
          className="shrink-0 text-[12px] font-semibold"
          style={{ color: "var(--accent)" }}
        >
          <span className="group-open:hidden">Recipe</span>
          <span className="hidden group-open:inline">Close</span>
        </span>
      </summary>
      <div className="flex flex-col gap-3 border-t px-4 py-3" style={{ borderColor: "var(--line)" }}>
        {meal.ingredients.length > 0 && (
          <div className="flex flex-col gap-1">
            <h3 className="overline" style={{ color: "var(--ink-2)" }}>
              Ingredients
            </h3>
            <ul className="flex flex-col gap-0.5">
              {meal.ingredients.map((ing) => (
                <li key={ing.item} className="flex items-baseline justify-between gap-3 text-[14px]">
                  <span className="min-w-0 flex-1">{ing.item}</span>
                  {/* Quantities sit on the split board's right column. */}
                  <span className="tabular shrink-0 text-[12px]" style={{ color: "var(--ink-2)" }}>
                    {ing.quantity}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <h3 className="overline" style={{ color: "var(--ink-2)" }}>
            Method
          </h3>
          <p className="whitespace-pre-wrap text-[14px] leading-[21px]">{meal.method}</p>
        </div>
      </div>
    </details>
  );
}

/** Legacy v1 meal card — old stored rows keep rendering until regenerated. */
function LegacyMealCard({ meal }: { meal: MealEntry | LegacyMealEntry }) {
  const structured = "meal_type" in meal ? (meal as MealEntry) : null;
  return (
    <article className="card flex flex-col gap-1.5 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold" style={{ color: "var(--ink-2)" }}>
          {formatWeekday(meal.date)}{" "}
          <span style={{ color: "var(--ink-3)" }}>{formatDateShort(meal.date)}</span>
        </span>
        {structured && <MealBadge type={structured.meal_type} />}
      </div>
      <h2 className="text-[15px] font-semibold leading-5">{meal.recipe_name}</h2>
      {meal.ingredients.length > 0 && (
        <p className="text-[13px] leading-[19px]" style={{ color: "var(--ink-2)" }}>
          {meal.ingredients.join(" · ")}
        </p>
      )}
      <p className="text-[13px] leading-[19px]" style={{ color: "var(--ink-2)" }}>
        {meal.short_instructions}
      </p>
    </article>
  );
}

export default async function NutritionPage() {
  const now = new Date();
  const today = todayISO(now);
  const weekStart = boundaryWeekStart(now);

  const plan = await getPlanForWeek(weekStart);
  const awayMeals = parseAwayMeals(plan);
  const legacyMeals =
    awayMeals === null && plan
      ? (parseMeals(plan) ?? parseLegacyMeals(plan))
      : null;
  const shoppingList = parseShoppingList(plan);

  // Upcoming away days first; already-passed prep days sink to the end.
  const orderedAway = awayMeals
    ? [
        ...awayMeals.filter((m) => m.date >= today).sort((a, b) => a.date.localeCompare(b.date)),
        ...awayMeals.filter((m) => m.date < today).sort((a, b) => a.date.localeCompare(b.date)),
      ]
    : [];

  return (
    <main className="flex flex-col gap-4 px-4 pt-3">
      <ScrollToHash />
      <header className="pt-1">
        <h1 className="display text-[26px] leading-8">Nutrition</h1>
      </header>

      {!plan ? (
        <section className="card flex flex-col items-start gap-3 p-5">
          <h2 className="text-[20px] font-semibold">No plan yet for this week</h2>
          <p className="text-[14px]" style={{ color: "var(--ink-2)" }}>
            Away-day recipes and the shopping list arrive with the weekly plan.
          </p>
          <GeneratePlanButton hasPlan={false} />
        </section>
      ) : awayMeals === null ? (
        /* Legacy plan row — v1 meal format until the next generation. */
        <section className="flex flex-col gap-2">
          <p
            className="rounded-xl px-3 py-2 text-[13px] font-medium"
            style={{ color: "var(--warn)", background: "var(--warn-soft)" }}
          >
            This plan predates the away-day meal-prep format — regenerate from the Plan tab to
            get prep-ahead recipes for away days.
          </p>
          {(legacyMeals ?? []).map((meal) => (
            <LegacyMealCard key={meal.date} meal={meal} />
          ))}
          {shoppingList && shoppingList.length > 0 && plan && (
            <div className="mt-2 flex flex-col gap-2">
              <h2 className="overline" style={{ color: "var(--ink-2)" }}>
                Shopping list
              </h2>
              <ShoppingList items={shoppingList} weekStart={weekStart} generatedAt={plan.generated_at} />
            </div>
          )}
        </section>
      ) : orderedAway.length === 0 ? (
        <section className="card p-5">
          <p className="text-[15px] font-medium">No away days coming up — nothing to prep.</p>
          <p className="mt-1 text-[13px]" style={{ color: "var(--ink-2)" }}>
            When the calendar shows a hotel stay or a trip outside Manchester or London, the
            week&apos;s plan adds prep-ahead recipes and a shopping list here.
          </p>
        </section>
      ) : (
        <>
          {/* Planned dinners — away-derived or explicit meal nights (§3.12). */}
          <section className="flex flex-col gap-2">
            <h2 className="overline" style={{ color: "var(--ink-2)" }}>
              Planned dinners
            </h2>
            <p className="-mt-1 text-[12px]" style={{ color: "var(--ink-3)" }}>
              Prep ahead at home — take along, reheat or eat cold.
            </p>
            {orderedAway.map((meal) => (
              <AwayMealCard key={meal.date} meal={meal} isToday={meal.date === today} />
            ))}
          </section>

          {/* Shopping list — Item | Volume */}
          <section className="flex flex-col gap-2">
            <h2 className="overline" style={{ color: "var(--ink-2)" }}>
              Shopping list
            </h2>
            {shoppingList === null || shoppingList.length === 0 ? (
              <p className="card p-4 text-[14px]" style={{ color: "var(--ink-2)" }}>
                Nothing on the list for this week&apos;s away meals.
              </p>
            ) : (
              <ShoppingList items={shoppingList} weekStart={weekStart} generatedAt={plan.generated_at} />
            )}
          </section>
        </>
      )}
    </main>
  );
}
