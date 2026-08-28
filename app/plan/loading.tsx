export default function PlanLoading() {
  return (
    <main className="flex flex-col gap-4 px-4 pt-3" aria-busy="true" aria-label="Loading">
      <div className="skeleton mt-1 h-7 w-24" />
      <div className="skeleton h-[128px] rounded-2xl" />
      <div className="skeleton h-[360px] rounded-2xl" />
    </main>
  );
}
