import Link from "next/link";
import {
  addDays,
  formatDateShort,
  londonDateOf,
  mondayOf,
  relativeTime,
  todayISO,
} from "@/components/dates";
import {
  getInjuryHistory,
  getLatestAppliedCheckin,
  getRecentFeedback,
  getRunnerContext,
} from "@/components/data";
import { IconChevronLeft } from "@/components/icons";
import { FeedbackForm, InjuriesForm } from "./checkin-forms";
import { InjuryHistory } from "./injury-history";
import { VoiceCheckin } from "./voice-checkin";

// Reads the DB on every request — never serve a stale prerender.
export const dynamic = "force-dynamic";

/**
 * Check-in (REQUIREMENTS §3.11): the 30-second Sunday-evening jot. Two
 * fields, no form ceremony — how the week felt (keyed to the week containing
 * today) and the persistent injuries text the planner believes.
 */
export default async function CheckinPage() {
  const now = new Date();
  const today = todayISO(now);
  // Feedback describes the week containing today — deliberately NOT the
  // boundary week: on Sunday evening the app shows next week, but the note is
  // about the week that just happened.
  const describedWeek = mondayOf(today);

  // §3.12: a check-in run today targets the week AFTER the one containing
  // today; an applied one flips the meeting into revise mode.
  const appliedCheckin = await getLatestAppliedCheckin([addDays(describedWeek, 7)]);

  const [context, feedback, injuryHistory] = await Promise.all([
    getRunnerContext(),
    getRecentFeedback(3),
    getInjuryHistory(),
  ]);

  const currentNote = feedback.find((f) => f.week_start_date === describedWeek);
  const previousNotes = feedback
    .filter((f) => f.week_start_date < describedWeek)
    .slice(0, 2);

  return (
    <main className="flex flex-col gap-5 px-4 pt-3">
      {/* Secondary screen: back affordance in the header */}
      <header className="flex items-center gap-1 pt-1">
        <Link
          href="/"
          aria-label="Back to Today"
          className="-ml-2 flex min-h-[44px] min-w-[44px] items-center justify-center"
          style={{ color: "var(--accent)" }}
        >
          <IconChevronLeft size={22} strokeWidth={2.2} />
        </Link>
        <h1 className="display text-[26px] leading-8">Check-in</h1>
      </header>

      {/* Sunday voice meeting (§3.12): the one-stop check-in. */}
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h2 className="overline" style={{ color: "var(--ink-2)" }}>
            Sunday meeting
          </h2>
          {appliedCheckin && (
            <span className="text-[12px] font-semibold" style={{ color: "var(--ok)" }}>
              Done · {formatDateShort(londonDateOf(appliedCheckin.applied_at))}
            </span>
          )}
        </div>
        <VoiceCheckin revising={appliedCheckin !== null} />
      </section>

      {/* Manual fallback: the same inputs, typed. */}
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h2 className="overline" style={{ color: "var(--ink-2)" }}>
            How did this week feel?
          </h2>
          <span className="text-[12px]" style={{ color: "var(--ink-3)" }}>
            Week of {formatDateShort(describedWeek)}
          </span>
        </div>
        <div className="card p-4">
          <FeedbackForm weekStart={describedWeek} initial={currentNote?.feedback ?? ""} />
        </div>
        {previousNotes.length > 0 && (
          <div className="flex flex-col gap-1.5 pt-1">
            {previousNotes.map((note) => (
              <p
                key={note.week_start_date}
                className="line-clamp-2 text-[13px] leading-[19px]"
                style={{ color: "var(--ink-3)" }}
              >
                <span className="font-semibold">Week of {formatDateShort(note.week_start_date)}:</span>{" "}
                {note.feedback}
              </p>
            ))}
          </div>
        )}
      </section>

      {/* Current injuries / niggles */}
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h2 className="overline" style={{ color: "var(--ink-2)" }}>
            Current injuries / niggles
          </h2>
          {context?.updated_at && (
            <span className="text-[12px]" style={{ color: "var(--ink-3)" }}>
              Updated {relativeTime(context.updated_at, now)}
            </span>
          )}
        </div>
        {/* Read-back: exactly what the planner believes right now. */}
        <p
          className="truncate rounded-xl px-3 py-2.5 text-[13px] font-medium"
          style={
            context?.injuries
              ? { color: "var(--warn)", background: "var(--warn-soft)" }
              : { color: "var(--ink-2)", background: "var(--raised)" }
          }
        >
          {context?.injuries
            ? `Working around: ${context.injuries}`
            : "The planner believes you are injury-free."}
        </p>
        <div className="card p-4">
          <InjuriesForm initial={context?.injuries ?? ""} />
        </div>
      </section>

      {/* Past injuries (round 2, U5) — visually secondary, rarely changes. */}
      <InjuryHistory items={injuryHistory} />
    </main>
  );
}
