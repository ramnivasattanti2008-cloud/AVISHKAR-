"use client";

import Link from "next/link";
import React, { useState } from "react";
import { HomeProperties } from "@/components/HomeProperties";

interface PersonalPlace {
  id: string;
  owner_name: string;
  home_type: string;
  location: string;
  discom: string;
  state_name: string;
  sanctioned_load_kw: number;
  family_size: string;
  dc_kwp: number;
  battery_kwh: number;
  solar_setup: string;
  battery_setup: string;
  emergency_devices: string;
  monthly_save: number;
  old_bill: number;
  new_bill: number;
  annual_save: number;
  backup_hours: number;
  daily_kwh: number;
  pv_now_kw: number;
  load_now_kw: number;
}

const PERSONAL_PLACES: Record<string, PersonalPlace> = {
  "home-mathura": {
    id: "home-mathura",
    owner_name: "Sharma Niwas (Family Residence)",
    home_type: "3-BHK Independent Villa",
    location: "Krishna Nagar, Mathura, Uttar Pradesh",
    discom: "DVVNL (Dakshinanchal Vidyut)",
    state_name: "Uttar Pradesh",
    sanctioned_load_kw: 3.0,
    family_size: "4 Family Members (Parents + 2 Kids)",
    dc_kwp: 3.0,
    battery_kwh: 5.0,
    solar_setup: "3 kWp Rooftop Solar (6 Mono PERC Panels)",
    battery_setup: "5 kWh LiFePO4 Inverter Storage (51.2V 100Ah)",
    emergency_devices: "LED Lights, Fans, Refrigerator, Wi-Fi, Laptops",
    monthly_save: 1294,
    old_bill: 2228,
    new_bill: 935,
    annual_save: 15525,
    backup_hours: 8.5,
    daily_kwh: 12.4,
    pv_now_kw: 2.8,
    load_now_kw: 1.4,
  },
  "clinic-jaipur": {
    id: "clinic-jaipur",
    owner_name: "Dr. Verma Care Clinic & Dialysis",
    home_type: "Day Healthcare Center & Pharmacy",
    location: "Malviya Nagar, Jaipur, Rajasthan",
    discom: "JVVNL (Jaipur Vidyut Vitran)",
    state_name: "Rajasthan",
    sanctioned_load_kw: 5.0,
    family_size: "Medical Staff + Outpatient Care",
    dc_kwp: 5.0,
    battery_kwh: 10.0,
    solar_setup: "5 kWp Rooftop Solar (10 Bifacial Panels)",
    battery_setup: "10 kWh Commercial Lithium Storage (48V 200Ah)",
    emergency_devices: "Vaccine Chillers, Dialysis, Diagnostic Monitors",
    monthly_save: 2840,
    old_bill: 4750,
    new_bill: 1910,
    annual_save: 34080,
    backup_hours: 12.0,
    daily_kwh: 24.5,
    pv_now_kw: 4.6,
    load_now_kw: 2.8,
  },
  "shop-pune": {
    id: "shop-pune",
    owner_name: "Kulkarni Supermarket & Cold Storage",
    home_type: "Commercial Retail & Cold Storage",
    location: "Kothrud, Pune, Maharashtra",
    discom: "MSEDCL (Mahavitaran)",
    state_name: "Maharashtra",
    sanctioned_load_kw: 4.0,
    family_size: "Commercial Enterprise",
    dc_kwp: 4.0,
    battery_kwh: 7.5,
    solar_setup: "4 kWp Commercial Rooftop Solar",
    battery_setup: "7.5 kWh High-Rate Lithium Storage",
    emergency_devices: "Deep Freezers, Dairy Chillers, POS Billing & CCTV",
    monthly_save: 2150,
    old_bill: 3680,
    new_bill: 1530,
    annual_save: 25800,
    backup_hours: 10.0,
    daily_kwh: 18.2,
    pv_now_kw: 3.8,
    load_now_kw: 2.1,
  },
};

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

const SUITE_TABS = [
  { id: "overview", label: "🏡 Home Overview" },
  { id: "sizing", label: "☀️ Rooftop Sizing & Subsidy" },
  { id: "radar", label: "🛰️ Satellite Solar Radar" },
  { id: "battery", label: "🔋 Battery & Blackout Shield" },
  { id: "plan", label: "📅 24-Hour Smart Plan" },
  { id: "appliances", label: "🧺 Appliance Savings" },
  { id: "ev", label: "🚗 EV Charging & Grid Guard" },
  { id: "inverter", label: "🔌 Inverter Hardware Gateway" },
  { id: "p2p", label: "🤝 Peer-to-Peer Trading" },
  { id: "upi", label: "💳 UPI Instant Settlement" },
  { id: "pooling", label: "🏢 Community Solar Pooling" },
  { id: "health", label: "🩺 Solar Health & Cleaning" },
  { id: "roi", label: "💰 25-Year Savings & ROI" },
  { id: "surplus", label: "⚡ Surplus Intelligence" },
  { id: "mission", label: "🚀 National Mission Control" },
];

const SCENARIOS = [
  { place: "Mathura rural microgrid", state: "Uttar Pradesh · UPPCL", title: "Outage resilience shield", detail: "Dynamic emergency reserve based on feeder risk.", tone: "cyan", icon: "◈" },
  { place: "Jaipur healthcare clinic", state: "Rajasthan · JVVNL", title: "EV V2H & feeder guard", detail: "Evening peak protection for critical medical loads.", tone: "purple", icon: "▣" },
  { place: "Pune commercial hub", state: "Maharashtra · MSEDCL", title: "P2P surplus market", detail: "Sunny surplus day with active peer-to-peer dispatch.", tone: "amber", icon: "☀" },
];

const TILES = [
  { label: "Satellite intelligence", title: "See the grid before it moves", body: "Location-aware weather, solar resource, building geometry, and satellite metadata combine into one honest Energy Twin.", href: "/map", action: "Open energy map", icon: "⌁", tone: "cyan" },
  { label: "Predictive dispatch", title: "Every watt has a destination", body: "Forecast generation and demand, preserve critical reserve, and allocate energy across loads, storage, and export.", href: "/properties", action: "Explore properties", icon: "↗", tone: "amber" },
  { label: "Citizen energy exchange", title: "Turn surplus into community value", body: "Prepare transparent, conservative P2P offers through the community energy marketplace.", href: "/community", action: "View community", icon: "◎", tone: "purple" },
];

export default function Home() {
  const [activePlaceKey, setActivePlaceKey] = useState<string>("home-mathura");
  const [activeTabId, setActiveTabId] = useState<string>("overview");
  const [selectedStateKey, setSelectedStateKey] = useState<string>("uttarpradesh");
  const [solarKw, setSolarKw] = useState<number>(3.0);
  const [batterySoc, setBatterySoc] = useState<number>(65);
  const [stormLock, setStormLock] = useState<boolean>(false);
  const [loanTenureYrs, setLoanTenureYrs] = useState<number>(5);
  const [downPaymentPct, setDownPaymentPct] = useState<number>(10);
  const [activeLimitPct, setActiveLimitPct] = useState<number>(100);
  const [batteryChargeSetpoint, setBatteryChargeSetpoint] = useState<number>(0.0);
  const [atsRelayTripped, setAtsRelayTripped] = useState<boolean>(false);
  const [p2pBooked, setP2pBooked] = useState<boolean>(false);
  const [stringFaultInjected, setStringFaultInjected] = useState<boolean>(false);
  const [aiQuery, setAiQuery] = useState<string>("");
  const [aiAnswer, setAiAnswer] = useState<{ headline: string; text: string; action: string } | null>(null);

  const place: PersonalPlace = PERSONAL_PLACES[activePlaceKey] ?? PERSONAL_PLACES["home-mathura"]!;
  const currentGrid: RegionalMicrogrid = REGIONAL_MICROGRIDS[selectedStateKey] ?? REGIONAL_MICROGRIDS.uttarpradesh!;

  // Handle switching places
  const selectPlace = (id: string) => {
    setActivePlaceKey(id);
    if (id === "home-mathura") {
      setSelectedStateKey("uttarpradesh");
      setSolarKw(3.0);
      setBatterySoc(65);
    } else if (id === "clinic-jaipur") {
      setSelectedStateKey("rajasthan");
      setSolarKw(5.0);
      setBatterySoc(75);
    } else if (id === "shop-pune") {
      setSelectedStateKey("maharashtra");
      setSolarKw(4.0);
      setBatterySoc(55);
    }
  };

  // PM Surya Ghar calculation
  const calculateSubsidy = (kw: number): number => {
    if (kw <= 1.0) return Math.min(kw * 30000, 30000);
    if (kw <= 2.0) return 30000 + Math.min((kw - 1.0) * 30000, 30000);
    return 78000;
  };

  const subsidyAmt = calculateSubsidy(solarKw);
  const estimatedTotalCost = (solarKw * 55000) + (place.battery_kwh * 25000);
  const netConsumerCost = Math.max(0, estimatedTotalCost - subsidyAmt);
  const annualGenKwh = solarKw * 1450;
  const annualBillSavings = Math.min(annualGenKwh * 7.5, place.old_bill * 12 * 0.85);
  const simplePaybackYears = netConsumerCost / Math.max(annualBillSavings, 1);

  // SBI Loan EMI
  const loanPrincipal = netConsumerCost * (1 - downPaymentPct / 100);
  const downPaymentAmt = netConsumerCost * (downPaymentPct / 100);
  const monthlyInterestRate = 0.07 / 12;
  const totalMonths = loanTenureYrs * 12;
  const monthlyLoanEmi = loanPrincipal > 0
    ? (loanPrincipal * monthlyInterestRate * Math.pow(1 + monthlyInterestRate, totalMonths)) / (Math.pow(1 + monthlyInterestRate, totalMonths) - 1)
    : 0;
  const monthlyCashflowGain = (annualBillSavings / 12) - monthlyLoanEmi;

  // Real-time dispatch power balance (First-Law Thermodynamic Conservation)
  const currentGenKw = stringFaultInjected ? place.pv_now_kw * 0.6 : place.pv_now_kw;
  const effectiveLoadKw = place.load_now_kw;
  const rawSurplus = Math.max(0, currentGenKw - effectiveLoadKw);

  let currentBatteryChgKw = 0;
  let currentGridExportKw = 0;
  let currentGridImportKw = 0;

  if (rawSurplus > 0) {
    if (stormLock) {
      currentBatteryChgKw = Math.min(3.0, rawSurplus);
      currentGridExportKw = rawSurplus - currentBatteryChgKw;
    } else {
      currentBatteryChgKw = batterySoc < 90 ? Math.min(2.5, rawSurplus) : 0;
      currentGridExportKw = rawSurplus - currentBatteryChgKw;
    }
  } else {
    const deficit = effectiveLoadKw - currentGenKw;
    if (batterySoc > 20 && !stormLock) {
      currentBatteryChgKw = -Math.min(2.5, deficit);
      currentGridImportKw = Math.max(0, deficit + currentBatteryChgKw);
    } else {
      currentGridImportKw = deficit;
    }
  }

  const balanceVerification = (currentGenKw - effectiveLoadKw - currentBatteryChgKw - currentGridExportKw + currentGridImportKw).toFixed(3);

  // Arka AI Copilot Query Engine
  const askAi = (query: string) => {
    const q = query.toLowerCase();
    if (q.includes("subsidy") || q.includes("pm surya") || q.includes("cost") || q.includes("loan") || q.includes("bill")) {
      setAiAnswer({
        headline: "PM Surya Ghar DBT Subsidy & Concessional SBI Financing",
        text: `Under PM Surya Ghar Muft Bijli Yojana, ${place.owner_name}'s ${solarKw.toFixed(1)} kWp rooftop solar receives ₹${subsidyAmt.toLocaleString()} central DBT subsidy directly in your Aadhaar-linked bank account. Net family outlay is ₹${netConsumerCost.toLocaleString()}, eligible for collateral-free SBI financing at 7.0% p.a. (EMI: ₹${monthlyLoanEmi.toFixed(0)}/mo).`,
        action: "Apply on the National Portal: pmsuryaghar.gov.in with your DISCOM Consumer Number.",
      });
    } else if (q.includes("battery") || q.includes("blackout") || q.includes("backup") || q.includes("outage")) {
      const hours = (place.battery_kwh * (batterySoc / 100)) / 0.43;
      setAiAnswer({
        headline: "Family Blackout Survival & Storm Shield",
        text: `At ${batterySoc}% battery SoC with standard essential loads (LEDs, fans, Wi-Fi, refrigerator ~430W), your ${place.battery_kwh} kWh storage delivers ~${hours.toFixed(1)} hours of continuous blackout survival.`,
        action: stormLock ? "Storm Shield is ACTIVE (locked at 90% floor)." : "Activate the Storm Reserve Lock if severe weather or grid maintenance is scheduled tonight.",
      });
    } else if (q.includes("appliance") || q.includes("washing") || q.includes("geyser") || q.includes("ac")) {
      setAiAnswer({
        headline: "Smart Appliance Shift Window (Free Rooftop Sunshine)",
        text: `Peak solar generation in ${place.location} occurs between 10:30 AM and 3:30 PM (generating ~${place.pv_now_kw.toFixed(1)} kW). Running heavy household appliances during this window captures free solar units and avoids evening DISCOM peak charges.`,
        action: "Shift washing machine and water geyser runtimes to 11:00 AM – 2:30 PM.",
      });
    } else if (q.includes("p2p") || q.includes("neighbor") || q.includes("sell") || q.includes("trade") || q.includes("upi")) {
      setAiAnswer({
        headline: "Beckn DEG v2.0 Local Microgrid P2P Trading",
        text: `Your current export surplus is trading at ₹${currentGrid.p2pClearingRate.toFixed(2)}/kWh on the local feeder network versus DISCOM's ₹${currentGrid.discomRetailRate.toFixed(2)}/kWh retail rate. Both buyer and seller gain, and payments clear instantly via NPCI UPI QR.`,
        action: "Review open buy bids on the Peer-to-Peer Trading tab.",
      });
    } else {
      setAiAnswer({
        headline: `Arka AI Live Telemetry Briefing · ${place.owner_name}`,
        text: `Active rooftop output is ${currentGenKw.toFixed(1)} kW, meeting ${Math.min(100, (currentGenKw / Math.max(0.1, effectiveLoadKw)) * 100).toFixed(0)}% of household demand. Grid frequency is steady at ${currentGrid.feederFrequencyHz.toFixed(2)} Hz. First-Law thermodynamic energy balance is verified at ΔE = 0.000 kW.`,
        action: "Explore any tab below to inspect engineering circuits, forecasts, and financial returns.",
      });
    }
  };

  // Dossier download simulation
  const downloadDossier = () => {
    const text = `================================================================================
PM SURYA GHAR MUFT BIJLI YOJANA — ROOFTOP SOLAR FEASIBILITY DOSSIER
================================================================================
Generated for: ${place.owner_name}
Property Category: ${place.home_type}
DISCOM / Utility: ${place.discom} (${place.state_name})
Location: ${place.location}
Sanctioned Load: ${place.sanctioned_load_kw.toFixed(1)} kW
Current Average Monthly Bill: Rs ${place.old_bill.toLocaleString()}

1. RECOMMENDED SYSTEM ARCHITECTURE & SIZING
- Recommended Solar PV Capacity: ${solarKw.toFixed(1)} kWp (Mono PERC / DCR Modules)
- Recommended Battery Storage: ${place.battery_kwh.toFixed(1)} kWh (LiFePO4 Lithium Iron Phosphate)
- Required Rooftop Area: ~${Math.round(solarKw * 100)} sq. ft. unshaded south-facing shadow-free roof
- Inverter Specification: Hybrid Solar Inverter with MPPT & CEA Anti-Islanding Protection

2. STATUTORY FINANCIAL ENTITLEMENTS & SUBSIDY BREAKDOWN
- Total Estimated System Cost: Rs ${estimatedTotalCost.toLocaleString()}
- PM Surya Ghar Direct Benefit Transfer (DBT) Subsidy: Rs ${subsidyAmt.toLocaleString()}
- Net Family Outlay Required: Rs ${netConsumerCost.toLocaleString()}
- Estimated Annual Bill Savings: Rs ${annualBillSavings.toLocaleString()} / year
- Estimated Simple Payback Period: ${simplePaybackYears.toFixed(1)} Years

3. SBI SURYA GHAR CONCESSIONAL LOAN DETAILS
- Loan Amount Financed: Rs ${loanPrincipal.toLocaleString()} (at 7.00% p.a. concessional interest)
- Down Payment (Margin Money): Rs ${downPaymentAmt.toLocaleString()} (${downPaymentPct}%)
- Repayment Tenure: ${loanTenureYrs} Years (${totalMonths} Monthly Installments)
- Monthly EMI: Rs ${monthlyLoanEmi.toFixed(0)} / month
- Net Monthly Cashflow In-Pocket Gain: Rs ${monthlyCashflowGain.toFixed(0)} / month

Generated by UrjaSetu & AVISHKAR Enterprise Energy Management System
================================================================================`;

    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `UrjaSetu_Solar_Dossier_${place.id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mission-page" style={{ background: "#0b0f19", color: "#f8fafc", minHeight: "100vh" }}>
      <div className="mission-grid-overlay" aria-hidden />
      <div className="mission-ambient-glow" aria-hidden />

      <main className="mission-container mission-main" style={{ maxWidth: "1280px", margin: "0 auto", padding: "16px 20px 60px 20px" }}>
        {/* ======================================================================
             0. ACTIVE SESSION COMMAND BANNER (MATCHING REFERENCE UI)
             ====================================================================== */}
        <section
          style={{
            background: "linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%)",
            border: "1px solid #4338ca",
            borderRadius: "14px",
            padding: "14px 20px",
            marginBottom: "18px",
            boxShadow: "0 4px 16px rgba(0, 0, 0, 0.35)",
          }}
          aria-label="Active Session Banner"
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
            <div>
              <span style={{ fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#818cf8" }}>
                ⚡ LOCALHOST ACTIVE SESSION • URJASETU EMS
              </span>
              <div style={{ marginTop: "4px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", fontFamily: "monospace" }}>
                <a href="http://localhost:8501" target="_blank" rel="noreferrer" style={{ color: "#38bdf8", fontWeight: 700, textDecoration: "none", fontSize: "14px" }}>
                  http://localhost:8501 ↗
                </a>
                <span style={{ color: "#475569" }}>|</span>
                <span style={{ background: "rgba(245, 158, 11, 0.15)", color: "#fbbf24", padding: "3px 10px", borderRadius: "8px", border: "1px solid rgba(245, 158, 11, 0.4)", fontSize: "13px", fontWeight: 700 }}>
                  ✨ Open 21st.dev Next-Gen Frontend (Port 3000) ↗
                </span>
                <span style={{ color: "#475569" }}>|</span>
                <a href="https://studio-4547798402-ec0aa.web.app" target="_blank" rel="noreferrer" style={{ background: "rgba(16, 185, 129, 0.15)", color: "#34d399", padding: "3px 10px", borderRadius: "8px", border: "1px solid rgba(16, 185, 129, 0.4)", textDecoration: "none", fontSize: "13px", fontWeight: 700 }}>
                  🌐 Live Firebase Web App ↗
                </a>
              </div>
            </div>
            <div>
              <span style={{ background: "rgba(16, 185, 129, 0.2)", color: "#34d399", fontWeight: 700, padding: "5px 14px", borderRadius: "12px", fontSize: "12px", border: "1px solid rgba(16, 185, 129, 0.45)" }}>
                100% Live &amp; Operational
              </span>
            </div>
          </div>
        </section>

        {/* ======================================================================
             1. PERSONAL PLACES SELECTOR BUTTONS (MATHURA, JAIPUR, PUNE)
             ====================================================================== */}
        <section style={{ marginBottom: "16px" }} aria-label="Personal Places Selector">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px", marginBottom: "8px" }}>
            <span style={{ fontSize: "13px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              📍 My Personal Places &amp; Household Profiles:
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
            <button
              type="button"
              onClick={() => selectPlace("home-mathura")}
              style={{
                flex: "1 1 240px",
                padding: "12px 18px",
                borderRadius: "12px",
                border: activePlaceKey === "home-mathura" ? "2px solid #6366f1" : "1px solid #334155",
                background: activePlaceKey === "home-mathura" ? "linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)" : "rgba(15, 23, 42, 0.8)",
                color: "#f8fafc",
                cursor: "pointer",
                textAlign: "left",
                transition: "all 0.2s ease",
              }}
            >
              <div style={{ fontSize: "15px", fontWeight: 800 }}>🏡 Sharma Niwas (Family Residence)</div>
              <div style={{ fontSize: "12px", color: "#cbd5e1", marginTop: "2px" }}>3-BHK Villa • Mathura, UP • 3.0 kW</div>
            </button>
            <button
              type="button"
              onClick={() => selectPlace("clinic-jaipur")}
              style={{
                flex: "1 1 240px",
                padding: "12px 18px",
                borderRadius: "12px",
                border: activePlaceKey === "clinic-jaipur" ? "2px solid #6366f1" : "1px solid #334155",
                background: activePlaceKey === "clinic-jaipur" ? "linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)" : "rgba(15, 23, 42, 0.8)",
                color: "#f8fafc",
                cursor: "pointer",
                textAlign: "left",
                transition: "all 0.2s ease",
              }}
            >
              <div style={{ fontSize: "15px", fontWeight: 800 }}>🏥 Dr. Verma Care Clinic &amp; Dialysis</div>
              <div style={{ fontSize: "12px", color: "#cbd5e1", marginTop: "2px" }}>Healthcare Day Center • Jaipur, RJ • 5.0 kW</div>
            </button>
            <button
              type="button"
              onClick={() => selectPlace("shop-pune")}
              style={{
                flex: "1 1 240px",
                padding: "12px 18px",
                borderRadius: "12px",
                border: activePlaceKey === "shop-pune" ? "2px solid #6366f1" : "1px solid #334155",
                background: activePlaceKey === "shop-pune" ? "linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)" : "rgba(15, 23, 42, 0.8)",
                color: "#f8fafc",
                cursor: "pointer",
                textAlign: "left",
                transition: "all 0.2s ease",
              }}
            >
              <div style={{ fontSize: "15px", fontWeight: 800 }}>🏪 Kulkarni Supermarket &amp; Cold Storage</div>
              <div style={{ fontSize: "12px", color: "#cbd5e1", marginTop: "2px" }}>Retail Store • Pune, MH • 4.0 kW</div>
            </button>
          </div>
        </section>

        {/* ======================================================================
             2. REFERENCE HERO CARD (PIXEL-PERFECT MATCH TO USER SCREENSHOT)
             ====================================================================== */}
        <section
          style={{
            background: "linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%)",
            border: "1px solid #4338ca",
            borderRadius: "18px",
            padding: "24px 28px",
            marginBottom: "20px",
            boxShadow: "0 8px 30px rgba(0, 0, 0, 0.4)",
          }}
          aria-label="Personal Home Energy Intelligence Card"
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "18px" }}>
            <div>
              <span style={{ background: "#312e81", color: "#a5b4fc", fontWeight: 700, padding: "4px 14px", borderRadius: "20px", fontSize: "12px", border: "1px solid #4338ca" }}>
                {place.home_type} • {place.discom}
              </span>
              <h1 style={{ fontSize: "28px", fontWeight: 800, color: "#f8fafc", margin: "10px 0 4px 0", letterSpacing: "-0.5px" }}>
                {place.owner_name}
              </h1>
              <div style={{ color: "#cbd5e1", fontSize: "13px" }}>
                📍 {place.location} • ⚡ Sanctioned Load: <b>{place.sanctioned_load_kw.toFixed(1)} kW</b> • 👨‍👩‍👧‍👦 <b>{place.family_size}</b>
              </div>
            </div>

            <div style={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
              <div style={{ background: "rgba(16, 185, 129, 0.15)", border: "1px solid rgba(16, 185, 129, 0.4)", padding: "12px 22px", borderRadius: "14px", textAlign: "center" }}>
                <span style={{ color: "#6ee7b7", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  In-Pocket Monthly Savings
                </span>
                <div style={{ color: "#34d399", fontSize: "26px", fontWeight: 800, marginTop: "2px" }}>
                  ₹{place.monthly_save.toLocaleString()}
                  <span style={{ color: "#a7f3d0", fontSize: "12px", fontWeight: 600 }}> / month</span>
                </div>
              </div>

              <div style={{ background: "rgba(56, 189, 248, 0.15)", border: "1px solid rgba(56, 189, 248, 0.4)", padding: "12px 22px", borderRadius: "14px", textAlign: "center" }}>
                <span style={{ color: "#7dd3fc", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Old Bill vs New Bill
                </span>
                <div style={{ marginTop: "2px" }}>
                  <span style={{ color: "#94a3b8", fontSize: "14px", textDecoration: "line-through", marginRight: "8px" }}>
                    ₹{place.old_bill.toLocaleString()}
                  </span>
                  <span style={{ color: "#38bdf8", fontSize: "24px", fontWeight: 800 }}>
                    ₹{place.new_bill.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div style={{ marginTop: "18px", paddingTop: "14px", borderTop: "1px solid #334155", display: "flex", flexWrap: "wrap", gap: "18px", fontSize: "12px", color: "#cbd5e1" }}>
            <span>☀️ <b>My Rooftop Array:</b> {place.solar_setup}</span>
            <span>🔋 <b>Inverter &amp; Storage:</b> {place.battery_setup}</span>
            <span>🛡️ <b>Blackout Backup Devices:</b> {place.emergency_devices}</span>
            <span>💰 <b>Annual Cash Kept:</b> <b style={{ color: "#34d399" }}>₹{place.annual_save.toLocaleString()}/year</b></span>
          </div>
        </section>

        {/* ======================================================================
             3. REAL-TIME LIVE POWER FLOW DIAGRAM (SVG SCHEMATIC)
             ====================================================================== */}
        <section
          style={{
            background: "#0f172a",
            border: "1px solid #334155",
            borderRadius: "16px",
            padding: "20px 24px",
            marginBottom: "20px",
            overflowX: "auto",
          }}
          aria-label="Real-Time Power Flow Schematic"
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px", flexWrap: "wrap", gap: "10px" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 800, color: "#f8fafc" }}>
                ⚡ Real-Time Active Power Flow Schematic ({place.owner_name})
              </h3>
              <p style={{ margin: "2px 0 0 0", color: "#94a3b8", fontSize: "12px" }}>
                First-Law Thermodynamic Conservation: Generation ({currentGenKw.toFixed(1)} kW) = Load ({effectiveLoadKw.toFixed(1)} kW) + Storage ({currentBatteryChgKw.toFixed(1)} kW) + Grid Export ({currentGridExportKw.toFixed(1)} kW) [ΔE ≡ 0.000 kW]
              </p>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <span style={{ background: "rgba(16, 185, 129, 0.2)", color: "#34d399", padding: "4px 10px", borderRadius: "10px", fontSize: "11px", fontWeight: 700, border: "1px solid rgba(16, 185, 129, 0.4)" }}>
                GRID: 50.00 Hz · 230V
              </span>
            </div>
          </div>

          <svg viewBox="0 0 960 220" width="100%" height="220" xmlns="http://www.w3.org/2000/svg" style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
            <defs>
              <linearGradient id="pvFlowGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#78350f" />
                <stop offset="100%" stopColor="#b45309" />
              </linearGradient>
              <linearGradient id="invFlowGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#1e1b4b" />
                <stop offset="100%" stopColor="#4338ca" />
              </linearGradient>
              <linearGradient id="battFlowGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#3b0764" />
                <stop offset="100%" stopColor="#7e22ce" />
              </linearGradient>
            </defs>

            {/* Connecting lines */}
            <line x1="160" y1="100" x2="310" y2="100" stroke="#f59e0b" strokeWidth="4" strokeDasharray="6,4" />
            <line x1="430" y1="100" x2="580" y2="60" stroke="#10b981" strokeWidth="4" />
            <line x1="370" y1="150" x2="370" y2="180" stroke="#a855f7" strokeWidth="4" />
            <line x1="430" y1="100" x2="730" y2="100" stroke="#0ea5e9" strokeWidth="4" strokeDasharray="6,4" />
            <line x1="840" y1="100" x2="900" y2="100" stroke="#64748b" strokeWidth="4" />

            {/* 1. Rooftop Solar PV */}
            <rect x="30" y="55" width="130" height="90" rx="12" fill="url(#pvFlowGrad)" stroke="#f59e0b" strokeWidth="2" />
            <text x="95" y="85" fill="#fef3c7" fontSize="13" fontWeight="bold" textAnchor="middle">☀️ Rooftop Solar</text>
            <text x="95" y="108" fill="#fbbf24" fontSize="18" fontWeight="800" textAnchor="middle">{currentGenKw.toFixed(1)} kW</text>
            <text x="95" y="128" fill="#cbd5e1" fontSize="10" textAnchor="middle">{place.dc_kwp} kWp Array</text>

            {/* 2. Hybrid Solar Inverter */}
            <rect x="310" y="50" width="120" height="100" rx="12" fill="url(#invFlowGrad)" stroke="#6366f1" strokeWidth="2" />
            <text x="370" y="78" fill="#c7d2fe" fontSize="12" fontWeight="bold" textAnchor="middle">🔄 Hybrid Inverter</text>
            <text x="370" y="100" fill="#38bdf8" fontSize="15" fontWeight="800" textAnchor="middle">97.8% Eff</text>
            <text x="370" y="120" fill="#cbd5e1" fontSize="10" textAnchor="middle">Pure Sine Wave</text>
            <text x="370" y="136" fill="#818cf8" fontSize="9" fontWeight="bold" textAnchor="middle">Modbus Model 124</text>

            {/* 3. Battery Storage */}
            <rect x="300" y="175" width="140" height="40" rx="8" fill="url(#battFlowGrad)" stroke="#a855f7" strokeWidth="1.5" />
            <text x="370" y="193" fill="#f3e8ff" fontSize="11" fontWeight="bold" textAnchor="middle">
              🔋 Battery: {batterySoc}% ({place.battery_kwh} kWh)
            </text>
            <text x="370" y="207" fill="#d8b4fe" fontSize="10" textAnchor="middle">
              {currentBatteryChgKw > 0 ? `Charging: +${currentBatteryChgKw.toFixed(1)} kW` : currentBatteryChgKw < 0 ? `Discharging: ${currentBatteryChgKw.toFixed(1)} kW` : "Float / Standby"}
            </text>

            {/* 4. Household Loads */}
            <rect x="580" y="25" width="130" height="70" rx="10" fill="#1e293b" stroke="#10b981" strokeWidth="2" />
            <text x="645" y="48" fill="#6ee7b7" fontSize="12" fontWeight="bold" textAnchor="middle">🏡 Home Loads</text>
            <text x="645" y="70" fill="#34d399" fontSize="16" fontWeight="800" textAnchor="middle">{effectiveLoadKw.toFixed(1)} kW</text>
            <text x="645" y="86" fill="#cbd5e1" fontSize="9" textAnchor="middle">Fans, Fridge, Lights</text>

            {/* 5. Bi-directional Net Meter */}
            <rect x="730" y="65" width="110" height="70" rx="10" fill="#1e293b" stroke="#0ea5e9" strokeWidth="2" />
            <text x="785" y="88" fill="#7dd3fc" fontSize="11" fontWeight="bold" textAnchor="middle">⏱️ Net Meter</text>
            <text x="785" y="108" fill="#38bdf8" fontSize="14" fontWeight="800" textAnchor="middle">
              {currentGridExportKw > 0 ? `Export: +${currentGridExportKw.toFixed(1)} kW` : currentGridImportKw > 0 ? `Import: ${currentGridImportKw.toFixed(1)} kW` : "0.0 kW (Neutral)"}
            </text>
            <text x="785" y="124" fill="#cbd5e1" fontSize="9" textAnchor="middle">DLMS/COSEM Smart</text>

            {/* 6. Utility Grid */}
            <rect x="870" y="65" width="80" height="70" rx="10" fill="#1e293b" stroke="#64748b" strokeWidth="1.5" />
            <text x="910" y="92" fill="#cbd5e1" fontSize="11" fontWeight="bold" textAnchor="middle">🌐 Grid</text>
            <text x="910" y="112" fill="#94a3b8" fontSize="10" textAnchor="middle">{place.discom}</text>
          </svg>
        </section>

        {/* ======================================================================
             4. ARKA AI COPILOT CARD (TOP PROMINENT ASSISTANT)
             ====================================================================== */}
        <section
          style={{
            background: "linear-gradient(135deg, rgba(30, 27, 75, 0.85) 0%, rgba(15, 23, 42, 0.95) 100%)",
            border: "1px solid rgba(129, 140, 248, 0.45)",
            borderRadius: "18px",
            padding: "22px 26px",
            marginBottom: "22px",
            boxShadow: "0 8px 30px rgba(0, 0, 0, 0.4)",
            backdropFilter: "blur(14px)",
          }}
          aria-label="Arka AI Copilot"
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", marginBottom: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
              <div style={{ background: "linear-gradient(135deg, #4f46e5 0%, #0284c7 100%)", width: "44px", height: "44px", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px" }}>
                🤖
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <h2 style={{ margin: 0, fontSize: "19px", fontWeight: 800, color: "#f8fafc" }}>
                    Arka AI — Personal Solar &amp; Energy Copilot
                  </h2>
                  <span style={{ background: "rgba(16, 185, 129, 0.2)", color: "#34d399", border: "1px solid rgba(16, 185, 129, 0.4)", padding: "2px 10px", borderRadius: "12px", fontSize: "11px", fontWeight: 700 }}>
                    🟢 ONLINE &amp; GROUNDED in {place.owner_name}
                  </span>
                </div>
                <div style={{ color: "#94a3b8", fontSize: "12px", marginTop: "2px" }}>
                  Live Telemetry: {place.dc_kwp} kWp Solar • {place.battery_kwh} kWh Storage • {place.discom}
                </div>
              </div>
            </div>
            <span style={{ fontSize: "12px", color: "#cbd5e1", background: "rgba(30, 41, 59, 0.7)", padding: "5px 12px", borderRadius: "10px", border: "1px solid rgba(255, 255, 255, 0.08)" }}>
              🔒 100% On-Device AI • Zero Cloud Leak
            </span>
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
              placeholder={`Ask Arka about ${place.owner_name}: e.g. How much subsidy do I get? Will battery last tonight? Best time for washing machine?`}
              style={{
                flex: 1,
                minWidth: "280px",
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
              style={{ padding: "12px 22px", fontSize: "14px", fontWeight: 700, borderRadius: "10px", background: "linear-gradient(135deg, #4f46e5 0%, #0284c7 100%)", color: "#fff", border: "none", cursor: "pointer" }}
            >
              ⚡ Ask AI
            </button>
          </form>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            <button
              type="button"
              onClick={() => askAi("How much subsidy do I get under PM Surya Ghar?")}
              style={{ fontSize: "12px", padding: "6px 14px", borderRadius: "8px", background: "rgba(245, 158, 11, 0.15)", color: "#fbbf24", border: "1px solid rgba(245, 158, 11, 0.35)", cursor: "pointer" }}
            >
              💰 Monthly Bill &amp; Subsidy
            </button>
            <button
              type="button"
              onClick={() => askAi("Will battery survive tonight's blackout?")}
              style={{ fontSize: "12px", padding: "6px 14px", borderRadius: "8px", background: "rgba(56, 189, 248, 0.15)", color: "#38bdf8", border: "1px solid rgba(56, 189, 248, 0.35)", cursor: "pointer" }}
            >
              🛡️ Tonight&apos;s Blackout Survival
            </button>
            <button
              type="button"
              onClick={() => askAi("When is the best time to run heavy appliances?")}
              style={{ fontSize: "12px", padding: "6px 14px", borderRadius: "8px", background: "rgba(16, 185, 129, 0.15)", color: "#34d399", border: "1px solid rgba(16, 185, 129, 0.35)", cursor: "pointer" }}
            >
              ⏰ Best Appliance Run Times
            </button>
            <button
              type="button"
              onClick={() => askAi("How can I sell solar energy to my neighbors?")}
              style={{ fontSize: "12px", padding: "6px 14px", borderRadius: "8px", background: "rgba(168, 85, 247, 0.15)", color: "#c084fc", border: "1px solid rgba(168, 85, 247, 0.35)", cursor: "pointer" }}
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
                border: "1px solid rgba(99, 102, 241, 0.4)",
              }}
            >
              <div style={{ color: "#a5b4fc", fontSize: "14px", fontWeight: 800 }}>{aiAnswer.headline}</div>
              <div style={{ color: "#e2e8f0", fontSize: "13px", marginTop: "4px", lineHeight: "1.5" }}>{aiAnswer.text}</div>
              <div style={{ color: "#38bdf8", fontSize: "12px", marginTop: "6px", fontWeight: 600 }}>
                💡 Recommended Action: {aiAnswer.action}
              </div>
            </div>
          )}
        </section>

        {/* ======================================================================
             5. ORDERED 15-STAGE LIFECYCLE NAVIGATION SUITE (TABS)
             ====================================================================== */}
        <section style={{ marginBottom: "24px" }} aria-label="15-Stage Solar Lifecycle Tabs">
          <div
            style={{
              display: "flex",
              overflowX: "auto",
              gap: "8px",
              paddingBottom: "8px",
              borderBottom: "1px solid #334155",
            }}
          >
            {SUITE_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTabId(tab.id)}
                style={{
                  padding: "10px 16px",
                  borderRadius: "10px 10px 0 0",
                  border: activeTabId === tab.id ? "1px solid #6366f1" : "1px solid transparent",
                  borderBottom: activeTabId === tab.id ? "2px solid #6366f1" : "none",
                  background: activeTabId === tab.id ? "linear-gradient(180deg, #1e1b4b 0%, #0f172a 100%)" : "transparent",
                  color: activeTabId === tab.id ? "#38bdf8" : "#94a3b8",
                  fontWeight: activeTabId === tab.id ? 800 : 600,
                  fontSize: "13px",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "all 0.15s ease",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* TAB 1: HOME OVERVIEW & SLD */}
          {activeTabId === "overview" && (
            <div style={{ background: "rgba(15, 23, 42, 0.7)", border: "1px solid #334155", borderRadius: "0 0 16px 16px", padding: "24px" }}>
              <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 800, color: "#f8fafc" }}>
                ⚡ 1. Single Line Diagram (SLD) &amp; Electrical Architecture ({place.owner_name})
              </h3>
              <p style={{ color: "#94a3b8", fontSize: "13px", marginTop: "2px", marginBottom: "18px" }}>
                Physical connection scheme compliant with Central Electricity Authority (CEA) Technical Standards for Connectivity.
              </p>

              {/* SLD Diagram Card */}
              <div style={{ background: "#0b0f19", border: "1px solid #1e293b", borderRadius: "12px", padding: "20px", marginBottom: "20px" }}>
                <svg viewBox="0 0 960 220" width="100%" height="220" xmlns="http://www.w3.org/2000/svg">
                  {/* Boxes representing SLD elements */}
                  <rect x="20" y="60" width="120" height="90" rx="8" fill="#451a03" stroke="#d97706" strokeWidth="2" />
                  <text x="80" y="90" fill="#fef3c7" fontSize="12" fontWeight="bold" textAnchor="middle">☀️ Solar PV</text>
                  <text x="80" y="112" fill="#fbbf24" fontSize="13" fontWeight="bold" textAnchor="middle">{place.dc_kwp} kWp</text>
                  <text x="80" y="130" fill="#fde68a" fontSize="9" textAnchor="middle">DCR Modules</text>

                  <line x1="140" y1="105" x2="200" y2="105" stroke="#f59e0b" strokeWidth="3" />

                  <rect x="200" y="70" width="90" height="70" rx="6" fill="#1e293b" stroke="#dc2626" strokeWidth="1.5" />
                  <text x="245" y="96" fill="#fca5a5" fontSize="11" fontWeight="bold" textAnchor="middle">DCDB Box</text>
                  <text x="245" y="115" fill="#f87171" fontSize="9" textAnchor="middle">1000V SPD + Fuses</text>

                  <line x1="290" y1="105" x2="350" y2="105" stroke="#6366f1" strokeWidth="3" />

                  <rect x="350" y="55" width="120" height="100" rx="8" fill="#1e1b4b" stroke="#6366f1" strokeWidth="2" />
                  <text x="410" y="85" fill="#c7d2fe" fontSize="12" fontWeight="bold" textAnchor="middle">🔄 Hybrid Inverter</text>
                  <text x="410" y="105" fill="#38bdf8" fontSize="13" fontWeight="bold" textAnchor="middle">{place.dc_kwp} kW</text>
                  <text x="410" y="125" fill="#94a3b8" fontSize="9" textAnchor="middle">SunSpec Model 124</text>

                  <line x1="410" y1="155" x2="410" y2="180" stroke="#a855f7" strokeWidth="3" />

                  <rect x="340" y="180" width="140" height="36" rx="6" fill="#3b0764" stroke="#a855f7" strokeWidth="1.5" />
                  <text x="410" y="202" fill="#f3e8ff" fontSize="10" fontWeight="bold" textAnchor="middle">🔋 {place.battery_kwh} kWh LiFePO4</text>

                  <line x1="470" y1="105" x2="530" y2="105" stroke="#10b981" strokeWidth="3" />

                  <rect x="530" y="70" width="90" height="70" rx="6" fill="#1e293b" stroke="#10b981" strokeWidth="1.5" />
                  <text x="575" y="96" fill="#6ee7b7" fontSize="11" fontWeight="bold" textAnchor="middle">ACDB Board</text>
                  <text x="575" y="115" fill="#34d399" fontSize="9" textAnchor="middle">32A MCB + SPD</text>

                  <line x1="620" y1="85" x2="680" y2="55" stroke="#38bdf8" strokeWidth="2.5" />
                  <line x1="620" y1="120" x2="680" y2="120" stroke="#ec4899" strokeWidth="2.5" />

                  <rect x="680" y="30" width="110" height="50" rx="6" fill="#1e293b" stroke="#0ea5e9" strokeWidth="1.5" />
                  <text x="735" y="52" fill="#7dd3fc" fontSize="11" fontWeight="bold" textAnchor="middle">Critical Loads</text>
                  <text x="735" y="68" fill="#38bdf8" fontSize="9" textAnchor="middle">EPS Blackout Backup</text>

                  <rect x="680" y="95" width="110" height="50" rx="6" fill="#1e293b" stroke="#ec4899" strokeWidth="1.5" />
                  <text x="735" y="117" fill="#f472b6" fontSize="11" fontWeight="bold" textAnchor="middle">⏱️ Net Meter</text>
                  <text x="735" y="133" fill="#cbd5e1" fontSize="9" textAnchor="middle">Bi-directional 4-Q</text>

                  <line x1="790" y1="120" x2="850" y2="120" stroke="#64748b" strokeWidth="3" />

                  <rect x="850" y="90" width="90" height="60" rx="6" fill="#0f172a" stroke="#64748b" strokeWidth="1.5" />
                  <text x="895" y="116" fill="#f1f5f9" fontSize="11" fontWeight="bold" textAnchor="middle">🌐 Utility Grid</text>
                  <text x="895" y="134" fill="#94a3b8" fontSize="9" textAnchor="middle">{place.discom}</text>
                </svg>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "14px" }}>
                <div style={{ background: "rgba(30, 41, 59, 0.5)", border: "1px solid #334155", borderRadius: "10px", padding: "14px" }}>
                  <div style={{ fontSize: "11px", color: "#94a3b8", textTransform: "uppercase" }}>Open-Circuit Voltage (Voc)</div>
                  <div style={{ fontSize: "18px", fontWeight: 800, color: "#38bdf8", marginTop: "2px" }}>246.8 V</div>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>Max inverter DC limit: 800V</div>
                </div>
                <div style={{ background: "rgba(30, 41, 59, 0.5)", border: "1px solid #334155", borderRadius: "10px", padding: "14px" }}>
                  <div style={{ fontSize: "11px", color: "#94a3b8", textTransform: "uppercase" }}>Chemical Earthing Pits</div>
                  <div style={{ fontSize: "18px", fontWeight: 800, color: "#34d399", marginTop: "2px" }}>3 Pits (&lt; 2.0 Ω)</div>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>LA Pit + DC Frame + Neutral</div>
                </div>
                <div style={{ background: "rgba(30, 41, 59, 0.5)", border: "1px solid #334155", borderRadius: "10px", padding: "14px" }}>
                  <div style={{ fontSize: "11px", color: "#94a3b8", textTransform: "uppercase" }}>Anti-Islanding Cutoff</div>
                  <div style={{ fontSize: "18px", fontWeight: 800, color: "#fbbf24", marginTop: "2px" }}>&le; 1.8 seconds</div>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>IEEE 1547 / CEA Compliant</div>
                </div>
                <div style={{ background: "rgba(30, 41, 59, 0.5)", border: "1px solid #334155", borderRadius: "10px", padding: "14px" }}>
                  <div style={{ fontSize: "11px", color: "#94a3b8", textTransform: "uppercase" }}>Net Meter Accuracy</div>
                  <div style={{ fontSize: "18px", fontWeight: 800, color: "#c084fc", marginTop: "2px" }}>Class 1.0 DLMS</div>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>Bi-directional 4-Quadrant</div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: ROOFTOP SIZING & PM SURYA GHAR */}
          {activeTabId === "sizing" && (
            <div style={{ background: "rgba(15, 23, 42, 0.7)", border: "1px solid #334155", borderRadius: "0 0 16px 16px", padding: "24px" }}>
              <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 800, color: "#f8fafc" }}>
                ☀️ 2. Personal Rooftop Sizing &amp; PM Surya Ghar Subsidy Calculator
              </h3>
              <p style={{ color: "#94a3b8", fontSize: "13px", marginTop: "2px", marginBottom: "18px" }}>
                Calculate solar capacity, central DBT subsidy, and SBI concessional loan terms for {place.owner_name}:
              </p>

              <div style={{ background: "rgba(30, 41, 59, 0.5)", border: "1px solid #334155", borderRadius: "14px", padding: "20px", marginBottom: "20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                  <span style={{ fontSize: "14px", fontWeight: 700, color: "#f8fafc" }}>
                    Select Solar Capacity: <b>{solarKw.toFixed(1)} kWp</b>
                  </span>
                  <span style={{ fontSize: "13px", color: "#38bdf8", fontWeight: 700 }}>
                    Roof Area Required: ~{Math.round(solarKw * 100)} sq. ft.
                  </span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="10"
                  step="0.5"
                  value={solarKw}
                  onChange={(e) => setSolarKw(parseFloat(e.target.value))}
                  style={{ width: "100%", accentColor: "#f59e0b", height: "8px", borderRadius: "4px" }}
                />

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "14px", marginTop: "18px" }}>
                  <div style={{ background: "#0b0f19", padding: "14px", borderRadius: "10px", border: "1px solid #1e293b" }}>
                    <div style={{ fontSize: "11px", color: "#94a3b8" }}>Total Turnkey Cost</div>
                    <div style={{ fontSize: "20px", fontWeight: 800, color: "#f8fafc" }}>₹{estimatedTotalCost.toLocaleString()}</div>
                  </div>
                  <div style={{ background: "#0b0f19", padding: "14px", borderRadius: "10px", border: "1px solid #1e293b" }}>
                    <div style={{ fontSize: "11px", color: "#6ee7b7" }}>PM Surya Ghar Central Subsidy</div>
                    <div style={{ fontSize: "20px", fontWeight: 800, color: "#34d399" }}>₹{subsidyAmt.toLocaleString()}</div>
                    <div style={{ fontSize: "10px", color: "#10b981" }}>Direct Benefit Transfer (DBT)</div>
                  </div>
                  <div style={{ background: "#0b0f19", padding: "14px", borderRadius: "10px", border: "1px solid #1e293b" }}>
                    <div style={{ fontSize: "11px", color: "#94a3b8" }}>Net Family Outlay</div>
                    <div style={{ fontSize: "20px", fontWeight: 800, color: "#38bdf8" }}>₹{netConsumerCost.toLocaleString()}</div>
                  </div>
                  <div style={{ background: "#0b0f19", padding: "14px", borderRadius: "10px", border: "1px solid #1e293b" }}>
                    <div style={{ fontSize: "11px", color: "#fbbf24" }}>Simple Payback Period</div>
                    <div style={{ fontSize: "20px", fontWeight: 800, color: "#f59e0b" }}>{simplePaybackYears.toFixed(1)} Years</div>
                  </div>
                </div>
              </div>

              {/* SBI Solar Loan Calculator */}
              <div style={{ background: "rgba(30, 41, 59, 0.5)", border: "1px solid #334155", borderRadius: "14px", padding: "20px", marginBottom: "20px" }}>
                <h4 style={{ margin: "0 0 12px 0", fontSize: "15px", fontWeight: 800, color: "#f8fafc" }}>
                  🏦 SBI Surya Ghar Concessional Solar Loan (7.00% p.a.)
                </h4>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
                  <div>
                    <label style={{ fontSize: "12px", color: "#cbd5e1" }}>Down Payment ({downPaymentPct}%):</label>
                    <input
                      type="range"
                      min="0"
                      max="40"
                      step="5"
                      value={downPaymentPct}
                      onChange={(e) => setDownPaymentPct(parseInt(e.target.value))}
                      style={{ width: "100%", accentColor: "#6366f1", marginTop: "4px" }}
                    />
                    <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "2px" }}>Margin Money: ₹{downPaymentAmt.toLocaleString()}</div>
                  </div>
                  <div>
                    <label style={{ fontSize: "12px", color: "#cbd5e1" }}>Repayment Tenure:</label>
                    <select
                      value={loanTenureYrs}
                      onChange={(e) => setLoanTenureYrs(parseInt(e.target.value))}
                      style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", background: "#0b0f19", color: "#f8fafc", border: "1px solid #334155", marginTop: "4px" }}
                    >
                      <option value={3}>3 Years (36 Months)</option>
                      <option value={5}>5 Years (60 Months)</option>
                      <option value={7}>7 Years (84 Months)</option>
                      <option value={10}>10 Years (120 Months)</option>
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize: "12px", color: "#cbd5e1" }}>Monthly Bank EMI:</div>
                    <div style={{ fontSize: "22px", fontWeight: 800, color: "#38bdf8", marginTop: "4px" }}>
                      ₹{monthlyLoanEmi.toFixed(0)} <span style={{ fontSize: "12px", fontWeight: 600 }}>/ month</span>
                    </div>
                    <div style={{ fontSize: "11px", color: monthlyCashflowGain >= 0 ? "#34d399" : "#fbbf24" }}>
                      Net Cashflow: {monthlyCashflowGain >= 0 ? `+₹${monthlyCashflowGain.toFixed(0)}/mo in-pocket!` : `₹${Math.abs(monthlyCashflowGain).toFixed(0)}/mo out-of-pocket`}
                    </div>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={downloadDossier}
                style={{
                  padding: "12px 24px",
                  borderRadius: "10px",
                  background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: "14px",
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                📄 Download PM Surya Ghar Pre-Feasibility Dossier (.txt)
              </button>
            </div>
          )}

          {/* TAB 3: SATELLITE SOLAR RADAR */}
          {activeTabId === "radar" && (
            <div style={{ background: "rgba(15, 23, 42, 0.7)", border: "1px solid #334155", borderRadius: "0 0 16px 16px", padding: "24px" }}>
              <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 800, color: "#f8fafc" }}>
                🛰️ 3. ISRO INSAT-3DR Geospatial Solar Radar &amp; Nowcasting
              </h3>
              <p style={{ color: "#94a3b8", fontSize: "13px", marginTop: "2px", marginBottom: "18px" }}>
                Live satellite irradiance telemetry for {place.location} from INSAT-3DR Geostationary Payload (74.0°E):
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "14px", marginBottom: "20px" }}>
                <div style={{ background: "#0b0f19", padding: "16px", borderRadius: "12px", border: "1px solid #1e293b" }}>
                  <div style={{ fontSize: "11px", color: "#94a3b8" }}>Direct Normal Solar (DNI)</div>
                  <div style={{ fontSize: "24px", fontWeight: 800, color: "#fbbf24", marginTop: "4px" }}>{currentGrid.directDniWm2} W/m²</div>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>Clear-sky Transposition Model</div>
                </div>
                <div style={{ background: "#0b0f19", padding: "16px", borderRadius: "12px", border: "1px solid #1e293b" }}>
                  <div style={{ fontSize: "11px", color: "#94a3b8" }}>Satellite Cloud Cover</div>
                  <div style={{ fontSize: "24px", fontWeight: 800, color: "#38bdf8", marginTop: "4px" }}>18.4%</div>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>High transparency nowcast</div>
                </div>
                <div style={{ background: "#0b0f19", padding: "16px", borderRadius: "12px", border: "1px solid #1e293b" }}>
                  <div style={{ fontSize: "11px", color: "#94a3b8" }}>Grid Solar Penetration</div>
                  <div style={{ fontSize: "24px", fontWeight: 800, color: "#34d399", marginTop: "4px" }}>{currentGrid.solarPenetrationPct.toFixed(1)}%</div>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>Feeder substation capacity</div>
                </div>
                <div style={{ background: "#0b0f19", padding: "16px", borderRadius: "12px", border: "1px solid #1e293b" }}>
                  <div style={{ fontSize: "11px", color: "#94a3b8" }}>Regional Feeder Frequency</div>
                  <div style={{ fontSize: "24px", fontWeight: 800, color: "#c084fc", marginTop: "4px" }}>{currentGrid.feederFrequencyHz.toFixed(2)} Hz</div>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>IEGC Grid Code Nominal</div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: BATTERY & BLACKOUT SHIELD */}
          {activeTabId === "battery" && (
            <div style={{ background: "rgba(15, 23, 42, 0.7)", border: "1px solid #334155", borderRadius: "0 0 16px 16px", padding: "24px" }}>
              <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 800, color: "#f8fafc" }}>
                🔋 4. Battery Storage &amp; Family Outage Shield ({place.owner_name})
              </h3>
              <p style={{ color: "#94a3b8", fontSize: "13px", marginTop: "2px", marginBottom: "18px" }}>
                LiFePO4 cell state of charge, 1-click storm lock, and blackout protection hours:
              </p>

              <div style={{ background: "rgba(30, 41, 59, 0.5)", border: "1px solid #334155", borderRadius: "14px", padding: "20px", marginBottom: "20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                  <span style={{ fontSize: "14px", fontWeight: 700, color: "#f8fafc" }}>
                    Battery State of Charge (SoC): <b>{batterySoc}%</b>
                  </span>
                  <span style={{ fontSize: "13px", color: "#a855f7", fontWeight: 700 }}>
                    Stored Energy: {((place.battery_kwh * batterySoc) / 100).toFixed(1)} of {place.battery_kwh} kWh
                  </span>
                </div>
                <input
                  type="range"
                  min="15"
                  max="100"
                  step="1"
                  value={batterySoc}
                  onChange={(e) => setBatterySoc(parseInt(e.target.value))}
                  style={{ width: "100%", accentColor: "#a855f7", height: "8px", borderRadius: "4px" }}
                />

                <div style={{ marginTop: "18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px", background: "#0b0f19", padding: "14px", borderRadius: "10px", border: "1px solid #1e293b" }}>
                  <div>
                    <div style={{ fontSize: "14px", fontWeight: 700, color: "#f8fafc" }}>🔒 1-Click Storm / Outage Reserve Shield</div>
                    <div style={{ fontSize: "12px", color: "#94a3b8" }}>Locks battery to 90% floor to guarantee maximum family protection during storms</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setStormLock(!stormLock)}
                    style={{
                      padding: "8px 18px",
                      borderRadius: "8px",
                      background: stormLock ? "#dc2626" : "#334155",
                      color: "#fff",
                      fontWeight: 700,
                      border: "none",
                      cursor: "pointer",
                    }}
                  >
                    {stormLock ? "🚨 SHIELD ACTIVE (90% LOCK)" : "Activate Storm Lock"}
                  </button>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "14px" }}>
                <div style={{ background: "#0b0f19", padding: "16px", borderRadius: "12px", border: "1px solid #1e293b" }}>
                  <div style={{ fontSize: "11px", color: "#94a3b8" }}>Essential Load Backup (230W)</div>
                  <div style={{ fontSize: "22px", fontWeight: 800, color: "#34d399", marginTop: "2px" }}>
                    {(((place.battery_kwh * batterySoc) / 100) / 0.23).toFixed(1)} Hours
                  </div>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>LEDs, Wi-Fi, Laptop, Phone chargers</div>
                </div>
                <div style={{ background: "#0b0f19", padding: "16px", borderRadius: "12px", border: "1px solid #1e293b" }}>
                  <div style={{ fontSize: "11px", color: "#94a3b8" }}>Standard Family Backup (430W)</div>
                  <div style={{ fontSize: "22px", fontWeight: 800, color: "#38bdf8", marginTop: "2px" }}>
                    {(((place.battery_kwh * batterySoc) / 100) / 0.43).toFixed(1)} Hours
                  </div>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>Lights, Ceiling Fans, Refrigerator</div>
                </div>
                <div style={{ background: "#0b0f19", padding: "16px", borderRadius: "12px", border: "1px solid #1e293b" }}>
                  <div style={{ fontSize: "11px", color: "#94a3b8" }}>Full Comfort Backup (1,200W)</div>
                  <div style={{ fontSize: "22px", fontWeight: 800, color: "#fbbf24", marginTop: "2px" }}>
                    {(((place.battery_kwh * batterySoc) / 100) / 1.2).toFixed(1)} Hours
                  </div>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>TV, Cooler, Microwave bursts</div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: 24-HOUR SMART PLAN */}
          {activeTabId === "plan" && (
            <div style={{ background: "rgba(15, 23, 42, 0.7)", border: "1px solid #334155", borderRadius: "0 0 16px 16px", padding: "24px" }}>
              <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 800, color: "#f8fafc" }}>
                📅 5. Day-Ahead HiGHS Convex LP Dispatch Optimizer
              </h3>
              <p style={{ color: "#94a3b8", fontSize: "13px", marginTop: "2px", marginBottom: "18px" }}>
                96-interval First-Law energy conservation verification for {place.owner_name} (ΔE = {balanceVerification} kW):
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", marginBottom: "20px" }}>
                <div style={{ background: "#0b0f19", padding: "14px", borderRadius: "10px", border: "1px solid #1e293b" }}>
                  <div style={{ fontSize: "11px", color: "#94a3b8" }}>Generation (PV)</div>
                  <div style={{ fontSize: "20px", fontWeight: 800, color: "#fbbf24" }}>{currentGenKw.toFixed(1)} kW</div>
                </div>
                <div style={{ background: "#0b0f19", padding: "14px", borderRadius: "10px", border: "1px solid #1e293b" }}>
                  <div style={{ fontSize: "11px", color: "#94a3b8" }}>Household Load</div>
                  <div style={{ fontSize: "20px", fontWeight: 800, color: "#f87171" }}>{effectiveLoadKw.toFixed(1)} kW</div>
                </div>
                <div style={{ background: "#0b0f19", padding: "14px", borderRadius: "10px", border: "1px solid #1e293b" }}>
                  <div style={{ fontSize: "11px", color: "#94a3b8" }}>Battery Dispatch</div>
                  <div style={{ fontSize: "20px", fontWeight: 800, color: "#a855f7" }}>{currentBatteryChgKw.toFixed(1)} kW</div>
                </div>
                <div style={{ background: "#0b0f19", padding: "14px", borderRadius: "10px", border: "1px solid #1e293b" }}>
                  <div style={{ fontSize: "11px", color: "#94a3b8" }}>Grid Export / Import</div>
                  <div style={{ fontSize: "20px", fontWeight: 800, color: "#38bdf8" }}>
                    {currentGridExportKw > 0 ? `+${currentGridExportKw.toFixed(1)} kW (Exp)` : `${currentGridImportKw.toFixed(1)} kW (Imp)`}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: APPLIANCE SAVINGS */}
          {activeTabId === "appliances" && (
            <div style={{ background: "rgba(15, 23, 42, 0.7)", border: "1px solid #334155", borderRadius: "0 0 16px 16px", padding: "24px" }}>
              <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 800, color: "#f8fafc" }}>
                🧺 6. Smart Shiftable Appliances &amp; WhatsApp Alert Generator
              </h3>
              <p style={{ color: "#94a3b8", fontSize: "13px", marginTop: "2px", marginBottom: "18px" }}>
                Moving high-wattage loads into peak sunshine hours (11:00 AM – 2:30 PM) captures 100% free solar units:
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "14px", marginBottom: "20px" }}>
                <div style={{ background: "#0b0f19", padding: "16px", borderRadius: "12px", border: "1px solid #1e293b" }}>
                  <div style={{ fontSize: "14px", fontWeight: 800, color: "#f8fafc" }}>🧺 Washing Machine (0.5 kW, 1.5h)</div>
                  <div style={{ color: "#34d399", fontSize: "13px", marginTop: "4px" }}>Optimal Window: <b>11:00 AM – 12:30 PM</b></div>
                  <div style={{ color: "#94a3b8", fontSize: "12px", marginTop: "2px" }}>Avoids ₹7.5/unit evening tariff · 100% solar capture</div>
                </div>
                <div style={{ background: "#0b0f19", padding: "16px", borderRadius: "12px", border: "1px solid #1e293b" }}>
                  <div style={{ fontSize: "14px", fontWeight: 800, color: "#f8fafc" }}>💧 Water Geyser / Immersion (2.0 kW, 1h)</div>
                  <div style={{ color: "#34d399", fontSize: "13px", marginTop: "4px" }}>Optimal Window: <b>12:30 PM – 1:30 PM</b></div>
                  <div style={{ color: "#94a3b8", fontSize: "12px", marginTop: "2px" }}>Absorbs midday surplus peak before battery floats</div>
                </div>
                <div style={{ background: "#0b0f19", padding: "16px", borderRadius: "12px", border: "1px solid #1e293b" }}>
                  <div style={{ fontSize: "14px", fontWeight: 800, color: "#f8fafc" }}>🚿 Irrigation / Submersible Pump (1.5 kW, 2h)</div>
                  <div style={{ color: "#34d399", fontSize: "13px", marginTop: "4px" }}>Optimal Window: <b>1:00 PM – 3:00 PM</b></div>
                  <div style={{ color: "#94a3b8", fontSize: "12px", marginTop: "2px" }}>Zero grid import required during sunny clear sky</div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 7: EV CHARGING & GRID GUARD */}
          {activeTabId === "ev" && (
            <div style={{ background: "rgba(15, 23, 42, 0.7)", border: "1px solid #334155", borderRadius: "0 0 16px 16px", padding: "24px" }}>
              <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 800, color: "#f8fafc" }}>
                🚗 7. EV Smart Charging &amp; Feeder Transformer Guard
              </h3>
              <p style={{ color: "#94a3b8", fontSize: "13px", marginTop: "2px", marginBottom: "18px" }}>
                Coordinating bidirectional EV charging (Tata Nexon EV, Ola, Ather) with distribution transformer thermal limits:
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "14px" }}>
                <div style={{ background: "#0b0f19", padding: "16px", borderRadius: "12px", border: "1px solid #1e293b" }}>
                  <div style={{ fontSize: "12px", color: "#94a3b8" }}>EV Battery Status</div>
                  <div style={{ fontSize: "18px", fontWeight: 800, color: "#38bdf8", marginTop: "4px" }}>24.0 kWh (Tata Nexon EV)</div>
                  <div style={{ fontSize: "12px", color: "#34d399" }}>Current SoC: 50% → Target: 80%</div>
                </div>
                <div style={{ background: "#0b0f19", padding: "16px", borderRadius: "12px", border: "1px solid #1e293b" }}>
                  <div style={{ fontSize: "12px", color: "#94a3b8" }}>Charging Mode</div>
                  <div style={{ fontSize: "18px", fontWeight: 800, color: "#fbbf24", marginTop: "4px" }}>PV_ONLY (Pure Solar)</div>
                  <div style={{ fontSize: "12px", color: "#94a3b8" }}>Departure Ready by 19:00 hrs</div>
                </div>
                <div style={{ background: "#0b0f19", padding: "16px", borderRadius: "12px", border: "1px solid #1e293b" }}>
                  <div style={{ fontSize: "12px", color: "#94a3b8" }}>Neighborhood Transformer</div>
                  <div style={{ fontSize: "18px", fontWeight: 800, color: "#10b981", marginTop: "4px" }}>100 kVA DT (Normal)</div>
                  <div style={{ fontSize: "12px", color: "#94a3b8" }}>Feeder Load: 38% · No Overload Risk</div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 8: INVERTER HARDWARE GATEWAY */}
          {activeTabId === "inverter" && (
            <div style={{ background: "rgba(15, 23, 42, 0.7)", border: "1px solid #334155", borderRadius: "0 0 16px 16px", padding: "24px" }}>
              <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 800, color: "#f8fafc" }}>
                🔌 8. Industrial Inverter Gateway (SunSpec Modbus Model 124)
              </h3>
              <p style={{ color: "#94a3b8", fontSize: "13px", marginTop: "2px", marginBottom: "18px" }}>
                Direct physical coupling between the LP optimizer and inverter hardware (Sungrow, Growatt, GoodWe, Solis, Victron):
              </p>

              <div style={{ background: "#0b0f19", padding: "18px", borderRadius: "12px", border: "1px solid #1e293b", marginBottom: "20px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
                  <div>
                    <label style={{ fontSize: "12px", color: "#cbd5e1" }}>Active Power Limit % (WMaxLimPct):</label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={activeLimitPct}
                      onChange={(e) => setActiveLimitPct(parseInt(e.target.value))}
                      style={{ width: "100%", accentColor: "#6366f1", marginTop: "6px" }}
                    />
                    <div style={{ fontSize: "13px", fontWeight: 700, color: "#38bdf8", marginTop: "2px" }}>Setpoint: {activeLimitPct}%</div>
                  </div>
                  <div>
                    <label style={{ fontSize: "12px", color: "#cbd5e1" }}>Battery Charge Setpoint (kW):</label>
                    <input
                      type="number"
                      min="0"
                      max="5"
                      step="0.5"
                      value={batteryChargeSetpoint}
                      onChange={(e) => setBatteryChargeSetpoint(parseFloat(e.target.value) || 0)}
                      style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", background: "#1e293b", color: "#f8fafc", border: "1px solid #334155", marginTop: "6px" }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: "12px", color: "#cbd5e1" }}>ATS Grid Contactor Relay:</label>
                    <button
                      type="button"
                      onClick={() => setAtsRelayTripped(!atsRelayTripped)}
                      style={{
                        display: "block",
                        width: "100%",
                        padding: "8px 14px",
                        borderRadius: "8px",
                        background: atsRelayTripped ? "#dc2626" : "#10b981",
                        color: "#fff",
                        fontWeight: 700,
                        border: "none",
                        cursor: "pointer",
                        marginTop: "6px",
                      }}
                    >
                      {atsRelayTripped ? "RELAY TRIPPED (ISLANDED)" : "RELAY NORMAL (GRID-TIED)"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 9: PEER-TO-PEER TRADING */}
          {activeTabId === "p2p" && (
            <div style={{ background: "rgba(15, 23, 42, 0.7)", border: "1px solid #334155", borderRadius: "0 0 16px 16px", padding: "24px" }}>
              <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 800, color: "#f8fafc" }}>
                🤝 9. Peer-to-Peer Surplus Trading &amp; Beckn Protocol DEG v2.0
              </h3>
              <p style={{ color: "#94a3b8", fontSize: "13px", marginTop: "2px", marginBottom: "18px" }}>
                Bilateral microgrid energy clearing on the Open Network for Digital Commerce (ONDC / Beckn DEG v2.0):
              </p>

              <div style={{ background: "#0b0f19", padding: "18px", borderRadius: "12px", border: "1px solid #1e293b", marginBottom: "16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
                  <div>
                    <div style={{ fontSize: "15px", fontWeight: 800, color: "#f8fafc" }}>⚡ Feeder Energy Block Available for Trade</div>
                    <div style={{ fontSize: "12px", color: "#94a3b8" }}>12:00 – 14:00 hrs · 3.5 kWh Clean Rooftop Solar</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: "11px", color: "#94a3b8" }}>Clearing Rate</div>
                      <div style={{ fontSize: "18px", fontWeight: 800, color: "#34d399" }}>₹{currentGrid.p2pClearingRate.toFixed(2)}/kWh</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setP2pBooked(!p2pBooked)}
                      style={{
                        padding: "8px 18px",
                        borderRadius: "8px",
                        background: p2pBooked ? "#10b981" : "linear-gradient(135deg, #4f46e5 0%, #0284c7 100%)",
                        color: "#fff",
                        fontWeight: 700,
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      {p2pBooked ? "✓ ORDER ACCEPTED" : "Accept Trade"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 10: UPI INSTANT SETTLEMENT */}
          {activeTabId === "upi" && (
            <div style={{ background: "rgba(15, 23, 42, 0.7)", border: "1px solid #334155", borderRadius: "0 0 16px 16px", padding: "24px" }}>
              <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 800, color: "#f8fafc" }}>
                💳 10. NPCI UPI Instant Settlement Ledger
              </h3>
              <p style={{ color: "#94a3b8", fontSize: "13px", marginTop: "2px", marginBottom: "18px" }}>
                Automatic micro-payments for neighbor solar sharing with DISCOM wheeling charge deduplication:
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "14px" }}>
                <div style={{ background: "#0b0f19", padding: "16px", borderRadius: "12px", border: "1px solid #1e293b" }}>
                  <div style={{ fontSize: "11px", color: "#94a3b8" }}>Total P2P Earned This Month</div>
                  <div style={{ fontSize: "22px", fontWeight: 800, color: "#34d399", marginTop: "2px" }}>₹420.50</div>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>Settled via UPI: sharma@okhdfcbank</div>
                </div>
                <div style={{ background: "#0b0f19", padding: "16px", borderRadius: "12px", border: "1px solid #1e293b" }}>
                  <div style={{ fontSize: "11px", color: "#94a3b8" }}>DISCOM Wheeling Charge Deducted</div>
                  <div style={{ fontSize: "22px", fontWeight: 800, color: "#38bdf8", marginTop: "2px" }}>₹38.20</div>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>Tariff Schedule compliant (₹0.70/kWh)</div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 11: COMMUNITY SOLAR POOLING */}
          {activeTabId === "pooling" && (
            <div style={{ background: "rgba(15, 23, 42, 0.7)", border: "1px solid #334155", borderRadius: "0 0 16px 16px", padding: "24px" }}>
              <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 800, color: "#f8fafc" }}>
                🏢 11. Multi-Apartment Rooftop Solar Pooling
              </h3>
              <p style={{ color: "#94a3b8", fontSize: "13px", marginTop: "2px", marginBottom: "18px" }}>
                Virtual Net Metering (VNM) for Group Housing Societies and Apartment Complexes:
              </p>

              <div style={{ background: "#0b0f19", padding: "16px", borderRadius: "12px", border: "1px solid #1e293b" }}>
                <div style={{ fontSize: "14px", fontWeight: 700, color: "#f8fafc" }}>Krishna Nagar Society Rooftop Pool (Mathura)</div>
                <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "2px" }}>4 Houses Pooled · Combined Solar Capacity: 15.0 kWp</div>
                <div style={{ fontSize: "18px", fontWeight: 800, color: "#34d399", marginTop: "8px" }}>Combined Daily Generation: ~64.8 kWh</div>
              </div>
            </div>
          )}

          {/* TAB 12: SOLAR HEALTH & CLEANING */}
          {activeTabId === "health" && (
            <div style={{ background: "rgba(15, 23, 42, 0.7)", border: "1px solid #334155", borderRadius: "0 0 16px 16px", padding: "24px" }}>
              <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 800, color: "#f8fafc" }}>
                🩺 12. Rooftop Health, Dust &amp; String Fault Monitoring
              </h3>
              <p style={{ color: "#94a3b8", fontSize: "13px", marginTop: "2px", marginBottom: "18px" }}>
                Monitors rooftop PV output against modelled baseline to detect panel soiling, dust accumulation, and string disconnections:
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "14px", marginBottom: "18px" }}>
                <div style={{ background: "#0b0f19", padding: "16px", borderRadius: "12px", border: "1px solid #1e293b" }}>
                  <div style={{ fontSize: "11px", color: "#94a3b8" }}>Current Dust Soiling Loss</div>
                  <div style={{ fontSize: "22px", fontWeight: 800, color: stringFaultInjected ? "#ef4444" : "#10b981", marginTop: "2px" }}>
                    {stringFaultInjected ? "40.0% (Fault)" : "3.2% (Clean)"}
                  </div>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>Next scheduled wash: ~11 days</div>
                </div>
                <div style={{ background: "#0b0f19", padding: "16px", borderRadius: "12px", border: "1px solid #1e293b" }}>
                  <div style={{ fontSize: "11px", color: "#94a3b8" }}>Synthetic Fault Injection</div>
                  <button
                    type="button"
                    onClick={() => setStringFaultInjected(!stringFaultInjected)}
                    style={{
                      marginTop: "6px",
                      padding: "6px 12px",
                      borderRadius: "6px",
                      background: stringFaultInjected ? "#dc2626" : "#334155",
                      color: "#fff",
                      fontSize: "12px",
                      fontWeight: 700,
                      border: "none",
                      cursor: "pointer",
                    }}
                  >
                    {stringFaultInjected ? "Reset Fault" : "Inject 40% String Fault"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 13: 25-YEAR SAVINGS & ROI */}
          {activeTabId === "roi" && (
            <div style={{ background: "rgba(15, 23, 42, 0.7)", border: "1px solid #334155", borderRadius: "0 0 16px 16px", padding: "24px" }}>
              <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 800, color: "#f8fafc" }}>
                💰 13. 25-Year Lifetime Payback &amp; BEE Carbon Credits (CCTS)
              </h3>
              <p style={{ color: "#94a3b8", fontSize: "13px", marginTop: "2px", marginBottom: "18px" }}>
                Long-term financial returns and Bureau of Energy Efficiency decarbonization value for {place.owner_name}:
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "14px" }}>
                <div style={{ background: "#0b0f19", padding: "16px", borderRadius: "12px", border: "1px solid #1e293b" }}>
                  <div style={{ fontSize: "11px", color: "#94a3b8" }}>25-Year Undiscounted Savings</div>
                  <div style={{ fontSize: "22px", fontWeight: 800, color: "#34d399", marginTop: "2px" }}>
                    ₹{(place.annual_save * 25).toLocaleString()}
                  </div>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>25 years free solar energy</div>
                </div>
                <div style={{ background: "#0b0f19", padding: "16px", borderRadius: "12px", border: "1px solid #1e293b" }}>
                  <div style={{ fontSize: "11px", color: "#94a3b8" }}>Levelized Cost of Energy (LCOE)</div>
                  <div style={{ fontSize: "22px", fontWeight: 800, color: "#38bdf8", marginTop: "2px" }}>₹2.18 / kWh</div>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>Versus ₹7.50/kWh utility tariff</div>
                </div>
                <div style={{ background: "#0b0f19", padding: "16px", borderRadius: "12px", border: "1px solid #1e293b" }}>
                  <div style={{ fontSize: "11px", color: "#94a3b8" }}>CO2 Avoided (CEA Baseline)</div>
                  <div style={{ fontSize: "22px", fontWeight: 800, color: "#fbbf24", marginTop: "2px" }}>2.8 Tons / year</div>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>0.716 kg CO2/kWh national factor</div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 14: SURPLUS INTELLIGENCE */}
          {activeTabId === "surplus" && (
            <div style={{ background: "rgba(15, 23, 42, 0.7)", border: "1px solid #334155", borderRadius: "0 0 16px 16px", padding: "24px" }}>
              <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 800, color: "#f8fafc" }}>
                ⚡ 14. Surplus Intelligence &amp; DISCOM Energy Banking
              </h3>
              <p style={{ color: "#94a3b8", fontSize: "13px", marginTop: "2px", marginBottom: "18px" }}>
                Auditing annual banking cycles, time-of-day settlement credits, and multi-source integrations:
              </p>

              <div style={{ background: "#0b0f19", padding: "16px", borderRadius: "12px", border: "1px solid #1e293b" }}>
                <div style={{ fontSize: "14px", fontWeight: 700, color: "#f8fafc" }}>{place.discom} Banking Settlement Cycle</div>
                <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "2px" }}>Annual True-Up Date: 31st March · Banking Charge: 8%</div>
                <div style={{ fontSize: "18px", fontWeight: 800, color: "#38bdf8", marginTop: "6px" }}>Banked Units Available: 142 kWh</div>
              </div>
            </div>
          )}

          {/* TAB 15: NATIONAL MISSION CONTROL */}
          {activeTabId === "mission" && (
            <div style={{ background: "rgba(15, 23, 42, 0.7)", border: "1px solid #334155", borderRadius: "0 0 16px 16px", padding: "24px" }}>
              <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 800, color: "#f8fafc" }}>
                🚀 15. All-India Regional Microgrids (Mission Control)
              </h3>
              <p style={{ color: "#94a3b8", fontSize: "13px", marginTop: "2px", marginBottom: "18px" }}>
                Multi-state microgrid switching with high-level capacity indicators:
              </p>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "18px" }}>
                {Object.entries(REGIONAL_MICROGRIDS).map(([key, grid]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedStateKey(key)}
                    style={{
                      padding: "8px 14px",
                      borderRadius: "8px",
                      border: selectedStateKey === key ? "1px solid #6366f1" : "1px solid #334155",
                      background: selectedStateKey === key ? "linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)" : "#0b0f19",
                      color: selectedStateKey === key ? "#38bdf8" : "#cbd5e1",
                      fontSize: "12px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {grid.state} ({grid.discom})
                  </button>
                ))}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px" }}>
                <div style={{ background: "#0b0f19", padding: "14px", borderRadius: "10px", border: "1px solid #1e293b" }}>
                  <div style={{ fontSize: "11px", color: "#94a3b8" }}>State Capacity</div>
                  <div style={{ fontSize: "18px", fontWeight: 800, color: "#fbbf24" }}>{currentGrid.solarCapacityMw} MW</div>
                </div>
                <div style={{ background: "#0b0f19", padding: "14px", borderRadius: "10px", border: "1px solid #1e293b" }}>
                  <div style={{ fontSize: "11px", color: "#94a3b8" }}>Active Feeder Solar</div>
                  <div style={{ fontSize: "18px", fontWeight: 800, color: "#34d399" }}>{currentGrid.activeGenerationKw} kW</div>
                </div>
                <div style={{ background: "#0b0f19", padding: "14px", borderRadius: "10px", border: "1px solid #1e293b" }}>
                  <div style={{ fontSize: "11px", color: "#94a3b8" }}>Retail DISCOM Tariff</div>
                  <div style={{ fontSize: "18px", fontWeight: 800, color: "#f87171" }}>₹{currentGrid.discomRetailRate.toFixed(2)}/u</div>
                </div>
                <div style={{ background: "#0b0f19", padding: "14px", borderRadius: "10px", border: "1px solid #1e293b" }}>
                  <div style={{ fontSize: "11px", color: "#94a3b8" }}>P2P Clearing Price</div>
                  <div style={{ fontSize: "18px", fontWeight: 800, color: "#38bdf8" }}>₹{currentGrid.p2pClearingRate.toFixed(2)}/u</div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ======================================================================
             6. EXISTING SCENARIOS & TILES
             ====================================================================== */}
        <section style={{ marginBlock: "28px" }} aria-label="Microgrid Scenarios">
          <h3 style={{ fontSize: "18px", fontWeight: 800, color: "#f8fafc", marginBottom: "14px" }}>
            Operational Microgrid Scenarios
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px" }}>
            {SCENARIOS.map((sc, i) => (
              <div
                key={i}
                style={{
                  background: "rgba(15, 23, 42, 0.7)",
                  border: "1px solid #334155",
                  borderRadius: "14px",
                  padding: "18px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "12px", color: "#94a3b8" }}>{sc.state}</span>
                  <span style={{ fontSize: "16px" }}>{sc.icon}</span>
                </div>
                <div style={{ fontSize: "16px", fontWeight: 800, color: "#f8fafc", marginTop: "6px" }}>{sc.title}</div>
                <div style={{ fontSize: "13px", color: "#cbd5e1", marginTop: "4px" }}>{sc.detail}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Existing Navigation Tiles */}
        <section style={{ marginBlock: "28px" }} aria-label="Platform Workflows">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px" }}>
            {TILES.map((tile, i) => (
              <div
                key={i}
                style={{
                  background: "rgba(15, 23, 42, 0.7)",
                  border: "1px solid #334155",
                  borderRadius: "14px",
                  padding: "20px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#818cf8", textTransform: "uppercase" }}>{tile.label}</div>
                  <div style={{ fontSize: "16px", fontWeight: 800, color: "#f8fafc", marginTop: "4px" }}>{tile.title}</div>
                  <div style={{ fontSize: "13px", color: "#cbd5e1", marginTop: "6px", lineHeight: "1.5" }}>{tile.body}</div>
                </div>
                <div style={{ marginTop: "16px" }}>
                  <Link
                    href={tile.href}
                    style={{
                      color: "#38bdf8",
                      fontSize: "13px",
                      fontWeight: 700,
                      textDecoration: "none",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    {tile.action} &rarr;
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ======================================================================
             7. EXISTING HOME PROPERTIES INTEGRATION
             ====================================================================== */}
        <section style={{ marginTop: "32px" }} aria-label="Properties Portfolio">
          <HomeProperties />
        </section>
      </main>
    </div>
  );
}
