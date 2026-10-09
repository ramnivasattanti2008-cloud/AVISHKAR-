import Link from "next/link";

/** Only features that exist are listed. More appear here as their backend lands (platform/STATUS.md). */
const TABS = [
  { href: "/today", label: "Today" },
  { href: "", label: "Energy Twin" },
  { href: "/forecast", label: "Forecast" },
  { href: "/tariff", label: "Tariff" },
  { href: "/meter-data", label: "Meter data" },
  { href: "/assets", label: "Assets" },
  { href: "/plan", label: "Plan" },
  { href: "/resilience", label: "Resilience" },
  { href: "/health", label: "Health" },
  { href: "/control", label: "Control" },
  { href: "/what-if", label: "What if" },
  { href: "/futures", label: "Futures" },
  { href: "/ask", label: "Ask" },
] as const;

export type PropertyTab = (typeof TABS)[number]["href"];

/** The section tabs of a property. A demo property also gets a banner on every tab, so no screenshot of it passes for real. */
export function PropertyTabs({ id, current, demo = false }: { id: string; current: PropertyTab; demo?: boolean }) {
  return (
    <>
    {demo && (
      <p role="note" className="mb-2 rounded-md px-3 py-2 text-sm" style={{ color: "var(--tone-demo-fg)", background: "var(--tone-demo-bg)" }}>
        <strong>DEMO DATA.</strong> An invented property in a real place: its readings and equipment are made up, and every value computed
        from them is labelled DEMO. The weather, the sun and a sourced tariff keep their own labels.
      </p>
    )}
    <nav aria-label="Property sections" className="flex gap-1 overflow-x-auto border-b border-line">
      {TABS.map((t) => (
        <Link key={t.href} href={`/property/${id}${t.href}`} aria-current={t.href === current ? "page" : undefined} className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${t.href === current ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`}>
          {t.label}
        </Link>
      ))}
    </nav>
    </>
  );
}
