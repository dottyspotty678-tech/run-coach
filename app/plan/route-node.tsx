// Shared route-card furniture (docs/DESIGN.md "the route line is the
// signature"): the dashed footpath line threading the week and the
// session-coloured waymark node, today ringed in heather. Used by both the
// This week review list and the Next week planning list so the two views
// stay visually one system.

/** The dashed vertical path segment for one row — joins across rows into one line. */
export function RouteLine() {
  return <span aria-hidden="true" className="route-line absolute bottom-0 left-[27px] top-0" />;
}

/** One waymark disc, coloured by session type; ringed in accent for today. */
export function WaymarkNode({ color, ringed = false }: { color: string; ringed?: boolean }) {
  return (
    <span className="relative flex items-center justify-center">
      <span
        className="h-3 w-3 rounded-full"
        style={{
          background: color,
          boxShadow: ringed
            ? "0 0 0 2px var(--surface), 0 0 0 4px var(--accent)"
            : "0 0 0 2px var(--surface)",
        }}
      />
    </span>
  );
}
