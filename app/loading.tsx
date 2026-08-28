export default function DashboardLoading() {
  return (
    <main className="flex flex-col gap-4 px-4 pt-3" aria-busy="true" aria-label="Loading">
      <div className="skeleton mt-1 h-7 w-36" />
      <div className="skeleton h-[190px] rounded-2xl" />
      <div className="skeleton h-[104px] rounded-2xl" />
      <div className="grid grid-cols-2 gap-1.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-[64px] rounded-2xl" />
        ))}
      </div>
    </main>
  );
}
