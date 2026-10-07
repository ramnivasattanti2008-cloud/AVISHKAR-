import Link from "next/link";

const PRINCIPLES = [
  { title: "Real data or nothing", text: "Weather, solar resource, building outlines and satellite scenes come from real sources. When a source is down, AVISHKAR says so and shows its age; it never fills the gap with a made-up number." },
  { title: "Every value is labelled", text: "LIVE, UPDATED, FORECAST, ESTIMATED, REFERENCE or UNAVAILABLE: each number carries its provider, its time and its caveats, so you can see how far to trust it." },
  { title: "Estimates show their working", text: "Anything calculated lists the assumptions behind it, such as how much roof is usable. What AVISHKAR cannot know yet, such as your consumption and tariff, is marked unavailable, not guessed." },
];

export default function Home() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-14">
      <p className="text-sm font-semibold uppercase tracking-widest text-accent">AVISHKAR</p>
      <h1 className="mt-2 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">Your energy. Understood.</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted">
        Pick a property on a map. AVISHKAR builds its Energy Twin from real weather, solar and satellite data, tells you what it can and cannot know, and shows you where every unit of energy could best go.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/map" className="btn btn-primary px-5 py-2.5 text-base">
          Open the map
        </Link>
        <Link href="/system" className="btn px-5 py-2.5 text-base">
          See system status
        </Link>
      </div>
      <ul className="mt-14 grid gap-4 sm:grid-cols-3">
        {PRINCIPLES.map((p) => (
          <li key={p.title} className="card p-5">
            <h2 className="font-semibold">{p.title}</h2>
            <p className="mt-2 text-sm text-muted">{p.text}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
