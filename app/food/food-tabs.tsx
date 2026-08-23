"use client";

import { useEffect, useState } from "react";

/**
 * Segmented control switching between Meals and the Shopping list
 * (REQUIREMENTS §3.4). Both panels are server-rendered; only visibility is
 * client state. Opens on Shopping when the URL hash is #shopping.
 */
export function FoodTabs({
  meals,
  shopping,
}: {
  meals: React.ReactNode;
  shopping: React.ReactNode;
}) {
  const [tab, setTab] = useState<"meals" | "shopping">("meals");

  useEffect(() => {
    if (window.location.hash === "#shopping") setTab("shopping");
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Food sections"
        className="grid grid-cols-2 gap-1 rounded-xl p-1"
        style={{ background: "var(--raised)" }}
      >
        {(
          [
            ["meals", "Meals"],
            ["shopping", "Shopping list"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className="min-h-[38px] rounded-[9px] text-[14px] font-semibold transition-colors"
            style={
              tab === key
                ? { background: "var(--surface)", color: "var(--ink)", border: "1px solid var(--line)" }
                : { color: "var(--ink-2)" }
            }
          >
            {label}
          </button>
        ))}
      </div>
      <div hidden={tab !== "meals"}>{meals}</div>
      <div hidden={tab !== "shopping"}>{shopping}</div>
    </div>
  );
}
