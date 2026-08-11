export default function DashboardPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold">Run Coach</h1>
      <p className="text-sm opacity-70">
        Logged in. Strava, calendar, and weekly plan features land next.
      </p>
      <form action="/auth/signout" method="post">
        <button type="submit" className="text-sm underline opacity-70">
          Sign out
        </button>
      </form>
    </main>
  );
}
