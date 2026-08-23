// Europe/London date helpers. All user-facing "today" and week-boundary logic
// runs through these (REQUIREMENTS §5.5) — never through server-local time.

const TZ = "Europe/London";

type LondonParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 1 = Monday … 7 = Sunday
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function londonParts(now: Date = new Date()): LondonParts {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: WEEKDAYS.indexOf(parts.weekday) + 1,
  };
}

/** Today's date in London as YYYY-MM-DD. */
export function todayISO(now: Date = new Date()): string {
  const p = londonParts(now);
  return isoFrom(p.year, p.month, p.day);
}

function isoFrom(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Add days to a YYYY-MM-DD string (pure calendar arithmetic, no TZ). */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return isoFrom(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** Monday of the week containing the given London date. */
export function mondayOf(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0 Sunday … 6 Saturday
  const diff = dow === 0 ? -6 : 1 - dow;
  return addDays(iso, diff);
}

/**
 * Week-boundary rule (REQUIREMENTS §3.3): the "current week" runs Monday 00:00
 * to Sunday 16:59 Europe/London; from Sunday 17:00 screens switch to the
 * upcoming week.
 */
export function boundaryWeekStart(now: Date = new Date()): string {
  const p = londonParts(now);
  const today = isoFrom(p.year, p.month, p.day);
  if (p.weekday === 7 && p.hour >= 17) return addDays(today, 1);
  return mondayOf(today);
}

/** True when it is Sunday 17:00 or later in London (plan-ready banner window). */
export function isSundayEvening(now: Date = new Date()): boolean {
  const p = londonParts(now);
  return p.weekday === 7 && p.hour >= 17;
}

/** The seven dates of a week, Monday-first. */
export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** "Tue 25 Aug" from YYYY-MM-DD. */
export function formatDayShort(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** "Monday" from YYYY-MM-DD. */
export function formatWeekday(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
}

/** "25 Aug" from YYYY-MM-DD. */
export function formatDateShort(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** London calendar date (YYYY-MM-DD) of a timestamp. */
export function londonDateOf(timestamp: string | Date): string {
  return todayISO(typeof timestamp === "string" ? new Date(timestamp) : timestamp);
}

/** "18:30" London time of a timestamp. */
export function londonTimeOf(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** London hour (0-23) of a timestamp — for the "evening event" cut-off. */
export function londonHourOf(timestamp: string): number {
  return londonParts(new Date(timestamp)).hour;
}

/** Relative time, e.g. "2 h ago", "just now", "3 days ago". */
export function relativeTime(timestamp: string | null | undefined, now: Date = new Date()): string | null {
  if (!timestamp) return null;
  const then = new Date(timestamp).getTime();
  if (Number.isNaN(then)) return null;
  const diffMs = now.getTime() - then;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/** Whole days between two YYYY-MM-DD dates (b - a). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}
