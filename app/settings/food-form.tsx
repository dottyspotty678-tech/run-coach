"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { saveSettings } from "./actions";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary">
      {pending ? (
        <>
          <span className="spinner" />
          Saving…
        </>
      ) : (
        "Save food preferences"
      )}
    </button>
  );
}

/**
 * Tag-style input: type, add, tap a tag to remove (REQUIREMENTS §3.9).
 * Persists via a hidden comma-joined field so the existing server action and
 * field names stay unchanged.
 */
function TagInput({
  name,
  label,
  placeholder,
  initial,
}: {
  name: string;
  label: string;
  placeholder: string;
  initial: string[];
}) {
  const [tags, setTags] = useState<string[]>(initial);
  const [draft, setDraft] = useState("");

  function add() {
    const value = draft.trim().replace(/,+$/, "");
    if (!value) return;
    if (!tags.some((t) => t.toLowerCase() === value.toLowerCase())) {
      setTags([...tags, value]);
    }
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>
        {label}
      </span>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setTags(tags.filter((t) => t !== tag))}
              className="flex min-h-[32px] items-center gap-1 rounded-full px-3 text-[13px] font-medium"
              style={{ background: "var(--raised)" }}
              aria-label={`Remove ${tag}`}
            >
              {tag}
              <span aria-hidden="true" style={{ color: "var(--ink-3)" }}>
                ×
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-1.5">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          className="input flex-1"
        />
        <button type="button" onClick={add} className="btn-secondary shrink-0 px-4">
          Add
        </button>
      </div>
      <input type="hidden" name={name} value={tags.join(", ")} />
    </div>
  );
}

export function FoodForm({
  defaults,
}: {
  defaults: {
    weight_goal: string;
    dietary_restrictions: string[];
    disliked_ingredients: string[];
    household_size: number;
  };
}) {
  const [weightGoal, setWeightGoal] = useState(defaults.weight_goal);
  const [household, setHousehold] = useState(
    Math.min(6, Math.max(1, defaults.household_size))
  );

  return (
    <form action={saveSettings} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>
          Weight goal
        </span>
        <div
          className="grid grid-cols-2 gap-1 rounded-xl p-1"
          style={{ background: "var(--raised)" }}
          role="radiogroup"
          aria-label="Weight goal"
        >
          {(
            [
              ["lose", "Lose"],
              ["maintain", "Maintain"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={weightGoal === value}
              onClick={() => setWeightGoal(value)}
              className="min-h-[38px] rounded-[9px] text-[14px] font-semibold"
              style={
                weightGoal === value
                  ? { background: "var(--surface)", color: "var(--ink)", border: "1px solid var(--line)" }
                  : { color: "var(--ink-2)" }
              }
            >
              {label}
            </button>
          ))}
        </div>
        <input type="hidden" name="weight_goal" value={weightGoal} />
      </div>

      <TagInput
        name="dietary_restrictions"
        label="Dietary restrictions"
        placeholder="e.g. vegetarian"
        initial={defaults.dietary_restrictions}
      />

      <TagInput
        name="disliked_ingredients"
        label="Disliked ingredients"
        placeholder="e.g. mushrooms"
        initial={defaults.disliked_ingredients}
      />

      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>
          Household size
        </span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Fewer people"
            onClick={() => setHousehold(Math.max(1, household - 1))}
            disabled={household <= 1}
            className="flex h-[44px] w-[44px] items-center justify-center rounded-xl text-[20px] font-semibold disabled:opacity-40"
            style={{ background: "var(--raised)" }}
          >
            −
          </button>
          <span className="w-6 text-center text-[17px] font-semibold tabular">{household}</span>
          <button
            type="button"
            aria-label="More people"
            onClick={() => setHousehold(Math.min(6, household + 1))}
            disabled={household >= 6}
            className="flex h-[44px] w-[44px] items-center justify-center rounded-xl text-[20px] font-semibold disabled:opacity-40"
            style={{ background: "var(--raised)" }}
          >
            +
          </button>
        </div>
        <input type="hidden" name="household_size" value={household} />
      </div>

      <SaveButton />
    </form>
  );
}
