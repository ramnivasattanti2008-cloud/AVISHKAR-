import Link from "next/link";

/** Only features that exist are listed. More appear here as their backend lands (platform/STATUS.md). */
const TABS = [
  { href: "", label: "Energy Twin" },
  { href: "/forecast", label: "Forecast" },
];

export function PropertyTabs({ id, current }: { id: string; current: "" | "/forecast" }) {
  return (
    <nav aria-label="Property sections" className="flex gap-1 border-b border-line">
      {TABS.map((t) => (
        <Link key={t.href} href={`/property/${id}${t.href}`} aria-current={t.href === current ? "page" : undefined} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${t.href === current ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
