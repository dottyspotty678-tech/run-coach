import {
  parseLegacyMeals,
  parseMeals,
  parseShoppingList,
  type LegacyMealEntry,
  type MealEntry,
} from "@/lib/planTypes";
import {
  boundaryWeekStart,
  formatDateShort,
  formatWeekday,
  todayISO,
  weekDates,
} from "@/components/dates";
import { getPlanForWeek } from "@/components/data";
import { MealBadge } from "@/components/session";
import { GeneratePlanButton } from "@/components/generate-plan";
import { ScrollToHash } from "@/components/scroll-to-hash";
import { FoodTabs } from "./food-tabs";
import { ShoppingList } from "./shopping-list";

// Reads the DB on every request — never serve a stale prerender.
export const dynamic = "force-dynamic";

export default async function FoodPage() {
  const now = new Date();
  const today = todayISO(now);
  const weekStart = boundaryWeekStart(now);
  const dates = weekDates(weekStart);

  const plan = await getPlanForWeek(weekStart);
  const meals = parseMeals(plan);
  const legacyMeals = meals ? null : parseLegacyMeals(plan);
  const shoppingList = parseShoppingList(plan);
  const allTravel = meals !== null && meals.every((m) => m.meal_type === "travel");

  const mealByDate = new Map<string, MealEntry | LegacyMealEntry>();
  for (const m of meals ?? legacyMeals ?? []) mealByDate.set(m.date, m);

  const mealsPanel = !plan ? (
    <section className="card flex flex-col items-start gap-3 p-5">
      <h2 className="text-[20px] font-semibold">No plan yet for this week</h2>
      <p className="text-[14px]" style={{ color: "var(--ink-2)" }}>
        Meals arrive with the weekly plan — generate it to see the week's cooking.
      </p>
      <GeneratePlanButton hasPlan={false} />
    </section>
  ) : (
    <section className="flex flex-col gap-2">
      {legacyMeals && (
        <p
          className="rounded-xl px-3 py-2 text-[13px] font-medium"
          style={{ color: "var(--warn)", background: "var(--warn-soft)" }}
        >
          This plan predates meal types and prep times — regenerate from the Plan tab for the full format.
        </p>
      )}
      {dates.map((date) => {
        const meal = mealByDate.get(date);
        const isToday = date === today;
        const structured = meal && "meal_type" in meal ? (meal as MealEntry) : null;
        return (
          <article
            key={date}
            id={`d${date}`}
            data-today={isToday ? "" : undefined}
            className="card flex flex-col gap-1.5 p-4"
            style={isToday ? { borderColor: "var(--accent)" } : undefined}
          >
            <div className="flex items-center justify-between gap-2">
              <span
                className="text-[13px] font-semibold"
                style={{ color: isToday ? "var(--accent)" : "var(--ink-2)" }}
              >
                {formatWeekday(date)}{" "}
                <span style={{ color: "var(--ink-3)" }}>{formatDateShort(date)}</span>
                {isToday && " · Today"}
              </span>
              <span className="flex items-center gap-2">
                {structured && structured.meal_type !== "travel" && (
                  <span className="text-[13px] font-semibold tabular" style={{ color: "var(--ink-2)" }}>
                    {structured.prep_time_min} min
                  </span>
                )}
                {structured && <MealBadge type={structured.meal_type} />}
              </span>
            </div>
            {!meal ? (
              <p className="text-[14px]" style={{ color: "var(--ink-3)" }}>
                No meal planned for this day.
              </p>
            ) : (
              <>
                <h2 className="text-[17px] font-semibold leading-6">{meal.recipe_name}</h2>
                {structured?.meal_type === "travel" ? (
                  <p className="text-[14px] leading-[21px]">{meal.short_instructions}</p>
                ) : (
                  <>
                    {meal.ingredients.length > 0 && (
                      <p className="text-[13px] leading-[19px]" style={{ color: "var(--ink-2)" }}>
                        {meal.ingredients.join(" · ")}
                      </p>
                    )}
                    <details className="group">
                      <summary
                        className="flex min-h-[32px] cursor-pointer list-none items-center text-[13px] font-semibold [&::-webkit-details-marker]:hidden"
                        style={{ color: "var(--accent)" }}
                      >
                        <span className="group-open:hidden">Method</span>
                        <span className="hidden group-open:inline">Hide method</span>
                      </summary>
                      <p className="pt-1 text-[14px] leading-[21px] whitespace-pre-wrap">
                        {meal.short_instructions}
                      </p>
                    </details>
                  </>
                )}
              </>
            )}
          </article>
        );
      })}
    </section>
  );

  const shoppingPanel = !plan ? (
    <section className="card p-5">
      <p className="text-[14px]" style={{ color: "var(--ink-2)" }}>
        The shopping list arrives with the weekly plan.
      </p>
    </section>
  ) : shoppingList === null ? (
    allTravel ? (
      <section className="card p-5">
        <p className="text-[15px] font-medium">No shopping needed this week — you're away.</p>
      </section>
    ) : (
      <section className="card p-5">
        <p className="text-[14px]" style={{ color: "var(--ink-2)" }}>
          This plan predates shopping lists — regenerate from the Plan tab to get one.
        </p>
      </section>
    )
  ) : shoppingList.length === 0 ? (
    <section className="card p-5">
      <p className="text-[15px] font-medium">No shopping needed this week — you're away.</p>
    </section>
  ) : (
    <ShoppingList
      items={shoppingList}
      weekStart={weekStart}
      generatedAt={plan.generated_at}
    />
  );

  return (
    <main className="flex flex-col gap-4 px-4 pt-3">
      <ScrollToHash />
      <header className="pt-1">
        <h1 className="text-[22px] font-semibold leading-7">Food</h1>
      </header>
      <FoodTabs meals={mealsPanel} shopping={shoppingPanel} />
    </main>
  );
}
