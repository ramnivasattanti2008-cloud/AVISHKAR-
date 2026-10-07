import { formatInr } from "@/lib/format";

const hh = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;

/** The price of electricity for each hour of the local day, from the plan's own rates. */
export function RateBars({ rates }: { rates: number[] }) {
  const max = Math.max(...rates);
  const min = Math.min(...rates);
  const summary = min === max ? `Flat rate of ${formatInr(min)} per kWh all day` : `Rate by hour of the day, from ${formatInr(min)} to ${formatInr(max)} per kWh`;
  return (
    <figure>
      <div role="img" aria-label={summary} className="flex h-24 items-end gap-0.5">
        {rates.map((r, h) => (
          <div
            key={h}
            title={`${hh(h)} to ${hh(h + 1)}: ${formatInr(r)} per kWh`}
            style={{ height: `${max > 0 ? Math.max(6, (r / max) * 100) : 6}%` }}
            className="flex-1 rounded-t-sm bg-accent opacity-80"
          />
        ))}
      </div>
      <figcaption className="mt-1 flex justify-between text-[11px] text-muted">
        <span>{hh(0)}</span>
        <span>{hh(6)}</span>
        <span>{hh(12)}</span>
        <span>{hh(18)}</span>
        <span>{hh(24)}</span>
      </figcaption>
    </figure>
  );
}
