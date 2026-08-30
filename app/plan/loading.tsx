export default function PlanLoading() {
  return (
    <main className="flex flex-col gap-4 px-4 pt-3" aria-busy="true" aria-label="Loading">
      <div className="skeleton mt-1 h-7 w-24" />
      {/* Segmented toggle */}
      <div className="skeleton h-[52px] rounded-full" />
      {/* Week summary card */}
      <div className="skeleton h-[128px] rounded-2xl" />
      {/* Route card */}
      <div className="skeleton h-[360px] rounded-2xl" />
      {/* Calendar strip */}
      <div className="skeleton h-[220px] rounded-2xl" />
    </main>
  );
}
