"use client";

import { useEffect, useMemo, useState } from "react";
import { SHOPPING_CATEGORIES, type ShoppingItem } from "@/lib/planTypes";
import { IconTick } from "@/components/icons";

type Stored = { generatedAt: string; ticked: string[] };

function storageKey(weekStart: string) {
  return `shopping-ticks-${weekStart}`;
}

function itemKey(item: ShoppingItem) {
  return `${item.category}|${item.item}`;
}

/**
 * Shopping list (REQUIREMENTS §3.5): grouped by category, ticks persist in
 * localStorage keyed by week_start_date, reset when the plan is regenerated
 * (generated_at changes). Checked items sink to the bottom of their group,
 * struck through.
 */
export function ShoppingList({
  items,
  weekStart,
  generatedAt,
}: {
  items: ShoppingItem[];
  weekStart: string;
  generatedAt: string;
}) {
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(weekStart));
      if (raw) {
        const stored = JSON.parse(raw) as Stored;
        // A regenerated plan replaces the list and clears the checks.
        if (stored.generatedAt === generatedAt) {
          setTicked(new Set(stored.ticked));
        } else {
          localStorage.removeItem(storageKey(weekStart));
        }
      }
    } catch {
      // Ignore corrupt storage.
    }
    setLoaded(true);
  }, [weekStart, generatedAt]);

  function persist(next: Set<string>) {
    setTicked(next);
    try {
      const stored: Stored = { generatedAt, ticked: [...next] };
      localStorage.setItem(storageKey(weekStart), JSON.stringify(stored));
    } catch {
      // Storage full/unavailable — ticks just won't persist.
    }
  }

  function toggle(key: string) {
    const next = new Set(ticked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    persist(next);
  }

  const groups = useMemo(() => {
    return SHOPPING_CATEGORIES.map((category) => ({
      category,
      items: items.filter((i) => i.category === category),
    })).filter((g) => g.items.length > 0);
  }, [items]);

  const remaining = items.length - ticked.size;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-medium tabular" style={{ color: "var(--ink-2)" }}>
          {remaining === 0 ? "All done" : `${remaining} of ${items.length} to get`}
        </p>
        {ticked.size > 0 && (
          <button
            type="button"
            onClick={() => persist(new Set())}
            className="min-h-[44px] text-[13px] font-semibold"
            style={{ color: "var(--accent)" }}
          >
            Reset ticks
          </button>
        )}
      </div>

      {groups.map(({ category, items: groupItems }) => {
        const sorted = loaded
          ? [...groupItems].sort(
              (a, b) => Number(ticked.has(itemKey(a))) - Number(ticked.has(itemKey(b)))
            )
          : groupItems;
        return (
          <div key={category} className="flex flex-col gap-1.5">
            <h2 className="overline capitalize" style={{ color: "var(--ink-2)" }}>
              {category}
            </h2>
            <ul className="card divide-y" style={{ borderColor: "var(--line)" }}>
              {sorted.map((item) => {
                const key = itemKey(item);
                const isTicked = ticked.has(key);
                return (
                  <li key={key} style={{ borderColor: "var(--line)" }}>
                    <button
                      type="button"
                      onClick={() => toggle(key)}
                      aria-pressed={isTicked}
                      className="flex min-h-[48px] w-full items-center gap-3 px-4 py-2 text-left"
                    >
                      <span
                        className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border"
                        style={
                          isTicked
                            ? { background: "var(--ok)", borderColor: "var(--ok)", color: "var(--surface)" }
                            : { borderColor: "var(--ink-3)" }
                        }
                      >
                        {isTicked && <IconTick size={13} strokeWidth={3} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className="block text-[15px] font-medium"
                          style={
                            isTicked
                              ? { color: "var(--ink-3)", textDecoration: "line-through" }
                              : undefined
                          }
                        >
                          {item.item}
                        </span>
                        {item.quantity_note && (
                          <span className="block text-[12px]" style={{ color: "var(--ink-3)" }}>
                            {item.quantity_note}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
