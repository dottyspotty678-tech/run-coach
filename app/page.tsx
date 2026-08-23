import Link from "next/link";

export default function DashboardPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold">Run Coach</h1>
      <p className="text-sm opacity-70">
        Calendar and weekly plan features land next.
      </p>
      <Link href="/activities" className="text-sm underline">
        Activities
      </Link>
      <Link href="/calendar" className="text-sm underline">
        Calendar
      </Link>
      <Link href="/settings" className="text-sm underline">
        Settings
      </Link>
      <Link href="/plan" className="text-sm underline">
        This week&apos;s plan
      </Link>
    </main>
  );
}
