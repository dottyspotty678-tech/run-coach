export default function ActivityLoading() {
  return (
    <main className="flex flex-col gap-4 px-4 pt-3" aria-busy="true" aria-label="Loading">
      <div className="skeleton mt-1 h-7 w-28" />
      <div className="skeleton h-[176px] rounded-2xl" />
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="skeleton h-[58px] rounded-xl" />
      ))}
    </main>
  );
}
