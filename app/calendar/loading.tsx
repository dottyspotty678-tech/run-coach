export default function CalendarLoading() {
  return (
    <main className="flex flex-col gap-4 px-4 pt-3" aria-busy="true" aria-label="Loading">
      <div className="skeleton mt-1 h-7 w-32" />
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="skeleton h-[76px] rounded-2xl" />
      ))}
    </main>
  );
}
