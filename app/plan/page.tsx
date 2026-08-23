import Link from "next/link";
import { getCurrentWeeklyPlan } from "@/lib/weeklyPlan";
import { RegenerateButton } from "./regenerate-button";

// Reads the DB on every request — without this, Next prerenders the page at
// build time and serves a stale snapshot of the plan.
export const dynamic = "force-dynamic";

type Meal = {
  date: string;
  recipe_name: string;
  ingredients: string[];
  short_instructions: string;
};

export default async function PlanPage() {
  const plan = await getCurrentWeeklyPlan();
  const meals = (plan?.meal_plan_json ?? []) as Meal[];

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-6 p-6">
      <Link href="/" className="text-sm opacity-70">
        &larr; Back
      </Link>
      <h1 className="text-xl font-semibold">This week&apos;s plan</h1>

      <RegenerateButton />

      {!plan ? (
        <p className="text-sm opacity-70">No plan generated yet this week — tap the button above.</p>
      ) : (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="font-medium">Training</h2>
            <p className="whitespace-pre-wrap text-sm">{plan.training_plan_text}</p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="font-medium">Meals</h2>
            <ul className="flex flex-col gap-3">
              {meals.map((m) => (
                <li key={m.date} className="rounded border border-black/10 p-3 dark:border-white/10">
                  <div className="text-xs opacity-60">
                    {new Date(m.date).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
                  </div>
                  <div className="font-medium">{m.recipe_name}</div>
                  <div className="text-sm opacity-70">{m.ingredients.join(", ")}</div>
                  <div className="mt-1 text-sm">{m.short_instructions}</div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
