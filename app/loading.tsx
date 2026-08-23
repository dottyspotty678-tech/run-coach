export default function TodayLoading() {
  return (
    <main className="flex flex-col gap-4 px-4 pt-3" aria-busy="true" aria-label="Loading">
      <div className="skeleton mt-1 h-7 w-36" />
      <div className="skeleton h-[190px] rounded-2xl" />
      <div className="skeleton h-[110px] rounded-2xl" />
      <div className="grid grid-cols-7 gap-1.5">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="skeleton h-[64px]" />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="skeleton h-[68px]" />
        ))}
      </div>
    </main>
  );
}
