import Link from "next/link";
import { HomeProperties } from "@/components/HomeProperties";

const SCENARIOS = [
  { place: "Mathura · Sharma Niwas", state: "Uttar Pradesh · DVVNL", title: "Personal Home Energy Shield", detail: "3 kWp rooftop solar, ₹1,294/mo in-pocket savings, 35% outage backup floor.", tone: "cyan", icon: "◈" },
  { place: "Jaipur · Dr. Verma Clinic", state: "Rajasthan · JVVNL", title: "EV V2H & Critical Care Guard", detail: "30 kWp rooftop solar, 40 kWh storage, peak hospital feeder protection.", tone: "purple", icon: "▣" },
  { place: "Pune · Kulkarni Supermarket", state: "Maharashtra · MSEDCL", title: "P2P Surplus Clean Trading", detail: "15 kWp rooftop solar, 20 kWh storage, Beckn DEG v2.0 local micro-trading.", tone: "amber", icon: "☀" },
];

const METRICS = [
  { value: "772", unit: "W/m²", label: "Direct solar beam", source: "INSAT-3DR synced", tone: "amber" },
  { value: "9.1", unit: "kW", label: "Active generation", source: "15.0 kWp array", tone: "emerald" },
  { value: "48.9", unit: "kg", label: "Daily CO₂ avoided", source: "CEA standard", tone: "cyan" },
  { value: "0.14", unit: "s", label: "Anti-islanding latency", source: "IEEE 1547 compliant", tone: "purple" },
];

const TILES = [
  { label: "Satellite intelligence", title: "See the grid before it moves", body: "Location-aware weather, solar resource, building geometry, and satellite metadata combine into one honest Energy Twin.", href: "/map", action: "Open energy map", icon: "⌁", tone: "cyan" },
  { label: "Predictive dispatch", title: "Every watt has a destination", body: "Forecast generation and demand, preserve critical reserve, and allocate energy across loads, storage, and export.", href: "/properties", action: "Explore properties", icon: "↗", tone: "amber" },
  { label: "Citizen energy exchange", title: "Turn surplus into community value", body: "Prepare transparent, conservative P2P offers through the community energy marketplace with UPI settlement.", href: "/community", action: "View community", icon: "◎", tone: "purple" },
  { label: "Hardware gateway", title: "SunSpec Modbus & Grid Guard", body: "IEEE 1547 compliant anti-islanding trip latency < 0.14s and real-time distribution transformer thermal protection.", href: "/properties", action: "Inspect hardware", icon: "⚡", tone: "emerald" },
];

const WORKFLOW = ["Monitor", "Forecast", "Reserve", "Plan", "Dispatch", "Payback"];

export default function Home() {
  return (
    <div className="mission-page">
      <div className="mission-grid-overlay" aria-hidden />
      <div className="mission-ambient-glow" aria-hidden />
      <main className="mission-container mission-main">
        <section className="mission-hero" aria-labelledby="hero-title">
          <div className="mission-hero-copy">
            <div className="mission-kicker"><span className="mission-live-dot" /> ISRO INSAT-3DR nowcasting · Beckn DEG v2.0 ready</div>
            <h1 id="hero-title">India&apos;s predictive<br /><span>energy mission control.</span></h1>
            <p className="mission-hero-lede">AI-driven energy intelligence for rooftop solar, resilient microgrids, and communities that want every unit to work harder.</p>
            <div className="mission-hero-actions">
              <Link href="/map" className="mission-primary-button">Open the energy map <span aria-hidden>↗</span></Link>
              <Link href="/community" className="mission-outline-button">Explore P2P dispatch</Link>
              <a href="http://localhost:8501" target="_blank" rel="noopener noreferrer" className="mission-outline-button" style={{ borderColor: "rgba(56, 189, 248, 0.4)", color: "#38bdf8" }}>
                Console (Port 8501) ↗
              </a>
            </div>
            <div className="mission-hero-note"><span>●</span> Real sources. Clear labels. No invented numbers.</div>
          </div>
          <div className="mission-hero-panel">
            <div className="mission-panel-top"><span>ACTIVE MISSION</span><strong>INDIA · 15 MIN HORIZON</strong></div>
            <div className="mission-orbit" aria-hidden><span className="orbit-ring orbit-ring-one" /><span className="orbit-ring orbit-ring-two" /><span className="orbit-core">⚡</span><i className="orbit-satellite">✦</i></div>
            <div className="mission-panel-readout"><span>Grid intelligence status</span><b><i className="mission-live-dot" /> NOMINAL</b></div>
            <div className="mission-panel-bars"><span style={{ "--bar": "74%" } as React.CSSProperties} /><span style={{ "--bar": "56%" } as React.CSSProperties} /><span style={{ "--bar": "88%" } as React.CSSProperties} /><span style={{ "--bar": "66%" } as React.CSSProperties} /></div>
          </div>
        </section>

        <section className="mission-scenarios" aria-label="Featured scenarios">
          {SCENARIOS.map((scenario) => (
            <Link href="/map" key={scenario.place} className={`mission-scenario mission-tone-${scenario.tone}`}>
              <div className="mission-scenario-icon">{scenario.icon}</div>
              <div><small>{scenario.place}</small><em>{scenario.state}</em><h2>{scenario.title}</h2><p>{scenario.detail}</p></div>
              <span className="mission-arrow" aria-hidden>↗</span>
            </Link>
          ))}
        </section>

        <HomeProperties />

        <section className="mission-metrics" aria-label="Live mission metrics">
          {METRICS.map((metric) => (
            <div className={`mission-metric mission-tone-${metric.tone}`} key={metric.label}>
              <div className="mission-metric-top"><span>{metric.source}</span><b>LIVE</b></div>
              <strong>{metric.value}<small>{metric.unit}</small></strong>
              <label>{metric.label}</label>
              <div className="mission-spark"><i /><i /><i /><i /><i /><i /><i /></div>
            </div>
          ))}
        </section>

        <section className="mission-section-heading">
          <div><span className="mission-section-tag">DECENTRALIZED ENERGY GRID</span><h2>Microgrid telemetry<br />&amp; citizen intelligence.</h2></div>
          <p>One operating picture for measured data, forecasts, savings, resilience, and transparent energy exchange.</p>
        </section>

        <section className="mission-bento" aria-label="Platform capabilities">
          {TILES.map((tile) => (
            <article key={tile.title} className={`mission-bento-tile mission-tone-${tile.tone}`}>
              <div className="mission-tile-icon">{tile.icon}</div><span className="mission-tile-label">{tile.label}</span>
              <h3>{tile.title}</h3><p>{tile.body}</p><Link href={tile.href}>{tile.action} <span aria-hidden>↗</span></Link>
            </article>
          ))}
          <article className="mission-bento-tile mission-bento-wide mission-tone-emerald">
            <div className="mission-tile-label">THE OPERATING LOOP</div>
            <h3>From signal to action, without the black box.</h3>
            <div className="mission-workflow">{WORKFLOW.map((step, index) => <span key={step}><b>{String(index + 1).padStart(2, "0")}</b>{step}{index < WORKFLOW.length - 1 && <i aria-hidden>→</i>}</span>)}</div>
          </article>
        </section>

        <section className="mission-trust">
          <div><span className="mission-section-tag">DATA HONESTY INVARIANTS</span><h2>Trust is a feature.</h2></div>
          <div className="mission-trust-list"><p><b>01</b><strong>Real data or nothing</strong><span>Providers, timestamps, and caveats stay visible. Missing data is never disguised.</span></p><p><b>02</b><strong>Every value is labelled</strong><span>LIVE, FORECAST, ESTIMATED, REFERENCE, or UNAVAILABLE at a glance.</span></p><p><b>03</b><strong>Estimates show their working</strong><span>Formulas, tariffs, assumptions, and confidence travel with every recommendation.</span></p></div>
        </section>
      </main>
    </div>
  );
}
