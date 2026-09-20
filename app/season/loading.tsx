export default function SeasonLoading() {
  return (
    <main className="flex flex-col gap-4 px-4 pt-3" aria-busy="true" aria-label="Loading">
      <div className="skeleton mt-1 h-8 w-32" />
      <div className="skeleton h-4 w-56" />
      <div className="skeleton h-[560px]" />
    </main>
  );
}
