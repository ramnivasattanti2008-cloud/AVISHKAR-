# ruff: noqa: C408, E402
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
from plotly.subplots import make_subplots

from avishkar_ems.advisor import advise_text, battery_advice
from avishkar_ems.anti_islanding import AntiIslandingWatchdog
from avishkar_ems.battery_physics import evaluate_lfp_battery_physics
from avishkar_ems.carbon_credits import compute_carbon_credits
from avishkar_ems.cybersecurity_cea import CEACyberSecurityManager
from avishkar_ems.demo import day_view, forecast_quality, prepare, run_payback
from avishkar_ems.ev_dispatch import INDIAN_EV_MODELS, compute_v2h_dispatch
from avishkar_ems.explain import explain_day
from avishkar_ems.fleet import pool, split_money
from avishkar_ems.flex import summarise
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
from avishkar_ems.transformer_guard import (
    STANDARD_DISTRIBUTION_TRANSFORMERS,
    evaluate_feeder_transformer_health,
)
from avishkar_ems.userdata import read_meter_csv

logging.disable(logging.WARNING)
st.set_page_config(
    page_title="UrjaSetu EMS | Smart Solar & P2P Energy Management",
    page_icon="⚡",
    layout="wide",
)


@st.cache_resource(show_spinner="Training P10/P50/P90 forecast models...")
def get_site(key: str):
    return prepare(key)


@st.cache_data(show_spinner="Replaying a year of days with the EMS and the baselines...")
def get_payback(key: str, every_days: int):
    ev = run_payback(get_site(key), every_days=every_days)
    return ev.payback_table(), ev.ems, ev.trades


@st.cache_data(show_spinner="Trying different battery sizes on the held-out days...")
def get_advice(key: str):
    q = get_site(key)
    days = pd.date_range(q.test_start, q.test_end)[::14]
    return battery_advice(q.site, q.df, q.pv_model, q.load_model, days)


@st.cache_data(ttl=600, show_spinner="Connecting to ISRO/Satellite Solar Feed...")
def get_satellite_weather(lat: float, lon: float):
    return fetch_satellite_solar(lat, lon, days=2)


@st.cache_data(show_spinner=False)
def get_cached_day_view(site_key: str, day_str: str, soc_init: float):
    prep = get_site(site_key)
    return day_view(prep, day_str, soc_init=soc_init)


@st.cache_data(show_spinner=False)
def get_cached_fleet_offers(day_str: str, soc_init: float):
    fleet_dict = {}
    for s_key in real_sites():
        try:
            dv_s = get_cached_day_view(s_key, day_str, soc_init)
            if dv_s.offers:
                fleet_dict[s_key] = dv_s.offers
        except Exception:
            pass
    return fleet_dict


@st.cache_data(show_spinner=False)
def get_cached_forecast_quality(site_key: str):
    return forecast_quality(get_site(site_key)).round(3)


@st.cache_data(show_spinner=False)
def get_cached_flex(site_key: str):
    prep = get_site(site_key)
    return summarise(prep.df["load_kw"], prep.df["import_rate"], prep.site.tariff.export_rate)


# --- Header & Architecture Badges ---
st.title("⚡ UrjaSetu (ऊर्जा सेतु): Predictive Energy Management & P2P Dispatch")
st.markdown("##### *India-Ready Rooftop Solar Intelligence, Dynamic Outage Reserve & P2P Trading (India Energy Stack)*")

# Shareable Demo Link Banner for Teammates
st.markdown(
    """
    <div style="background: linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%); border: 1px solid #4338ca; border-radius: 14px; padding: 14px 20px; margin-bottom: 14px; box-shadow: 0 4px 14px rgba(0,0,0,0.3);">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
            <div>
                <span style="font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #818cf8;">🔗 Live Public Demo Link • Share with Teammates & Jury</span><br/>
                <span style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 15px; font-weight: 700; color: #38bdf8;">
                    https://trek-produces-meyer-academy.trycloudflare.com
                </span>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
                <span style="background: rgba(16, 185, 129, 0.2); color: #34d399; font-weight: 600; padding: 4px 12px; border-radius: 12px; font-size: 12px; border: 1px solid rgba(16, 185, 129, 0.4);">
                    🟢 100% Live & Operational
                </span>
                <span style="background: rgba(56, 189, 248, 0.2); color: #38bdf8; font-weight: 600; padding: 4px 12px; border-radius: 12px; font-size: 12px; border: 1px solid rgba(56, 189, 248, 0.4);">
                    ⚡ Ultra-Fast LP Caching
                </span>
                <span style="background: rgba(168, 85, 247, 0.2); color: #c084fc; font-weight: 600; padding: 4px 12px; border-radius: 12px; font-size: 12px; border: 1px solid rgba(168, 85, 247, 0.4);">
                    📱 Mobile & Desktop
                </span>
            </div>
        </div>
    </div>
    """,
    unsafe_allow_html=True,
)

st.markdown(
    """
    <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px;">
        <span style="background:#1e293b; color:#38bdf8; padding:3px 10px; border-radius:12px; font-size:12px; border:1px solid #334155;">🛰️ <b>Satellite:</b> ISRO INSAT-3D/3DR & NavIC</span>
        <span style="background:#1e293b; color:#fbbf24; padding:3px 10px; border-radius:12px; font-size:12px; border:1px solid #334155;">⚡ <b>Engine:</b> HiGHS LP Solver</span>
        <span style="background:#1e293b; color:#4ade80; padding:3px 10px; border-radius:12px; font-size:12px; border:1px solid #334155;">☀️ <b>Forecast:</b> Conformal P10/P50/P90</span>
        <span style="background:#1e293b; color:#a78bfa; padding:3px 10px; border-radius:12px; font-size:12px; border:1px solid #334155;">🛡️ <b>Reserve:</b> Dynamic Outage Floor</span>
        <span style="background:#1e293b; color:#f472b6; padding:3px 10px; border-radius:12px; font-size:12px; border:1px solid #334155;">🤝 <b>P2P Protocol:</b> Beckn DEG v2.0 (IES)</span>
        <span style="background:#1e293b; color:#34d399; padding:3px 10px; border-radius:12px; font-size:12px; border:1px solid #334155;">📑 <b>Tariffs:</b> Official State Commission Orders</span>
    </div>
    """,
    unsafe_allow_html=True,
)
st.caption("Built on EMHASS LP Engine • Real Weather (PVGIS/ERA5) • Measured CEEW Smart Meter Outages • Beckn DEG v2.0")

# --- Session State & 1-Click Tour Scenarios ---
all_sites = list(real_sites())
if "site_select" not in st.session_state or st.session_state["site_select"] not in all_sites:
    st.session_state["site_select"] = "shop-pune"
if "soc_slider" not in st.session_state:
    st.session_state["soc_slider"] = 0.50
if "meter_series" not in st.session_state:
    st.session_state["meter_series"] = None

# --- Sidebar Controls ---
st.sidebar.markdown("## ⚡ UrjaSetu EMS")
st.sidebar.caption("Predictive Energy Management & Dispatch")

with st.sidebar.expander("⚡ 1-Click Demo Scenarios (Tour Guide)", expanded=True):
    st.caption("Click any preset to immediately load verified test scenarios:")
    sc1, sc2 = st.columns(2)
    if sc1.button("☀️ P2P Market", help="Sunny surplus day with active Beckn DEG trades in Pune"):
        st.session_state["site_select"] = "shop-pune"
        st.session_state["day_input"] = pd.Timestamp("2023-03-25").date()
        st.session_state["soc_slider"] = 0.50
        st.rerun()
    if sc2.button("🛡️ Outage Cut", help="Monsoon blackout risk with dynamic reserve floor in Mathura"):
        st.session_state["site_select"] = "home-mathura"
        st.session_state["day_input"] = pd.Timestamp("2020-07-28").date()
        st.session_state["soc_slider"] = 0.40
        st.rerun()
    sc3, sc4 = st.columns(2)
    if sc3.button("🚗 EV V2H & DT", help="Evening peak V2H discharge & transformer thermal guard in Jaipur"):
        st.session_state["site_select"] = "clinic-jaipur"
        st.session_state["day_input"] = pd.Timestamp("2023-05-15").date()
        st.session_state["soc_slider"] = 0.60
        st.rerun()
    if sc4.button("📂 350kW Meter", help="Load commercial smart meter dataset"):
        sample_path = _ROOT / "data/real/load_tool.csv"
        if sample_path.exists():
            st.session_state["meter_series"] = read_meter_csv(str(sample_path), sep=";", decimal=",")
        st.rerun()

cur_site_idx = all_sites.index(st.session_state["site_select"])
key = st.sidebar.selectbox("Select Site", all_sites, index=cur_site_idx, key="site_select")

p = get_site(key)
site = p.site

st.sidebar.markdown(
    f"**{site.dc_kwp:.0f} kWp Solar**, {site.battery_kwh:.0f} kWh Battery  \n"
    f"Critical Load: {site.critical_kw:.1f} kW for {site.backup_hours:.0f} h  \n"
    f"System Cost: Rs {site.system_cost_inr:,.0f}  \n"
    f"Tariff: {site.tariff.name}"
)

test_days = pd.date_range(p.test_start, p.test_end)
default_day = (p.test_start + pd.Timedelta(days=50)).date()
if "day_input" not in st.session_state or not (test_days[0].date() <= st.session_state["day_input"] <= test_days[-1].date()):
    st.session_state["day_input"] = default_day

day = st.sidebar.date_input("Day to plan", min_value=test_days[0].date(), max_value=test_days[-1].date(), key="day_input")
soc0 = st.sidebar.slider("Battery charge at midnight", 0.2, 1.0, step=0.05, key="soc_slider")

lang = st.sidebar.radio("Language / भाषा", ["en", "hi"], format_func=lambda x: {"en": "English", "hi": "हिन्दी"}[x])

st.sidebar.markdown("---")
st.sidebar.caption("🔒 **Privacy Guarantee**: All meter data stays on this local instance. Only aggregated P2P trade offers (window, quantity, floor price) are published.")

# --- Primary Day Simulation (Ultra-Fast Cached) ---
dv = get_cached_day_view(key, str(day), soc0)
s, ex = dv.plan.steps, dv.ems.steps
hours = s.index

# High-Level Summary Card
st.info(plain_summary(dv, site.backup_hours, lang))

# --- Tabs Architecture ---
tab_sat, tab_citizen, tab_plan, tab_offers, tab_hardware, tab_reg_upi, tab_ev_grid, tab_fleet, tab_payback, tab_advice, tab_custom, tab_monitor = st.tabs([
    "🛰️ ISRO / NavIC Satellite Radar",
    "🏠 Aam Aadmi / Citizen Guide",
    "📊 Plan for the Day",
    "🤝 P2P Offers & Beckn DEG",
    "🔌 Hardware Inverter Gateway",
    "⚖️ DISCOM Wheeling & UPI",
    "🚗 EV V2H & Feeder Guard",
    "🌐 Fleet Pooling (Multi-Site)",
    "💰 Payback & PM Surya Ghar",
    "💡 Appliance & Battery Advisor",
    "📂 Smart Meter CSV Analyser",
    "🔍 Fault Monitoring & Flex",
])

# ==============================================================================
# TAB 1: ISRO / NAVIC SATELLITE RADAR & MICROGRID MAP
# ==============================================================================
with tab_sat:
    st.subheader("🛰️ Indian Geospatial Solar Radar & Satellite Observation")
    st.caption("Live solar irradiance, cloud cover nowcasting, and regional P2P microgrid power flows grounded in ISRO INSAT-3D/3DR meteorological observations and NavIC positioning.")

    # 1. Regional Weather Station / Hub Selector
    h_col1, h_col2 = st.columns([3, 1])
    with h_col1:
        hub_keys = list(INDIAN_SATELLITE_HUBS.keys())
        default_hub_idx = hub_keys.index(key) if key in hub_keys else 0
        selected_hub_key = st.selectbox(
            "📍 Regional Microgrid Weather Station & Satellite Observation Hub:",
            hub_keys,
            index=default_hub_idx,
            format_func=lambda k: f"{INDIAN_SATELLITE_HUBS[k]['name']} ({INDIAN_SATELLITE_HUBS[k]['state']}) — {INDIAN_SATELLITE_HUBS[k]['discom']} [{INDIAN_SATELLITE_HUBS[k]['primary_satellite']}]",
            help="Select any major Indian solar microgrid hub to inspect live satellite telemetry and ground-truth irradiance",
        )
    with h_col2:
        st.markdown("<div style='height: 28px;'></div>", unsafe_allow_html=True)
        if st.button("🔄 Refresh Radar Feed", help="Fetch latest geostationary satellite telemetry"):
            st.cache_data.clear()
            st.rerun()

    hub_meta = INDIAN_SATELLITE_HUBS[selected_hub_key]
    sat_rep = get_satellite_weather(hub_meta["lat"], hub_meta["lon"])
    now_ist = pd.Timestamp.now(tz="Asia/Kolkata")

    # 2. Day/Night Physical State Banner
    if sat_rep.is_night:
        st.markdown(
            f"""
            <div style="background: linear-gradient(90deg, #1e1b4b 0%, #0f172a 100%); padding: 14px 20px; border-radius: 12px; border: 1px solid #3730a3; margin-bottom: 16px;">
                <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
                    <div>
                        <span style="font-size: 19px; font-weight: 700; color: #a5b4fc;">🌙 Nighttime Grid & Battery Reserve Mode</span><br/>
                        <span style="color: #cbd5e1; font-size: 13px;">Observation Time: <b>{now_ist.strftime('%d %b %Y, %I:%M %p')} IST</b> • Solar Zenith Elevation: <b>0.0° (Sun Below Horizon)</b> • NavIC Zone: <b>{hub_meta['navic_zone']}</b></span>
                    </div>
                    <div style="background: #312e81; padding: 6px 14px; border-radius: 20px; font-size: 13px; color: #e0e7ff; border: 1px solid #4338ca;">
                        ⚡ Direct Solar: <b>0 W/m² (Night)</b> • Next Dawn: <b>~06:15 IST</b> (Rooftop solar resumes at sunrise)
                    </div>
                </div>
            </div>
            """,
            unsafe_allow_html=True,
        )
    else:
        st.markdown(
            f"""
            <div style="background: linear-gradient(90deg, #78350f 0%, #0f172a 100%); padding: 14px 20px; border-radius: 12px; border: 1px solid #b45309; margin-bottom: 16px;">
                <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
                    <div>
                        <span style="font-size: 19px; font-weight: 700; color: #fbbf24;">☀️ Active Daytime Solar Radiation & P2P Generation</span><br/>
                        <span style="color: #cbd5e1; font-size: 13px;">Observation Time: <b>{now_ist.strftime('%d %b %Y, %I:%M %p')} IST</b> • Solar Zenith Elevation: <b>{sat_rep.solar_elevation_deg}°</b> • NavIC Zone: <b>{hub_meta['navic_zone']}</b></span>
                    </div>
                    <div style="background: #92400e; padding: 6px 14px; border-radius: 20px; font-size: 13px; color: #fef3c7; border: 1px solid #b45309;">
                        🛰️ {hub_meta['primary_satellite']}
                    </div>
                </div>
            </div>
            """,
            unsafe_allow_html=True,
        )

    # 3. Telemetry metrics row (5 columns)
    sm1, sm2, sm3, sm4, sm5 = st.columns(5)
    sm1.metric(
        "Direct Normal Solar (DNI)",
        f"{sat_rep.current_dni_wm2:.0f} W/m²",
        help="Direct solar beam radiation from satellite observation (0 at night)",
    )
    sm2.metric(
        "Satellite Cloud Opacity",
        f"{sat_rep.current_cloud_cover_pct:.0f}%",
        help="Geostationary cloud fraction over Indian coordinates from INSAT-3D",
    )
    sm3.metric("Surface Temperature", f"{sat_rep.current_temp_c:.1f} °C", help="Ground surface ambient temperature")
    clearness_now = 0.0 if sat_rep.is_night else max(0.05, 1.0 - (sat_rep.current_cloud_cover_pct / 100.0) ** 1.8)
    sm4.metric(
        "Nowcasting Clearness (kt)",
        "0.00 (Night)" if sat_rep.is_night else f"{clearness_now:.2f}",
        help="Atmospheric clearness ratio derived from satellite cloud fraction",
    )
    sm5.metric(
        "Humidity & Wind",
        f"{sat_rep.current_humidity_pct:.0f}% • {sat_rep.current_wind_speed_kmh:.1f} km/h",
        help="Local surface relative humidity and 10m wind speed",
    )

    # 4. Interactive Microgrid Map (Dual Engine Support)
    st.markdown("---")
    map_head_col, map_eng_col = st.columns([3, 2])
    with map_head_col:
        st.markdown("##### 🗺️ 3D Indian Solar Microgrid & Peer-to-Peer Energy Flow Network")
    with map_eng_col:
        map_engine = st.radio(
            "Map Visualization Engine:",
            ["🌐 3D PyDeck Mesh (WebGL)", "🗺️ High-Definition Plotly Radar"],
            horizontal=True,
            index=0,
        )

    active_sites_map = {k: v[0] for k, v in demo_sites().items()}

    if "3D PyDeck" in map_engine:
        try:
            deck = build_microgrid_map_deck(active_sites_map, selected_key=selected_hub_key)
            st.pydeck_chart(deck, use_container_width=True)
        except Exception as e:
            st.warning(f"PyDeck GPU rendering unavailable ({e}), displaying Plotly High-Definition Map:")
            p_map = build_microgrid_plotly_map(active_sites_map, selected_key=selected_hub_key)
            st.plotly_chart(p_map, use_container_width=True)
    else:
        p_map = build_microgrid_plotly_map(active_sites_map, selected_key=selected_hub_key)
        st.plotly_chart(p_map, use_container_width=True)

    st.caption("🟢 Green Nodes = Active Solar EMS Sites | 🟡 Amber Node = Currently Selected Hub | 🔵 Blue Arcs = Peer-to-Peer Surplus Trade Flows | Hover over pins for telemetry.")

    # 5. 48-Hour Live Irradiance & Cloud Profile Chart
    with st.expander("📈 View Live Satellite Irradiance & Cloud Profile (48 Hours)", expanded=True):
        if not sat_rep.hourly_df.empty:
            hdf = sat_rep.hourly_df.iloc[:48]
            fig_sat = make_subplots(specs=[[{"secondary_y": True}]])
            fig_sat.add_trace(go.Scatter(x=hdf.index, y=hdf["dni_wm2"], name="Direct Normal Irradiance (W/m²)", line=dict(color="#f59e0b", width=2.5)), secondary_y=False)
            fig_sat.add_trace(go.Scatter(x=hdf.index, y=hdf["gti_wm2"], name="Global Tilted Irradiance (W/m²)", line=dict(color="#10b981", dash="dash", width=2)), secondary_y=False)
            fig_sat.add_trace(go.Scatter(x=hdf.index, y=hdf["cloud_pct"], name="Cloud Cover (%)", line=dict(color="#94a3b8", width=1.5)), secondary_y=True)
            if "temp_c" in hdf.columns:
                fig_sat.add_trace(go.Scatter(x=hdf.index, y=hdf["temp_c"], name="Temperature (°C)", line=dict(color="#ef4444", dash="dot", width=1.5)), secondary_y=True)

            # Add vertical marker for Current Time (NOW)
            fig_sat.add_vline(
                x=now_ist,
                line_width=2,
                line_dash="dash",
                line_color="#38bdf8",
                annotation_text="NOW (Current IST)",
                annotation_position="top left",
                annotation_font=dict(color="#38bdf8", size=12),
            )

            fig_sat.update_layout(
                height=370,
                margin=dict(l=10, r=10, t=25, b=10),
                legend=dict(orientation="h", y=-0.18, x=0.5, xanchor="center"),
                paper_bgcolor="#0f172a",
                plot_bgcolor="#1e293b",
                font=dict(color="#f8fafc"),
            )
            fig_sat.update_xaxes(showgrid=True, gridcolor="#334155")
            fig_sat.update_yaxes(title_text="Irradiance (W/m²)", secondary_y=False, showgrid=True, gridcolor="#334155")
            fig_sat.update_yaxes(title_text="Cloud Cover (%) / Temp (°C)", secondary_y=True, range=[0, 100], showgrid=False)
            st.plotly_chart(fig_sat, use_container_width=True)
        st.info(f"**Data Grounding**: {sat_rep.source_description}. Primary Satellite: {hub_meta['primary_satellite']}. NavIC Zone: {hub_meta['navic_zone']}.")

# ==============================================================================
# TAB 2: AAM AADMI / CITIZEN GUIDE (SIMPLE & ACTIONABLE FOR FAMILIES & SHOPS)
# ==============================================================================
with tab_citizen:
    st.subheader("🏠 Aam Aadmi & Local Citizen Guide (आम जनता / बचत गाइड)")
    st.caption("Plain-language, actionable guidance for homeowners, farmers, and local shops. No engineering jargon.")

    # 1. Bijli Bachat (Savings Meter)
    c1, c2, c3 = st.columns(3)
    today_savings_inr = float(ex["import_kwh"].sum() * 0.0) # baseline difference
    # calculate today's net benefit vs buying all from grid
    tod_rates = s["import_rate"].to_numpy()
    actual_load = ex["load_kw"].to_numpy() * 0.25
    cost_without = float((actual_load * tod_rates).sum())
    cost_with = float((ex["import_kwh"] * s["import_rate"]).sum() - (ex["export_kwh"] * s["export_rate"]).sum())
    day_savings = max(0.0, cost_without - cost_with)

    c1.metric("💰 Today's Bill Savings (आज की बचत)", f"₹{day_savings:.1f}", help="Money saved today compared to buying all power from DISCOM")
    c2.metric("⚡ Solar Units Generated Today", f"{ex['pv_kw'].sum() * 0.25:.1f} Units (kWh)")
    c3.metric("🔋 Emergency Inverter Charge", f"{ex['soc'].iloc[-1]:.0%}",
              help="Current charge stored in battery for unexpected grid power cuts")

    # 1b. BEE Carbon Credit Trading Scheme (CCTS) Counter
    clean_kwh_today = float(ex["pv_kw"].sum() * 0.25)
    carbon_rep = compute_carbon_credits(clean_kwh_today, site_id=key)
    c_sub1, c_sub2, c_sub3, c_sub4 = st.columns(4)
    c_sub1.metric("🌿 CO2 Avoided (CEA Factor)", f"{carbon_rep.avoided_co2_kg:.1f} kg", help="Based on Central Electricity Authority baseline (0.716 kg CO2/kWh)")
    c_sub2.metric("🪵 Coal Displaced", f"{carbon_rep.avoided_coal_kg:.1f} kg")
    c_sub3.metric("🌳 Trees Equivalent", f"{carbon_rep.equivalent_trees_planted} trees")
    c_sub4.metric("📜 CCTS Carbon Value", f"₹{carbon_rep.estimated_credit_value_inr:.1f}", help="Estimated market value under BEE Carbon Credit Trading Scheme")

    # 2. Power Cut Shield (Inverter Survival Time)
    st.markdown("---")
    st.markdown("##### 🛡️ Power Cut Shield (कटौती सुरक्षा: बिजली जाने पर क्या चलेगा?)")
    current_stored_kwh = float(ex["soc"].iloc[-1] * site.battery_kwh * site.one_way_eff)

    st.write(f"Your battery currently holds **{current_stored_kwh:.1f} kWh of usable energy**. If the grid fails right now:")

    app_cols = st.columns(4)
    app_cols[0].markdown(f"💡 **LED Lights (4) + Fans (3)**  \n`150 Watts`  \n**Runs for:** ~{current_stored_kwh / 0.15:.1f} Hours")
    app_cols[1].markdown(f"📶 **Wi-Fi Router + Laptops (2)**  \n`80 Watts`  \n**Runs for:** ~{current_stored_kwh / 0.08:.1f} Hours")
    app_cols[2].markdown(f"🧊 **Refrigerator (Single Door)**  \n`200 Watts`  \n**Runs for:** ~{current_stored_kwh / 0.20:.1f} Hours")
    app_cols[3].markdown(f"💧 **Water Pump (0.5 HP)**  \n`400 Watts`  \n**Runs for:** ~{current_stored_kwh / 0.40:.1f} Hours")

    # 3. Traffic-Light Appliance Action Guide
    st.markdown("---")
    st.markdown("##### 🚦 Right-Now Appliance Guide (उपकरण कब चलाएं?)")
    col_t1, col_t2 = st.columns([1, 1])

    with col_t1:
        st.success("🟢 **Run Now (Solar Surplus Available):**  \n- Washing Machine  \n- Water Geyser  \n- EV Scooter / Vehicle Slow Charging  \n*Running these now uses free rooftop sunshine instead of paid grid power.*")

    with col_t2:
        st.error("🔴 **Avoid During Evening Peak (6:00 PM – 10:00 PM):**  \n- Heavy Air Conditioning  \n- Agricultural / Heavy Water Pumps  \n- Electric Vehicle Fast Charging  \n*Peak electricity rate is ₹10.00/unit. Running heavy loads now inflates your bill.*")

    # 4. WhatsApp / SMS Alert Dispatcher
    st.markdown("---")
    st.markdown("##### 📱 1-Click WhatsApp / SMS Alert (फैमिली या स्टाफ को अलर्ट भेजें)")
    risk_level_str = "कम (Low)" if dv.reserve.risk < 0.25 else "मध्यम (Medium)" if dv.reserve.risk < 0.5 else "उच्च (High - Storm / Notice)"

    alert_msg = (
        f"⚡ *UrjaSetu Smart Power Alert ({site.tariff.name})*\n"
        f"📅 Date: {day}\n"
        f"☀️ Solar Expected: {float(s['pv_p50'].sum() * 0.25):.1f} units\n"
        f"🔋 Emergency Backup Floor: {dv.reserve.floor_soc:.0%} (Protected for {site.backup_hours:.0f} hours)\n"
        f"⚠️ Power Cut Risk Today: {risk_level_str}\n"
        f"💡 Tip: Free solar power peak is 11 AM - 3 PM. Avoid heavy appliances after 6 PM."
    )

    st.text_area("Copy-ready WhatsApp / SMS message:", value=alert_msg, height=125)
    st.caption("Click into the box, copy (Ctrl+C), and send directly to your household group or staff.")

# ==============================================================================
# TAB 3: PLAN FOR THE DAY (DETAILED TECHNICAL FORECAST & LP DISPATCH)
# ==============================================================================
with tab_plan:
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Emergency reserve (hard floor)", f"{dv.reserve.floor_soc:.0%}", help=dv.reserve.reason)
    c2.metric("Outage risk today", f"{dv.reserve.risk:.2f}")
    exp_kwh = float(ex["export_kwh"].sum())
    c3.metric("Exported today", f"{exp_kwh:.1f} kWh")
    c4.metric("Offers published", f"{len(dv.offers)}")

    if not dv.reserve.feasible:
        st.error("Battery is too small to hold the required reserve: " + dv.reserve.reason)

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
    fig.add_hline(y=dv.reserve.floor_soc * 100, line_color="#dc2626", line_dash="dot",
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

# ==============================================================================
# TAB 4: OFFERS & SETTLEMENT (BECKN DEG V2.0 / INDIA ENERGY STACK)
# ==============================================================================
with tab_offers:
    st.subheader("🤝 P2P Surplus Energy Offers & Beckn DEG v2.0 Protocol")
    st.caption("Decentralized peer-to-peer clean energy trading on the Open Network for Digital Commerce (ONDC / Beckn DEG v2.0) without blockchain overhead.")

    if not dv.offers:
        st.markdown(
            f"""
            <div style="background: linear-gradient(90deg, #1e293b 0%, #0f172a 100%); padding: 14px 20px; border-radius: 12px; border: 1px solid #334155; margin-bottom: 16px;">
                <div style="display: flex; align-items: flex-start; gap: 14px;">
                    <span style="font-size: 26px;">🛡️</span>
                    <div>
                        <b style="color: #38bdf8; font-size: 15px;">Dynamic Outage Reserve Protection Active (No Surplus Exported Today)</b><br/>
                        <span style="color: #cbd5e1; font-size: 13px;">
                            On this planned date (<b>{day}</b>), conservative conformal forecasting (<b>P10 Solar Generation & P90 Local Load</b>) determined that all available rooftop generation must be retained locally to protect your <b>{site.critical_kw} kW</b> critical load reserve floor (<b>{dv.reserve.floor_soc:.0%} battery charge</b>) for <b>{site.backup_hours:.0f} hours</b> of blackout immunity.
                        </span>
                    </div>
                </div>
            </div>
            """,
            unsafe_allow_html=True,
        )

        with st.expander("💡 Understanding Conformal Risk-Floor Sizing"):
            st.markdown(
                """
                - **Statistical Safety**: Offers are committed only when the **P10 generation band** (90% lower confidence bound) strictly exceeds the **P90 load band** plus the emergency reserve.
                - **Zero Default Guarantee**: This guarantees your microgrid never defaults on committed P2P deliveries, avoiding DISCOM open-access shortfall penalties.
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
    st.caption("Replaces static heuristic formulas with a real double-sided merit-order continuous auction: clearing price discovered where cumulative supply meets demand.")

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

    # Visual Merit-Order Supply & Demand Curve
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
# TAB 5: FLEET POOLING & MULTI-SITE DISPATCH
# ==============================================================================
with tab_fleet:
    st.subheader("🌐 Community & Multi-Site Surplus Pooling")
    st.caption("Aggregates P2P surplus offers across independent rooftop sites into bulk commercial trade blocks. "
               "Floor price equals the highest member floor so no site sells at a loss; revenue splits pro rata.")

    fleet_offers = get_cached_fleet_offers(str(day), soc0)
    pooled = pool(fleet_offers)
    col_f1, col_f2, col_f3 = st.columns(3)
    col_f1.metric("Contributing Sites Today", f"{len(fleet_offers)} of {len(real_sites())}")
    tot_pool_kwh = sum(p_item.quantity_kwh for p_item in pooled) if pooled else 0.0
    col_f2.metric("Total Pooled Surplus", f"{tot_pool_kwh:.1f} kWh")
    max_fl = max((p_item.floor_price for p_item in pooled), default=0.0)
    col_f3.metric("Pool Floor Price", f"Rs {max_fl:.2f}/kWh" if max_fl > 0 else "—")

    if pooled:
        p_rows = []
        for p_item in pooled:
            contrib_str = ", ".join(f"{k}: {v:.1f} kWh" for k, v in p_item.members.items())
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
                    "Site": s_id,
                    "Delivered kWh": round(p_item.members[s_id], 2),
                    "Net Payout (Rs)": round(s_amt, 2),
                })
        st.dataframe(pd.DataFrame(split_rows), use_container_width=True, hide_index=True)
    else:
        st.info("No sites have export surplus on this specific day due to conservative P10/P90 safety bands. "
                "Try sunny weekend dates when commercial load is lower.")

# ==============================================================================
# TAB 6: PAYBACK & PM SURYA GHAR SUBSIDY
# ==============================================================================
with tab_payback:
    every = st.select_slider("Replay detail (days between sampled days)", options=[28, 14, 7], value=28)
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
    st.dataframe(get_cached_forecast_quality(key), use_container_width=True)
    st.caption("Forecast quality on the held-out year. band80_coverage should sit near 0.80.")

# ==============================================================================
# TAB 7: ADVICE & APPLIANCE SCHEDULER
# ==============================================================================
with tab_advice:
    st.subheader("Why the plan does what it does")
    for line in explain_day(s, dv.reserve, dv.offers, lang):
        st.markdown(f"- {line}")
    st.subheader("When should I run a big appliance?")
    st.caption("Uses today's forecast and tariff. A guide, not a guarantee.")
    a1, a2, a3 = st.columns(3)
    appl = a1.selectbox("Appliance", ["Geyser (2 kW, 1 h)", "Washing machine (0.5 kW, 1.5 h)", "Water pump (1.5 kW, 2 h)",
                                      "EV charger (3.3 kW, 4 h)"])
    kw_, hrs_ = {"Geyser (2 kW, 1 h)": (2.0, 1.0), "Washing machine (0.5 kW, 1.5 h)": (0.5, 1.5),
                 "Water pump (1.5 kW, 2 h)": (1.5, 2.0), "EV charger (3.3 kW, 4 h)": (3.3, 4.0)}[appl]
    lo_h = a2.slider("Earliest start hour", 0, 23, 6)
    hi_h = a3.slider("Must finish by hour", 1, 24, 22)
    bs = best_start(s, kw_, hrs_, float(lo_h), float(hi_h))
    if bs.empty:
        st.warning("That window is too short for this appliance.")
    else:
        st.dataframe(bs, use_container_width=True, hide_index=True)
    st.subheader("How big should my battery be?")
    st.caption("The battery price is an assumption (Rs 25,000 per kWh). Replace it with a real quote.")
    want = st.slider("Hours of backup I want", 1, 12, min(12, max(1, int(site.backup_hours))))
    adv = get_advice(key)
    st.dataframe(adv, use_container_width=True)
    st.info(advise_text(adv, want, lang))

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
# TAB 8: SMART METER CSV ANALYSER
# ==============================================================================
with tab_custom:
    st.subheader("Analyse Your Own Meter Data (CSV)")
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
            st.error(f"Error parsing uploaded file: {e}")
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
# TAB 9: FAULT MONITORING & SHIFTABLE LOADS
# ==============================================================================
with tab_monitor:
    st.subheader("Live Fault Deviation & Shiftable Load Detection")
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
    st.caption("Bursts of use above the base load. Moving them into 10:00-16:00 captures free solar energy.")
    flex = get_cached_flex(key)
    if len(flex):
        st.dataframe(flex, use_container_width=True)
    else:
        st.info("No clear bursts found in this load series.")

# ==============================================================================
# TAB: HARDWARE INVERTER GATEWAY (SUNSPEC MODBUS RTU / TCP)
# ==============================================================================
with tab_hardware:
    st.subheader("🔌 Industrial Inverter Hardware Gateway (SunSpec Modbus)")
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
# TAB: DISCOM WHEELING & UPI SETTLEMENT
# ==============================================================================
with tab_reg_upi:
    st.subheader("⚖️ Legal DISCOM Wheeling Ledger & Instant UPI Settlement")
    st.caption("Compliant distribution wheeling under state electricity regulatory frameworks (UPERC P2P Solar Pilot / MERC / RERC). "
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
        st.markdown("##### 💳 Instant NPCI UPI Settlement Token")
        st.caption("Sub-rupee instant settlement link matching the Beckn DEG trade reference:")

        upi_req = generate_upi_payment(
            payee_vpa="solar.mathura@oksbi" if key == "mathura" else "cleanenergy.pune@icici",
            payee_name=f"UrjaSetu Prosumer ({key.title()})",
            amount_inr=legal_res.net_seller_payout_inr,
            trade_id="TRD-2026-US-88",
        )

        st.markdown(upi_req.qr_svg_html, unsafe_allow_html=True)
        st.code(upi_req.upi_intent_uri, language="text")
        st.caption(f"Status: `{upi_req.status}` | Reference: `{upi_req.transaction_ref}`")

# ==============================================================================
# TAB: EV V2H & FEEDER TRANSFORMER GUARD
# ==============================================================================
with tab_ev_grid:
    st.subheader("🚗 Vehicle-to-Home (V2H) & Feeder Transformer Shield")
    st.caption("Coordinating bidirectional EV charging (Ola, Ather, Tata Nexon EV) and neighborhood distribution transformer thermal protection.")

    ev_col1, ev_col2 = st.columns([1, 1])

    with ev_col1:
        st.markdown("##### 🚗 Bidirectional V2H Smart Dispatch")
        st.caption("Discharge stored EV battery energy during evening peak tariff hours (18:00 - 22:00 @ ₹10/unit) while preserving commute range.")

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

        st.metric("Transformer Loading %", f"{dt_status.transformer_loading_pct:.1f}%",
                  help="Safe thermal threshold is ≤ 80% (Central Electricity Authority standard)")

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
