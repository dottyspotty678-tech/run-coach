export default function NutritionLoading() {
  return (
    <main className="flex flex-col gap-4 px-4 pt-3" aria-busy="true" aria-label="Loading">
      <div className="skeleton mt-1 h-7 w-28" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="skeleton h-[56px] rounded-2xl" />
      ))}
      <div className="skeleton h-[220px] rounded-2xl" />
    </main>
  );
}
