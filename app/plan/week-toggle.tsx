"use client";

import { useState } from "react";

// The Plan screen's segmented toggle (brief: "This week" / "Next week").
// In-system vocabulary: each segment carries a waymark dot like the tab
// bar's active-tab marker, the active segment gets the accent disc + a
// surface "tile" lift. Both weeks are fetched server-side and passed in
// already rendered — the toggle only hides the inactive one (native
// `hidden`, so it drops out of the a11y tree and tab order for free) rather
// than unmounting, so edit-mode state on Next week survives a glance back
// at This week.

export function PlanWeekToggle({
  initialTab = "this",
  thisWeek,
  nextWeek,
}: {
  initialTab?: "this" | "next";
  thisWeek: React.ReactNode;
  nextWeek: React.ReactNode;
}) {
  const [tab, setTab] = useState<"this" | "next">(initialTab);

  return (
    <>
      <div
        role="tablist"
        aria-label="Plan week"
        className="flex gap-1 rounded-full p-1"
        style={{ background: "var(--raised)" }}
      >
        {(
          [
            { key: "this" as const, label: "This week" },
            { key: "next" as const, label: "Next week" },
          ]
        ).map(({ key, label }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              id={`plan-tab-${key}`}
              aria-selected={active}
              aria-controls={`plan-panel-${key}`}
              onClick={() => setTab(key)}
              className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-full text-[14px] font-semibold"
              style={
                active
                  ? { background: "var(--surface)", color: "var(--accent)" }
                  : { color: "var(--ink-2)" }
              }
            >
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: active ? "var(--accent)" : "var(--ink-3)" }}
              />
              {label}
            </button>
          );
        })}
      </div>

      <div
        id="plan-panel-this"
        role="tabpanel"
        aria-labelledby="plan-tab-this"
        hidden={tab !== "this"}
        className="flex flex-col gap-4"
      >
        {thisWeek}
      </div>
      <div
        id="plan-panel-next"
        role="tabpanel"
        aria-labelledby="plan-tab-next"
        hidden={tab !== "next"}
        className="flex flex-col gap-4"
      >
        {nextWeek}
      </div>
    </>
  );
}
