export default function CheckinLoading() {
  return (
    <main className="flex flex-col gap-5 px-4 pt-3" aria-busy="true" aria-label="Loading">
      <div className="skeleton mt-1 h-7 w-32" />
      <div className="skeleton h-[172px] rounded-2xl" />
      <div className="skeleton h-[196px] rounded-2xl" />
    </main>
  );
}
