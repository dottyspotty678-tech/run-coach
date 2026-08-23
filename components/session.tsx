import type { MealType, SessionType } from "@/lib/planTypes";

// Fixed session-type metadata: one colour per type, used identically in
// badges, week-strip tiles and the volume chart (docs/DESIGN.md §2).

export const SESSION_META: Record<
  SessionType,
  { label: string; abbrev: string; color: string; soft: string }
> = {
  rest: { label: "Rest", abbrev: "Rest", color: "var(--s-rest)", soft: "var(--s-rest-soft)" },
  easy: { label: "Easy run", abbrev: "Easy", color: "var(--s-easy)", soft: "var(--s-easy-soft)" },
  tempo: { label: "Tempo", abbrev: "Tmp", color: "var(--s-tempo)", soft: "var(--s-tempo-soft)" },
  intervals: {
    label: "Intervals",
    abbrev: "Int",
    color: "var(--s-intervals)",
    soft: "var(--s-intervals-soft)",
  },
  long: { label: "Long run", abbrev: "Long", color: "var(--s-long)", soft: "var(--s-long-soft)" },
  cross: {
    label: "Cross-training",
    abbrev: "XT",
    color: "var(--s-cross)",
    soft: "var(--s-cross-soft)",
  },
  strength: {
    label: "Strength",
    abbrev: "Str",
    color: "var(--s-strength)",
    soft: "var(--s-strength-soft)",
  },
  race: { label: "Race", abbrev: "Race", color: "var(--s-race)", soft: "var(--s-race-soft)" },
};

export function SessionBadge({ type }: { type: SessionType }) {
  const meta = SESSION_META[type];
  return (
    <span className="chip" style={{ color: meta.color, background: meta.soft }}>
      {meta.label}
    </span>
  );
}

export const MEAL_META: Record<MealType, { label: string }> = {
  home: { label: "Home" },
  travel: { label: "Eating out" },
  assemble: { label: "Quick" },
};

export function MealBadge({ type }: { type: MealType }) {
  return (
    <span
      className="chip"
      style={
        type === "travel"
          ? { color: "var(--s-long)", background: "var(--s-long-soft)" }
          : type === "assemble"
            ? { color: "var(--s-cross)", background: "var(--s-cross-soft)" }
            : { color: "var(--s-easy)", background: "var(--s-easy-soft)" }
      }
    >
      {MEAL_META[type].label}
    </span>
  );
}
