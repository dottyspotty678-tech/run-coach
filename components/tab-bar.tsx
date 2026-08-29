"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconFood,
  IconPlan,
  IconSettings,
  IconToday,
} from "@/components/icons";

// V2 (docs/REDESIGN-V2.md): four tabs. Activity history is a secondary
// screen reached from the Dashboard volume card, like Calendar.
const TABS = [
  { href: "/", label: "Dashboard", Icon: IconToday },
  { href: "/plan", label: "Plan", Icon: IconPlan },
  { href: "/food", label: "Nutrition", Icon: IconFood },
  { href: "/settings", label: "Settings", Icon: IconSettings },
] as const;

export function TabBar() {
  const pathname = usePathname();

  // The PIN gate is a full-screen takeover — no chrome.
  if (pathname === "/pin") return null;

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t pb-safe"
      style={{
        borderColor: "var(--line)",
        background:
          "color-mix(in srgb, var(--surface) 88%, transparent)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
      }}
    >
      <div className="mx-auto flex max-w-lg items-stretch">
        {TABS.map(({ href, label, Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              onClick={(e) => {
                if (active) {
                  e.preventDefault();
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }
              }}
              className="relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1"
              style={{ color: active ? "var(--accent)" : "var(--ink-3)" }}
            >
              {/* Waymark: a small disc above the active tab — the
                  coloured marker on the fingerpost. */}
              <span
                aria-hidden="true"
                className="absolute top-[3px] h-[5px] w-[5px] rounded-full"
                style={{ background: active ? "var(--accent)" : "transparent" }}
              />
              <Icon size={22} strokeWidth={active ? 2.1 : 1.8} />
              <span
                className="uppercase leading-3"
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 11,
                  letterSpacing: "0.09em",
                  fontWeight: active ? 700 : 500,
                }}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
