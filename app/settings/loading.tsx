export default function SettingsLoading() {
  return (
    <main className="flex flex-col gap-6 px-4 pt-3" aria-busy="true" aria-label="Loading">
      <div className="skeleton mt-1 h-7 w-28" />
      <div className="skeleton h-[320px] rounded-2xl" />
      <div className="skeleton h-[280px] rounded-2xl" />
      <div className="skeleton h-[220px] rounded-2xl" />
    </main>
  );
}
