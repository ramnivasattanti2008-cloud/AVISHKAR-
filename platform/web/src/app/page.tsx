import Link from "next/link";
import { HomeProperties } from "@/components/HomeProperties";

const QUESTIONS = [
  {
    num: "1",
    question: "What energy system should I install?",
    desc: "Analyze your property's exact geographic location, roof geometry, solar potential, weather history, and consumption patterns before investing a single rupee in hardware.",
  },
  {
    num: "2",
    question: "What should I do with my energy now and in the coming days?",
    desc: "Predict solar generation and electricity demand with uncertainty bands, then decide in advance how to consume, store, or distribute available energy.",
  },
  {
    num: "3",
    question: "How can I get maximum value from every unit of energy?",
    desc: "Minimize electricity costs on Time-of-Day tariffs, safeguard essential loads during grid outages, eliminate waste, and monetize surplus energy via P2P dispatch.",
  },
];

const PHILOSOPHY = [
  {
    step: "SEE",
    title: "Understand the Site",
    desc: "Build a digital Energy Twin using real weather, satellite metadata, building geometry, and consumption profiles.",
  },
  {
    step: "PREDICT",
    title: "Forecast with Uncertainty",
    desc: "Compute probabilistic P10/P50/P90 solar and load forecast bands with conformal empirical calibration.",
  },
  {
    step: "OPTIMIZE",
    title: "Allocate Intelligently",
    desc: "Solve a multi-objective LP/MILP over tariffs, battery wear, critical reserve floors, and shiftable loads.",
  },
  {
    step: "ACT",
    title: "Dispatch & Protect",
    desc: "Execute guided battery dispatch, enforce emergency reserves, and formulate Beckn DEG v2.0 trade offers.",
  },
];

const WORKFLOW = [
  { stage: "1", name: "MONITOR", detail: "Collect available property, generation, consumption, weather, and tariff information." },
  { stage: "2", name: "FORECAST", detail: "Predict solar generation, electricity demand, and potential energy surpluses or deficits." },
  { stage: "3", name: "RESERVE", detail: "Protect critical energy requirements and enforce battery and operational limits." },
  { stage: "4", name: "PLAN", detail: "Optimize energy use, storage, flexible loads, and possible exports." },
  { stage: "5", name: "DISPATCH", detail: "Present or execute permitted actions through supported integrations." },
  { stage: "6", name: "PAYBACK", detail: "Measure outcomes and compare actual costs and performance against the baseline." },
];

const FEATURES = [
  {
    num: "01",
    title: "AI-Powered Energy Twin",
    desc: "Digital representation of property characteristics, solar potential, consumption DNA, battery capacity, and grid conditions.",
    href: "/map",
    linkText: "Explore on Map",
  },
  {
    num: "02",
    title: "Location-Aware Solar Intelligence",
    desc: "Real building footprints (Overpass/OSM), NASA POWER irradiance, and PVGIS solar modeling for pre-install sizing.",
    href: "/map",
    linkText: "Analyze Solar",
  },
  {
    num: "03",
    title: "Predictive Energy Forecasting",
    desc: "Hour-by-hour solar and load predictions with conformally calibrated P10/P50/P90 bands to manage uncertainty.",
    href: "/properties",
    linkText: "View Forecasts",
  },
  {
    num: "04",
    title: "Intelligent Energy Allocation Engine",
    desc: "Accounting for every kWh across immediate consumption, battery storage, flexible loads, emergency reserve, and grid export.",
    href: "/properties",
    linkText: "See Energy Ledger",
  },
  {
    num: "05",
    title: "Smart Battery Optimization",
    desc: "Non-linear DoD degradation modeling (ASTM E1049 Rainflow), Arrhenius temperature derating, and cycle life preservation.",
    href: "/properties",
    linkText: "Battery Health",
  },
  {
    num: "06",
    title: "Surplus Energy Dispatch",
    desc: "India Energy Stack / Beckn DEG v2.0 catalog publishing, conservative offer sizing, and simulated settlement.",
    href: "/community",
    linkText: "Community & VPP",
  },
  {
    num: "07",
    title: "Electricity Cost Optimization",
    desc: "Time-of-Day (ToD) tariff arbitrage, telescopic slab modeling, and transparent savings comparison against unmanaged baselines.",
    href: "/properties",
    linkText: "Tariff Analysis",
  },
  {
    num: "08",
    title: "Critical Energy Reserve",
    desc: "Dynamic SOC floor calculated from critical kW, backup hours, and storm/outage risk to prevent cut blackouts.",
    href: "/properties",
    linkText: "Resilience Duration",
  },
  {
    num: "09",
    title: "What-If Simulation",
    desc: "Simulate solar expansion, battery sizing, tariff hikes, cloudy days, and multi-hour outages before committing capital.",
    href: "/properties",
    linkText: "Run Scenarios",
  },
  {
    num: "10",
    title: "Explainable AI Recommendations",
    desc: "Plain-language recommendations with measured confidence, underlying data sources, and strict grounded citations.",
    href: "/properties",
    linkText: "Ask Copilot",
  },
];

const PRINCIPLES = [
  {
    title: "Real data or nothing",
    text: "Weather, solar resource, building outlines, and satellite scenes come from real sources. When a source is down, AVISHKAR says so honestly; it never fills gaps with made-up numbers.",
  },
  {
    title: "Every value is labelled",
    text: "LIVE, UPDATED, FORECAST, ESTIMATED, REFERENCE, or UNAVAILABLE: each number carries its provider, its timestamp, and its caveats, so trust is never blind.",
  },
  {
    title: "Estimates show their working",
    text: "Anything calculated lists the underlying formulas, tariffs, and assumptions. Unknown data (such as unmetered circuits) is marked unavailable, not guessed.",
  },
];

export default function Home() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-12 sm:py-16">
      {/* Hero Section */}
      <section aria-labelledby="hero-title" className="text-center sm:text-left">
        <div className="inline-flex items-center gap-2 rounded-full border border-line bg-surface2 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-accent">
          <span>AI-Powered Energy Intelligence</span>
          <span aria-hidden>•</span>
          <span>India Energy Stack P2P Ready</span>
        </div>
        <h1 id="hero-title" className="mt-4 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
          See Your Energy. <br className="hidden sm:inline" />
          <span className="text-accent">Predict Its Future.</span> Control Its Value.
        </h1>
        <p className="mt-3 text-lg font-medium text-ink/90 sm:text-xl">
          &ldquo;Every Watt Has a Purpose. Every Decision Has Intelligence.&rdquo;
        </p>
        <p className="mt-4 max-w-3xl text-base text-muted sm:text-lg">
          AVISHKAR is not just a solar monitoring dashboard. It is an AI-powered energy intelligence platform that predicts,
          optimizes, and manages energy across properties — connecting location-aware potential with forward-looking dispatch.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3 sm:justify-start">
          <Link href="/map" className="btn btn-primary px-6 py-3 text-base">
            Open the Map
          </Link>
          <Link href="/community" className="btn px-5 py-3 text-base">
            Community &amp; VPP
          </Link>
          <Link href="/system" className="btn px-5 py-3 text-base">
            System Status
          </Link>
        </div>
      </section>

      {/* Properties of Logged In User */}
      <HomeProperties />

      {/* The 3 Core Questions */}
      <section aria-labelledby="questions-title" className="mt-16 sm:mt-20">
        <h2 id="questions-title" className="text-2xl font-bold tracking-tight sm:text-3xl">
          The Three Questions AVISHKAR Answers
        </h2>
        <p className="mt-2 text-sm text-muted">
          Connecting pre-investment hardware feasibility with dynamic day-to-day energy optimization.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {QUESTIONS.map((q) => (
            <div key={q.num} className="card p-6 flex flex-col justify-between">
              <div>
                <span className="inline-block rounded-md bg-accent/15 px-2.5 py-1 text-xs font-bold text-accent">
                  Question {q.num}
                </span>
                <h3 className="mt-3 text-lg font-semibold leading-snug">{q.question}</h3>
                <p className="mt-2 text-sm text-muted">{q.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Core Operating Philosophy */}
      <section aria-labelledby="philosophy-title" className="mt-16 sm:mt-20">
        <div className="card border-accent/30 bg-surface p-6 sm:p-8">
          <div className="sm:flex sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-accent">Operating Philosophy</p>
              <h2 id="philosophy-title" className="mt-1 text-2xl font-bold tracking-tight">
                SEE &rarr; PREDICT &rarr; OPTIMIZE &rarr; ACT
              </h2>
            </div>
            <p className="mt-2 text-sm text-muted sm:mt-0 sm:max-w-xs">
              Every unit of energy should have an informed, economically sensible, and operationally feasible destination.
            </p>
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PHILOSOPHY.map((p) => (
              <div key={p.step} className="rounded-lg border border-line bg-surface2/60 p-4">
                <span className="text-xs font-black tracking-widest text-accent">{p.step}</span>
                <h3 className="mt-1 font-semibold text-ink">{p.title}</h3>
                <p className="mt-1 text-xs text-muted leading-relaxed">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The 6-Stage Complete Operating Cycle */}
      <section aria-labelledby="workflow-title" className="mt-16 sm:mt-20">
        <h2 id="workflow-title" className="text-2xl font-bold tracking-tight sm:text-3xl">
          The 6-Stage Operational Workflow
        </h2>
        <p className="mt-2 text-sm text-muted">
          A continuous loop combining probabilistic quantile forecasting with rigorous LP mathematical optimization.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {WORKFLOW.map((w) => (
            <div key={w.stage} className="card p-5">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-ink">
                  {w.stage}
                </span>
                <h3 className="font-semibold tracking-wide text-ink">{w.name}</h3>
              </div>
              <p className="mt-2 text-xs text-muted leading-relaxed">{w.detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 10 Core Features Grid */}
      <section aria-labelledby="features-title" className="mt-16 sm:mt-20">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 id="features-title" className="text-2xl font-bold tracking-tight sm:text-3xl">
              10 Core Features of AVISHKAR
            </h2>
            <p className="mt-2 text-sm text-muted">
              Built, verified, and operational across both the Python EMS and the TypeScript platform.
            </p>
          </div>
          <Link href="/map" className="text-sm font-semibold text-accent hover:underline">
            Try a Property &rarr;
          </Link>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.num} className="card p-5 flex flex-col justify-between hover:border-accent/50 transition-colors">
              <div>
                <span className="num text-xs font-bold text-muted">{f.num}</span>
                <h3 className="mt-1 text-base font-semibold text-ink">{f.title}</h3>
                <p className="mt-2 text-xs text-muted leading-relaxed">{f.desc}</p>
              </div>
              <div className="mt-4 pt-3 border-t border-line/60">
                <Link href={f.href} className="text-xs font-semibold text-accent hover:underline">
                  {f.linkText} &rarr;
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Foundation Principles */}
      <section aria-labelledby="principles-title" className="mt-16 sm:mt-20">
        <h2 id="principles-title" className="text-xl font-bold tracking-tight">
          Core Data Honesty Invariants
        </h2>
        <p className="mt-1 text-sm text-muted">
          Data honesty is the product: AVISHKAR never presents simulated, estimated, or demo data as live.
        </p>
        <ul className="mt-6 grid gap-4 sm:grid-cols-3">
          {PRINCIPLES.map((p) => (
            <li key={p.title} className="card p-5">
              <h3 className="font-semibold text-ink">{p.title}</h3>
              <p className="mt-2 text-xs text-muted leading-relaxed">{p.text}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
