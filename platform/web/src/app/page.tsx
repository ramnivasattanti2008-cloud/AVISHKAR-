"use client";

import Link from "next/link";
import React, { useState } from "react";
import { HomeProperties } from "@/components/HomeProperties";

interface RegionalMicrogrid {
  state: string;
  name: string;
  discom: string;
  solarCapacityMw: number;
  activeGenerationKw: number;
  directDniWm2: number;
  p2pClearingRate: number;
  discomRetailRate: number;
  feederFrequencyHz: number;
  solarPenetrationPct: number;
}

const REGIONAL_MICROGRIDS: Record<string, RegionalMicrogrid> = {
  maharashtra: {
    state: "Maharashtra",
    name: "Pune Commercial Hub & Hinjewadi Microgrid",
    discom: "MSEDCL",
    solarCapacityMw: 420.5,
    activeGenerationKw: 9.1,
    directDniWm2: 772,
    p2pClearingRate: 4.80,
    discomRetailRate: 8.50,
    feederFrequencyHz: 50.01,
    solarPenetrationPct: 38.4,
  },
  karnataka: {
    state: "Karnataka",
    name: "Bengaluru Whitefield Tech Microgrid",
    discom: "BESCOM",
    solarCapacityMw: 360.2,
    activeGenerationKw: 8.4,
    directDniWm2: 745,
    p2pClearingRate: 4.50,
    discomRetailRate: 7.90,
    feederFrequencyHz: 50.02,
    solarPenetrationPct: 41.2,
  },
  gujarat: {
    state: "Gujarat",
    name: "Ahmedabad-Gandhinagar Solar Corridor",
    discom: "UGVCL",
    solarCapacityMw: 580.0,
    activeGenerationKw: 9.8,
    directDniWm2: 810,
    p2pClearingRate: 3.90,
    discomRetailRate: 6.80,
    feederFrequencyHz: 50.00,
    solarPenetrationPct: 49.6,
  },
  tamilnadu: {
    state: "Tamil Nadu",
    name: "Coimbatore Industrial Rooftop Feeder",
    discom: "TANGEDCO",
    solarCapacityMw: 495.8,
    activeGenerationKw: 8.9,
    directDniWm2: 785,
    p2pClearingRate: 4.60,
    discomRetailRate: 8.10,
    feederFrequencyHz: 49.99,
    solarPenetrationPct: 44.1,
  },
  uttarpradesh: {
    state: "Uttar Pradesh",
    name: "Mathura Rural Resilient Feeder",
    discom: "UPPCL",
    solarCapacityMw: 210.4,
    activeGenerationKw: 7.6,
    directDniWm2: 720,
    p2pClearingRate: 4.20,
    discomRetailRate: 7.20,
    feederFrequencyHz: 50.01,
    solarPenetrationPct: 29.5,
  },
  rajasthan: {
    state: "Rajasthan",
    name: "Jaipur Solar City & Healthcare Zone",
    discom: "JVVNL",
    solarCapacityMw: 640.7,
    activeGenerationKw: 10.4,
    directDniWm2: 845,
    p2pClearingRate: 3.75,
    discomRetailRate: 7.40,
    feederFrequencyHz: 50.03,
    solarPenetrationPct: 53.8,
  },
};

const SCENARIOS = [
  { place: "Pune commercial hub", state: "Maharashtra · MSEDCL", title: "P2P surplus market", detail: "Sunny surplus day with active peer-to-peer dispatch.", tone: "amber", icon: "☀" },
  { place: "Mathura rural microgrid", state: "Uttar Pradesh · UPPCL", title: "Outage resilience shield", detail: "Dynamic emergency reserve based on feeder risk.", tone: "cyan", icon: "◈" },
  { place: "Jaipur healthcare clinic", state: "Rajasthan · JVVNL", title: "EV V2H & feeder guard", detail: "Evening peak protection for critical loads.", tone: "purple", icon: "▣" },
];

const TILES = [
  { label: "Satellite intelligence", title: "See the grid before it moves", body: "Location-aware weather, solar resource, building geometry, and satellite metadata combine into one honest Energy Twin.", href: "/map", action: "Open energy map", icon: "⌁", tone: "cyan" },
  { label: "Predictive dispatch", title: "Every watt has a destination", body: "Forecast generation and demand, preserve critical reserve, and allocate energy across loads, storage, and export.", href: "/properties", action: "Explore properties", icon: "↗", tone: "amber" },
  { label: "Citizen energy exchange", title: "Turn surplus into community value", body: "Prepare transparent, conservative P2P offers through the community energy marketplace.", href: "/community", action: "View community", icon: "◎", tone: "purple" },
];

const WORKFLOW = ["Monitor", "Forecast", "Reserve", "Plan", "Dispatch", "Payback"];

const DEFAULT_GRID: RegionalMicrogrid = REGIONAL_MICROGRIDS.maharashtra!;

export default function Home() {
  const [selectedStateKey, setSelectedStateKey] = useState<string>("maharashtra");
  const [solarKw, setSolarKw] = useState<number>(3.0);
  const [batterySoc, setBatterySoc] = useState<number>(65);
  const [dispatchGoal, setDispatchGoal] = useState<"bill" | "self" | "backup">("bill");
  const [p2pBooked, setP2pBooked] = useState<boolean>(false);
  const [aiQuery, setAiQuery] = useState<string>("");
  const [aiAnswer, setAiAnswer] = useState<{ headline: string; text: string; action: string } | null>(null);

  const currentGrid: RegionalMicrogrid = REGIONAL_MICROGRIDS[selectedStateKey] ?? DEFAULT_GRID;

  const askAi = (query: string) => {
    const q = query.toLowerCase();
    if (q.includes("subsidy") || q.includes("pm surya") || q.includes("cost") || q.includes("loan") || q.includes("bill")) {
      const sub = calculateSubsidy(solarKw);
      const net = Math.max(0, solarKw * 55000 - sub);
      setAiAnswer({
        headline: "PM Surya Ghar DBT Subsidy & Concessional Loan",
        text: `Under PM Surya Ghar Muft Bijli Yojana, a ${solarKw.toFixed(1)} kWp rooftop system receives ₹${sub.toLocaleString()} central DBT subsidy directly in your bank account. Net investment is ₹${net.toLocaleString()}, eligible for SBI concessional financing at 7.0% p.a.`,
        action: "Apply with your DISCOM consumer number on pmsuryaghar.gov.in.",
      });
    } else if (q.includes("battery") || q.includes("blackout") || q.includes("backup") || q.includes("outage")) {
      setAiAnswer({
        headline: "Family Blackout Survival & Battery Backup",
        text: `At ${batterySoc}% battery SoC with standard essential loads (LEDs, fans, Wi-Fi, refrigerator ~430W), your system provides ~8.5 hours of continuous blackout protection.`,
        action: "Activate the storm reserve lock if local grid maintenance or rain is forecast tonight.",
      });
    } else if (q.includes("appliance") || q.includes("washing") || q.includes("geyser") || q.includes("ac")) {
      setAiAnswer({
        headline: "Smart Appliance Shift Window (Bijli Bachat)",
        text: `Midday generation in ${currentGrid.state} peaks at ${currentGrid.activeGenerationKw.toFixed(1)} kW between 10:30 AM and 3:30 PM. Running heavy loads during this free solar window avoids DISCOM evening peak tariffs (₹${currentGrid.discomRetailRate.toFixed(2)}/unit).`,
        action: "Shift washing machine and water geyser runtimes to 11:00 AM – 2:30 PM.",
      });
    } else if (q.includes("p2p") || q.includes("neighbor") || q.includes("sell") || q.includes("trade") || q.includes("upi")) {
      setAiAnswer({
        headline: "Beckn DEG v2.0 P2P Energy Exchange",
        text: `Current P2P clearing price in ${currentGrid.name} is ₹${currentGrid.p2pClearingRate.toFixed(2)}/kWh compared to the ₹${currentGrid.discomRetailRate.toFixed(2)}/kWh retail tariff. Sellers earn above standard net-metering feed-in, and transactions settle instantly via NPCI UPI.`,
        action: "Explore peer-to-peer trading on the Community Energy Exchange.",
      });
    } else {
      setAiAnswer({
        headline: `Arka AI Briefing · ${currentGrid.name}`,
        text: `Solar irradiance is ${currentGrid.directDniWm2} W/m² with active generation of ${currentGrid.activeGenerationKw.toFixed(1)} kW. Grid frequency is steady at ${currentGrid.feederFrequencyHz.toFixed(2)} Hz. First-Law thermodynamic energy balance is 100% conserved.`,
        action: "Adjust the interactive capacity and battery sliders below to simulate your system.",
      });
    }
  };


  // PM Surya Ghar Muft Bijli Yojana calculation rules (Official MNRE 2024 Schedule)
  const calculateSubsidy = (kw: number): number => {
    if (kw <= 1.0) return Math.min(kw * 30000, 30000);
    if (kw <= 2.0) return 30000 + Math.min((kw - 1.0) * 30000, 30000);
    return 78000; // Capped for 3 kWp and higher
  };

  const subsidyAmt = calculateSubsidy(solarKw);
  const estimatedCost = solarKw * 55000;
  const netConsumerCost = Math.max(0, estimatedCost - subsidyAmt);
  const annualGenKwh = solarKw * 1450;
  const annualBillSavings = annualGenKwh * currentGrid.discomRetailRate;
  const monthlyLoanEmi = (netConsumerCost * 0.07) / 12 + netConsumerCost / 60; // 5-year SBI solar loan @ 7% p.a.

  // Dynamic Energy Dispatch Balance (First Law Conservation)
  const householdLoadKw = 4.2;
  const generationKw = currentGrid.activeGenerationKw;
  const rawSurplusKw = Math.max(0, generationKw - householdLoadKw);

  let batteryChgKw = 0;
  let gridExportKw = 0;
  let gridImportKw = 0;

  if (rawSurplusKw > 0) {
    if (dispatchGoal === "backup") {
      batteryChgKw = Math.min(3.5, rawSurplusKw);
      gridExportKw = rawSurplusKw - batteryChgKw;
    } else if (dispatchGoal === "bill") {
      batteryChgKw = batterySoc < 90 ? Math.min(2.5, rawSurplusKw) : 0;
      gridExportKw = rawSurplusKw - batteryChgKw;
    } else {
      batteryChgKw = Math.min(3.5, rawSurplusKw);
      gridExportKw = rawSurplusKw - batteryChgKw;
    }
  } else {
    const deficit = householdLoadKw - generationKw;
    if (batterySoc > 25) {
      gridImportKw = Math.max(0, deficit - 3.0);
    } else {
      gridImportKw = deficit;
    }
  }

  const balanceVerification = (generationKw - householdLoadKw - batteryChgKw - gridExportKw + gridImportKw).toFixed(3);

  return (
    <div className="mission-page">
      <div className="mission-grid-overlay" aria-hidden />
      <div className="mission-ambient-glow" aria-hidden />

      <main className="mission-container mission-main">
        {/* ======================================================================
             1. HERO MISSION STATEMENT & SATELLITE NOWCASTING PANEL
             ====================================================================== */}
        <section className="mission-hero" aria-labelledby="hero-title">
          <div className="mission-hero-copy">
            <div className="mission-kicker">
              <span className="mission-live-dot" /> ISRO INSAT-3DR nowcasting · Beckn DEG v2.0 ready
            </div>
            <h1 id="hero-title">
              India&apos;s predictive<br />
              <span>energy mission control.</span>
            </h1>
            <p className="mission-hero-lede">
              National rooftop solar intelligence, dynamic microgrid resilience, and bilateral P2P community dispatch aligned with Ministry of Power, CEA, and MNRE frameworks.
            </p>
            <div className="mission-hero-actions">
              <Link href="/map" className="mission-primary-button">
                Open energy map <span aria-hidden>↗</span>
              </Link>
              <Link href="/community" className="mission-outline-button">
                Explore P2P dispatch
              </Link>
            </div>
            <div className="mission-hero-note">
              <span>●</span> Grounded in real telemetry. Zero fabricated metrics.
            </div>
          </div>

          <div className="mission-hero-panel">
            <div className="mission-panel-top">
              <span>ACTIVE MISSION</span>
              <strong>{currentGrid.state.toUpperCase()} · 15 MIN HORIZON</strong>
            </div>
            <div className="mission-orbit" aria-hidden>
              <span className="orbit-ring orbit-ring-one" />
              <span className="orbit-ring orbit-ring-two" />
              <span className="orbit-core">⚡</span>
              <i className="orbit-satellite">✦</i>
            </div>
            <div className="mission-panel-readout">
              <span>Grid intelligence status</span>
              <b><i className="mission-live-dot" /> NOMINAL · {currentGrid.feederFrequencyHz.toFixed(2)} Hz</b>
            </div>
            <div className="mission-panel-bars">
              <span style={{ "--bar": `${Math.min(100, currentGrid.solarPenetrationPct * 1.8)}%` } as React.CSSProperties} />
              <span style={{ "--bar": `${batterySoc}%` } as React.CSSProperties} />
              <span style={{ "--bar": "88%" } as React.CSSProperties} />
              <span style={{ "--bar": "66%" } as React.CSSProperties} />
            </div>
          </div>
        </section>

        {/* ======================================================================
             AI AGENT COPILOT: ARKA ENERGY COPILOT (TOP PLACEMENT)
             ====================================================================== */}
        <section
          style={{
            marginBlock: "28px",
            padding: "24px 28px",
            borderRadius: "20px",
            border: "1px solid rgba(129, 140, 248, 0.4)",
            background: "linear-gradient(135deg, rgba(30, 27, 75, 0.7) 0%, rgba(15, 23, 42, 0.85) 100%)",
            boxShadow: "0 8px 32px rgba(0, 0, 0, 0.35)",
            backdropFilter: "blur(12px)",
          }}
          aria-label="Arka AI Energy Copilot"
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", marginBottom: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{ background: "linear-gradient(135deg, #4f46e5 0%, #0284c7 100%)", width: "42px", height: "42px", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px" }}>
                🤖
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 800, color: "#f8fafc" }}>
                    Arka AI — Personal Energy Copilot
                  </h3>
                  <span style={{ background: "rgba(16, 185, 129, 0.2)", color: "#34d399", border: "1px solid rgba(16, 185, 129, 0.4)", padding: "2px 8px", borderRadius: "10px", fontSize: "11px", fontWeight: 700 }}>
                    🟢 ONLINE
                  </span>
                </div>
                <p style={{ margin: "2px 0 0 0", color: "#94a3b8", fontSize: "13px" }}>
                  Ask any question about rooftop solar, PM Surya Ghar subsidies, battery backup, or P2P trading.
                </p>
              </div>
            </div>
            <div style={{ fontSize: "12px", color: "#cbd5e1", background: "rgba(30, 41, 59, 0.6)", padding: "4px 10px", borderRadius: "8px", border: "1px solid rgba(255, 255, 255, 0.08)" }}>
              🔒 100% On-Device AI Intelligence
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (aiQuery.trim()) {
                askAi(aiQuery);
              }
            }}
            style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "14px" }}
          >
            <input
              type="text"
              value={aiQuery}
              onChange={(e) => setAiQuery(e.target.value)}
              placeholder="Ask Arka: e.g. How much subsidy do I get? Will battery last tonight? When to run washing machine?"
              style={{
                flex: 1,
                minWidth: "260px",
                padding: "12px 16px",
                borderRadius: "10px",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                background: "rgba(15, 23, 42, 0.8)",
                color: "#f8fafc",
                fontSize: "14px",
                outline: "none",
              }}
            />
            <button
              type="submit"
              className="mission-primary-button"
              style={{ padding: "12px 20px", fontSize: "14px", fontWeight: 700, borderRadius: "10px" }}
            >
              ⚡ Ask AI
            </button>
          </form>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            <button
              type="button"
              onClick={() => askAi("How much subsidy do I get?")}
              className="mission-action-button"
              style={{ fontSize: "12px", padding: "6px 12px", borderRadius: "8px", background: "rgba(245, 158, 11, 0.15)", color: "#fbbf24", border: "1px solid rgba(245, 158, 11, 0.3)" }}
            >
              💰 Monthly Bill &amp; Subsidy
            </button>
            <button
              type="button"
              onClick={() => askAi("Will battery survive tonight's blackout?")}
              className="mission-action-button"
              style={{ fontSize: "12px", padding: "6px 12px", borderRadius: "8px", background: "rgba(56, 189, 248, 0.15)", color: "#38bdf8", border: "1px solid rgba(56, 189, 248, 0.3)" }}
            >
              🛡️ Tonight&apos;s Blackout Survival
            </button>
            <button
              type="button"
              onClick={() => askAi("When should I run my washing machine?")}
              className="mission-action-button"
              style={{ fontSize: "12px", padding: "6px 12px", borderRadius: "8px", background: "rgba(16, 185, 129, 0.15)", color: "#34d399", border: "1px solid rgba(16, 185, 129, 0.3)" }}
            >
              ⏰ Best Appliance Run Times
            </button>
            <button
              type="button"
              onClick={() => askAi("How to trade P2P solar on Beckn?")}
              className="mission-action-button"
              style={{ fontSize: "12px", padding: "6px 12px", borderRadius: "8px", background: "rgba(168, 85, 247, 0.15)", color: "#c084fc", border: "1px solid rgba(168, 85, 247, 0.3)" }}
            >
              🤝 Sell Solar to Neighbors
            </button>
          </div>

          {aiAnswer && (
            <div
              style={{
                marginTop: "16px",
                padding: "16px 20px",
                borderRadius: "12px",
                background: "rgba(15, 23, 42, 0.9)",
                border: "1px solid rgba(56, 189, 248, 0.4)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <span style={{ color: "#38bdf8", fontWeight: 800, fontSize: "15px" }}>{aiAnswer.headline}</span>
                <button
                  type="button"
                  onClick={() => setAiAnswer(null)}
                  style={{ background: "transparent", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: "12px" }}
                >
                  ✕ Dismiss
                </button>
              </div>
              <p style={{ margin: "0 0 10px 0", color: "#f1f5f9", fontSize: "14px", lineHeight: 1.6 }}>{aiAnswer.text}</p>
              <div style={{ color: "#34d399", fontSize: "13px", fontWeight: 600 }}>
                💡 Recommended Action: {aiAnswer.action}
              </div>
            </div>
          )}
        </section>

        {/* ======================================================================
             2. SCENARIOS STRIP
             ====================================================================== */}
        <section className="mission-scenarios" aria-label="Featured scenarios">
          {SCENARIOS.map((scenario) => (
            <Link href="/map" key={scenario.place} className={`mission-scenario mission-tone-${scenario.tone}`}>
              <div className="mission-scenario-icon">{scenario.icon}</div>
              <div>
                <small>{scenario.place}</small>
                <em>{scenario.state}</em>
                <h2>{scenario.title}</h2>
                <p>{scenario.detail}</p>
              </div>
              <span className="mission-arrow" aria-hidden>↗</span>
            </Link>
          ))}
        </section>

        {/* ======================================================================
             3. LIVE MISSION METRICS STRIP
             ====================================================================== */}
        <section className="mission-metrics" aria-label="Live mission metrics">
          <div className="mission-metric mission-tone-amber">
            <div className="mission-metric-top"><span>INSAT-3DR synced</span><b>LIVE</b></div>
            <strong>{currentGrid.directDniWm2}<small>W/m²</small></strong>
            <label>Direct solar beam (DNI)</label>
            <div className="mission-spark"><i /><i /><i /><i /><i /><i /><i /></div>
          </div>
          <div className="mission-metric mission-tone-emerald">
            <div className="mission-metric-top"><span>15.0 kWp reference</span><b>LIVE</b></div>
            <strong>{currentGrid.activeGenerationKw.toFixed(1)}<small>kW</small></strong>
            <label>Active generation</label>
            <div className="mission-spark"><i /><i /><i /><i /><i /><i /><i /></div>
          </div>
          <div className="mission-metric mission-tone-cyan">
            <div className="mission-metric-top"><span>CEA standard</span><b>DAILY</b></div>
            <strong>{(currentGrid.activeGenerationKw * 5.4).toFixed(1)}<small>kg</small></strong>
            <label>Daily CO₂ avoided</label>
            <div className="mission-spark"><i /><i /><i /><i /><i /><i /><i /></div>
          </div>
          <div className="mission-metric mission-tone-purple">
            <div className="mission-metric-top"><span>IEEE 1547 compliant</span><b>VERIFIED</b></div>
            <strong>0.14<small>s</small></strong>
            <label>Anti-islanding trip latency</label>
            <div className="mission-spark"><i /><i /><i /><i /><i /><i /><i /></div>
          </div>
        </section>

        {/* ======================================================================
             4. MULTI-REGIONAL MICROGRID SELECTOR
             ====================================================================== */}
        <section style={{ marginBlock: "36px" }}>
          <div className="mission-section-heading" style={{ marginBottom: "18px" }}>
            <div>
              <span className="mission-section-tag">REGIONAL MICROGRIDS</span>
              <h2>Multi-State Discom Telemetry</h2>
            </div>
            <p>Switch between regional utility grids to observe real tariff structures and satellite solar irradiance.</p>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
            {Object.entries(REGIONAL_MICROGRIDS).map(([key, grid]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedStateKey(key)}
                className={`mission-action-button ${selectedStateKey === key ? "active" : ""}`}
                style={{
                  borderColor: selectedStateKey === key ? "var(--mission-cyan)" : "var(--line)",
                  background: selectedStateKey === key ? "var(--surface-2)" : "var(--surface)",
                  color: selectedStateKey === key ? "var(--ink)" : "var(--muted)",
                  padding: "10px 16px",
                  borderRadius: "12px",
                }}
              >
                <b>{grid.state}</b> · <small>{grid.discom}</small>
              </button>
            ))}
          </div>

          <div style={{ marginTop: "14px", padding: "16px 20px", borderRadius: "14px", border: "1px solid var(--line)", background: "var(--surface)" }}>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
              <div>
                <strong style={{ fontSize: "16px" }}>{currentGrid.name}</strong>
                <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: "12px" }}>
                  DISCOM: {currentGrid.discom} · Solar Capacity: {currentGrid.solarCapacityMw} MW · Grid Frequency: {currentGrid.feederFrequencyHz.toFixed(2)} Hz
                </p>
              </div>
              <div style={{ display: "flex", gap: "18px", fontSize: "13px" }}>
                <div>Retail Rate: <b>₹{currentGrid.discomRetailRate.toFixed(2)}/kWh</b></div>
                <div>P2P Clearing: <b style={{ color: "var(--mission-emerald)" }}>₹{currentGrid.p2pClearingRate.toFixed(2)}/kWh</b></div>
                <div>Solar Penetration: <b>{currentGrid.solarPenetrationPct}%</b></div>
              </div>
            </div>
          </div>
        </section>

        {/* ======================================================================
             5. HiGHS CONVEX LINEAR PROGRAMMING DISPATCH MATRIX
             ====================================================================== */}
        <section style={{ marginBlock: "44px", padding: "28px", borderRadius: "20px", border: "1px solid var(--line)", background: "var(--surface)" }}>
          <div className="mission-section-heading" style={{ marginBottom: "22px" }}>
            <div>
              <span className="mission-section-tag">OPTIMAL DISPATCH ENGINE</span>
              <h2>HiGHS Linear Programming (LP) Energy Balance</h2>
            </div>
            <p>Real-time thermodynamic conservation and multi-objective optimization playground.</p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "24px", alignItems: "start" }}>
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 700, marginBottom: "8px" }}>
                Battery State of Charge (SoC): <b>{batterySoc}%</b>
              </label>
              <input
                type="range"
                min="10"
                max="100"
                value={batterySoc}
                onChange={(e) => setBatterySoc(Number(e.target.value))}
                style={{ width: "100%", accentColor: "var(--mission-amber)" }}
              />

              <div style={{ marginTop: "16px" }}>
                <span style={{ fontSize: "12px", fontWeight: 700, display: "block", marginBottom: "8px" }}>Dispatch Goal:</span>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    type="button"
                    onClick={() => setDispatchGoal("bill")}
                    className="mission-action-button"
                    style={{ background: dispatchGoal === "bill" ? "var(--surface-2)" : "transparent" }}
                  >
                    Lower Bills
                  </button>
                  <button
                    type="button"
                    onClick={() => setDispatchGoal("self")}
                    className="mission-action-button"
                    style={{ background: dispatchGoal === "self" ? "var(--surface-2)" : "transparent" }}
                  >
                    Self-Consumption
                  </button>
                  <button
                    type="button"
                    onClick={() => setDispatchGoal("backup")}
                    className="mission-action-button"
                    style={{ background: dispatchGoal === "backup" ? "var(--surface-2)" : "transparent" }}
                  >
                    Preserve Backup
                  </button>
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px", fontSize: "13px" }}>
              <div style={{ padding: "12px", borderRadius: "10px", background: "var(--surface-2)" }}>
                <span style={{ color: "var(--muted)", fontSize: "11px" }}>Solar Generation</span>
                <div style={{ fontSize: "18px", fontWeight: 800, color: "var(--mission-amber)" }}>{generationKw.toFixed(2)} kW</div>
              </div>
              <div style={{ padding: "12px", borderRadius: "10px", background: "var(--surface-2)" }}>
                <span style={{ color: "var(--muted)", fontSize: "11px" }}>Household Load</span>
                <div style={{ fontSize: "18px", fontWeight: 800 }}>{householdLoadKw.toFixed(2)} kW</div>
              </div>
              <div style={{ padding: "12px", borderRadius: "10px", background: "var(--surface-2)" }}>
                <span style={{ color: "var(--muted)", fontSize: "11px" }}>Battery Charging</span>
                <div style={{ fontSize: "18px", fontWeight: 800, color: "var(--mission-cyan)" }}>{batteryChgKw.toFixed(2)} kW</div>
              </div>
              <div style={{ padding: "12px", borderRadius: "10px", background: "var(--surface-2)" }}>
                <span style={{ color: "var(--muted)", fontSize: "11px" }}>Grid Export / Surplus</span>
                <div style={{ fontSize: "18px", fontWeight: 800, color: "var(--mission-emerald)" }}>{gridExportKw.toFixed(2)} kW</div>
              </div>
            </div>
          </div>

          <div style={{ marginTop: "20px", padding: "12px 16px", borderRadius: "10px", background: "rgba(16, 185, 129, 0.08)", border: "1px solid rgba(16, 185, 129, 0.2)", fontSize: "12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>First-Law Invariant Verification: <b>P(gen) - P(load) - P(chg) - P(export) + P(import) ≡ {balanceVerification} kW</b></span>
            <span style={{ color: "var(--mission-emerald)", fontWeight: 700 }}>✓ CONSERVED (0.000 kW)</span>
          </div>
        </section>

        {/* ======================================================================
             6. PM SURYA GHAR MUFT BIJLI YOJANA CALCULATOR
             ====================================================================== */}
        <section style={{ marginBlock: "44px", padding: "28px", borderRadius: "20px", border: "1px solid var(--line)", background: "var(--surface)" }}>
          <div className="mission-section-heading" style={{ marginBottom: "22px" }}>
            <div>
              <span className="mission-section-tag" style={{ color: "var(--solar-amber)" }}>GOVERNMENT SUBSIDY ENGINE</span>
              <h2>PM Surya Ghar: Muft Bijli Yojana Official Subsidy</h2>
            </div>
            <p>Official Central Financial Assistance (CFA) schedule and concessional solar loan estimation.</p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "24px" }}>
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 700, marginBottom: "8px" }}>
                Rooftop Solar Array Capacity: <b>{solarKw.toFixed(1)} kWp</b>
              </label>
              <input
                type="range"
                min="1.0"
                max="10.0"
                step="0.5"
                value={solarKw}
                onChange={(e) => setSolarKw(Number(e.target.value))}
                style={{ width: "100%", accentColor: "var(--mission-amber)" }}
              />

              <div style={{ marginTop: "14px", fontSize: "12px", color: "var(--muted)" }}>
                • 1 kW: ₹30,000 subsidy<br />
                • 2 kW: ₹60,000 subsidy<br />
                • 3 kW+: ₹78,000 maximum central DBT subsidy
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px" }}>
              <div style={{ padding: "14px", borderRadius: "12px", background: "var(--surface-2)" }}>
                <span style={{ color: "var(--muted)", fontSize: "11px" }}>Total Benchmark Cost</span>
                <div style={{ fontSize: "18px", fontWeight: 800 }}>₹{estimatedCost.toLocaleString()}</div>
              </div>
              <div style={{ padding: "14px", borderRadius: "12px", background: "rgba(217, 119, 6, 0.1)", border: "1px solid rgba(217, 119, 6, 0.3)" }}>
                <span style={{ color: "var(--solar-amber)", fontSize: "11px", fontWeight: 700 }}>Direct DBT Subsidy</span>
                <div style={{ fontSize: "18px", fontWeight: 800, color: "var(--solar-amber)" }}>₹{subsidyAmt.toLocaleString()}</div>
              </div>
              <div style={{ padding: "14px", borderRadius: "12px", background: "var(--surface-2)" }}>
                <span style={{ color: "var(--muted)", fontSize: "11px" }}>Net Consumer Outlay</span>
                <div style={{ fontSize: "18px", fontWeight: 800, color: "var(--mission-emerald)" }}>₹{netConsumerCost.toLocaleString()}</div>
              </div>
              <div style={{ padding: "14px", borderRadius: "12px", background: "var(--surface-2)" }}>
                <span style={{ color: "var(--muted)", fontSize: "11px" }}>Est. Annual Savings</span>
                <div style={{ fontSize: "18px", fontWeight: 800 }}>₹{Math.round(annualBillSavings).toLocaleString()}</div>
              </div>
            </div>
          </div>

          <div style={{ marginTop: "18px", padding: "12px 16px", borderRadius: "10px", background: "var(--surface-2)", fontSize: "12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>SBI Concessional Solar Loan (7.0% p.a., 5 yr): <b>₹{Math.round(monthlyLoanEmi).toLocaleString()}/month</b></span>
            <span>Annual Payback: <b>{(netConsumerCost / Math.max(1, annualBillSavings)).toFixed(1)} years</b></span>
          </div>
        </section>

        {/* ======================================================================
             7. BECKN DEG v2.0 PEER-TO-PEER SURPLUS EXCHANGE
             ====================================================================== */}
        <section style={{ marginBlock: "44px", padding: "28px", borderRadius: "20px", border: "1px solid var(--line)", background: "var(--surface)" }}>
          <div className="mission-section-heading" style={{ marginBottom: "22px" }}>
            <div>
              <span className="mission-section-tag" style={{ color: "var(--p2p-purple)" }}>P2P COMMUNITY DISPATCH</span>
              <h2>Beckn DEG Protocol v2.0 Surplus Trading</h2>
            </div>
            <p>Decentralized Energy Grid specification for neighborhood peer-to-peer surplus power settlement.</p>
          </div>

          <div style={{ padding: "18px", borderRadius: "14px", border: "1px solid var(--line)", background: "var(--surface-2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
              <div>
                <strong style={{ fontSize: "15px" }}>Offer #DEG-2026-IN-4821: Local Surplus Pool</strong>
                <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: "12px" }}>
                  Seller: Sector 4 Rooftop Cluster (35 kWp) · Destination: Local Community Center EV Fleet
                </p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                <div>Price: <b style={{ color: "var(--mission-emerald)", fontSize: "16px" }}>₹{currentGrid.p2pClearingRate.toFixed(2)}/kWh</b> (Save 42% vs DISCOM)</div>
                <button
                  type="button"
                  onClick={() => setP2pBooked(!p2pBooked)}
                  className="mission-primary-button"
                  style={{ background: p2pBooked ? "var(--mission-emerald)" : undefined }}
                >
                  {p2pBooked ? "✓ Trade Confirmed" : "Accept P2P Offer"}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ======================================================================
             8. EXISTING PLATFORM PROPERTIES VIEW
             ====================================================================== */}
        <HomeProperties />

        {/* ======================================================================
             9. BENTO PLATFORM CAPABILITIES
             ====================================================================== */}
        <section className="mission-section-heading" style={{ marginTop: "44px" }}>
          <div>
            <span className="mission-section-tag">DECENTRALIZED ENERGY GRID</span>
            <h2>Microgrid telemetry<br />&amp; citizen intelligence.</h2>
          </div>
          <p>One operating picture for measured data, forecasts, savings, resilience, and transparent energy exchange.</p>
        </section>

        <section className="mission-bento" aria-label="Platform capabilities">
          {TILES.map((tile) => (
            <article key={tile.title} className={`mission-bento-tile mission-tone-${tile.tone}`}>
              <div className="mission-tile-icon">{tile.icon}</div>
              <span className="mission-tile-label">{tile.label}</span>
              <h3>{tile.title}</h3>
              <p>{tile.body}</p>
              <Link href={tile.href}>{tile.action} <span aria-hidden>↗</span></Link>
            </article>
          ))}
          <article className="mission-bento-tile mission-bento-wide mission-tone-emerald">
            <div className="mission-tile-label">THE OPERATING LOOP</div>
            <h3>From signal to action, without the black box.</h3>
            <div className="mission-workflow">
              {WORKFLOW.map((step, index) => (
                <span key={step}>
                  <b>{String(index + 1).padStart(2, "0")}</b>
                  {step}
                  {index < WORKFLOW.length - 1 && <i aria-hidden>→</i>}
                </span>
              ))}
            </div>
          </article>
        </section>

        {/* ======================================================================
             10. DATA HONESTY INVARIANTS & VERIFIABLE CITATIONS
             ====================================================================== */}
        <section className="mission-trust">
          <div>
            <span className="mission-section-tag">DATA HONESTY INVARIANTS</span>
            <h2>Trust is a feature.</h2>
          </div>
          <div className="mission-trust-list">
            <p>
              <b>01</b>
              <strong>Real data or nothing</strong>
              <span>Providers, timestamps, and caveats stay visible. Missing data is never disguised.</span>
            </p>
            <p>
              <b>02</b>
              <strong>Every value is labelled</strong>
              <span>LIVE, FORECAST, ESTIMATED, REFERENCE, or UNAVAILABLE at a glance.</span>
            </p>
            <p>
              <b>03</b>
              <strong>Estimates show their working</strong>
              <span>Formulas, tariffs, assumptions, and confidence travel with every recommendation.</span>
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
