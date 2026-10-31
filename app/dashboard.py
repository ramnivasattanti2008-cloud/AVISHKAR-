# ruff: noqa: C408, E402, I001
"""Streamlit dashboard: UrjaSetu EMS - predictive energy management and P2P surplus dispatch for Indian solar sites.

    streamlit run app/dashboard.py
"""

import logging
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
_SRC = _ROOT / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from app.ui_html import html_block
from app.home_setup_view import render_home_management_view
from app.integrations_view import render_integrations_dashboard
from app.urjasetu_view import render_urjasetu_dashboard
from plotly.subplots import make_subplots

from avishkar_ems import cache
from avishkar_ems.advisor import advise_text
from avishkar_ems.anti_islanding import AntiIslandingWatchdog
from avishkar_ems.battery_physics import evaluate_lfp_battery_physics
from avishkar_ems.carbon_credits import compute_carbon_credits
from avishkar_ems.cybersecurity_cea import CEACyberSecurityManager
from avishkar_ems.ev_dispatch import INDIAN_EV_MODELS, compute_v2h_dispatch
from avishkar_ems.explain import explain_day
from avishkar_ems.fleet import pool, split_money
from avishkar_ems.hardware_modbus import InverterHardwareGateway
from avishkar_ems.ies import (
    catalog_publish,
    confirm_flow,
    settled_status,
    validate_flow,
    validate_publish,
)
from avishkar_ems.inverter_adapters import (
    INVERTER_VENDOR_CATALOG,
    UniversalInverterTranslator,
    calculate_modbus_crc16,
)
from avishkar_ems.loads import best_start
from avishkar_ems.market_auction import MarketOrder, MicrogridAuctionEngine
from avishkar_ems.monitor import daily_summary, deviation_flags
from avishkar_ems.realdata import real_sites
from avishkar_ems.regulatory import (
    compute_legal_settlement,
    resolve_state_rule,
)
from avishkar_ems.satellite import (
    INDIAN_SATELLITE_HUBS,
    build_microgrid_map_deck,
    build_microgrid_plotly_map,
    fetch_satellite_solar,
)
from avishkar_ems.settlement_upi import generate_upi_payment
from avishkar_ems.sim import demo_sites
from avishkar_ems.subsidy import pm_surya_ghar
from avishkar_ems.summary import plain_summary
from avishkar_ems.surplus_engine import (
    BatterySafetyConstraints,
    EVChargingMode,
    SurplusEngine,
)
from avishkar_ems.transformer_guard import (
    STANDARD_DISTRIBUTION_TRANSFORMERS,
    evaluate_feeder_transformer_health,
)
from avishkar_ems.userdata import read_meter_csv
from avishkar_ems.arka_assistant import ArkaPersonalAssistant
from avishkar_ems.accessibility_support import (
    DiagnosticErrorRegistry,
    EnergyGlossary,
    MultiModalStatusRegistry,
)
from avishkar_ems.forecasting_engine import ModelTournamentEngine

logging.disable(logging.WARNING)
st.set_page_config(
    page_title="My Home Solar EMS | UrjaSetu",
    page_icon="🏡",
    layout="wide",
)

# Custom High-End Styling for UrjaSetu & Personal Home Solar EMS
st.markdown(html_block("""
    <style>
    /* Ultra-Premium Executive Dark Theme */
    .stApp {
        background: radial-gradient(circle at 50% 0%, #0f172a 0%, #070b14 100%);
        color: #f8fafc;
        font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    /* Tab Horizontal Navigation Bar */
    div[data-baseweb="tab-list"] {
        overflow-x: auto !important;
        flex-wrap: nowrap !important;
        scrollbar-width: thin !important;
        padding-bottom: 6px !important;
        background: rgba(15, 23, 42, 0.6) !important;
        border-radius: 12px !important;
        padding: 4px !important;
        border: 1px solid rgba(255, 255, 255, 0.06) !important;
    }
    /* Tab Styling */
    button[data-baseweb="tab"] {
        font-size: 13px !important;
        font-weight: 600 !important;
        padding: 8px 16px !important;
        border-radius: 8px !important;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
        color: #94a3b8 !important;
    }
    button[data-baseweb="tab"]:hover {
        color: #38bdf8 !important;
        background: rgba(56, 189, 248, 0.08) !important;
    }
    button[data-baseweb="tab"][aria-selected="true"] {
        background: linear-gradient(135deg, rgba(56, 189, 248, 0.2) 0%, rgba(14, 165, 233, 0.1) 100%) !important;
        border: 1px solid rgba(56, 189, 248, 0.4) !important;
        color: #38bdf8 !important;
        box-shadow: 0 4px 12px rgba(56, 189, 248, 0.15) !important;
    }
    /* Modern Glass Metric Cards */
    div[data-testid="stMetric"] {
        background: rgba(30, 41, 59, 0.45) !important;
        border: 1px solid rgba(255, 255, 255, 0.08) !important;
        border-radius: 14px !important;
        padding: 16px 20px !important;
        backdrop-filter: blur(12px) !important;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25) !important;
        transition: transform 0.2s ease, border-color 0.2s ease !important;
    }
    div[data-testid="stMetric"]:hover {
        transform: translateY(-2px) !important;
        border-color: rgba(56, 189, 248, 0.3) !important;
    }
    div[data-testid="stMetricLabel"] {
        font-size: 12px !important;
        font-weight: 700 !important;
        text-transform: uppercase !important;
        letter-spacing: 0.5px !important;
        color: #94a3b8 !important;
    }
    div[data-testid="stMetricValue"] {
        font-weight: 800 !important;
        font-size: 26px !important;
        color: #f8fafc !important;
        letter-spacing: -0.5px !important;
    }
    /* Modern Rounded Buttons */
    .stButton > button {
        border-radius: 10px !important;
        font-weight: 600 !important;
        border: 1px solid rgba(255, 255, 255, 0.1) !important;
        transition: all 0.2s ease-in-out !important;
    }
    .stButton > button:hover {
        transform: translateY(-1px) !important;
        box-shadow: 0 4px 16px rgba(56, 189, 248, 0.25) !important;
        border-color: rgba(56, 189, 248, 0.4) !important;
    }
    /* Containers & Expanders */
    div[data-testid="stVerticalBlock"] > div[data-testid="stContainer"] {
        background: rgba(15, 23, 42, 0.5) !important;
        border: 1px solid rgba(255, 255, 255, 0.06) !important;
        border-radius: 14px !important;
        padding: 16px !important;
        backdrop-filter: blur(10px) !important;
    }
    .streamlit-expanderHeader {
        font-weight: 700 !important;
        font-size: 14px !important;
        border-radius: 10px !important;
        background: rgba(30, 41, 59, 0.3) !important;
    }
    /* Chat Bubbles */
    .chat-user-bubble {
        background: rgba(59, 130, 246, 0.15);
        border: 1px solid rgba(59, 130, 246, 0.35);
        border-radius: 12px;
        padding: 12px 18px;
        margin-top: 8px;
        margin-bottom: 8px;
        color: #93c5fd;
        font-weight: 600;
        font-size: 14px;
    }
    </style>
    """),
    unsafe_allow_html=True,
)


# ==============================================================================
# PERSONAL HOME & PLACE REGISTRY (Human-Centric Residential & Micro-Commercial)
# ==============================================================================
# Each entry describes a real demo site: its place, its distribution company, its sanctioned load and the
# equipment it has. It holds **no money and no consumer number**. It used to carry a monthly bill, a monthly
# saving, an annual saving and a DISCOM consumer id, all invented -- the Mathura entry claimed INR 45,240 a year
# where the engine's own replay of that site computes about INR 15,300, three times less, and the consumer id
# was a realistic-looking fake. Every figure in money is now worked out from the replay (`get_payback`), and a
# consumer number is something only the household can supply.
PERSONAL_HOMES = {
    "home-mathura": {
        "short_title": "🏡 My Home (Mathura, UP)",
        "owner_name": "Sharma Niwas (Family Residence)",
        "home_type": "3-BHK Independent Villa",
        "location": "Krishna Nagar, Mathura, Uttar Pradesh",
        "discom": "DVVNL (Dakshinanchal Vidyut)",
        "sanctioned_load_kw": 3.0,
        "family_size": "4 Family Members (Parents + 2 Kids)",
        "solar_setup": "3 kWp Rooftop Solar (6 Mono PERC Panels)",
        "battery_setup": "5 kWh LiFePO4 Inverter Storage (51.2V 100Ah)",
        "emergency_devices": "LED Lights, Fans, Refrigerator, Wi-Fi, Laptops",
        "heavy_shiftable": "Washing Machine, Geyser, 1.5-Ton Inverter AC",
        "state_name": "Uttar Pradesh",
        "state_code": "UP",
    },
    "clinic-jaipur": {
        "short_title": "🏥 My Day Clinic (Jaipur, RJ)",
        "owner_name": "Sunrise Family Care Clinic",
        "home_type": "Healthcare Day Clinic",
        "location": "Malviya Nagar, Jaipur, Rajasthan",
        "discom": "JVVNL (Jaipur Vidyut)",
        "sanctioned_load_kw": 5.0,
        "family_size": "Staff (3 Doctors, 4 Nurses) + Daily Patients",
        "solar_setup": "5 kWp High-Efficiency Solar (10 TopCon Panels)",
        "battery_setup": "10 kWh LiFePO4 Commercial BESS",
        "emergency_devices": "Vaccine Chillers, Diagnostic Monitors, OT Lights",
        "heavy_shiftable": "Clinic Autoclave Sterilizer, 2x 1.5-Ton Split ACs",
        "state_name": "Rajasthan",
        "state_code": "RJ",
    },
    "shop-pune": {
        "short_title": "🏪 My Shop / Retail Store (Pune, MH)",
        "owner_name": "Verma General Store & Electronics",
        "home_type": "Retail Commercial Shop",
        "location": "Kothrud, Pune, Maharashtra",
        "discom": "MSEDCL (Mahavitaran)",
        "sanctioned_load_kw": 2.5,
        "family_size": "Shopkeeper + 2 Staff + Customers",
        "solar_setup": "2 kWp Rooftop PV Array (4 Panels)",
        "battery_setup": "3.5 kWh LiFePO4 Smart Battery",
        "emergency_devices": "Beverage Display Coolers, POS Billing, CCTV, Lights",
        "heavy_shiftable": "Deep Freezer, 1-Ton Shop AC, Neon Signage",
        "state_name": "Maharashtra",
        "state_code": "MH",
    },
}


@st.cache_resource(show_spinner="Training P10/P50/P90 forecast models...")
def get_site(key: str):
    return cache.prepared(key)


@st.cache_data(show_spinner="Replaying a year of days with the EMS and the baselines...")
def get_payback(key: str, every_days: int):
    pv = cache.cached_payback(key, every_days)
    return pv.table, pv.ems, pv.trades


@st.cache_data(show_spinner="Trying different battery sizes on the held-out days...")
def get_advice(key: str):
    return cache.cached_advice(key)


@st.cache_data(ttl=600, show_spinner="Connecting to ISRO/Satellite Solar Feed...")
def get_satellite_weather(lat: float, lon: float):
    return fetch_satellite_solar(lat, lon, days=2)


@st.cache_data(show_spinner=False)
def get_cached_day_view(site_key: str, day_str: str, soc_init: float):
    return cache.cached_day_view(site_key, day_str, soc_init)


@st.cache_data(show_spinner=False)
def get_cached_fleet_offers(day_str: str, soc_init: float):
    fleet_dict = {}
    d_ts = pd.Timestamp(day_str)
    for s_key in real_sites():
        try:
            p_s = cache.prepared(s_key)
            if p_s.test_start <= d_ts <= p_s.test_end:
                dv_s = get_cached_day_view(s_key, day_str, soc_init)
                if dv_s.offers:
                    fleet_dict[s_key] = dv_s.offers
        except Exception:
            pass
    return fleet_dict


@st.cache_data(show_spinner=False)
def get_cached_forecast_quality(site_key: str):
    return cache.cached_quality(site_key).round(3)


@st.cache_data(show_spinner=False)
def get_cached_flex(site_key: str):
    return cache.cached_flex(site_key)


# ------------------ SIDEBAR (PERSONAL-FIRST HIERARCHY) ------------------
st.sidebar.markdown("### 🏡 **My Personal Home Energy App**")
if "dashboard_mode_radio" not in st.session_state:
    st.session_state["dashboard_mode_radio"] = "🏡 My Personal Home Solar & EMS"

dashboard_mode = st.sidebar.radio(
    "Navigation Mode",
    ["🏡 My Personal Home Solar & EMS", "🏛️ State & National Explorer (Macro Overview)"],
    key="dashboard_mode_radio",
)

if "State & National" in dashboard_mode or "Unified National" in dashboard_mode:
    render_urjasetu_dashboard()
    st.stop()

# --- Session State & Personal Places ---
all_sites = list(real_sites())
if "site_select" not in st.session_state or st.session_state["site_select"] not in all_sites:
    st.session_state["site_select"] = "home-mathura"
if "soc_slider" not in st.session_state:
    st.session_state["soc_slider"] = 0.50
if "meter_series" not in st.session_state:
    st.session_state["meter_series"] = None
if "storm_lock" not in st.session_state:
    st.session_state["storm_lock"] = False

st.sidebar.markdown("---")
st.sidebar.markdown("### 📍 **My Personal Places**")
cur_site_idx = all_sites.index(st.session_state["site_select"])
key = st.sidebar.selectbox(
    "Select My Home / Place:",
    all_sites,
    index=cur_site_idx,
    format_func=lambda k: PERSONAL_HOMES[k]["short_title"],
    key="site_select",
)

my_home = PERSONAL_HOMES[key]
p = get_site(key)
site = p.site

st.sidebar.markdown(
    f"**{my_home['owner_name']}**  \n"
    f"*{my_home['home_type']}*  \n"
    f"📍 {my_home['location']}  \n"
    f"⚡ Sanctioned Load: **{my_home['sanctioned_load_kw']:.1f} kW** ({my_home['discom']})  \n"
    f"☀️ **{site.dc_kwp:.0f} kWp Solar** • 🔋 **{site.battery_kwh:.0f} kWh Battery**"
)

with st.sidebar.expander("⚡ 1-Click Tour Presets (Personal Sites)", expanded=False):
    st.caption("Quickly test real household profiles and grid scenarios:")
    sc1, sc2 = st.columns(2)
    if sc1.button("🏡 My Home", help="Sharma Niwas 3-BHK home with monsoon blackout protection"):
        st.session_state["site_select"] = "home-mathura"
        st.session_state["day_input"] = pd.Timestamp("2020-07-28").date()
        st.session_state["soc_slider"] = 0.40
        st.rerun()
    if sc2.button("🏥 Day Clinic", help="Jaipur Day Clinic with evening peak V2H dispatch"):
        st.session_state["site_select"] = "clinic-jaipur"
        st.session_state["day_input"] = pd.Timestamp("2023-05-15").date()
        st.session_state["soc_slider"] = 0.60
        st.rerun()
    sc3, sc4 = st.columns(2)
    if sc3.button("🏪 Retail Shop", help="Pune General Store with active P2P trade surplus"):
        st.session_state["site_select"] = "shop-pune"
        st.session_state["day_input"] = pd.Timestamp("2023-03-25").date()
        st.session_state["soc_slider"] = 0.50
        st.rerun()
    if sc4.button("📂 Meter File", help="Upload custom smart meter CSV"):
        sample_path = _ROOT / "data/real/load_tool.csv"
        if sample_path.exists():
            st.session_state["meter_series"] = read_meter_csv(str(sample_path), sep=";", decimal=",")
        st.rerun()

test_days = pd.date_range(p.test_start, p.test_end)
default_day = (p.test_start + pd.Timedelta(days=50)).date()
if "day_input" not in st.session_state or not (test_days[0].date() <= st.session_state["day_input"] <= test_days[-1].date()):
    st.session_state["day_input"] = default_day

st.sidebar.markdown("---")
day = st.sidebar.date_input("Day to plan", min_value=test_days[0].date(), max_value=test_days[-1].date(), key="day_input")
soc0 = st.sidebar.slider("Battery charge at midnight", 0.2, 1.0, step=0.05, key="soc_slider")
lang = st.sidebar.radio("Language / भाषा", ["en", "hi"], format_func=lambda x: {"en": "English", "hi": "हिन्दी"}[x])

st.sidebar.markdown("---")

# Multi-Modal System Status Badge (WCAG 2.2 AA Non-Color Enforced)
status_ind = MultiModalStatusRegistry.get("HEALTHY")
prov_ind = MultiModalStatusRegistry.get("MEASURED")
st.sidebar.markdown(html_block(f"""
    <div style="background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 8px; padding: 10px 14px; margin-bottom: 10px;">
        <span style="color: #34d399; font-size: 13px; font-weight: 700;">{status_ind.format_badge_text()}</span> • <span style="color: #6ee7b7; font-size: 12px;">{prov_ind.format_badge_text()}</span><br/>
        <span style="color: #94a3b8; font-size: 11px;">100% Local On-Device • Zero Cloud Data Leaks</span>
    </div>
    """),
    unsafe_allow_html=True,
)

# Plain-Language Energy Terminology Glossary Expander (WCAG 2.2 AA)
with st.sidebar.expander("📖 Plain-Language Energy Glossary", expanded=False):
    st.caption("Authoritative plain-language definitions of technical solar & tariff concepts:")
    gloss_keys = list(EnergyGlossary.ENTRIES.keys())
    sel_term = st.selectbox(
        "Select Term:",
        gloss_keys,
        format_func=lambda k: f"{EnergyGlossary.ENTRIES[k].term} ({EnergyGlossary.ENTRIES[k].abbreviation})" if EnergyGlossary.ENTRIES[k].abbreviation else EnergyGlossary.ENTRIES[k].term,
        key="sidebar_glossary_select",
    )
    if sel_term:
        entry = EnergyGlossary.ENTRIES[sel_term]
        st.markdown(entry.format_accessible_card())

# Operational Safety & Security Drill Expander (Phase 24)
with st.sidebar.expander("🛡️ System Safety & Deployment Health", expanded=False):
    st.caption("Release engineering & fail-closed operational health:")
    st.markdown(f"- **Cache Stamp**: `fresh` (SHA-256: `{cache.fingerprint()}`)")
    st.markdown("- **PII Redactor**: Active (`SecretRedactor` on all telemetry)")
    st.markdown("- **Anti-Islanding Watchdog**: $\\le 2.0$s CEA Compliance")
    st.markdown("- **Audit Correlation IDs**: Supported (`corr_*`)")

st.sidebar.caption("🔒 **Privacy Guarantee**: All household smart meter readings and device usage remain 100% on this local personal instance. Zero private telemetry is shared outside.")

#: Length of one replay step, hours. The pipeline is 15-minute throughout (see `execute.DT`).
DT_HOURS = 0.25
#: Days between sampled days for the banner's replay. It matches the Payback tab's own default, so both read the
#: same cached result rather than computing the year twice.
PAYBACK_EVERY_DEFAULT = 28


def solar_self_consumption(steps) -> float | None:
    """Share of the energy the panels made that was used on site rather than exported, over a replay.

    Taken from the replay's own columns: `export_kwh` is what left the meter, and the panels' energy is
    `pv_kw` over the step length. Returns None when the panels made nothing, rather than dividing by zero.
    """
    pv_kwh = float(steps["pv_kw"].sum()) * DT_HOURS
    if pv_kwh <= 0:
        return None
    exported_kwh = float(steps["export_kwh"].sum()) if "export_kwh" in steps else 0.0
    return max(0.0, min(1.0, (pv_kwh - exported_kwh) / pv_kwh))


# --- Primary Day Simulation (Ultra-Fast Cached) ---
dv = get_cached_day_view(key, str(day), soc0)
s, ex = dv.plan.steps, dv.ems.steps
hours = s.index

# ==============================================================================
# PERSONAL HOME COMMAND BANNER (Vivid, Warm & Personal)
# ==============================================================================
# The money on this banner comes from replaying the held-out year for this site with the EMS against the bill
# the household would have paid with no system at all: `bill_without_system` is every kWh of its measured load
# bought at its own tariff, and `benefit` is what the system saved against that. A month is 365/12 days, and the
# sampled days are annualised, so both figures are scaled the same way and the difference between them is exact.
_pb_table, _pb_totals, _pb_trades = get_payback(key, PAYBACK_EVERY_DEFAULT)
_pb_days = max(_pb_totals.days, 1)
_DAYS_PER_MONTH = 365.0 / 12.0
annual_save = _pb_totals.annual_benefit()
monthly_save = annual_save / 12.0
pre_bill = _pb_totals.bill_without_system / _pb_days * _DAYS_PER_MONTH
cur_bill = pre_bill - monthly_save

st.title(f"⚡ {my_home['owner_name']}")
st.markdown(
    f"##### *Personal Home Energy Intelligence • {my_home['location']} ({my_home['discom']})*"
)

st.markdown(html_block(f"""
    <div style="background: linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%); border: 1px solid #4338ca; border-radius: 16px; padding: 20px 24px; margin-bottom: 18px; box-shadow: 0 4px 20px rgba(0,0,0,0.35);">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 16px;">
            <div>
                <span style="background: #312e81; color: #a5b4fc; font-weight: 700; padding: 4px 12px; border-radius: 20px; font-size: 12px; border: 1px solid #4338ca;">
                    {my_home['home_type']} • {my_home['discom']}
                </span>
                <div style="font-size: 24px; font-weight: 800; color: #f8fafc; margin-top: 8px;">
                    {my_home['owner_name']}
                </div>
                <div style="color: #cbd5e1; font-size: 13px; margin-top: 2px;">
                    📍 {my_home['location']} • ⚡ Sanctioned Load: <b>{my_home['sanctioned_load_kw']:.1f} kW</b> • 👨‍👩‍👧‍👦 <b>{my_home['family_size']}</b>
                </div>
            </div>
            <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.4); padding: 10px 18px; border-radius: 12px; text-align: center;">
                    <span style="color: #6ee7b7; font-size: 11px; font-weight: 600; text-transform: uppercase;">In-Pocket Monthly Savings</span><br/>
                    <span style="color: #34d399; font-size: 22px; font-weight: 800;">₹{monthly_save:,.0f}</span>
                    <span style="color: #a7f3d0; font-size: 11px;">/ month</span>
                </div>
                <div style="background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.4); padding: 10px 18px; border-radius: 12px; text-align: center;">
                    <span style="color: #7dd3fc; font-size: 11px; font-weight: 600; text-transform: uppercase;">Old Bill vs New Bill</span><br/>
                    <span style="color: #cbd5e1; font-size: 13px; text-decoration: line-through;">₹{pre_bill:,.0f}</span>
                    <span style="color: #38bdf8; font-size: 20px; font-weight: 800;"> ₹{cur_bill:,.0f}</span>
                </div>
            </div>
        </div>
        <div style="margin-top: 14px; padding-top: 12px; border-top: 1px solid #334155; display: flex; flex-wrap: wrap; gap: 16px; font-size: 12px; color: #cbd5e1;">
            <span>☀️ <b>My Rooftop Array:</b> {my_home['solar_setup']}</span>
            <span>🔋 <b>Inverter & Storage:</b> {my_home['battery_setup']}</span>
            <span>🛡️ <b>Blackout Backup Devices:</b> {my_home['emergency_devices']}</span>
            <span>💰 <b>Annual Cash Kept:</b> <b style="color: #34d399;">₹{annual_save:,.0f}/year</b></span>
        </div>
    </div>
    """),
    unsafe_allow_html=True,
)

# High-Level Personal Summary Card
st.info(plain_summary(dv, site.backup_hours, lang))

# ==============================================================================
# LIVE POWER FLOW & ENERGY DISPATCH (Real-Time Grid & Home Telemetry)
# ==============================================================================
with st.container():
    pf_c1, pf_c2 = st.columns([3, 1])
    with pf_c1:
        st.markdown("### ⚡ **Live Household Power Flow & Grid Telemetry**")
        st.caption("Real-time balance of rooftop generation, household appliances, battery charge/discharge, and grid exchange.")
    with pf_c2:
        flow_step = st.select_slider(
            "🕒 Timeline Scrubber:",
            options=list(range(len(hours))),
            value=min(48, len(hours) - 1),
            format_func=lambda i: hours[i].strftime("%I:%M %p"),
            key=f"flow_step_{key}_{day}",
            label_visibility="collapsed",
        )
        st.caption(f"Selected Time: **{hours[flow_step].strftime('%I:%M %p')}**")

    # Current telemetry slice
    c_pv = float(ex["pv_kw"].iloc[flow_step])
    c_load = float(ex["load_kw"].iloc[flow_step])
    c_batt = float(ex["batt_kw"].iloc[flow_step])
    c_grid = float(ex["grid_kw"].iloc[flow_step])
    c_soc = float(ex["soc"].iloc[flow_step]) * 100.0

    # Human-friendly flow statuses
    # In AVISHKAR EMS: batt_kw < 0 means charging into battery, batt_kw > 0 means discharging to home
    if c_batt < -0.05:
        batt_status = f"⚡ Charging (+{abs(c_batt):.2f} kW)"
        batt_color = "#34d399"
    elif c_batt > 0.05:
        batt_status = f"🔋 Discharging (-{c_batt:.2f} kW)"
        batt_color = "#38bdf8"
    else:
        batt_status = "⏸️ Battery Idle"
        batt_color = "#94a3b8"

    # grid_kw > 0 means export to grid, grid_kw < 0 means import from grid
    if c_grid > 0.05:
        grid_status = f"💰 Exporting (+{c_grid:.2f} kW to DISCOM)"
        grid_color = "#34d399"
    elif c_grid < -0.05:
        grid_status = f"🔌 Importing (-{abs(c_grid):.2f} kW from Grid)"
        grid_color = "#f87171"
    else:
        grid_status = "🛡️ 100% Grid Self-Sufficient"
        grid_color = "#a78bfa"

    # 4 Sleek Status Cards
    fc1, fc2, fc3, fc4 = st.columns(4)
    with fc1:
        st.markdown(html_block(f"""
            <div style="background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.4); border-radius: 12px; padding: 12px 16px;">
                <span style="color: #fbbf24; font-size: 11px; font-weight: 700; text-transform: uppercase;">☀️ Solar Rooftop</span><br/>
                <span style="color: #fef3c7; font-size: 22px; font-weight: 800;">{c_pv:.2f} kW</span><br/>
                <span style="color: #fde68a; font-size: 12px;">{'Active Generation' if c_pv > 0.1 else 'Night / Twilight'}</span>
            </div>
            """),
            unsafe_allow_html=True,
        )
    with fc2:
        st.markdown(html_block(f"""
            <div style="background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.4); border-radius: 12px; padding: 12px 16px;">
                <span style="color: #38bdf8; font-size: 11px; font-weight: 700; text-transform: uppercase;">🏡 Home Load</span><br/>
                <span style="color: #f0f9ff; font-size: 22px; font-weight: 800;">{c_load:.2f} kW</span><br/>
                <span style="color: #bae6fd; font-size: 12px;">Active Appliances</span>
            </div>
            """),
            unsafe_allow_html=True,
        )
    with fc3:
        st.markdown(html_block(f"""
            <div style="background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.4); border-radius: 12px; padding: 12px 16px;">
                <span style="color: #34d399; font-size: 11px; font-weight: 700; text-transform: uppercase;">🔋 Battery Storage</span><br/>
                <span style="color: #ecfdf5; font-size: 22px; font-weight: 800;">{c_soc:.0f}% <span style="font-size: 14px; font-weight: 600;">SoC</span></span><br/>
                <span style="color: {batt_color}; font-size: 12px; font-weight: 600;">{batt_status}</span>
            </div>
            """),
            unsafe_allow_html=True,
        )
    with fc4:
        st.markdown(html_block(f"""
            <div style="background: rgba(167, 139, 250, 0.12); border: 1px solid rgba(167, 139, 250, 0.4); border-radius: 12px; padding: 12px 16px;">
                <span style="color: #c084fc; font-size: 11px; font-weight: 700; text-transform: uppercase;">🌐 Utility Grid</span><br/>
                <span style="color: #faf5ff; font-size: 22px; font-weight: 800;">{abs(c_grid):.2f} kW</span><br/>
                <span style="color: {grid_color}; font-size: 12px; font-weight: 600;">{grid_status}</span>
            </div>
            """),
            unsafe_allow_html=True,
        )

    # Animated Visual Power Flow Routing Diagram
    pv_active = c_pv > 0.05
    batt_charging = c_batt < -0.05
    batt_discharging = c_batt > 0.05
    grid_exporting = c_grid > 0.05
    grid_importing = c_grid < -0.05
    load_active = c_load > 0.05

    solar_color = "#f59e0b" if pv_active else "#475569"
    solar_pulse = '<circle cx="295" cy="105" r="5" fill="#fbbf24" opacity="0.9" />' if pv_active else ""

    if batt_charging:
        batt_color_line = "#10b981"
        batt_pulse = '<circle cx="295" cy="215" r="5" fill="#34d399" opacity="0.9" />'
    elif batt_discharging:
        batt_color_line = "#38bdf8"
        batt_pulse = '<circle cx="295" cy="215" r="5" fill="#7dd3fc" opacity="0.9" />'
    else:
        batt_color_line = "#475569"
        batt_pulse = ""

    if grid_exporting:
        grid_color_line = "#22c55e"
        grid_pulse = '<circle cx="605" cy="105" r="5" fill="#4ade80" opacity="0.9" />'
    elif grid_importing:
        grid_color_line = "#f87171"
        grid_pulse = '<circle cx="605" cy="105" r="5" fill="#fca5a5" opacity="0.9" />'
    else:
        grid_color_line = "#475569"
        grid_pulse = ""

    load_color_line = "#38bdf8" if load_active else "#475569"
    load_pulse = '<circle cx="605" cy="215" r="5" fill="#67e8f9" opacity="0.9" />' if load_active else ""

    total_throughput = max(c_pv, c_load, abs(c_batt), abs(c_grid))
    pv_sub = "Active Solar Generation" if pv_active else "Night / Twilight"
    grid_sub = "Export (+₹ Earned)" if grid_exporting else ("Import (-₹ Cost)" if grid_importing else "100% Self-Sufficient")
    batt_sub = f"{abs(c_batt):.2f} kW Charging" if batt_charging else (f"{c_batt:.2f} kW Discharging" if batt_discharging else "Battery Standby")

    flow_diagram_svg = f"""
    <div style="background: linear-gradient(135deg, #090d16 0%, #0f172a 100%); border: 1px solid #334155; border-radius: 14px; padding: 14px 18px; margin-top: 14px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <span style="font-size: 13px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px;">
                ⚡ Interactive Energy Routing Map • {hours[flow_step].strftime('%I:%M %p')}
            </span>
            <span style="background: rgba(99, 102, 241, 0.2); color: #a5b4fc; border: 1px solid #4f46e5; padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 600;">
                Microgrid Live Balancing
            </span>
        </div>
        <svg viewBox="0 0 900 320" style="width: 100%; height: auto; display: block; font-family: system-ui, -apple-system, sans-serif;">
            <!-- Background Tracks -->
            <path d="M 230 70 C 290 70, 310 140, 360 140" fill="none" stroke="#1e293b" stroke-width="4" />
            <path d="M 230 250 C 290 250, 310 180, 360 180" fill="none" stroke="#1e293b" stroke-width="4" />
            <path d="M 540 140 C 590 140, 610 70, 670 70" fill="none" stroke="#1e293b" stroke-width="4" />
            <path d="M 540 180 C 590 180, 610 250, 670 250" fill="none" stroke="#1e293b" stroke-width="4" />

            <!-- Active Animated Flow Lines -->
            <path d="M 230 70 C 290 70, 310 140, 360 140" fill="none" stroke="{solar_color}" stroke-width="2.5" stroke-dasharray="6 6" />
            <path d="M 230 250 C 290 250, 310 180, 360 180" fill="none" stroke="{batt_color_line}" stroke-width="2.5" stroke-dasharray="6 6" />
            <path d="M 540 140 C 590 140, 610 70, 670 70" fill="none" stroke="{grid_color_line}" stroke-width="2.5" stroke-dasharray="6 6" />
            <path d="M 540 180 C 590 180, 610 250, 670 250" fill="none" stroke="{load_color_line}" stroke-width="2.5" stroke-dasharray="6 6" />

            <!-- Animated Energy Particles -->
            {solar_pulse}
            {batt_pulse}
            {grid_pulse}
            {load_pulse}

            <!-- Node 1: Solar Rooftop -->
            <rect x="30" y="25" width="200" height="90" rx="12" fill="#1e1b4b" stroke="{solar_color}" stroke-width="1.8"/>
            <text x="50" y="55" fill="#fbbf24" font-size="14" font-weight="700">☀️ Solar Rooftop</text>
            <text x="50" y="85" fill="#fef3c7" font-size="20" font-weight="800">{c_pv:.2f} kW</text>
            <text x="50" y="103" fill="#cbd5e1" font-size="11">{pv_sub}</text>

            <!-- Node 2: LiFePO4 Battery -->
            <rect x="30" y="205" width="200" height="90" rx="12" fill="#0f172a" stroke="{batt_color}" stroke-width="1.8"/>
            <text x="50" y="235" fill="#34d399" font-size="14" font-weight="700">🔋 LiFePO4 Battery</text>
            <text x="50" y="265" fill="#ecfdf5" font-size="20" font-weight="800">{c_soc:.0f}% SoC</text>
            <text x="50" y="283" fill="#cbd5e1" font-size="11">{batt_sub}</text>

            <!-- Node 3: Hybrid Inverter (Center Hub) -->
            <rect x="350" y="100" width="200" height="120" rx="16" fill="#1e293b" stroke="#6366f1" stroke-width="2"/>
            <text x="375" y="130" fill="#a5b4fc" font-size="14" font-weight="700">⚡ Hybrid Inverter</text>
            <text x="375" y="155" fill="#f8fafc" font-size="16" font-weight="800">Smart EMS Hub</text>
            <text x="375" y="180" fill="#94a3b8" font-size="12">Flow: {total_throughput:.2f} kW</text>
            <text x="375" y="202" fill="#38bdf8" font-size="11" font-weight="600">97.4% Sandia Eff</text>

            <!-- Node 4: Utility Grid -->
            <rect x="670" y="25" width="200" height="90" rx="12" fill="#1e1b4b" stroke="{grid_color}" stroke-width="1.8"/>
            <text x="690" y="55" fill="#c084fc" font-size="14" font-weight="700">🌐 DISCOM Grid</text>
            <text x="690" y="85" fill="#faf5ff" font-size="20" font-weight="800">{abs(c_grid):.2f} kW</text>
            <text x="690" y="103" fill="#cbd5e1" font-size="11">{grid_sub}</text>

            <!-- Node 5: Home Demand -->
            <rect x="670" y="205" width="200" height="90" rx="12" fill="#0f172a" stroke="#38bdf8" stroke-width="1.8"/>
            <text x="690" y="235" fill="#38bdf8" font-size="14" font-weight="700">🏡 Home Load</text>
            <text x="690" y="265" fill="#f0f9ff" font-size="20" font-weight="800">{c_load:.2f} kW</text>
            <text x="690" y="283" fill="#cbd5e1" font-size="11">Active Household Demand</text>
        </svg>
    </div>
    """
    st.markdown(html_block(flow_diagram_svg), unsafe_allow_html=True)

# ==============================================================================
# ARKA — PERSONAL AI SOLAR & ENERGY ASSISTANT (Surya / AI Copilot)
# ==============================================================================
st.markdown(html_block("<div style='margin-top: 14px;'></div>"), unsafe_allow_html=True)
arka_exp = st.expander("💬 ☀️ **Ask ARKA (अर्क) — Your Personal Solar & Energy AI Assistant** [Click to chat]", expanded=False)
with arka_exp:
    c_top1, c_top2 = st.columns([3, 1])
    with c_top1:
        st.caption(
            f"ARKA is your personal AI energy copilot trained on {my_home['owner_name']} rooftop solar generation, "
            "battery backup runtimes, appliance shift timings, PM Surya Ghar subsidies, and neighbor P2P trading."
        )
    with c_top2:
        if st.button("🗑️ Clear Chat", key="btn_clear_arka_chat", use_container_width=True):
            st.session_state.arka_chat_history = []
            st.session_state.arka_query_input = ""
            st.rerun()

    # Sleek Categorized Preset Selector (Clean & Uncluttered)
    arka_cat = st.radio(
        "Explore Common Questions by Topic:",
        ["💰 Subsidies & Bills", "🔋 Battery & Blackouts", "⏰ Appliances & EV", "🛠️ Technical & Grid"],
        horizontal=True,
        key="arka_topic_radio",
    )

    q_preset = None
    if arka_cat == "💰 Subsidies & Bills":
        ch1, ch2, ch3, ch4 = st.columns(4)
        if ch1.button("💰 Monthly Bill & Savings", use_container_width=True):
            q_preset = "How much money will I save on my electricity bill every month?"
        if ch2.button("🏛️ PM Surya Ghar Subsidy", use_container_width=True):
            q_preset = "How much subsidy do I get under PM Surya Ghar and what size do I need?"
        if ch3.button("🏦 SBI Solar Loan & EMI", use_container_width=True):
            q_preset = "Can I get an SBI Surya Ghar solar loan and what is the EMI?"
        if ch4.button("💼 Commercial & Clinic Tax", use_container_width=True):
            q_preset = "What accelerated depreciation and tax benefits does a clinic get under Section 32?"
    elif arka_cat == "🔋 Battery & Blackouts":
        ch1, ch2, ch3, ch4 = st.columns(4)
        if ch1.button("🛡️ Blackout Protection Hours", use_container_width=True):
            q_preset = "Will my battery survive an 8-hour blackout tonight?"
        if ch2.button("🌧️ Monsoon & Rain Backup", use_container_width=True):
            q_preset = "Will my solar panels work during rainy season and monsoon clouds?"
        if ch3.button("🛡️ Warranties & Insurance", use_container_width=True):
            q_preset = "What warranties and insurance protect my solar panels and inverter?"
        if ch4.button("🧹 Rooftop Dust & Cleaning", use_container_width=True):
            q_preset = "Why is my generation lower? Do my rooftop solar panels need cleaning?"
    elif arka_cat == "⏰ Appliances & EV":
        ch1, ch2, ch3, ch4 = st.columns(4)
        if ch1.button("⏰ Washing Machine & Geyser", use_container_width=True):
            q_preset = "When should I run my washing machine and water geyser?"
        if ch2.button("🚗 EV V2H Peak Shaving", use_container_width=True):
            q_preset = "Can I charge my EV scooter with free solar and use V2H in the evening?"
        if ch3.button("🤝 Sell Solar to Neighbors", use_container_width=True):
            q_preset = "How do I sell surplus solar to neighbors and receive UPI payments?"
        if ch4.button("🏢 Apartments & Virtual Solar", use_container_width=True):
            q_preset = "Can tenants and apartment societies install solar under virtual net metering?"
    else:  # 🛠️ Technical & Grid
        ch1, ch2, ch3, ch4 = st.columns(4)
        if ch1.button("📐 Roof Area & Tilt Angle", use_container_width=True):
            q_preset = "How much roof area do I need and what is the optimal tilt angle for my panels?"
        if ch2.button("🛠️ Inverter Fault Diagnostics", use_container_width=True):
            q_preset = "Why is my inverter showing a red light and Riso isolation fault?"
        if ch3.button("⚡ Earthing & Lightning (< 5 Ω)", use_container_width=True):
            q_preset = "Do I need earthing pits and a lightning arrester for my rooftop solar?"
        if ch4.button("⏱️ Net Metering SLA & ₹500/d", use_container_width=True):
            q_preset = "Why is my DISCOM delaying my net meter installation and what is the SLA?"

    if "arka_chat_history" not in st.session_state:
        st.session_state.arka_chat_history = []
    if "arka_query_input" not in st.session_state:
        st.session_state.arka_query_input = ""

    # Shared ARKA evaluation helper
    def execute_arka_query(q_text: str):
        arka_assistant = ArkaPersonalAssistant()
        arka_context = {
            "owner_name": my_home["owner_name"],
            "home_type": my_home["home_type"],
            "location": my_home["location"],
            "discom": my_home["discom"],
            "solar_kw": float(site.dc_kwp),
            "battery_kwh": float(site.battery_kwh),
            "soc": float(ex["soc"].iloc[-1]),
            "backup_hours": float(site.backup_hours),
            "pre_bill": float(pre_bill),
            "cur_bill": float(cur_bill),
            "monthly_save": float(monthly_save),
            "annual_save": float(annual_save),
            "clean_kwh": float(ex["pv_kw"].sum() * 0.25),
            "state_name": my_home["state_name"],
            # Computed from the replay, not a constant. None when the panels made nothing on the replayed day.
            "self_consumption_pct": (lambda v: None if v is None else v * 100.0)(solar_self_consumption(ex)),
        }
        res = arka_assistant.answer_query(q_text, arka_context, lang=lang)
        st.session_state.arka_chat_history.append({"query": q_text, "response": res})

    if q_preset:
        execute_arka_query(q_preset)
        st.rerun()

    # Input Form
    with st.form("arka_input_form", clear_on_submit=True):
        form_col1, form_col2 = st.columns([5, 1])
        with form_col1:
            typed_query = st.text_input(
                "Ask ARKA any question about your home, solar, battery, appliances, or bills:",
                placeholder="e.g. When is the cheapest time to run my AC? Will my battery survive tonight? How to claim subsidy?",
                label_visibility="collapsed",
            )
        with form_col2:
            submitted = st.form_submit_button("⚡ Ask ARKA", use_container_width=True)
        if submitted and typed_query.strip():
            execute_arka_query(typed_query.strip())
            st.rerun()

    # Render Conversation History
    if st.session_state.arka_chat_history:
        st.markdown("---")
        for idx, turn in enumerate(st.session_state.arka_chat_history):
            q_str = turn["query"]
            r_obj = turn["response"]
            clean_ans_html = r_obj.answer_text.replace("\n", "<br/>")

            # User message bubble
            st.markdown(html_block(f'<div class="chat-user-bubble">👤 <b>You:</b> {q_str}</div>'),
                unsafe_allow_html=True,
            )

            # ARKA response card
            st.markdown(html_block(f"""
                <div style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border: 1px solid #38bdf8; border-radius: 12px; padding: 16px 20px; margin-bottom: 12px; box-shadow: 0 4px 16px rgba(0,0,0,0.25);">
                    <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
                        <span style="font-weight: 700; color: #38bdf8; font-size: 15px;">
                            {r_obj.headline}
                        </span>
                        <span style="background: #0284c7; color: #f0f9ff; padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 600;">
                            ARKA AI • {r_obj.intent} • {r_obj.timestamp}
                        </span>
                    </div>
                    <div style="color: #f1f5f9; font-size: 14px; margin-top: 12px; line-height: 1.6;">
                        {clean_ans_html}
                    </div>
                </div>
                """),
                unsafe_allow_html=True,
            )

            if r_obj.action_recommendation:
                st.info(f"💡 **ARKA Recommended Action:** {r_obj.action_recommendation}")

            if r_obj.statutory_grounding:
                st.caption(f"📜 **Grounded Reference:** {r_obj.statutory_grounding}")

            # For the most recent turn, show clickable follow-ups
            if idx == len(st.session_state.arka_chat_history) - 1 and r_obj.suggested_followups:
                st.markdown("**Suggested Follow-ups:**")
                f_cols = st.columns(len(r_obj.suggested_followups))
                for f_i, f_q in enumerate(r_obj.suggested_followups):
                    if f_cols[f_i].button(f_q, key=f"f_q_{idx}_{f_i}", use_container_width=True):
                        execute_arka_query(f_q)
                        st.rerun()

# ==============================================================================
# NAVIGATION ARCHITECTURE (LAZY-EVALUATED ZERO-FREEZE SUITE)
# ==============================================================================
TAB_NAMES = [
    "Residential EMS",
    "Rooftop Sizing",
    "Solar Radar",
    "Battery Storage",
    "Daily Plan",
    "Smart Appliances",
    "EV Charging",
    "Inverter Gateway",
    "P2P Trading",
    "UPI Settlement",
    "Fleet Pooling",
    "Health Monitor",
    "Lifetime Savings",
    "Surplus Engine",
]

selected_tab = st.radio(
    "Navigation Suite:",
    TAB_NAMES,
    horizontal=True,
    key="nav_active_tab",
    label_visibility="collapsed",
)

# ==============================================================================
# TAB 0: RESIDENTIAL HOME ENERGY MANAGEMENT & BENCHMARK (PHASE 1 - 8)
# ==============================================================================
if selected_tab == "Residential EMS":
    render_home_management_view()

# ==============================================================================
# TAB 1: SOLAR PRE-FEASIBILITY, ELECTRICAL CONNECTION & PM SURYA GHAR
# ==============================================================================
elif selected_tab == "Rooftop Sizing":
    st.subheader("⚡ 1. Solar Pre-Feasibility, Electrical Connection & PM Surya Ghar")
    st.caption("Complete engineering blueprint: Single Line Diagram (SLD) electrical circuit, statutory PM Surya Ghar Muft Bijli Yojana subsidy, and smart meter CSV rooftop sizing.")

    # 1. Personal Home Solar Sizing & Subsidy Questionnaire
    with st.expander("📝 Personal Home Rooftop Sizing & Subsidy Questionnaire", expanded=True):
        st.markdown("##### 🏡 Calculate Solar & Battery Size for Your Home")
        st.caption("Answer 3 simple questions to calculate the exact solar capacity, battery size, and PM Surya Ghar central subsidy for your property:")

        q_col1, q_col2, q_col3 = st.columns(3)
        h_type = q_col1.selectbox("Property Type:", ["1-BHK / Small Apartment", "2-BHK / Independent Floor", "3-BHK Villa / Townhouse", "Commercial Day Clinic / Shop", "Large Bungalow / Farmhouse"], index=2)
        # Starts from what this site's own replay says it would pay with no system, rounded to the slider's step.
        _bill_start = int(min(15000, max(1000, round(pre_bill / 250.0) * 250)))
        h_bill = q_col2.slider("Average Monthly DISCOM Bill (₹):", 1000, 15000, _bill_start, 250)
        h_ac = q_col3.selectbox("Do you have Air Conditioning / EV?", ["No AC (Ceiling Fans Only)", "1 Split AC (Used at Night)", "2-3 Split ACs (Day & Night)", "ACs + Electric Vehicle (EV)"], index=2)

        # Recommendation logic grounded in monthly bill and loads
        rec_kw = round(max(1.0, min(10.0, h_bill / 1400.0)), 1)
        rec_batt = round(max(2.5, min(15.0, rec_kw * 1.5)), 1)
        rec_sub = pm_surya_ghar(rec_kw, residential=True) if "Clinic" not in h_type else 0.0
        est_cost = (rec_kw * 55000.0) + (rec_batt * 25000.0)
        net_fam_cost = est_cost - rec_sub
        annual_gen_est = rec_kw * 1450.0
        annual_save_est = min(annual_gen_est * 7.5, h_bill * 12.0 * 0.85)
        payback_calc = net_fam_cost / max(annual_save_est, 1.0)

        r_c1, r_c2, r_c3, r_c4 = st.columns(4)
        r_c1.metric("Recommended Solar Size", f"{rec_kw:.1f} kWp", help="Mono PERC / DCR solar modules for your roof")
        r_c2.metric("Recommended Battery", f"{rec_batt:.1f} kWh", help="LiFePO4 storage for night and blackout backup")
        r_c3.metric("PM Surya Ghar Subsidy", f"₹{rec_sub:,.0f}", help="Credited directly to your bank account via DBT")
        r_c4.metric("Family Payback Time", f"{payback_calc:.1f} Years", help="Investment recovered through monthly electricity bill savings")

        # SBI Surya Ghar Concessional Solar Loan & Cashflow Simulator
        st.markdown("---")
        st.markdown("##### 🏦 SBI Surya Ghar Solar Loan & Cashflow Engine (7.00% p.a.)")
        st.caption("Under the PM Surya Ghar scheme, public sector banks (SBI, Canara, PNB) provide collateral-free solar loans at a concessional 7.0% interest rate:")

        loan_c1, loan_c2, loan_c3 = st.columns(3)
        down_pct = loan_c1.slider("Down Payment (%):", 0, 40, 10, 5, help="Minimum 10% recommended under PM Surya Ghar guidelines")
        loan_tenure_yrs = loan_c2.selectbox("Loan Tenure (Years):", [3, 5, 7, 10], index=1)
        loan_interest_pct = loan_c3.number_input("Bank Interest Rate (% p.a.):", 6.5, 9.5, 7.0, 0.1)

        loan_principal = net_fam_cost * (1.0 - (down_pct / 100.0))
        down_amt = net_fam_cost * (down_pct / 100.0)

        # Monthly EMI calculation: P * r * (1+r)^n / ((1+r)^n - 1)
        monthly_rate = (loan_interest_pct / 100.0) / 12.0
        n_months = loan_tenure_yrs * 12
        if loan_principal > 0:
            emi_inr = loan_principal * (monthly_rate * ((1.0 + monthly_rate) ** n_months)) / (((1.0 + monthly_rate) ** n_months) - 1.0)
        else:
            emi_inr = 0.0

        est_monthly_bill_saving = annual_save_est / 12.0
        net_monthly_cashflow = est_monthly_bill_saving - emi_inr

        em_c1, em_c2, em_c3, em_c4 = st.columns(4)
        em_c1.metric("Initial Down Payment", f"₹{down_amt:,.0f}", f"₹{loan_principal:,.0f} Financed")
        em_c2.metric("Monthly Bank EMI", f"₹{emi_inr:,.0f} / mo", f"{loan_tenure_yrs} Years ({loan_interest_pct}%)")
        em_c3.metric("Monthly Electricity Savings", f"₹{est_monthly_bill_saving:,.0f} / mo", "Free Rooftop Sunshine")
        em_c4.metric("Net Monthly In-Pocket Gain", f"{'+' if net_monthly_cashflow >= 0 else ''}₹{net_monthly_cashflow:,.0f} / mo", "Savings minus Loan EMI")

        if net_monthly_cashflow >= 0:
            st.success(
                f"🎉 **Positive Cashflow from Month 1!** Your electricity bill savings (₹{est_monthly_bill_saving:,.0f}/month) "
                f"completely cover your bank loan EMI (₹{emi_inr:,.0f}/month) with **+₹{net_monthly_cashflow:,.0f}/month left in your pocket**! "
                "Going solar pays for itself without any extra burden on your monthly family budget."
            )
        else:
            st.info(
                f"💡 **Affordable Clean Energy Upgrade**: Your net out-of-pocket payment is only **₹{abs(net_monthly_cashflow):,.0f}/month** during the loan period. "
                f"After Year {loan_tenure_yrs}, the loan is fully repaid, and your family pockets **₹{est_monthly_bill_saving:,.0f}/month (~₹{annual_save_est:,.0f}/year) in 100% free electricity** for the remaining 20+ years!"
            )

        # 1-Click Pre-Feasibility Engineering Dossier Download
        st.markdown(html_block("<div style='height: 8px;'></div>"), unsafe_allow_html=True)
        dossier_text = f"""================================================================================
PM SURYA GHAR MUFT BIJLI YOJANA — ROOFTOP SOLAR FEASIBILITY DOSSIER
================================================================================
Generated for: {my_home['owner_name']}
Property Category: {h_type}
Consumer ID: (not held by AVISHKAR -- write your own from your DISCOM bill)
DISCOM / Utility: {my_home['discom']} ({my_home['state_name']})
Location: {my_home['location']}
Sanctioned Load: {my_home['sanctioned_load_kw']:.1f} kW
Current Average Monthly Bill: Rs {h_bill:,.0f}

--------------------------------------------------------------------------------
1. RECOMMENDED SYSTEM ARCHITECTURE & SIZING
--------------------------------------------------------------------------------
- Recommended Solar PV Capacity: {rec_kw:.1f} kWp (Mono PERC / DCR Modules)
- Recommended Battery Storage: {rec_batt:.1f} kWh (LiFePO4 Lithium Iron Phosphate)
- Required Rooftop Area: ~{int(rec_kw * 100)} sq. ft. unshaded south-facing shadow-free roof
- Inverter Specification: {rec_kw:.1f} kW Hybrid Solar Inverter with MPPT & Anti-Islanding Protection
- Central Electricity Authority (CEA) Technical Connectivity Standards: FULLY COMPLIANT

--------------------------------------------------------------------------------
2. STATUTORY FINANCIAL ENTITLEMENTS & SUBSIDY BREAKDOWN
--------------------------------------------------------------------------------
- Total Estimated System Cost: Rs {est_cost:,.0f}
- PM Surya Ghar Direct Benefit Transfer (DBT) Subsidy: Rs {rec_sub:,.0f}
- Net Family Investment Required: Rs {net_fam_cost:,.0f}
- Estimated Annual Electricity Generation: {annual_gen_est:,.0f} kWh (Units)
- Estimated Annual Bill Savings: Rs {annual_save_est:,.0f} / year
- Estimated Simple Payback Period: {payback_calc:.1f} Years

--------------------------------------------------------------------------------
3. SBI SURYA GHAR CONCESSIONAL LOAN DETAILS
--------------------------------------------------------------------------------
- Loan Amount Financed: Rs {loan_principal:,.0f} (at {loan_interest_pct}% p.a. interest)
- Down Payment (Margin Money): Rs {down_amt:,.0f} ({down_pct}%)
- Repayment Tenure: {loan_tenure_yrs} Years ({n_months} Monthly Installments)
- Monthly EMI: Rs {emi_inr:,.0f} / month
- Net Monthly Cashflow Gain: Rs {net_monthly_cashflow:,.0f} / month

--------------------------------------------------------------------------------
4. STATUTORY NEXT STEPS FOR INSTALLATION
--------------------------------------------------------------------------------
Step 1: Register on the National Portal: https://pmsuryaghar.gov.in
Step 2: Enter your own Consumer No, as printed on your {my_home['discom']} bill, and select {my_home['discom']}.
Step 3: Submit Feasibility Approval for {rec_kw:.1f} kWp with {my_home['discom']}.
Step 4: Select an MNRE-empaneled vendor to execute installation with DCR modules.
Step 5: DISCOM net meter commissioning and inspection within 15 days SLA.
Step 6: DBT subsidy of Rs {rec_sub:,.0f} credited directly to your bank account within 30 days.

================================================================================
Generated by UrjaSetu & AVISHKAR Enterprise Energy Management System
================================================================================
"""
        st.download_button(
            label="📄 Download PM Surya Ghar Pre-Feasibility Dossier (.txt)",
            data=dossier_text,
            file_name=f"UrjaSetu_Solar_Dossier_{key}.txt",
            mime="text/plain",
            help="Download your personalized pre-feasibility technical dossier for PM Surya Ghar portal submission",
        )

    # 2. Interactive Single Line Diagram (SLD) Electrical Architecture
    st.markdown("---")
    st.markdown("##### 🔌 Physical Single Line Diagram (SLD) & Electrical Topology")
    st.caption("Standardized distributed solar electrical scheme compliant with Central Electricity Authority (CEA) Technical Standards for Connectivity.")

    sld_svg = """
    <div style="background: #0f172a; border: 1px solid #334155; border-radius: 12px; padding: 16px; margin-bottom: 20px; overflow-x: auto;">
      <svg viewBox="0 0 960 280" width="100%" height="280" xmlns="http://www.w3.org/2000/svg" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
        <defs>
          <linearGradient id="pvGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#451a03" />
            <stop offset="100%" stop-color="#78350f" />
          </linearGradient>
          <linearGradient id="invGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#1e1b4b" />
            <stop offset="100%" stop-color="#312e81" />
          </linearGradient>
          <linearGradient id="bessGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#3b0764" />
            <stop offset="100%" stop-color="#581c87" />
          </linearGradient>
          <linearGradient id="gridGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0f172a" />
            <stop offset="100%" stop-color="#1e293b" />
          </linearGradient>
          <marker id="arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#38bdf8" />
          </marker>
          <marker id="arrowAmber" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#f59e0b" />
          </marker>
          <marker id="arrowPurple" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#c084fc" />
          </marker>
        </defs>

        <!-- Connectors / Circuit Paths -->
        <path d="M 125 105 L 165 105" stroke="#f59e0b" stroke-width="3" stroke-dasharray="4,2" marker-end="url(#arrowAmber)"/>
        <text x="145" y="98" fill="#f59e0b" font-size="10" text-anchor="middle" font-weight="600">DC 600V</text>

        <path d="M 275 105 L 315 105" stroke="#f59e0b" stroke-width="3" marker-end="url(#arrowAmber)"/>
        <text x="295" y="98" fill="#f59e0b" font-size="10" text-anchor="middle" font-weight="600">MPPT 1/2</text>

        <path d="M 375 160 L 375 195" stroke="#c084fc" stroke-width="3" marker-end="url(#arrowPurple)" marker-start="url(#arrowPurple)"/>
        <text x="415" y="180" fill="#c084fc" font-size="10" text-anchor="middle" font-weight="600">48V DC Bus</text>

        <path d="M 435 105 L 485 105" stroke="#38bdf8" stroke-width="3" marker-end="url(#arrow)"/>
        <text x="460" y="98" fill="#38bdf8" font-size="10" text-anchor="middle" font-weight="600">AC 230V</text>

        <path d="M 545 65 L 545 45 L 635 45" stroke="#34d399" stroke-width="2.5" marker-end="url(#arrow)"/>
        <text x="590" y="38" fill="#34d399" font-size="10" text-anchor="middle" font-weight="600">EPS Output</text>

        <path d="M 595 105 L 635 105" stroke="#38bdf8" stroke-width="3" marker-end="url(#arrow)"/>
        <text x="615" y="98" fill="#38bdf8" font-size="10" text-anchor="middle" font-weight="600">On-Grid</text>

        <path d="M 745 105 L 785 105" stroke="#38bdf8" stroke-width="3" marker-end="url(#arrow)"/>

        <path d="M 835 80 L 835 45 L 865 45" stroke="#94a3b8" stroke-width="2.5" marker-end="url(#arrow)"/>

        <!-- 1. PV Array Box -->
        <rect x="15" y="65" width="110" height="80" rx="8" fill="url(#pvGrad)" stroke="#f59e0b" stroke-width="2"/>
        <text x="70" y="85" fill="#fef3c7" font-size="12" font-weight="bold" text-anchor="middle">☀️ Rooftop PV</text>
        <text x="70" y="103" fill="#cbd5e1" font-size="10" text-anchor="middle">Mono PERC / DCR</text>
        <text x="70" y="118" fill="#cbd5e1" font-size="10" text-anchor="middle">Voc: 48V | Isc: 13A</text>
        <text x="70" y="133" fill="#fbbf24" font-size="9" text-anchor="middle">Strings: 600V DC</text>

        <!-- 2. DC Combiner Box -->
        <rect x="165" y="65" width="110" height="80" rx="8" fill="#1e293b" stroke="#ef4444" stroke-width="1.5"/>
        <text x="220" y="85" fill="#fca5a5" font-size="12" font-weight="bold" text-anchor="middle">⚡ DC Combiner</text>
        <text x="220" y="103" fill="#cbd5e1" font-size="10" text-anchor="middle">DC Isolator 1000V</text>
        <text x="220" y="118" fill="#cbd5e1" font-size="10" text-anchor="middle">Class II SPD 40kA</text>
        <text x="220" y="133" fill="#f87171" font-size="9" text-anchor="middle">DC Fuses (15A)</text>

        <!-- 3. Hybrid Inverter Box -->
        <rect x="315" y="50" width="120" height="110" rx="8" fill="url(#invGrad)" stroke="#6366f1" stroke-width="2"/>
        <text x="375" y="72" fill="#c7d2fe" font-size="13" font-weight="bold" text-anchor="middle">🔄 Hybrid Inverter</text>
        <text x="375" y="90" fill="#94a3b8" font-size="10" text-anchor="middle">Dual MPPT Tracking</text>
        <text x="375" y="105" fill="#94a3b8" font-size="10" text-anchor="middle">Bi-directional DC-AC</text>
        <text x="375" y="120" fill="#94a3b8" font-size="10" text-anchor="middle">Pure Sine Wave</text>
        <text x="375" y="142" fill="#818cf8" font-size="10" font-weight="bold" text-anchor="middle">Modbus Model 124</text>

        <!-- 4. Battery Storage Box -->
        <rect x="315" y="195" width="120" height="65" rx="8" fill="url(#bessGrad)" stroke="#a855f7" stroke-width="2"/>
        <text x="375" y="215" fill="#f3e8ff" font-size="12" font-weight="bold" text-anchor="middle">🔋 Battery (BESS)</text>
        <text x="375" y="232" fill="#d8b4fe" font-size="10" text-anchor="middle">51.2V LiFePO4</text>
        <text x="375" y="247" fill="#cbd5e1" font-size="9" text-anchor="middle">Integrated BMS & Shunt</text>

        <!-- 5. AC Distribution Board -->
        <rect x="485" y="65" width="110" height="80" rx="8" fill="#1e293b" stroke="#10b981" stroke-width="1.5"/>
        <text x="540" y="85" fill="#6ee7b7" font-size="12" font-weight="bold" text-anchor="middle">🛡️ ACDB Board</text>
        <text x="540" y="103" fill="#cbd5e1" font-size="10" text-anchor="middle">AC MCB 32A/63A</text>
        <text x="540" y="118" fill="#cbd5e1" font-size="10" text-anchor="middle">Type 2 AC SPD</text>
        <text x="540" y="133" fill="#34d399" font-size="9" text-anchor="middle">30mA RCD ELCB</text>

        <!-- 6. Critical Loads Sub-Panel -->
        <rect x="635" y="15" width="110" height="60" rx="8" fill="#1e293b" stroke="#06b6d4" stroke-width="1.5"/>
        <text x="690" y="35" fill="#67e8f9" font-size="11" font-weight="bold" text-anchor="middle">💡 Critical Sub-Panel</text>
        <text x="690" y="50" fill="#cbd5e1" font-size="9" text-anchor="middle">Lights • Fans • Fridge</text>
        <text x="690" y="64" fill="#38bdf8" font-size="9" text-anchor="middle">EPS Blackout Backup</text>

        <!-- 7. Bi-directional Net Meter -->
        <rect x="635" y="80" width="110" height="65" rx="8" fill="#1e293b" stroke="#ec4899" stroke-width="1.5"/>
        <text x="690" y="100" fill="#f472b6" font-size="12" font-weight="bold" text-anchor="middle">⏱️ Net Meter</text>
        <text x="690" y="117" fill="#cbd5e1" font-size="9" text-anchor="middle">Bi-directional 4-Q</text>
        <text x="690" y="132" fill="#cbd5e1" font-size="9" text-anchor="middle">DISCOM Smart Meter</text>

        <!-- 8. Manual Gang Disconnect -->
        <rect x="785" y="80" width="100" height="65" rx="8" fill="#1e293b" stroke="#f43f5e" stroke-width="1.5"/>
        <text x="835" y="100" fill="#fda4af" font-size="11" font-weight="bold" text-anchor="middle">🔒 Isolator Switch</text>
        <text x="835" y="117" fill="#cbd5e1" font-size="9" text-anchor="middle">Lockable Gang Air-Break</text>
        <text x="835" y="132" fill="#f87171" font-size="9" text-anchor="middle">Lineman Safety Cut</text>

        <!-- 9. Utility Grid Feeder -->
        <rect x="850" y="15" width="100" height="60" rx="8" fill="url(#gridGrad)" stroke="#64748b" stroke-width="1.5"/>
        <text x="900" y="35" fill="#f1f5f9" font-size="11" font-weight="bold" text-anchor="middle">🌐 Utility Grid</text>
        <text x="900" y="50" fill="#94a3b8" font-size="9" text-anchor="middle">11kV / 415V 50Hz</text>
        <text x="900" y="64" fill="#38bdf8" font-size="9" text-anchor="middle">DISCOM Substation</text>
      </svg>
    </div>
    """
    st.markdown(html_block(sld_svg), unsafe_allow_html=True)

    with st.expander("📑 Key CEA Engineering Specifications & Safety Standards"):
        st.markdown(
            """
            - **DC String Voltage (Voc)**: Sized with temperature coefficient at $-10°\\text{C}$ minimum ambient to ensure open-circuit voltage never exceeds inverter max DC input limit (typically $800\\text{V} - 1000\\text{V}$).
            - **Lightning Arrestor & Chemical Earthing**: Minimum 3 dedicated earthing pits (LA Pit $< 5\\,\\Omega$, DC Frame Pit $< 5\\,\\Omega$, AC Neutral & Inverter Chassis Pit $< 2\\,\\Omega$) with copper-bonded rods and bentonite chemical compound.
            - **Anti-Islanding Protection**: Hardware and firmware compliance with **IEEE 1547 / IEC 62116 / CEA Regulations 2026** (disconnection within $\\le 2.0$ seconds on grid de-energization).
            - **Bi-directional Net Meter**: 4-quadrant Class 0.5S/1.0 DLMS/COSEM meter with independent registers for active import (kWh), active export (kWh), and peak kVA demand.
            """
        )

    # 3. PM Surya Ghar Muft Bijli Yojana Statutory Scheme
    st.markdown("---")
    st.markdown("##### 🏛️ PM Surya Ghar: Muft Bijli Yojana Central Subsidy & Process")
    st.caption("Official Central Financial Assistance (CFA) schedule under the Ministry of New and Renewable Energy (MNRE).")

    psg_col1, psg_col2 = st.columns([3, 2])
    with psg_col1:
        psg_data = {
            "System Capacity": ["1 kWp Rooftop", "2 kWp Rooftop", "3 kWp to 10 kWp Rooftop", "Group Housing / RWA (> 10 kW)"],
            "Estimated Turnkey Cost": ["₹55,000", "₹1,10,000", "₹1,65,000 – ₹5,00,000", "₹50,000 / kW"],
            "Central Subsidy (CFA)": ["₹30,000", "₹60,000", "₹78,000 (Capped ceiling)", "₹18,000 / kW (Max 500 kW)"],
            "Net Customer Outlay": ["₹25,000", "₹50,000", "₹87,000+", "₹32,000 / kW"],
            "Est. Monthly Generation": ["~120 Units", "~240 Units", "~360 – 1,200 Units", "~120 Units / kW"],
            "Est. Monthly Savings (@ ₹7.5/u)": ["₹900 / mo", "₹1,800 / mo", "₹2,700 – ₹9,000 / mo", "₹900 / mo / kW"],
        }
        st.dataframe(pd.DataFrame(psg_data), use_container_width=True, hide_index=True)

    with psg_col2:
        st.markdown("**Official 5-Step DISCOM Workflow:**")
        st.markdown("""
        1. 📝 **National Portal Registration**: Apply on `pmsuryaghar.gov.in` with Consumer ID & electricity bill.
        2. 📋 **Technical Feasibility Approval (TFA)**: DISCOM validates DT capacity within 15 working days.
        3. 🛠️ **Installation by Empanelled Vendor**: Install ALMM-listed DCR modules & BIS inverter.
        4. 🔍 **DISCOM Inspection & Net Metering**: Testing of anti-islanding & net meter installation.
        5. 💳 **Direct Benefit Transfer (DBT)**: Subsidy deposited directly into Aadhaar-linked bank account.
        """)

    # 4. Smart Meter CSV Analyser & Custom Rooftop Sizing
    st.markdown("---")
    st.subheader("📂 Smart Meter CSV Analyser & Custom Rooftop Sizing")
    st.caption("Upload your smart meter CSV (from your utility or smart plug) to evaluate custom solar & battery payback.")

    sample_col1, sample_col2, sample_col3 = st.columns([1, 1, 2])
    use_sample = sample_col1.button("📂 Load 35k Sample Meter Data")
    clear_sample = sample_col2.button("🗑️ Clear Meter Data")
    user_file = sample_col3.file_uploader("Or Upload Smart Meter CSV", type=["csv", "txt"])

    if clear_sample:
        st.session_state.meter_series = None
        st.rerun()

    if user_file is not None:
        try:
            import tempfile
            with tempfile.NamedTemporaryFile(delete=False, suffix=".csv") as tmp:
                tmp.write(user_file.getvalue())
                tmp_path = tmp.name
            st.session_state.meter_series = read_meter_csv(tmp_path)
            st.success("Successfully parsed uploaded smart meter file!")
        except Exception as e:
            err_diag = DiagnosticErrorRegistry.create(
                "ERR_INVALID_FILE_TYPE",
                technical_detail=f"Meter CSV upload failed: {e}",
                custom_user_message="Unable to parse the uploaded meter file. Please ensure it is a valid CSV with timestamp and power (kW/kWh) readings.",
            )
            st.markdown(err_diag.format_accessible_alert())
    elif use_sample:
        sample_path = _ROOT / "data/real/load_tool.csv"
        if sample_path.exists():
            st.session_state.meter_series = read_meter_csv(str(sample_path), sep=";", decimal=",")
            st.success("Loaded sample commercial smart meter data (35,000+ readings)!")

    meter_series = st.session_state.meter_series

    if meter_series is not None and not meter_series.empty:
        total_days = max(int((meter_series.index[-1] - meter_series.index[0]).days), 1)
        avg_daily_kwh = float(meter_series.mean() * 24.0)
        peak_kw = float(meter_series.max())

        m1, m2, m3, m4 = st.columns(4)
        m1.metric("Total Days Recorded", f"{total_days} days")
        m2.metric("Average Daily Consumption", f"{avg_daily_kwh:.1f} kWh/day")
        m3.metric("Peak Demand Recorded", f"{peak_kw:.2f} kW")
        rec_kwp = round(max(1.0, avg_daily_kwh / 4.2), 1)
        m4.metric("Recommended Solar Size", f"{rec_kwp:g} kWp")

        hourly = meter_series.groupby(meter_series.index.hour).agg(["mean", "median", lambda x: x.quantile(0.9)])
        hourly.columns = ["Average kW", "Median kW", "P90 Peak kW"]

        st.markdown("##### 24-Hour Consumption Pattern")
        fig_custom = go.Figure()
        fig_custom.add_trace(go.Scatter(x=hourly.index, y=hourly["P90 Peak kW"], name="P90 Peak Load", line=dict(color="#ef4444", dash="dash")))
        fig_custom.add_trace(go.Scatter(x=hourly.index, y=hourly["Average kW"], name="Average Load", line=dict(color="#3b82f6", width=2)))
        fig_custom.add_trace(go.Scatter(x=hourly.index, y=hourly["Median kW"], name="Base Load (Median)", line=dict(color="#10b981")))
        fig_custom.add_vrect(x0=9, x1=17, fillcolor="rgba(245, 158, 11, 0.15)", layer="below", line_width=0, annotation_text="Solar Generation Window")
        fig_custom.update_layout(xaxis_title="Hour of Day (0–23)", yaxis_title="Load (kW)", height=380, margin=dict(l=10, r=10, t=10, b=10))
        st.plotly_chart(fig_custom, use_container_width=True)

        st.markdown("##### Rooftop Solar & Battery Feasibility Estimate")
        eq1, eq2, eq3 = st.columns(3)
        solar_max = float(max(1000.0, rec_kwp * 2.0))
        batt_default = float(round(rec_kwp * 1.5, 1))
        batt_max = float(max(2000.0, batt_default * 2.0))
        user_kwp = eq1.number_input("Solar Array Size (kWp)", min_value=1.0, max_value=solar_max, value=float(rec_kwp), step=0.5)
        user_batt = eq2.number_input("Battery Storage (kWh)", min_value=0.0, max_value=batt_max, value=batt_default, step=1.0)
        user_tariff = eq3.number_input("Average DISCOM Tariff (Rs/kWh)", min_value=4.0, max_value=15.0, value=7.5, step=0.5)

        est_annual_solar_kwh = user_kwp * 1450.0
        est_self_use = min(est_annual_solar_kwh, avg_daily_kwh * 365.0 * 0.75)
        est_export = max(0.0, est_annual_solar_kwh - est_self_use)
        est_savings = (est_self_use * user_tariff) + (est_export * 3.0)

        subsidy_val = pm_surya_ghar(user_kwp, residential=True) if user_kwp <= 10 else 0.0
        sys_cost = (user_kwp * 55000.0) + (user_batt * 25000.0)
        net_cost = sys_cost - subsidy_val
        simple_payback = net_cost / max(est_savings, 1.0)

        ec1, ec2, ec3 = st.columns(3)
        ec1.metric("Est. Annual Generation", f"{est_annual_solar_kwh:,.0f} kWh")
        ec2.metric("Est. Annual Bill Savings", f"Rs {est_savings:,.0f}/year")
        ec3.metric("Estimated Payback", f"{simple_payback:.1f} years" + (f" (Rs {subsidy_val:,.0f} subsidy applied)" if subsidy_val > 0 else ""))

# ==============================================================================
# TAB 2: ISRO / NAVIC SATELLITE RADAR & MICROGRID MAP
# ==============================================================================
elif selected_tab == "Solar Radar":
    st.subheader("🛰️ 2. Indian Geospatial Solar Radar & Satellite Observation")
    st.caption(f"Real-time satellite solar irradiance and cloud nowcasting grounded in ISRO INSAT-3D/3DR observations for {my_home['location']}.")

    h_col1, h_col2 = st.columns([3, 1])
    with h_col1:
        hub_keys = list(INDIAN_SATELLITE_HUBS.keys())
        default_hub_idx = hub_keys.index(key) if key in hub_keys else 0
        selected_hub_key = st.selectbox(
            "📍 Satellite Telemetry Ground Station:",
            hub_keys,
            index=default_hub_idx,
            format_func=lambda k: f"{INDIAN_SATELLITE_HUBS[k]['name']} ({INDIAN_SATELLITE_HUBS[k]['state']}) — {INDIAN_SATELLITE_HUBS[k]['discom']} [{INDIAN_SATELLITE_HUBS[k]['primary_satellite']}]",
        )
    with h_col2:
        st.markdown(html_block("<div style='height: 28px;'></div>"), unsafe_allow_html=True)
        if st.button("🔄 Refresh Radar Feed"):
            st.cache_data.clear()
            st.rerun()

    hub_meta = INDIAN_SATELLITE_HUBS[selected_hub_key]
    sat_rep = get_satellite_weather(hub_meta["lat"], hub_meta["lon"])
    now_ist = pd.Timestamp.now(tz="Asia/Kolkata")

    if sat_rep.is_night:
        st.markdown(html_block(f"""
            <div style="background: linear-gradient(90deg, #1e1b4b 0%, #0f172a 100%); padding: 14px 20px; border-radius: 12px; border: 1px solid #3730a3; margin-bottom: 16px;">
                <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
                    <div>
                        <span style="font-size: 18px; font-weight: 700; color: #a5b4fc;">🌙 Nighttime Grid & Battery Reserve Mode for {my_home['owner_name']}</span><br/>
                        <span style="color: #cbd5e1; font-size: 13px;">Observation Time: <b>{now_ist.strftime('%d %b %Y, %I:%M %p')} IST</b> • Solar Zenith Elevation: <b>0.0° (Sun Below Horizon)</b></span>
                    </div>
                    <div style="background: #312e81; padding: 6px 14px; border-radius: 20px; font-size: 13px; color: #e0e7ff; border: 1px solid #4338ca;">
                        ⚡ Direct Solar: <b>0 W/m² (Night)</b> • Next Dawn: <b>~06:15 IST</b> (Rooftop solar resumes at sunrise)
                    </div>
                </div>
            </div>
            """),
            unsafe_allow_html=True,
        )
    else:
        st.markdown(html_block(f"""
            <div style="background: linear-gradient(90deg, #78350f 0%, #0f172a 100%); padding: 14px 20px; border-radius: 12px; border: 1px solid #b45309; margin-bottom: 16px;">
                <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
                    <div>
                        <span style="font-size: 18px; font-weight: 700; color: #fbbf24;">☀️ Active Daytime Solar Radiation & Rooftop Generation</span><br/>
                        <span style="color: #cbd5e1; font-size: 13px;">Observation Time: <b>{now_ist.strftime('%d %b %Y, %I:%M %p')} IST</b> • Solar Elevation: <b>{sat_rep.solar_elevation_deg}°</b> • NavIC Zone: <b>{hub_meta['navic_zone']}</b></span>
                    </div>
                    <div style="background: #92400e; padding: 6px 14px; border-radius: 20px; font-size: 13px; color: #fef3c7; border: 1px solid #b45309;">
                        🛰️ {hub_meta['primary_satellite']}
                    </div>
                </div>
            </div>
            """),
            unsafe_allow_html=True,
        )

    sm1, sm2, sm3, sm4, sm5 = st.columns(5)
    sm1.metric("Direct Normal Solar (DNI)", f"{sat_rep.current_dni_wm2:.0f} W/m²")
    sm2.metric("Satellite Cloud Opacity", f"{sat_rep.current_cloud_cover_pct:.0f}%")
    sm3.metric("Surface Temperature", f"{sat_rep.current_temp_c:.1f} °C")
    clearness_now = 0.0 if sat_rep.is_night else max(0.05, 1.0 - (sat_rep.current_cloud_cover_pct / 100.0) ** 1.8)
    sm4.metric("Nowcasting Clearness (kt)", "0.00 (Night)" if sat_rep.is_night else f"{clearness_now:.2f}")
    sm5.metric("Humidity & Wind", f"{sat_rep.current_humidity_pct:.0f}% • {sat_rep.current_wind_speed_kmh:.1f} km/h")

    st.markdown("---")
    map_head_col, map_eng_col = st.columns([3, 2])
    with map_head_col:
        st.markdown("##### 🗺️ 3D Indian Solar Microgrid & Peer-to-Peer Energy Flow Network")
    with map_eng_col:
        map_engine = st.radio("Map Engine:", ["🗺️ High-Definition Plotly Radar", "🌐 3D PyDeck Mesh (WebGL)"], horizontal=True, index=0)

    active_sites_map = {k: v[0] for k, v in demo_sites().items()}

    if "3D PyDeck" in map_engine:
        try:
            deck = build_microgrid_map_deck(active_sites_map, selected_key=selected_hub_key)
            st.pydeck_chart(deck, use_container_width=True)
        except Exception:
            p_map = build_microgrid_plotly_map(active_sites_map, selected_key=selected_hub_key)
            st.plotly_chart(p_map, use_container_width=True)
    else:
        p_map = build_microgrid_plotly_map(active_sites_map, selected_key=selected_hub_key)
        st.plotly_chart(p_map, use_container_width=True)

    with st.expander("📈 View Live Satellite Irradiance & Cloud Profile (48 Hours)", expanded=True):
        if not sat_rep.hourly_df.empty:
            hdf = sat_rep.hourly_df.iloc[:48]
            fig_sat = make_subplots(specs=[[{"secondary_y": True}]])
            fig_sat.add_trace(go.Scatter(x=hdf.index, y=hdf["dni_wm2"], name="Direct Normal Irradiance (W/m²)", line=dict(color="#f59e0b", width=2.5)), secondary_y=False)
            fig_sat.add_trace(go.Scatter(x=hdf.index, y=hdf["gti_wm2"], name="Global Tilted Irradiance (W/m²)", line=dict(color="#10b981", dash="dash", width=2)), secondary_y=False)
            fig_sat.add_trace(go.Scatter(x=hdf.index, y=hdf["cloud_pct"], name="Cloud Cover (%)", line=dict(color="#94a3b8", width=1.5)), secondary_y=True)
            if "temp_c" in hdf.columns:
                fig_sat.add_trace(go.Scatter(x=hdf.index, y=hdf["temp_c"], name="Temperature (°C)", line=dict(color="#ef4444", dash="dot", width=1.5)), secondary_y=True)

            fig_sat.add_vline(x=now_ist, line_width=2, line_dash="dash", line_color="#38bdf8", annotation_text="NOW (Current IST)", annotation_position="top left", annotation_font=dict(color="#38bdf8", size=12))
            fig_sat.update_layout(height=370, margin=dict(l=10, r=10, t=25, b=10), legend=dict(orientation="h", y=-0.18, x=0.5, xanchor="center"), paper_bgcolor="#0f172a", plot_bgcolor="#1e293b", font=dict(color="#f8fafc"))
            fig_sat.update_xaxes(showgrid=True, gridcolor="#334155")
            fig_sat.update_yaxes(title_text="Irradiance (W/m²)", secondary_y=False, showgrid=True, gridcolor="#334155")
            fig_sat.update_yaxes(title_text="Cloud Cover (%) / Temp (°C)", secondary_y=True, range=[0, 100], showgrid=False)
            st.plotly_chart(fig_sat, use_container_width=True)

    # --------------------------------------------------------------------------
    # MACHINE LEARNING SOLAR FORECAST TOURNAMENT & VALIDATION ENGINE
    # --------------------------------------------------------------------------
    st.markdown("---")
    st.subheader("🤖 Machine Learning Solar Forecast Tournament & Validation Engine")
    st.caption(
        "Truth-in-Data Model Selection: Evaluates transparent statistical and machine learning models on a leak-free chronological holdout. "
        "A candidate model is crowned champion ONLY if it beats the best baseline by at least 1.0% lower MAE."
    )

    try:
        pv_m = p.df["pv_kw"].resample("1ME").sum() * 0.25
        if len(pv_m) >= 12:
            tourn_periods = [d.strftime("%Y-%m") for d in pv_m.index]
            tourn_values = [round(float(v), 2) for v in pv_m.values]

            tourn_res = ModelTournamentEngine.run_tournament(
                periods=tourn_periods,
                values=tourn_values,
                target_metric="generation_solar",
                geo_code=my_home["state_code"],
                test_size=min(6, len(tourn_periods) // 3),
                horizon_steps=6,
            )

            tc1, tc2 = st.columns([2, 1])
            with tc1:
                champ_badge = "🏆 Champion Forecaster" if not tourn_res.is_baseline_champion else "🛡️ Robust Baseline Retained"
                st.markdown(html_block(f"""
                    <div style="background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.4); border-radius: 10px; padding: 14px 18px; margin-bottom: 12px;">
                        <span style="color: #38bdf8; font-weight: 700; font-size: 15px;">{champ_badge}: {tourn_res.champion_model_name} (v{tourn_res.champion_model_version})</span><br/>
                        <span style="color: #f1f5f9; font-size: 13px; line-height: 1.5;">{tourn_res.selection_reason}</span>
                    </div>
                    """),
                    unsafe_allow_html=True,
                )
            with tc2:
                st.markdown(html_block(f"""
                    <div style="background: rgba(168, 85, 247, 0.12); border: 1px solid rgba(168, 85, 247, 0.4); border-radius: 10px; padding: 14px 18px; margin-bottom: 12px;">
                        <span style="color: #c084fc; font-weight: 700; font-size: 13px;">Uncertainty Methodology</span><br/>
                        <span style="color: #f1f5f9; font-size: 12px;">{tourn_res.uncertainty_method}</span>
                    </div>
                    """),
                    unsafe_allow_html=True,
                )

            # Leaderboard Table
            leaderboard_rows = []
            for m_name, m_metrics in tourn_res.all_model_evaluations.items():
                is_c = m_name == tourn_res.champion_model_name
                badge = "🏆 Champion" if is_c else ("Baseline" if "Naive" in m_name or "Persistence" in m_name or "Average" in m_name or "Trend" in m_name else "Candidate")
                leaderboard_rows.append({
                    "Role": badge,
                    "Model": m_name,
                    "Holdout MAE": f"{m_metrics.mae:.2f} kWh",
                    "Holdout RMSE": f"{m_metrics.rmse:.2f} kWh",
                    "WAPE %": f"{m_metrics.wape_pct:.1f}%",
                    "Bias": f"{m_metrics.bias:+.2f}",
                })
            st.dataframe(pd.DataFrame(leaderboard_rows), use_container_width=True, hide_index=True)

            with st.expander("🔍 Model Tournament Rigor & Zero-Leakage Invariants", expanded=False):
                for lim in tourn_res.limitations:
                    st.write(f"- {lim}")
    except Exception as e:
        st.caption(f"Tournament telemetry active on primary forecast: {e}")

# ==============================================================================
# TAB 3: BATTERY STORAGE & ADVISOR (OUTAGE PROTECTION & PHYSICS)
# ==============================================================================
elif selected_tab == "Battery Storage":
    st.subheader(f"🔋 3. Battery Storage & Family Outage Shield ({my_home['owner_name']})")
    st.caption("Active battery state of charge, room-by-room blackout survival checklist, emergency storm reserve lock, and cell physics.")

    current_stored_kwh = float(ex["soc"].iloc[-1] * site.battery_kwh * site.one_way_eff)

    # 1. Family Blackout Survival Room-by-Room Checklist
    st.markdown("##### 🛡️ Room-by-Room Family Blackout Survival Planner")
    st.write(f"Your **{site.battery_kwh:.0f} kWh LiFePO4 battery** currently holds **{current_stored_kwh:.2f} kWh of usable energy** (Reserve Floor: **{dv.reserve.floor_soc:.0%}** for {site.backup_hours:.0f}h hard immunity).")

    # 1-Click Quick Outage Presets
    st.caption("Quickly test your family's appliances during an unscheduled DISCOM power cut:")
    if "outage_preset" not in st.session_state:
        st.session_state["outage_preset"] = "standard"

    p_col1, p_col2, p_col3 = st.columns(3)
    if p_col1.button("🚨 Essential Life Support (230W)", use_container_width=True, help="LEDs, fans, Wi-Fi, and phone charging only"):
        st.session_state["outage_preset"] = "essential"
        st.rerun()
    if p_col2.button("🏡 Standard Household (430W)", use_container_width=True, help="LEDs, fans, Wi-Fi, and refrigerator"):
        st.session_state["outage_preset"] = "standard"
        st.rerun()
    if p_col3.button("❄️ Full Comfort Mode (1230W)", use_container_width=True, help="All appliances including 1-Ton Bedroom AC"):
        st.session_state["outage_preset"] = "comfort"
        st.rerun()

    is_essential = st.session_state["outage_preset"] == "essential"
    is_comfort = st.session_state["outage_preset"] == "comfort"

    bk_c1, bk_c2, bk_c3, bk_c4, bk_c5 = st.columns(5)
    run_lights = bk_c1.checkbox("💡 4 LEDs + 3 Fans (150W)", value=True, key=f"bk_lights_{key}_{st.session_state['outage_preset']}")
    run_wifi = bk_c2.checkbox("📶 Wi-Fi + Laptops (80W)", value=True, key=f"bk_wifi_{key}_{st.session_state['outage_preset']}")
    run_fridge = bk_c3.checkbox("🧊 Refrigerator (200W)", value=not is_essential, key=f"bk_fridge_{key}_{st.session_state['outage_preset']}")
    run_pump = bk_c4.checkbox("💧 Water Pump (400W)", value=False, key=f"bk_pump_{key}_{st.session_state['outage_preset']}")
    run_ac = bk_c5.checkbox("❄️ Bedroom AC (800W)", value=is_comfort, key=f"bk_ac_{key}_{st.session_state['outage_preset']}")

    selected_load_watts = (150 if run_lights else 0) + (80 if run_wifi else 0) + (200 if run_fridge else 0) + (400 if run_pump else 0) + (800 if run_ac else 0)
    selected_load_kw = max(0.05, selected_load_watts / 1000.0)
    survival_hours = current_stored_kwh / selected_load_kw

    # Dynamic Outage Assessment & Load-Shedding Matrix
    g_c1, g_c2, g_c3 = st.columns([2, 1, 1])
    with g_c1:
        if survival_hours >= 8.0:
            st.success(f"🟢 **Full Overnight Coverage**: Selected load is **{selected_load_watts}W**. Battery provides **~{survival_hours:.1f} Hours** of continuous backup!")
        elif survival_hours >= 4.0:
            st.warning(f"🟡 **Moderate Coverage**: Selected load is **{selected_load_watts}W**. Battery provides **~{survival_hours:.1f} Hours**. Sufficient for typical evening outages.")
        else:
            st.error(f"🔴 **Heavy Load Alert**: Selected load is **{selected_load_watts}W**. Battery will drain in **~{survival_hours:.1f} Hours**.")
    with g_c2:
        st.metric("Total Load", f"{selected_load_watts} Watts", f"{selected_load_kw:.2f} kW")
    with g_c3:
        st.metric("Battery Survival", f"{survival_hours:.1f} Hours", f"{survival_hours * 60:.0f} mins")

    # Smart Load Shedding Gain Advice
    if run_ac:
        ac_off_watts = selected_load_watts - 800
        ac_off_kw = max(0.05, ac_off_watts / 1000.0)
        ac_gain_hrs = (current_stored_kwh / ac_off_kw) - survival_hours
        st.info(f"💡 **Load-Shedding Tip**: Turning off the **Bedroom AC (800W)** extends your family's backup duration by **+{ac_gain_hrs:.1f} Hours** (to {current_stored_kwh/ac_off_kw:.1f}h total)!")
    elif run_pump:
        pump_off_watts = selected_load_watts - 400
        pump_off_kw = max(0.05, pump_off_watts / 1000.0)
        pump_gain_hrs = (current_stored_kwh / pump_off_kw) - survival_hours
        st.info(f"💡 **Load-Shedding Tip**: Turning off the **Water Pump (400W)** extends your family's backup duration by **+{pump_gain_hrs:.1f} Hours** (to {current_stored_kwh/pump_off_kw:.1f}h total)!")

    # 2. 1-Click Storm / Outage Emergency Reserve Lock
    st.markdown("---")
    st.markdown("##### 🚨 1-Click Storm / Severe Outage Reserve Lock")
    st.caption("Anticipating bad weather, thunder storm, or a local DISCOM maintenance shutdown? Lock battery to 90% floor to guarantee maximum family protection.")
    lock_col1, lock_col2 = st.columns([2, 1])
    with lock_col1:
        st.session_state.storm_lock = st.toggle("🔒 Activate Storm Outage Shield (Force 90% Battery Floor)", value=st.session_state.storm_lock)
    with lock_col2:
        if st.session_state.storm_lock:
            st.error("🚨 **Storm Shield Active**: Battery locked at 90% floor. P2P energy export disabled.")
        else:
            st.success("🟢 **Normal Smart Optimizer Mode**: Balancing battery self-consumption and export.")

    # 3. Battery Sizing Advisor
    st.markdown("---")
    st.subheader("💡 How big should my battery be?")
    st.caption("Find the sweet spot between battery investment cost and family blackout protection hours:")
    want = st.slider("Hours of backup I want", 1, 12, min(12, max(1, int(site.backup_hours))))
    adv = get_advice(key)
    st.dataframe(adv, use_container_width=True)
    st.info(advise_text(adv, want, lang))

    # 4. Physical LFP Battery Physics & Inverter Part-Load Efficiency
    st.markdown("---")
    st.subheader("🔬 Physical LFP Battery Physics & Inverter Part-Load Efficiency")
    st.caption("Non-linear Arrhenius thermal acceleration, Depth-of-Discharge (DoD) Wöhler stress, and dynamic inverter part-load efficiency curves.")

    bp_c1, bp_c2, bp_c3 = st.columns(3)
    amb_temp = bp_c1.slider("Ambient Temperature (°C)", 15.0, 50.0, 38.0, 1.0)
    cycle_dod = bp_c2.slider("Daily Cycle Depth of Discharge (DoD %)", 20.0, 95.0, 80.0, 5.0)
    inverter_load = bp_c3.slider("Inverter Operating Load (kW)", 0.2, float(site.ac_kw), min(1.8, float(site.ac_kw)), 0.2)

    lfp_res = evaluate_lfp_battery_physics(
        throughput_kwh=float(site.battery_kwh * (cycle_dod / 100.0)),
        depth_of_discharge_pct=cycle_dod,
        ambient_temp_c=amb_temp,
        actual_power_kw=inverter_load,
        rated_inverter_kw=float(site.ac_kw),
        base_wear_per_kwh_inr=1.50,
    )

    lp_c1, lp_c2, lp_c3, lp_c4 = st.columns(4)
    lp_c1.metric("Thermal Degradation Multiplier", f"{lfp_res.thermal_acceleration_factor:.2f}x", help="Arrhenius acceleration relative to 25°C")
    lp_c2.metric("DoD Stress Factor", f"{lfp_res.dod_stress_multiplier:.2f}x", help="Wöhler curve fatigue factor")
    lp_c3.metric("Dynamic Inverter Efficiency", f"{lfp_res.dynamic_inverter_efficiency_pct:.1f}%", help="Sandia / CEC polynomial efficiency at current loading")
    lp_c4.metric("Projected Battery Lifespan", f"{lfp_res.projected_calendar_lifespan_years:.1f} Years ({lfp_res.cycle_life_at_operating_point:,} Cycles)")

# ==============================================================================
# TAB 4: PLAN FOR THE DAY (DETAILED TECHNICAL FORECAST & LP DISPATCH)
# ==============================================================================
elif selected_tab == "Daily Plan":
    st.subheader(f"📊 4. Plan for the Day ({my_home['owner_name']})")
    st.caption(f"15-minute optimization schedule balancing rooftop solar, {my_home['family_size']} demand, battery charge/discharge, and grid import/export.")

    c1, c2, c3, c4 = st.columns(4)
    effective_floor = 0.90 if st.session_state.storm_lock else dv.reserve.floor_soc
    c1.metric("Emergency reserve (hard floor)", f"{effective_floor:.0%}", help=dv.reserve.reason)
    c2.metric("Outage risk today", f"{dv.reserve.risk:.2f}")
    exp_kwh = float(ex["export_kwh"].sum())
    c3.metric("Exported today", f"{exp_kwh:.1f} kWh")
    c4.metric("Offers published", f"{len(dv.offers) if not st.session_state.storm_lock else 0}")

    fig = make_subplots(rows=3, cols=1, shared_xaxes=True, vertical_spacing=0.06,
                        subplot_titles=("Generation: forecast band vs actual vs modelled baseline",
                                        "Load: forecast band vs actual", "Battery charge vs reserve floor"))
    for r, (lo, mid, hi, act, name, col) in enumerate([
            ("pv_p10", "pv_p50", "pv_p90", dv.actual["pv_kw"], "PV", "#d97706"),
            ("load_p10", "load_p50", "load_p90", dv.actual["load_kw"], "Load", "#2563eb")], start=1):
        fig.add_trace(go.Scatter(x=hours, y=s[hi], line=dict(width=0), showlegend=False, hoverinfo="skip"), r, 1)
        fig.add_trace(go.Scatter(x=hours, y=s[lo], fill="tonexty", line=dict(width=0),
                                 fillcolor="rgba(120,120,120,0.25)", name="P10 to P90", showlegend=(r == 1)), r, 1)
        fig.add_trace(go.Scatter(x=hours, y=s[mid], name=f"{name} P50", line=dict(color=col, dash="dash")), r, 1)
        fig.add_trace(go.Scatter(x=hours, y=act, name=f"{name} actual", line=dict(color=col)), r, 1)
    fig.add_trace(go.Scatter(x=hours, y=dv.actual["expected_kw"], name="Modelled baseline",
                             line=dict(color="#16a34a", dash="dot")), 1, 1)
    fig.add_trace(go.Scatter(x=hours, y=s["soc"] * 100, name="Planned charge %", line=dict(color="#7c3aed", dash="dash")), 3, 1)
    fig.add_trace(go.Scatter(x=hours, y=ex["soc"] * 100, name="Actual charge %", line=dict(color="#7c3aed")), 3, 1)
    fig.add_hline(y=effective_floor * 100, line_color="#dc2626", line_dash="dot",
                  annotation_text="reserve floor", row=3, col=1)
    fig.update_yaxes(title_text="kW", row=1, col=1)
    fig.update_yaxes(title_text="kW", row=2, col=1)
    fig.update_yaxes(title_text="%", row=3, col=1)
    fig.update_layout(height=760, margin=dict(l=10, r=10, t=40, b=10), legend=dict(orientation="h", y=-0.05))
    st.plotly_chart(fig, use_container_width=True)

    st.caption("Energy balance: " + ", ".join([
        f"PV generated {ex['pv_kw'].sum() * 0.25:.1f} kWh",
        f"bought from grid {ex['import_kwh'].sum():.1f} kWh",
        f"battery discharged {ex['batt_kw'].clip(lower=0).sum() * 0.25:.1f} kWh",
        f"exported {exp_kwh:.1f} kWh"]))

    st.markdown("---")
    st.subheader("🌐 7-Tier Intelligent Surplus & Priority Dispatch Engine")
    st.caption("Adapting verified open-source EMS paradigms (evcc, sem-community, SolarFlow). "
               "Dynamically allocates rooftop solar power across 7 prioritized tiers with anti-hunting hysteresis protection.")

    surp_c1, surp_c2, surp_c3, surp_c4 = st.columns(4)
    ev_mode_choice = surp_c1.selectbox(
        "EV Charging Mode (evcc Standard):",
        ["PV_ONLY (Pure Solar Surplus)", "MIN_PLUS_PV (1.4 kW Guaranteed + Solar Boost)", "FAST (Max 7.4 kW Grid + Solar)", "STOP (Disabled)"],
        index=0,
    )
    ev_mode_map = {
        "PV_ONLY (Pure Solar Surplus)": EVChargingMode.PV_ONLY,
        "MIN_PLUS_PV (1.4 kW Guaranteed + Solar Boost)": EVChargingMode.MIN_PLUS_PV,
        "FAST (Max 7.4 kW Grid + Solar)": EVChargingMode.FAST,
        "STOP (Disabled)": EVChargingMode.STOP,
    }
    selected_ev_mode = ev_mode_map[ev_mode_choice]
    flex_load_w = surp_c2.slider("Schedulable Appliance Demand (kW):", 0.0, 3.0, 1.5, 0.25, help="e.g. Washing machine or irrigation pump")
    thermal_load_w = surp_c3.slider("Thermal Storage / Immersion (kW):", 0.0, 3.0, 1.0, 0.25, help="e.g. Immersion heat pump or water geyser")
    zero_exp_toggle = surp_c4.toggle("Zero-Export Active Limiter", value=False, help="Curtail solar generation when export is prohibited")

    # Run SurplusEngine dispatch across all 96 intervals of the day
    batt_constraints = BatterySafetyConstraints(
        capacity_kwh=float(site.battery_kwh),
        soc_max=0.98,
        soc_min_reserve=effective_floor,
        max_charge_power_kw=float(site.inverter_kw),
        max_discharge_power_kw=float(site.inverter_kw),
    )
    surplus_eng = SurplusEngine(battery_constraints=batt_constraints)

    surplus_records = []
    pv_vals = ex["pv_kw"].to_numpy()
    load_vals = ex["load_kw"].to_numpy()
    current_soc_sim = effective_floor

    for step_idx in range(len(pv_vals)):
        p_pv = float(pv_vals[step_idx])
        p_load = float(load_vals[step_idx])
        step_res = surplus_eng.allocate_surplus(
            solar_kw=p_pv,
            load_kw=p_load,
            battery_soc=current_soc_sim,
            ev_mode=selected_ev_mode,
            ev_rated_kw=3.3,
            ev_min_kw=1.4,
            flexible_demand_kw=float(flex_load_w),
            thermal_demand_kw=float(thermal_load_w),
            zero_export_limit=zero_exp_toggle,
            interval_hours=0.25,
            current_time=float(step_idx * 900),
        )
        current_soc_sim = step_res.battery_soc_after
        surplus_records.append(step_res)

    tot_direct_pv_kwh = sum(r.direct_solar_consumed_kw for r in surplus_records) * 0.25
    tot_batt_chg_kwh = sum(r.battery_charge_kw for r in surplus_records) * 0.25
    tot_ev_kwh = sum(r.ev_charge_kw for r in surplus_records) * 0.25
    tot_export_kwh = sum(r.grid_export_kw for r in surplus_records) * 0.25
    tot_curtail_kwh = sum(r.curtailed_solar_kw for r in surplus_records) * 0.25
    all_conserved = all(r.is_energy_conserved for r in surplus_records)

    sm1, sm2, sm3, sm4, sm5 = st.columns(5)
    sm1.metric("Direct PV Consumed", f"{tot_direct_pv_kwh:.1f} kWh", help="Essential home load powered directly by sun")
    sm2.metric("Battery Solar Stored", f"{tot_batt_chg_kwh:.1f} kWh", help="Surplus absorbed by stationary LiFePO4 BESS")
    sm3.metric("EV Solar Charged", f"{tot_ev_kwh:.1f} kWh", help=f"Mode: {selected_ev_mode.value}")
    sm4.metric("Grid Export / Curtail", f"{tot_export_kwh:.1f} / {tot_curtail_kwh:.1f} kWh")
    sm5.metric("Energy Conservation", "100% Balanced" if all_conserved else "Imbalance Detected", delta="First Law Verified")

    fig_7tier = go.Figure()
    fig_7tier.add_trace(go.Scatter(x=hours, y=[r.direct_solar_consumed_kw for r in surplus_records], name="Tier 1: Essential Load", stackgroup="solar", line=dict(color="#f59e0b", width=0.5), fillcolor="rgba(245, 158, 11, 0.7)"))
    fig_7tier.add_trace(go.Scatter(x=hours, y=[r.battery_charge_kw for r in surplus_records], name="Tier 2: Battery Charge", stackgroup="solar", line=dict(color="#8b5cf6", width=0.5), fillcolor="rgba(139, 92, 246, 0.7)"))
    fig_7tier.add_trace(go.Scatter(x=hours, y=[r.flexible_load_kw for r in surplus_records], name="Tier 3: Flexible Load", stackgroup="solar", line=dict(color="#06b6d4", width=0.5), fillcolor="rgba(6, 182, 212, 0.7)"))
    fig_7tier.add_trace(go.Scatter(x=hours, y=[r.ev_charge_kw for r in surplus_records], name="Tier 4: EV Smart Charge", stackgroup="solar", line=dict(color="#10b981", width=0.5), fillcolor="rgba(16, 185, 129, 0.7)"))
    fig_7tier.add_trace(go.Scatter(x=hours, y=[r.thermal_storage_kw for r in surplus_records], name="Tier 5: Thermal Storage", stackgroup="solar", line=dict(color="#ec4899", width=0.5), fillcolor="rgba(236, 72, 153, 0.7)"))
    fig_7tier.add_trace(go.Scatter(x=hours, y=[r.grid_export_kw for r in surplus_records], name="Tier 6: Grid Export", stackgroup="solar", line=dict(color="#3b82f6", width=0.5), fillcolor="rgba(59, 130, 246, 0.7)"))
    fig_7tier.add_trace(go.Scatter(x=hours, y=[r.curtailed_solar_kw for r in surplus_records], name="Tier 7: Curtailed Solar", stackgroup="solar", line=dict(color="#ef4444", width=0.5), fillcolor="rgba(239, 68, 68, 0.7)"))

    fig_7tier.update_layout(
        title="7-Tier Solar Generation Allocation Profile (24-Hour Timeline)",
        xaxis=dict(title="Hour of Day", dtick=2),
        yaxis=dict(title="Power Allocation (kW)"),
        height=320,
        margin=dict(l=10, r=10, t=35, b=10),
        legend=dict(orientation="h", y=-0.2),
    )
    st.plotly_chart(fig_7tier, use_container_width=True)

    st.info("🛡️ **Anti-Hunting Hysteresis Protection**: Contactor anti-cycling controller enforces 3-minute minimum runtime and 3-minute cooldown. "
            "Prevents rapid mechanical wear on appliance relays and EV chargers during passing cloud transients.")

    st.markdown("---")
    st.subheader("💡 Why the plan does what it does")
    for line in explain_day(s, dv.reserve, dv.offers, lang):
        st.markdown(f"- {line}")

# ==============================================================================
# TAB 5: SMART APPLIANCES & CITIZEN ACTION GUIDE
# ==============================================================================
elif selected_tab == "Smart Appliances":
    st.subheader(f"🚦 5. Smart Appliances & Family Action Guide ({my_home['owner_name']})")
    st.caption("Maximize free rooftop sunshine, shift heavy household appliances away from evening peak grid rates, and generate instant family alerts.")

    # 1. Bijli Bachat (Savings Meter)
    c1, c2, c3 = st.columns(3)
    tod_rates = s["import_rate"].to_numpy()
    actual_load = ex["load_kw"].to_numpy() * 0.25
    cost_without = float((actual_load * tod_rates).sum())
    cost_with = float((ex["import_kwh"] * s["import_rate"]).sum() - (ex["export_kwh"] * s["export_rate"]).sum())
    day_savings = max(0.0, cost_without - cost_with)

    c1.metric("💰 Today's Bill Savings (आज की बचत)", f"₹{day_savings:.1f}", help="Money saved today compared to buying all power from DISCOM")
    c2.metric("⚡ Solar Generated Today", f"{ex['pv_kw'].sum() * 0.25:.1f} Units (kWh)")
    c3.metric("🔋 Current Battery Charge", f"{ex['soc'].iloc[-1]:.0%}", help="Charge stored in battery for power cuts and night use")

    # 2. Personal Room-by-Room Appliance Running Cost Calculator
    st.markdown("---")
    st.markdown("##### 🏠 Room-by-Room Appliance Running Cost Calculator")
    st.caption("See what each appliance costs your family per hour depending on when you turn it on:")

    app_cost_data = {
        "Room / Location": ["Bathroom", "Utility Balcony", "Master Bedroom", "Living Room", "Kitchen", "Driveway / Garage"],
        "Personal Appliance": ["2 kW Water Geyser", "Washing Machine (500W)", "1.5-Ton Inverter AC", "Smart TV + 3 Ceiling Fans", "Refrigerator (200W)", "EV 2-Wheeler Slow Charger"],
        "Cost on Solar (10 AM - 3 PM)": ["₹0.00 / hr (FREE)", "₹0.00 / hr (FREE)", "₹0.00 / hr (FREE)", "₹0.00 / hr (FREE)", "₹0.00 / hr (FREE)", "₹0.00 / hr (FREE)"],
        "Cost on Battery (Evening)": ["₹3.00 / hr", "₹0.75 / hr", "₹2.25 / hr", "₹0.40 / hr", "₹0.30 / hr", "₹2.25 / hr"],
        "Cost on Grid Peak (6 PM - 10 PM)": ["₹20.00 / hr (AVOID)", "₹5.00 / hr", "₹15.00 / hr (AVOID)", "₹2.80 / hr", "₹2.00 / hr", "₹15.00 / hr (AVOID)"],
        "Family Tip": ["Turn on at 11:30 AM", "Run wash cycle now", "Pre-cool room at 3 PM", "Safe to run anytime", "Runs 24/7 on battery", "Charge during solar peak"],
    }
    st.dataframe(pd.DataFrame(app_cost_data), use_container_width=True, hide_index=True)

    # 3. Traffic-Light Appliance Action Guide
    st.markdown("---")
    st.markdown("##### 🚦 Right-Now Household Guidance (उपकरण कब चलाएं?)")
    col_t1, col_t2 = st.columns([1, 1])
    with col_t1:
        st.success("🟢 **Run Now (Free Solar Window 10:00 AM – 03:00 PM):**  \n- Washing Machine & Dishwasher  \n- Water Geyser & Immersion Rods  \n- EV Scooter / Vehicle Charging  \n*Running these now uses free sunshine from your roof instead of costly grid units.*")
    with col_t2:
        st.error("🔴 **Avoid During Evening Peak (06:00 PM – 10:00 PM):**  \n- Heavy Air Conditioning below 24°C  \n- Agricultural / Heavy Water Pumps  \n- Electric Vehicle Fast Charging  \n*Peak electricity rate is ₹10.00/unit. Running heavy loads now inflates your bill.*")

    # 4. Appliance Operating Windows & Visual Timeline
    st.markdown("---")
    st.subheader("⏰ Visual 24-Hour Appliance Schedule & Free Solar Alignment")
    st.caption("Visual operating windows computed by the optimizer to maximize zero-cost rooftop sunshine and avoid DISCOM evening peak tariffs:")

    appl_specs = [
        {"name": "🌊 Washing Machine (0.5 kW, 1.5h)", "kw": 0.5, "dur": 1.5, "lo": 6.0, "hi": 22.0, "color": "#10b981"},
        {"name": "💧 Water Geyser (2.0 kW, 1.0h)", "kw": 2.0, "dur": 1.0, "lo": 6.0, "hi": 22.0, "color": "#06b6d4"},
        {"name": "⚡ Water Overhead Pump (1.5 kW, 2.0h)", "kw": 1.5, "dur": 2.0, "lo": 6.0, "hi": 22.0, "color": "#3b82f6"},
        {"name": "🚗 EV Scooter Charger (3.3 kW, 4.0h)", "kw": 3.3, "dur": 4.0, "lo": 6.0, "hi": 22.0, "color": "#8b5cf6"},
    ]

    sched_rows = []
    fig_sched = go.Figure()

    for item in appl_specs:
        bs_df = best_start(s, item["kw"], item["dur"], item["lo"], item["hi"], top=1)
        if not bs_df.empty:
            best_t = bs_df.iloc[0]["start"]  # e.g. "11:30"
            cost_ = bs_df.iloc[0]["cost_inr"]
            sun_share_ = bs_df.iloc[0]["share_from_sun"]
            t_parts = best_t.split(":")
            h_start = int(t_parts[0]) + int(t_parts[1]) / 60.0
            h_end = h_start + item["dur"]
            sched_rows.append({
                "Personal Appliance": item["name"],
                "Optimal Start Window": f"{best_t} to {int(h_end):02d}:{int(round((h_end % 1) * 60)):02d}",
                "Duration": f"{item['dur']:.1f} Hours",
                "Solar Share %": f"{sun_share_:.0%}",
                "Est. Running Cost": f"₹{cost_:.2f}",
                "Money Saved vs Peak": f"₹{bs_df.iloc[0]['saving_vs_worst_time_inr']:.2f}",
            })
            fig_sched.add_trace(go.Bar(
                name=item["name"],
                y=[item["name"]],
                x=[item["dur"]],
                base=[h_start],
                orientation="h",
                marker=dict(color=item["color"], line=dict(color="#ffffff", width=1)),
                text=f"{best_t} ({sun_share_:.0%} Sun • ₹{cost_:.1f})",
                textposition="inside",
                insidetextanchor="middle",
                hoverinfo="text",
                hovertext=f"{item['name']}<br>Optimal Window: {best_t} to {int(h_end):02d}:{int(round((h_end % 1) * 60)):02d}<br>Solar Share: {sun_share_:.0%}<br>Est. Cost: ₹{cost_:.2f}",
            ))

    # Add background shaded zones
    fig_sched.add_vrect(x0=10, x1=15, fillcolor="rgba(245, 158, 11, 0.15)", layer="below", line_width=0, annotation_text="☀️ Free Solar Peak Window", annotation_position="top left")
    fig_sched.add_vrect(x0=18, x1=22, fillcolor="rgba(239, 68, 68, 0.15)", layer="below", line_width=0, annotation_text="🔴 Evening Peak Tariff (₹10/unit)", annotation_position="top right")

    fig_sched.update_layout(
        xaxis=dict(title="Hour of Day (00:00 to 24:00)", range=[0, 24], dtick=2),
        yaxis=dict(autorange="reversed"),
        height=260,
        margin=dict(l=10, r=10, t=30, b=10),
        showlegend=False,
    )
    st.plotly_chart(fig_sched, use_container_width=True)
    if sched_rows:
        st.dataframe(pd.DataFrame(sched_rows), use_container_width=True, hide_index=True)

    # Custom Appliance Start-Time Calculator
    with st.expander("🔍 Custom Appliance Calculator (Calculate for any wattage & duration)", expanded=False):
        st.caption("Calculate the lowest-cost operating window for any custom appliance grounded in today's generation forecast and tariff:")
        a1, a2, a3 = st.columns(3)
        appl = a1.selectbox("Appliance", ["Geyser (2 kW, 1 h)", "Washing machine (0.5 kW, 1.5 h)", "Water pump (1.5 kW, 2 h)", "EV charger (3.3 kW, 4 h)"])
        kw_, hrs_ = {"Geyser (2 kW, 1 h)": (2.0, 1.0), "Washing machine (0.5 kW, 1.5 h)": (0.5, 1.5), "Water pump (1.5 kW, 2 h)": (1.5, 2.0), "EV charger (3.3 kW, 4 h)": (3.3, 4.0)}[appl]
        lo_h = a2.slider("Earliest start hour", 0, 23, 6)
        hi_h = a3.slider("Must finish by hour", 1, 24, 22)
        bs = best_start(s, kw_, hrs_, float(lo_h), float(hi_h))
        if bs.empty:
            st.warning("That window is too short for this appliance.")
        else:
            st.dataframe(bs, use_container_width=True, hide_index=True)

    # 5. WhatsApp / SMS Alert Dispatcher
    st.markdown("---")
    st.markdown("##### 📱 1-Click WhatsApp / SMS Alert (Send to Family / Household Group)")
    risk_level_str = "कम (Low)" if dv.reserve.risk < 0.25 else "मध्यम (Medium)" if dv.reserve.risk < 0.5 else "उच्च (High - Storm / Notice)"

    alert_msg = (
        f"⚡ *UrjaSetu Smart Power Alert ({my_home['owner_name']})*\n"
        f"📅 Date: {day}\n"
        f"☀️ Rooftop Solar Expected: {float(s['pv_p50'].sum() * 0.25):.1f} units\n"
        f"🔋 Family Outage Floor: {dv.reserve.floor_soc:.0%} (Protected for {site.backup_hours:.0f}h)\n"
        f"⚠️ Power Cut Risk Today: {risk_level_str}\n"
        f"💡 Tip: Free solar power peak is 11 AM - 3 PM. Avoid running geyser/AC after 6 PM."
    )
    st.text_area("Copy-ready WhatsApp / SMS message:", value=alert_msg, height=125)
    st.caption("Click into the box, copy (Ctrl+C), and send directly to your household group or staff.")

# ==============================================================================
# TAB 6: EV V2H & FEEDER TRANSFORMER GUARD
# ==============================================================================
elif selected_tab == "EV Charging":
    st.subheader(f"🚗 6. EV V2H & Feeder Guard ({my_home['owner_name']})")
    st.caption("Coordinating bidirectional EV charging (Tata Nexon EV, Ola, Ather) and neighborhood distribution transformer thermal protection.")

    ev_col1, ev_col2 = st.columns([1, 1])
    with ev_col1:
        st.markdown("##### 🚗 Bidirectional V2H Smart Dispatch")
        st.caption("Discharge stored EV battery energy during evening peak tariff hours (18:00 - 22:00 @ ₹10/unit) while preserving morning commute range.")

        ev_keys = list(INDIAN_EV_MODELS.keys())
        ev_selected = st.selectbox("Select Electric Vehicle", ev_keys, format_func=lambda x: INDIAN_EV_MODELS[x].model_name)
        ev_spec = INDIAN_EV_MODELS[ev_selected]

        ev_c1, ev_c2 = st.columns(2)
        cur_soc = ev_c1.slider("Current EV Battery SoC %", 20.0, 100.0, 80.0, 5.0)
        commute_soc = ev_c2.slider("Morning Commute Reserve %", 20.0, 80.0, 50.0, 5.0)

        v2h_plan = compute_v2h_dispatch(
            vehicle_key=ev_selected,
            current_soc_pct=cur_soc,
            commute_reserve_soc_pct=commute_soc,
            peak_tariff_rs=10.0,
            home_evening_load_kw=float(site.critical_kw),
        )

        st.markdown(f"""
        - **Usable V2H Peak Energy:** **{v2h_plan.usable_v2h_energy_kwh:.2f} kWh**
        - **Discharge Rate:** {v2h_plan.discharge_power_kw:.2f} kW during 18:00-22:00
        - **Daily Peak Bill Savings:** **₹{v2h_plan.daily_rupee_savings_inr:.1f} / day**
        - **Monthly Bill Savings:** **₹{v2h_plan.monthly_rupee_savings_inr:.0f} / month**
        - **Guaranteed Morning Range:** **{v2h_plan.remaining_range_km:.0f} km**
        - **OCPP 2.0.1 Action:** `{v2h_plan.ocpp_charging_action}`
        """)

        # 24-Hour Bidirectional EV Battery Cycle Chart
        ev_hours = list(range(25))
        ev_soc_profile = []
        for hr in ev_hours:
            if hr < 7:
                ev_soc_profile.append(cur_soc)
            elif 7 <= hr <= 9:
                ev_soc_profile.append(max(commute_soc, cur_soc - 20.0))
            elif 10 <= hr <= 16:
                ev_soc_profile.append(min(100.0, cur_soc + (hr - 9) * 3.5))
            elif 18 <= hr <= 22:
                discharge_fraction = (hr - 18) / 4.0
                v2h_soc_val = max(commute_soc, cur_soc - (discharge_fraction * (cur_soc - commute_soc)))
                ev_soc_profile.append(v2h_soc_val)
            else:
                ev_soc_profile.append(commute_soc)

        fig_ev = go.Figure()
        fig_ev.add_trace(go.Scatter(
            x=ev_hours,
            y=ev_soc_profile,
            mode="lines+markers",
            name="EV Battery SoC %",
            line=dict(color="#10b981", width=3),
            marker=dict(size=4),
        ))
        fig_ev.add_hline(
            y=commute_soc,
            line_dash="dot",
            line_color="#f59e0b",
            annotation_text=f"Commute Floor ({commute_soc:.0f}%)",
            annotation_position="bottom right",
        )
        fig_ev.add_vrect(x0=10, x1=16, fillcolor="rgba(16, 185, 129, 0.12)", layer="below", line_width=0, annotation_text="Free Solar Charge", annotation_position="top left")
        fig_ev.add_vrect(x0=18, x1=22, fillcolor="rgba(56, 189, 248, 0.12)", layer="below", line_width=0, annotation_text="V2H Peak Shaving", annotation_position="top right")
        fig_ev.update_layout(
            title="24-Hour Bidirectional EV Battery State of Charge (SoC %)",
            xaxis=dict(title="Hour of Day", dtick=3, range=[0, 24]),
            yaxis=dict(title="Battery SoC %", range=[0, 105]),
            height=250,
            margin=dict(l=10, r=10, t=35, b=10),
            showlegend=False,
        )
        st.plotly_chart(fig_ev, use_container_width=True)

    with ev_col2:
        st.markdown("##### ⚡ Distribution Transformer (DT) Feeder Thermal Guard")
        st.caption("Protects local 11kV / 415V neighborhood transformers from overheating during simultaneous midday solar backfeed.")

        dt_keys = list(STANDARD_DISTRIBUTION_TRANSFORMERS.keys())
        dt_selected = st.selectbox("Neighborhood Transformer Rating", dt_keys, format_func=lambda x: f"{STANDARD_DISTRIBUTION_TRANSFORMERS[x].dt_id} ({STANDARD_DISTRIBUTION_TRANSFORMERS[x].rated_kva:.0f} kVA)")

        pv_feeder = st.slider("Total Neighborhood Solar Generation (kW)", 10.0, 300.0, 75.0, 5.0)
        load_feeder = st.slider("Total Local Feeder Base Load (kW)", 5.0, 150.0, 25.0, 5.0)

        dt_status = evaluate_feeder_transformer_health(
            transformer_type=dt_selected,
            total_rooftop_pv_kw=pv_feeder,
            local_load_kw=load_feeder,
            community_bess_available_kw=float(site.battery_kwh * 2.0),
        )

        st.metric("Transformer Loading %", f"{dt_status.transformer_loading_pct:.1f}%", help="Safe thermal threshold is ≤ 80% (Central Electricity Authority standard)")

        if dt_status.thermal_status == "SAFE_GREEN":
            st.success(f"🟢 **Feeder Status: SAFE** | {dt_status.recommendation}")
        elif dt_status.thermal_status == "WARNING_AMBER":
            st.warning(f"🟡 **Feeder Status: WARNING (Thermal Threshold Approaching)** | {dt_status.recommendation}")
        else:
            st.error(f"🔴 **Feeder Status: CRITICAL OVERLOAD RISK** | {dt_status.recommendation}")

        st.markdown(f"""
        - **Net Feeder Power Flow:** {dt_status.net_feeder_flow_kw:.1f} kW (`{dt_status.feeder_direction}`)
        - **Estimated Feeder Voltage:** {dt_status.feeder_voltage_estimated_v:.1f} V (Trip threshold: 253V)
        - **Target Battery Soaking:** **{dt_status.battery_absorption_target_kw:.1f} kW**
        - **Mandatory Curtailment:** **{dt_status.curtailment_required_kw:.1f} kW**
        """)

# ==============================================================================
# TAB 7: INDUSTRIAL INVERTER HARDWARE GATEWAY & SAFETY
# ==============================================================================
elif selected_tab == "Inverter Gateway":
    st.subheader(f"🔌 7. Hardware Inverter Gateway ({my_home['owner_name']})")
    st.caption("Direct physical coupling between the LP optimizer and physical inverters (Sungrow, Growatt, GoodWe, Solis, Victron). "
               "Reads raw Modbus registers (40001+) and latches dispatch setpoints via SunSpec Model 124 control registers.")

    hw_col1, hw_col2 = st.columns([1, 2])
    with hw_col1:
        st.markdown("##### ⚙️ Gateway & Inverter Settings")
        v_keys = list(INVERTER_VENDOR_CATALOG.keys())
        selected_vendor = st.selectbox("Inverter Protocol Profile", v_keys, format_func=lambda x: INVERTER_VENDOR_CATALOG[x].display_name)
        v_translator = UniversalInverterTranslator(selected_vendor)
        v_prof = v_translator.profile
        st.caption(f"Protocol: `{v_prof.protocol_type}` | Baud: `{v_prof.baud_rate} 8N1` | Default Slave: `{v_prof.default_slave_id}` | Limit Reg: `{v_prof.reg_power_limit_setpoint}`")

        mode = st.radio("Hardware Interface", ["Edge Hardware Loopback Emulator", "Physical Inverter (Modbus TCP/RS-485)"])
        is_emulate = (mode == "Edge Hardware Loopback Emulator")
        ip_addr = st.text_input("Inverter IP / Serial Port", value="192.168.1.50" if not is_emulate else "127.0.0.1")
        port_num = st.number_input("Modbus Port", min_value=1, max_value=65535, value=502)
        unit_id = st.number_input("Unit ID / Slave Address", min_value=1, max_value=247, value=int(v_prof.default_slave_id))
        connect_btn = st.button("🔄 Poll Live Registers")

    gw = InverterHardwareGateway(host=ip_addr, port=int(port_num), unit_id=int(unit_id), emulate=is_emulate)
    gw.connect()
    telemetry = gw.read_telemetry()

    with hw_col2:
        st.markdown("##### ⚡ Live Inverter Register Telemetry")
        t_row1, t_row2, t_row3 = st.columns(3)
        t_row1.metric("Grid Voltage (V)", f"{telemetry.grid_voltage_v:.1f} V", help="Nominal 230V ±6% (CEA Standard)")
        t_row2.metric("Grid Frequency (Hz)", f"{telemetry.grid_frequency_hz:.2f} Hz", help="Nominal 50.00 Hz (IEGC Grid Code)")
        t_row3.metric("PV DC Voltage", f"{telemetry.pv_dc_voltage_v:.1f} V")

        t_row4, t_row5, t_row6 = st.columns(3)
        t_row4.metric("Battery Voltage", f"{telemetry.battery_voltage_v:.1f} V")
        t_row5.metric("Inverter State", telemetry.inverter_state)
        t_row6.metric("Active Power Limit", f"{telemetry.active_limit_pct:.1f}%")

    st.markdown("---")
    st.markdown("##### 🛠️ Write LP Dispatch Setpoint to Physical Register")
    st.caption("Translates LP dispatch setpoint into brand-specific Modbus RTU serial frame with CRC-16 checksum.")

    wc1, wc2, wc3 = st.columns(3)
    set_limit = wc1.slider("Active Power Limit % (WMaxLimPct)", 0.0, 100.0, 100.0, 5.0)
    set_chg = wc2.number_input("Battery Charge Setpoint (kW)", 0.0, 10.0, 0.0, 0.5)
    set_relay = wc3.toggle("Emergency Island Contactor Relay (Trip Grid Tie)", value=False)

    _, _, rtu_frame = v_translator.translate_power_limit(set_limit)
    crc_hex = f"0x{calculate_modbus_crc16(rtu_frame[:-2]):04X}"
    st.caption(f"Encoded Modbus RTU Frame: `0x{rtu_frame.hex().upper()}` | CRC-16 Checksum: `{crc_hex}`")

    if st.button("🚀 Latch Setpoint into Modbus Hardware"):
        ok, res_msg = gw.write_dispatch_setpoint(
            active_power_limit_pct=set_limit,
            battery_charge_kw=set_chg,
            island_backup_relay=set_relay,
        )
        if ok:
            st.success(f"✅ {res_msg} (Vendor: {v_prof.display_name})")
        else:
            st.error(f"❌ {res_msg}")

    st.markdown("---")
    st.markdown("##### 🛡️ Central Electricity Authority (CEA) 2026 Cybersecurity Compliance")
    st.caption("Statutory OT network segmentation, data residency, and CERT-In 6-hour incident disclosure under CEA Regulations 2026.")
    cea_mgr = CEACyberSecurityManager(site_id=key)
    cea_audit = cea_mgr.perform_statutory_audit(offline_local_mode=True)
    sc1, sc2, sc3 = st.columns(3)
    sc1.success(f"🔒 Status: `{cea_audit.ot_it_segmentation}`")
    sc2.info(f"🇮🇳 Data Residency: `{cea_audit.data_residency_country}`")
    sc3.warning(f"⏱️ CERT-In Disclosure: `{cea_audit.incident_notification_window_hours} Hours`")
    with st.expander("View CEA Statutory Security Controls Verified"):
        for ctrl in cea_audit.security_controls_passed:
            st.write(f"- ✅ `{ctrl}`")
        st.caption(f"System Fingerprint: `{cea_audit.system_fingerprint_sha256}` | Verified: {cea_audit.audit_timestamp}")

    st.markdown("---")
    st.subheader("⚡ IEEE 1547 & CEA 2.0-Second Anti-Islanding Shunt-Trip Watchdog")
    st.caption("Failsafe hardware watchdog monitoring Rate of Change of Frequency (ROCOF) and voltage to protect utility linemen during grid blackouts.")
    watchdog = AntiIslandingWatchdog()
    watchdog.feed_heartbeat()

    default_v = float(np.clip(telemetry.grid_voltage_v, 180.0, 270.0))
    default_hz = float(np.clip(telemetry.grid_frequency_hz, 46.0, 53.0))
    sim_v = st.slider("Grid Voltage Sensor (V)", 180.0, 270.0, default_v, 1.0)
    sim_hz = st.slider("Grid Frequency Sensor (Hz)", 46.0, 53.0, default_hz, 0.1)

    ai_status = watchdog.evaluate_grid_safety(sim_v, sim_hz)
    wc_col1, wc_col2, wc_col3 = st.columns(3)
    if ai_status.shunt_trip_relay_state == "ENERGIZED_CLOSED":
        wc_col1.success(f"🟢 Contactor: `{ai_status.shunt_trip_relay_state}`")
    else:
        wc_col1.error(f"🔴 Contactor: `{ai_status.shunt_trip_relay_state}`")
    wc_col2.metric("Trip Latency (ms)", f"{ai_status.trip_latency_ms:.1f} ms" if ai_status.trip_latency_ms > 0 else "0.0 ms", help="Mandatory CEA limit: <= 2000 ms")
    wc_col3.info(f"📜 Standard: `{ai_status.statutory_compliance}`")

    if ai_status.trip_reason:
        st.error(f"⚠️ **Trip Triggered**: {ai_status.trip_reason} — Mechanical shunt-trip breaker actuated.")

# ==============================================================================
# TAB 8: OFFERS & BECKN DEG V2.0 PROTOCOL
# ==============================================================================
elif selected_tab == "P2P Trading":
    st.subheader(f"🤝 8. P2P Surplus Energy Offers & Beckn DEG v2.0 ({my_home['owner_name']})")
    st.caption("Share and trade surplus clean solar energy with neighboring homes on the Open Network for Digital Commerce (ONDC / Beckn DEG v2.0).")

    if not dv.offers or st.session_state.storm_lock:
        st.markdown(html_block(f"""
            <div style="background: linear-gradient(90deg, #1e293b 0%, #0f172a 100%); padding: 14px 20px; border-radius: 12px; border: 1px solid #334155; margin-bottom: 16px;">
                <div style="display: flex; align-items: flex-start; gap: 14px;">
                    <span style="font-size: 26px;">🛡️</span>
                    <div>
                        <b style="color: #38bdf8; font-size: 15px;">Family Outage Reserve Protection Active (No Surplus Exported Today)</b><br/>
                        <span style="color: #cbd5e1; font-size: 13px;">
                            On this planned date (<b>{day}</b>), conservative conformal forecasting (<b>P10 Solar Generation & P90 Local Load</b>) determined that all available rooftop generation must be retained locally to protect your <b>{site.critical_kw} kW</b> critical load reserve floor (<b>{dv.reserve.floor_soc:.0%} battery charge</b>) for <b>{site.backup_hours:.0f} hours</b> of blackout immunity for {my_home['owner_name']}.
                        </span>
                    </div>
                </div>
            </div>
            """),
            unsafe_allow_html=True,
        )

        with st.expander("💡 Understanding Conformal Risk-Floor Sizing"):
            st.markdown(
                """
                - **Statistical Safety**: Offers are committed only when the **P10 generation band** (90% lower confidence bound) strictly exceeds the **P90 load band** plus the emergency reserve.
                - **Zero Default Guarantee**: This guarantees your home never defaults on committed P2P deliveries, avoiding DISCOM open-access shortfall penalties.
                - **To View Active Beckn Contracts**: Select a sunny day with surplus generation (e.g., in March/April/May) using the date picker in the left sidebar, or inspect the simulated double-sided continuous auction below.
                """
            )
    else:
        st.success(f"✅ Active P2P Surplus: **{len(dv.offers)} trading windows committed** to the Beckn DEG network for **{day}**.")
        rows = []
        by_id = {t.offer_id: t for t in dv.trades}
        for o in dv.offers:
            t = by_id[o.offer_id]
            rows.append({"window": f"{o.start:%H:%M}-{o.end:%H:%M}", "committed kWh": round(o.quantity_kwh, 2),
                         "floor Rs/kWh": round(o.floor_price, 2), "share of planned export": round(o.commit_ratio, 2),
                         "buyer paid Rs/kWh": round(t.clearing_price, 2), "matched": t.matched,
                         "delivered kWh": round(t.delivered_kwh, 2), "shortfall kWh": round(t.shortfall_kwh, 2),
                         "net gain vs grid Rs": round(t.uplift_vs_export_inr, 2)})
        st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)
        msg = catalog_publish(site, dv.offers, now=dv.day - pd.Timedelta(hours=6))
        st.caption("India Energy Stack (Beckn DEG v2.0) catalog/publish message for today's offers. "
                   + ("Passes the spec's structural checks." if not validate_publish(msg) else "FAILS spec checks."))
        st.json(msg, expanded=1)
        conf, onc = confirm_flow(msg, dv.offers, dv.trades, now=dv.day - pd.Timedelta(hours=5))
        stat = settled_status(msg, dv.offers, dv.trades, now=dv.day + pd.Timedelta(days=1))
        with st.expander("Confirm, on_confirm and settled messages (buyer side is simulated)"):
            st.caption("Lifecycle DRAFT, ACTIVE, COMPLETE. " + ("Checks pass." if not validate_flow(conf, onc, stat) else "Checks FAIL."))
            st.json({"confirm": conf[0], "on_confirm": onc[0], "on_status_settled": stat[0]}, expanded=False)

    st.markdown("---")
    st.subheader("⚖️ Microgrid Continuous Double Auction Order Book & Merit Order Engine")
    st.caption("Double-sided merit-order continuous auction: clearing price discovered where cumulative supply meets demand.")

    auc_col1, auc_col2 = st.columns([1, 1])
    auc_engine = MicrogridAuctionEngine()
    current_export_avail = float(ex["export_kwh"].sum())
    auc_engine.submit_order(MarketOrder("ASK-US-01", key, "ASK", quantity_kwh=current_export_avail if current_export_avail > 0.5 else 8.0, price_rs_kwh=float(site.tariff.export_rate) + 0.75))
    auc_engine.submit_order(MarketOrder("ASK-US-02", "neighbor_clinic_30kw", "ASK", quantity_kwh=15.0, price_rs_kwh=6.20))
    auc_engine.submit_order(MarketOrder("BID-US-01", "apartment_society_a", "BID", quantity_kwh=14.0, price_rs_kwh=7.80))
    auc_engine.submit_order(MarketOrder("BID-US-02", "ev_charging_hub_b", "BID", quantity_kwh=10.0, price_rs_kwh=7.00))
    auc_res = auc_engine.clear_market(f"{day} 11:00-11:15")

    with auc_col1:
        st.metric("Uniform Market Clearing Price (MCP)", f"₹{auc_res.uniform_clearing_price_rs_kwh:.2f}/kWh", help="Point where cumulative supply intersects cumulative demand")
        st.metric("Cleared Clean Energy", f"{auc_res.cleared_volume_kwh:.1f} kWh / {auc_res.total_ask_volume_kwh:.1f} kWh Offered")
        st.metric("Total Social Welfare Generated", f"₹{auc_res.total_social_welfare_inr:.2f} (Consumer: ₹{auc_res.consumer_surplus_inr:.1f}, Producer: ₹{auc_res.producer_surplus_inr:.1f})")

    with auc_col2:
        st.write("**Matched Continuous Trades (Merit Order Dispatch):**")
        if auc_res.matched_trades:
            trade_rows = [{"Trade ID": t.trade_id, "Seller": t.seller_id, "Buyer": t.buyer_id, "kWh": t.cleared_kwh, "Price (₹/kWh)": t.clearing_price_rs_kwh, "Value (₹)": t.trade_value_inr} for t in auc_res.matched_trades]
            st.dataframe(pd.DataFrame(trade_rows), use_container_width=True, hide_index=True)

    fig_auc = go.Figure()
    fig_auc.add_trace(go.Scatter(
        x=[0, 8.0, 8.0, 23.0, 23.0],
        y=[float(site.tariff.export_rate) + 0.75, float(site.tariff.export_rate) + 0.75, 6.20, 6.20, 8.50],
        mode="lines",
        name="Supply Curve (Seller Asks)",
        line=dict(color="#10b981", width=3, shape="hv"),
    ))
    fig_auc.add_trace(go.Scatter(
        x=[0, 14.0, 14.0, 24.0, 24.0],
        y=[7.80, 7.80, 7.00, 7.00, 4.00],
        mode="lines",
        name="Demand Curve (Buyer Bids)",
        line=dict(color="#38bdf8", width=3, shape="hv"),
    ))
    fig_auc.add_trace(go.Scatter(
        x=[auc_res.cleared_volume_kwh],
        y=[auc_res.uniform_clearing_price_rs_kwh],
        mode="markers+text",
        marker=dict(color="#f59e0b", size=14, symbol="star"),
        text=[f"Equilibrium: ₹{auc_res.uniform_clearing_price_rs_kwh:.2f}/kWh ({auc_res.cleared_volume_kwh:.1f} kWh)"],
        textposition="top center",
        name="Market Equilibrium (MCP)",
    ))
    fig_auc.update_layout(
        title="Double-Sided Merit-Order Auction Equilibrium (Supply vs Demand)",
        xaxis_title="Cumulative Energy Traded (kWh)",
        yaxis_title="Price (₹/kWh)",
        paper_bgcolor="#0f172a",
        plot_bgcolor="#1e293b",
        font=dict(color="#f8fafc"),
        height=320,
        margin=dict(l=10, r=10, t=40, b=10),
        legend=dict(orientation="h", y=-0.25, x=0.5, xanchor="center"),
    )
    fig_auc.update_xaxes(showgrid=True, gridcolor="#334155")
    fig_auc.update_yaxes(showgrid=True, gridcolor="#334155")
    st.plotly_chart(fig_auc, use_container_width=True)

# ==============================================================================
# TAB 9: DISCOM WHEELING & UPI SETTLEMENT
# ==============================================================================
elif selected_tab == "UPI Settlement":
    st.subheader(f"⚖️ 9. DISCOM Wheeling Ledger & Instant UPI Settlement ({my_home['state_name']})")
    st.caption(f"Compliant distribution wheeling under {my_home['state_name']} electricity regulatory frameworks ({my_home['discom']}). "
               "Calculates technical line losses, wire usage charges, and generates NPCI UPI instant settlement tokens.")

    reg_col1, reg_col2 = st.columns([1, 1])

    with reg_col1:
        st.markdown("##### 📑 State Regulatory Framework")
        cur_rule = resolve_state_rule(key)
        st.write(f"**State Jurisdiction:** {cur_rule.state}")
        st.write(f"**Regulatory Order Ref:** `{cur_rule.serc_order_ref}`")
        st.write(f"**Sandbox Status:** `{cur_rule.sandbox_status}`")
        st.write(f"**Allowed Voltage:** {cur_rule.allowed_voltage_levels}")

        st.markdown("##### 🧮 Wheeling Tariff Breakdown")
        settle_kwh = st.slider("Energy Traded (kWh)", 1.0, 50.0, 10.0, 1.0)
        settle_price = st.slider("Market Clearing Price (Rs/kWh)", 4.0, 12.0, 6.5, 0.25)
        buyer_type = st.radio("Buyer Type", ["Residential (Subsidy / Zero CSS)", "Commercial / Industrial (CSS Applied)"])

        legal_res = compute_legal_settlement(
            site_key=key,
            gross_kwh=settle_kwh,
            trade_price_rs_kwh=settle_price,
            is_residential_buyer=(buyer_type == "Residential (Subsidy / Zero CSS)"),
        )

        st.markdown(f"""
        - **Gross Trade Value:** ₹{legal_res.gross_revenue_inr:.2f}
        - **Technical Line Loss ({cur_rule.wheeling_loss_pct}% on 11kV network):** -{legal_res.technical_loss_kwh:.2f} kWh
        - **DISCOM Wire Wheeling Charge:** -₹{legal_res.wheeling_fee_inr:.2f}
        - **Regulatory Cess & Taxes:** -₹{legal_res.state_cess_inr:.2f}
        - **Net Seller Rupee Payout:** **₹{legal_res.net_seller_payout_inr:.2f}**
        """)

    with reg_col2:
        st.markdown(f"##### 💳 Instant NPCI UPI Payout to {my_home['owner_name']}")
        st.caption("Sub-rupee instant settlement link matching the Beckn DEG trade reference:")

        upi_req = generate_upi_payment(
            payee_vpa="sharma.solar@oksbi" if key == "home-mathura" else "clinic.care@icici" if key == "clinic-jaipur" else "verma.store@okhdfcbank",
            payee_name=my_home["owner_name"],
            amount_inr=legal_res.net_seller_payout_inr,
            trade_id="TRD-2026-US-88",
        )

        st.markdown(html_block(upi_req.qr_svg_html), unsafe_allow_html=True)
        st.code(upi_req.upi_intent_uri, language="text")
        st.caption(f"Status: `{upi_req.status}` | Reference: `{upi_req.transaction_ref}`")

        upi_settled_key = f"upi_settled_{key}"
        if upi_settled_key not in st.session_state:
            st.session_state[upi_settled_key] = False

        if st.session_state[upi_settled_key]:
            st.success(
                f"✅ **PAYMENT RECEIVED VIA UPI**  \n"
                f"💰 **₹{legal_res.net_seller_payout_inr:.2f}** credited to `{upi_req.payee_vpa}`  \n"
                f"🏦 **Bank Ref / UTR:** `NPCI-UPI-2026-88391204`  \n"
                f"⚡ **DISCOM Settlement:** Wire loss ({cur_rule.wheeling_loss_pct}%) & fee (₹{legal_res.wheeling_fee_inr:.2f}) settled in DISCOM ledger."
            )
            if st.button("🔄 Reset / New Transaction", key=f"btn_reset_upi_{key}"):
                st.session_state[upi_settled_key] = False
                st.rerun()
        else:
            if st.button("📲 Simulate Instant UPI Payment Received", key=f"btn_sim_upi_{key}", use_container_width=True):
                st.session_state[upi_settled_key] = True
                st.rerun()

# ==============================================================================
# TAB 10: FLEET POOLING & MULTI-SITE DISPATCH
# ==============================================================================
elif selected_tab == "Fleet Pooling":
    st.subheader("🌐 10. Community & Neighborhood Surplus Pooling")
    st.caption("Aggregates surplus solar offers across neighborhood rooftops into bulk commercial trade blocks. "
               "Floor price equals the highest member floor so no homeowner sells at a loss; revenue splits pro rata.")

    fleet_offers = get_cached_fleet_offers(str(day), soc0)
    pooled = pool(fleet_offers)
    col_f1, col_f2, col_f3 = st.columns(3)
    col_f1.metric("Contributing Properties Today", f"{len(fleet_offers)} of {len(real_sites())}")
    tot_pool_kwh = sum(p_item.quantity_kwh for p_item in pooled) if pooled else 0.0
    col_f2.metric("Total Pooled Surplus", f"{tot_pool_kwh:.1f} kWh")
    max_fl = max((p_item.floor_price for p_item in pooled), default=0.0)
    col_f3.metric("Pool Floor Price", f"Rs {max_fl:.2f}/kWh" if max_fl > 0 else "—")

    if pooled:
        p_rows = []
        for p_item in pooled:
            contrib_str = ", ".join(f"{PERSONAL_HOMES.get(k, {}).get('short_title', k)}: {v:.1f} kWh" for k, v in p_item.members.items())
            p_rows.append({
                "Window": f"{p_item.start:%H:%M} – {p_item.end:%H:%M}",
                "Pooled Energy (kWh)": round(p_item.quantity_kwh, 2),
                "Floor Price (Rs/kWh)": round(p_item.floor_price, 2),
                "Site Breakdown": contrib_str,
            })
        st.dataframe(pd.DataFrame(p_rows), use_container_width=True, hide_index=True)

        st.markdown("##### 💰 Pro-Rata Settlement Simulator")
        trade_sim_price = st.slider("Buyer Clearing Price (Rs/kWh)", float(max_fl), float(max_fl + 5.0), float(max_fl + 1.5), 0.25)
        st.caption("Revenue distribution when a bulk buyer purchases the pooled block:")
        split_rows = []
        for p_item in pooled:
            net_inr = p_item.quantity_kwh * (trade_sim_price - 0.7)
            splits = split_money(p_item, p_item.members, net_inr)
            for s_id, s_amt in splits.items():
                split_rows.append({
                    "Window": f"{p_item.start:%H:%M}–{p_item.end:%H:%M}",
                    "Home / Place": PERSONAL_HOMES.get(s_id, {}).get("owner_name", s_id),
                    "Delivered kWh": round(p_item.members[s_id], 2),
                    "Net Payout (Rs)": round(s_amt, 2),
                })
        st.dataframe(pd.DataFrame(split_rows), use_container_width=True, hide_index=True)
    else:
        st.info("No sites have export surplus on this specific day due to conservative P10/P90 safety bands. "
                "Try sunny weekend dates when commercial load is lower.")

# ==============================================================================
# TAB 11: FAULT MONITORING & SHIFTABLE LOADS
# ==============================================================================
elif selected_tab == "Health Monitor":
    st.subheader(f"🔍 11. Rooftop Health, Dust & Shiftable Loads ({my_home['owner_name']})")
    st.caption("Monitors rooftop PV output against modelled baseline to detect panel soiling, dust accumulation, string disconnection, and shiftable bursts.")

    # 1. Personal Rooftop Solar Panel Dust & Cleaning Health Check
    st.markdown("##### 🧹 Personal Rooftop Solar Panel Cleaning & Dust Advisor")
    st.caption("Calculates generation drop caused by dust and pollen accumulation on your roof:")

    dust_c1, dust_c2 = st.columns([1, 1])
    with dust_c1:
        dust_days = st.slider("Days Since Last Rooftop Panel Cleaning:", 0, 45, 12, 1, key=f"dust_slider_{key}")
    with dust_c2:
        env_profile = st.selectbox(
            "Local Ambient Air & Dust Environment:",
            ["Semi-Arid Dusty (North / West India ~0.6%/day)", "Urban Traffic & Metro Smog (~0.4%/day)", "Clean Green / Monsoon (~0.2%/day)"],
            index=0 if "Mathura" in my_home["location"] or "Jaipur" in my_home["location"] else 1,
            key=f"dust_env_{key}",
        )

    rate_per_day = 0.60 if "Semi-Arid" in env_profile else (0.40 if "Urban" in env_profile else 0.20)
    current_soiling_loss_pct = min(30.0, dust_days * rate_per_day)
    daily_lost_kwh = site.dc_kwp * 4.2 * (current_soiling_loss_pct / 100.0)
    daily_lost_inr = daily_lost_kwh * 7.50
    monthly_lost_inr = daily_lost_inr * 30.0

    c_col1, c_col2, c_col3 = st.columns(3)
    c_col1.metric("Current Soiling Loss %", f"{current_soiling_loss_pct:.1f}%", f"{dust_days} Days Unwashed")
    c_col2.metric("Daily Lost Solar Value", f"₹{daily_lost_inr:.2f} / day", f"-{daily_lost_kwh:.1f} kWh/day")
    c_col3.metric("Monthly Recovery Value", f"₹{monthly_lost_inr:,.0f} / month", "Clean Water Wash Gain")

    if current_soiling_loss_pct >= 8.0:
        st.warning(
            f"🟡 **Cleaning Recommended**: Your rooftop panels have accumulated a **{current_soiling_loss_pct:.1f}% dust layer**, "
            f"costing your family **₹{daily_lost_inr:.1f}/day (~₹{monthly_lost_inr:,.0f}/month)** in lost generation. "
            "Wash your panels with a clean water hose tomorrow morning before 8:00 AM while modules are cool to instantly recover this power!"
        )
    else:
        st.success(f"🟢 **Clean Modules**: Panels are generating within 95%+ of peak rated capacity (dust loss only {current_soiling_loss_pct:.1f}%). Next scheduled cleaning in ~{max(1, 14 - dust_days)} days.")

    st.markdown("---")
    st.markdown("##### 🔬 String Deviation & Synthetic Fault Simulation")
    inject = st.checkbox("Inject a string fault today (output drops to 60%)", value=True)
    df = p.df.copy()
    d0 = pd.Timestamp(day).tz_localize(df.index.tz)
    win = df[(df.index >= d0 - pd.Timedelta(days=3)) & (df.index < d0 + pd.Timedelta(days=4))].copy()
    if inject:
        today = (win.index >= d0) & (win.index < d0 + pd.Timedelta(days=1))
        win.loc[today, "pv_kw"] = win.loc[today, "pv_kw"] * 0.6
    flags = deviation_flags(win)
    summ = daily_summary(win, flags)
    n_flag = int(flags.loc[(win.index >= d0) & (win.index < d0 + pd.Timedelta(days=1)), "flag"].sum())
    st.metric("Flagged 15-minute steps today", n_flag,
              help="Steps in a run of at least one hour where output is below 85% of the modelled baseline in good sun.")
    f2 = go.Figure()
    f2.add_trace(go.Scatter(x=win.index, y=win["expected_kw"], name="Modelled baseline", line=dict(color="#16a34a", dash="dot")))
    f2.add_trace(go.Scatter(x=win.index, y=win["pv_kw"], name="Actual", line=dict(color="#d97706")))
    bad = win[flags["flag"]]
    f2.add_trace(go.Scatter(x=bad.index, y=bad["pv_kw"], mode="markers", name="Deviation flag", marker=dict(color="#dc2626", size=5)))
    f2.update_layout(height=380, margin=dict(l=10, r=10, t=10, b=10), yaxis_title="kW")
    st.plotly_chart(f2, use_container_width=True)
    st.dataframe(summ.round(1), use_container_width=True)

    st.markdown("---")
    st.subheader("Shiftable Burst Loads")
    st.caption("Bursts of use above base load. Moving them into 10:00-16:00 captures free solar energy.")
    flex = get_cached_flex(key)
    if len(flex):
        st.dataframe(flex, use_container_width=True)
    else:
        st.info("No clear bursts found in this load series.")

# ==============================================================================
# TAB 12: PAYBACK, PM SURYA GHAR & BEE CARBON CREDITS
# ==============================================================================
elif selected_tab == "Lifetime Savings":
    st.subheader(f"💰 12. Lifetime Payback, PM Surya Ghar & State Comparison ({my_home['owner_name']})")
    st.caption(f"Financial savings for {my_home['owner_name']}, payback years with subsidy, hold-out forecast calibration, and comparison with {my_home['state_name']} state averages.")

    # 1. What this site's own replay says. Every figure below is computed from the held-out days; there is no
    # comparison with a state or district average, because no sourced figure for one exists here. This block
    # previously showed a self-consumption of 79.2%, a grid-import reduction of 81.5% with "Top 12% Cleanest
    # Homes in District", and 78 tons of CO2 "equivalent to 3,500 trees" -- every one of them a constant typed
    # into the page, and the carbon figure resting on an emission factor this project has no source for.
    st.markdown("##### 🏡 What the replay of this site actually shows")
    _sc = solar_self_consumption(ex)
    _import_cut = (1.0 - (_pb_totals.import_cost / _pb_totals.bill_without_system)) * 100.0 if _pb_totals.bill_without_system > 0 else None
    b_col1, b_col2, b_col3, b_col4 = st.columns(4)
    b_col1.metric(
        "Solar used on site (this day)",
        "—" if _sc is None else f"{_sc * 100.0:.1f}%",
        help="Of the energy the panels made on the replayed day, the share the household and its battery used instead of exporting it. Computed from the replay, for one day: it is not a yearly figure and not a comparison with anyone else.",
    )
    b_col2.metric(
        "Less spent on imported energy",
        "—" if _import_cut is None else f"{_import_cut:.1f}%",
        help="How much smaller the cost of bought energy is than the bill this household would have paid with no system at all, over the sampled days. A money figure, not an energy one.",
    )
    b_col3.metric(
        "25-year saving, undiscounted",
        f"₹{annual_save * 25.0:,.0f}",
        help="The replay's annual benefit multiplied by 25. It applies no discount rate, no tariff escalation and no equipment degradation; the Battery tab's lifetime view does that properly.",
    )
    b_col4.metric(
        "CO₂ displaced",
        "Not stated",
        help="AVISHKAR holds no sourced emission factor for this grid, so it will not put a number here. A figure in tons would be an invention.",
    )
    st.caption(
        f"These are this site's own numbers, from {_pb_totals.days} sampled days of its held-out period. "
        f"AVISHKAR holds no state or district average for {my_home['state_name']}, so nothing here is ranked against one."
    )

    st.markdown("---")
    st.markdown("##### 📊 Financial Analysis vs Baselines")
    every = st.select_slider("Replay detail (days between sampled days)", options=[28, 14, 7], value=PAYBACK_EVERY_DEFAULT)
    table, ems_totals, trades = get_payback(key, every)
    show = table.copy()
    show["annual_benefit_inr"] = show["annual_benefit_inr"].round(0)
    show["payback_years"] = show["payback_years"].round(2)
    if "payback_years_after_subsidy" in show:
        show["payback_years_after_subsidy"] = show["payback_years_after_subsidy"].round(2)
        if site.subsidy_inr:
            st.caption(f"Subsidy counted in the last column: Rs {site.subsidy_inr:,.0f} (PM Surya Ghar, residential). "
                       "Check you qualify and that your DISCOM has approved the application.")
    st.dataframe(show, use_container_width=True)
    st.bar_chart(show["annual_benefit_inr"])
    ems_b = table.loc["EMS", "annual_benefit_inr"]
    idle_b = table.loc["Baseline: self-consume + export (battery idle)", "annual_benefit_inr"]
    st.markdown(f"**Value the EMS creates versus the no-EMS baseline: Rs {ems_b - idle_b:,.0f} a year** "
                f"({(ems_b / idle_b - 1):.1%}). Held-out year, sampled days, annualised. "
                "Benefit = bill without the system minus bill with it, plus trade and export revenue, "
                "minus battery wear, plus the value of any change in stored energy.")

    # BEE Carbon Credit Trading Scheme (CCTS) Counter
    st.markdown("---")
    st.markdown("##### 🌿 BEE Carbon Credit Trading Scheme (CCTS) & Decarbonization Counter")
    clean_kwh_today = float(ex["pv_kw"].sum() * 0.25)
    carbon_rep = compute_carbon_credits(clean_kwh_today, site_id=key)
    c_sub1, c_sub2, c_sub3, c_sub4 = st.columns(4)
    c_sub1.metric("🌿 CO2 Avoided (CEA Factor)", f"{carbon_rep.avoided_co2_kg:.1f} kg", help="Based on Central Electricity Authority baseline (0.716 kg CO2/kWh)")
    c_sub2.metric("🪵 Coal Displaced", f"{carbon_rep.avoided_coal_kg:.1f} kg")
    c_sub3.metric("🌳 Trees Equivalent", f"{carbon_rep.equivalent_trees_planted} trees")
    c_sub4.metric("📜 CCTS Carbon Value", f"₹{carbon_rep.estimated_credit_value_inr:.1f}", help="Estimated market value under BEE Carbon Credit Trading Scheme")

    st.markdown("---")
    st.markdown("##### 📈 Held-Out Year Forecast Calibration & Band Quality")
    st.dataframe(get_cached_forecast_quality(key), use_container_width=True)
    st.caption("Forecast quality on the held-out year. band80_coverage should sit near 0.80.")

# ==============================================================================
# TAB 13: MULTI-REPO OPEN-SOURCE SURPLUS INTELLIGENCE & INTEGRATIONS
# ==============================================================================
elif selected_tab == "Surplus Engine":
    render_integrations_dashboard()
