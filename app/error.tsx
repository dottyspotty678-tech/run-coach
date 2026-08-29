"use client";

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex flex-col gap-4 px-4 pt-3">
      <section className="card mt-8 flex flex-col items-start gap-3 p-5">
        <h1 className="text-[17px] font-semibold">Something went wrong</h1>
        <p className="text-[14px]" style={{ color: "var(--ink-2)" }}>
          Couldn&apos;t load this screen. Your data is safe — try again in a moment.
        </p>
        <button type="button" onClick={reset} className="btn-primary">
          Try again
        </button>
      </section>
    </main>
  );
}
