# ruff: noqa: C408
"""AVISHKAR EMS Dashboard: predictive energy management for Indian solar sites.

    streamlit run app/dashboard.py
"""

import logging
import pathlib
import tempfile

import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from plotly.subplots import make_subplots

from avishkar_ems import cache
from avishkar_ems.advisor import BATTERY_INR_PER_KWH, advise_text
from avishkar_ems.explain import explain_day
from avishkar_ems.fleet import pool, split_money
from avishkar_ems.ies import (
    catalog_publish,
    confirm_flow,
    settled_status,
    validate_publish,
)
from avishkar_ems.lifetime import Lifetime, lifetime_view
from avishkar_ems.loads import best_start
from avishkar_ems.mysite import IDLE, AnalysisError, analyse, build_tariff, report_markdown
from avishkar_ems.planner import is_optimal
from avishkar_ems.realdata import real_sites
from avishkar_ems.summary import plain_summary
from avishkar_ems.userdata import read_meter_csv

logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")

st.set_page_config(
    page_title="AVISHKAR EMS | Indian Solar Dispatch",
    page_icon="⚡",
    layout="wide",
    initial_sidebar_state="expanded",
)

# Heavy results live in a disk cache (avishkar_ems.cache, filled ahead of time by scripts/precompute_cache.py);
# the Streamlit decorators only add an in-memory layer on top.


@st.cache_resource(show_spinner="Training P10/P50/P90 forecast models (first run only)...")
def get_site(key: str):
    return cache.prepared(key)


@st.cache_data(show_spinner=False)
def get_day_view(key: str, day_str: str, soc_init: float):
    return cache.cached_day_view(key, day_str, soc_init)


@st.cache_data(show_spinner="Replaying the held-out days with the EMS and the baselines (first run only)...")
def get_payback(key: str, every_days: int):
    return cache.cached_payback(key, every_days)


@st.cache_data(show_spinner="Trying different battery sizes on the held-out days (first run only)...")
def get_advice(key: str):
    return cache.cached_advice(key)


@st.cache_data(show_spinner=False)
def get_fq(key: str):
    return cache.cached_quality(key)


@st.cache_data(show_spinner=False)
def get_flex(key: str):
    return cache.cached_flex(key)


@st.cache_data(show_spinner=False)
def get_mon(key: str, day_str: str, inject: bool):
    return cache.cached_monitor(key, day_str)["fault" if inject else "clean"]


@st.cache_resource(show_spinner=False)
def get_cache_status():
    cache.prune()  # every date and charge level tried adds a pickle; keep the newest few hundred
    return cache.cache_status()


@st.cache_data(show_spinner="Parsing meter data...")
def parse_meter(content: bytes | None, sample: bool) -> pd.Series:
    """The uploaded file's bytes (or the bundled CEEW sample) as a 15-minute kW series."""
    if sample:
        return read_meter_csv(str(cache.ROOT / "data" / "real" / "ceew_MH21_15min.csv"))
    with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as tmp:  # read_csv wants a path; removed straight after
        tmp.write(content)
    scratch = pathlib.Path(tmp.name)
    try:
        return read_meter_csv(str(scratch))
    finally:
        scratch.unlink(missing_ok=True)


@st.cache_data(show_spinner="Analysing your meter: training forecasts and replaying held-out days (a minute or two)...")
def get_site_report(load: pd.Series, tariff_args: dict, **params):
    return analyse(load, tariff=build_tariff(**tariff_args), **params)


@st.cache_data(show_spinner=False)
def get_fleet_pooling(current_key: str, day_str: str, offers_tuple: tuple):
    """Pool this site's offers with those of every other site that has data, and surplus, on the same date."""
    members = {current_key: list(offers_tuple)} if offers_tuple else {}
    for other in real_sites():
        if other == current_key:
            continue
        try:
            offers = get_day_view(other, day_str, 0.5).offers
        except ValueError:  # that site's held-out period does not cover this date
            continue
        if offers:
            members[other] = offers
    return pool(members) if members else []


# ------------------ SIDEBAR ------------------
st.sidebar.markdown("### ⚡ **AVISHKAR EMS Controller**")
key = st.sidebar.selectbox("Select Site", list(real_sites()), index=1)
p = get_site(key)
site = p.site

st.sidebar.markdown(
    f"""
    **{site.dc_kwp:.0f} kWp Solar**, **{site.battery_kwh:.0f} kWh Battery**
    - Critical Load: `{site.critical_kw:.1f} kW` (Floor: `{site.backup_hours:.0f}h backup`)
    - System Capital: `₹{site.system_cost_inr:,.0f}`
    - Tariff Structure: `{site.tariff.name}`
    """
)

test_days = pd.date_range(p.test_start, p.test_end)
day = st.sidebar.date_input(
    "Day to plan",
    value=cache.default_day(p).date(),
    min_value=test_days[0].date(),
    max_value=test_days[-1].date(),
)
soc0 = st.sidebar.slider("Battery charge at midnight (SoC₀)", 0.2, 1.0, 0.5, 0.05)

lang = st.sidebar.radio(
    "Language / भाषा",
    ["en", "hi"],
    format_func=lambda x: {"en": "English", "hi": "हिन्दी"}[x],
    horizontal=True,
)

st.sidebar.caption("🔒 **Data Privacy Guaranteed**: All load profile meter readings stay locally on-premise. "
                   "Only aggregated P2P trade offers (window, quantity, price) are published to the network.")

with st.sidebar.expander("What is real, what is assumed"):
    st.markdown(
        "**Real:** PVGIS/ERA5 weather; the Mathura home's measured load and grid outages (CEEW meter); import rates "
        "and Time-of-Day bands taken from the regulators' orders.\n\n"
        "**Modelled or assumed:** generation (modelled from real irradiance, no inverter logs); shop and clinic load "
        "(a German factory profile) and their outages; export rates; the P2P price "
        f"(`{site.tariff.p2p_share:.0%}` of the way from export to retail, `p2p_share` in the tariff file); the battery price "
        f"(₹{BATTERY_INR_PER_KWH:,.0f} per kWh); system costs; day-ahead forecast inputs (yesterday repeated); the "
        "outage-risk weights. Details: README, *Limitations*."
    )

_status = get_cache_status()
if _status == "stale":
    st.sidebar.warning("Cached results were built before the code, tariffs, data or libraries last changed, so they may "
                       "not match a fresh run. Rebuild with `python scripts/precompute_cache.py --rebuild`.")
elif _status == "unstamped":
    st.sidebar.warning("Cached results carry no version stamp, so they cannot be checked against the current code. "
                       "Rebuild with `python scripts/precompute_cache.py --rebuild`.")

# ------------------ MAIN HEADER ------------------
st.markdown(
    """
    <div style="background: linear-gradient(90deg, #1e3a8a 0%, #2563eb 100%); padding: 16px 24px; border-radius: 10px; color: white; margin-bottom: 20px;">
        <h2 style="margin: 0; color: white;">⚡ AVISHKAR EMS: Predictive Energy Management & Surplus Dispatch</h2>
        <p style="margin: 6px 0 0 0; opacity: 0.92; font-size: 14px;">
            Optimised dispatch under Indian Time-of-Day tariffs, dynamic emergency reserves, P10/P50/P90 quantile forecasting,
            and India Energy Stack (Beckn DEG v2.0) P2P surplus settlement.
        </p>
    </div>
    """,
    unsafe_allow_html=True,
)

dv = get_day_view(key, str(day), round(soc0, 2))
s, ex = dv.plan.steps, dv.ems.steps
hours = s.index

st.info(plain_summary(dv, site.backup_hours, lang))

# ------------------ TABS ------------------
tab_plan, tab_offers, tab_fleet, tab_payback, tab_advice, tab_monitor, tab_flex, tab_upload = st.tabs([
    "📋 Plan for the day",
    "🤝 Offers & Settlement",
    "🌐 Fleet / Community Pooling",
    "💰 Payback & Subsidy",
    "💡 Smart Advisory",
    "🔍 Live Fault Monitor",
    "⏰ Shiftable Loads",
    "📂 Upload Your Meter",
])

# ------------------ TAB 1: PLAN FOR THE DAY ------------------
with tab_plan:
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Emergency Reserve Floor", f"{dv.reserve.floor_soc:.0%}", help=dv.reserve.reason)
    c2.metric("Outage Risk Assessment", f"{dv.reserve.risk:.2f}",
              help="Calculated from planned notices, storm probabilities and 90-day historical outage frequency.")
    exp_kwh = float(ex["export_kwh"].sum())
    c3.metric("Exported Energy Today", f"{exp_kwh:.1f} kWh")
    c4.metric("Beckn DEG Offers", f"{len(dv.offers)}")

    if not dv.reserve.feasible:
        st.error(f"⚠️ Battery capacity is insufficient to maintain emergency reserve: {dv.reserve.reason}")
    if not is_optimal(dv.plan.status):
        st.warning(f"The solver reported '{dv.plan.status}' for this day, so the plan below may be unreliable.")

    fig = make_subplots(
        rows=3, cols=1, shared_xaxes=True, vertical_spacing=0.07,
        subplot_titles=(
            "Solar Generation: P10-P90 Forecast Uncertainty Band vs Actual vs Clear-Sky Output",
            "Load Demand: P10-P90 Forecast Band vs Actual Consumption",
            "Battery State-of-Charge (SoC) Trajectory vs Dynamic Reserve Floor"
        ),
    )

    for r, (lo, mid, hi, act, name, col) in enumerate([
        ("pv_p10", "pv_p50", "pv_p90", dv.actual["pv_kw"], "Solar PV", "#d97706"),
        ("load_p10", "load_p50", "load_p90", dv.actual["load_kw"], "Facility Load", "#2563eb"),
    ], start=1):
        fig.add_trace(go.Scatter(x=hours, y=s[hi], line=dict(width=0), showlegend=False, hoverinfo="skip"), r, 1)
        fig.add_trace(go.Scatter(x=hours, y=s[lo], fill="tonexty", line=dict(width=0),
                                 fillcolor="rgba(120,120,120,0.22)", name=f"{name} 80% Confidence (P10-P90)", showlegend=(r == 1)), r, 1)
        fig.add_trace(go.Scatter(x=hours, y=s[mid], name=f"{name} P50 Forecast", line=dict(color=col, dash="dash", width=2)), r, 1)
        fig.add_trace(go.Scatter(x=hours, y=act, name=f"{name} Actual", line=dict(color=col, width=2)), r, 1)

    fig.add_trace(go.Scatter(x=hours, y=dv.actual["pv_clear_kw"], name="Clear-Sky Output (site physics)",
                             line=dict(color="#16a34a", dash="dot", width=1.5)), 1, 1)

    fig.add_trace(go.Scatter(x=hours, y=s["soc"] * 100, name="Planned SoC %", line=dict(color="#8b5cf6", dash="dash", width=2)), 3, 1)
    fig.add_trace(go.Scatter(x=hours, y=ex["soc"] * 100, name="Actual Delivered SoC %", line=dict(color="#7c3aed", width=2.5)), 3, 1)
    fig.add_hline(y=dv.reserve.floor_soc * 100, line_color="#dc2626", line_dash="dot", line_width=2,
                  annotation_text=f"Reserve Floor ({dv.reserve.floor_soc:.0%})", annotation_position="top left", row=3, col=1)

    fig.update_yaxes(title_text="kW", row=1, col=1)
    fig.update_yaxes(title_text="kW", row=2, col=1)
    fig.update_yaxes(title_text="SoC %", row=3, col=1)
    fig.update_layout(height=780, margin=dict(l=10, r=10, t=35, b=10), legend=dict(orientation="h", y=-0.06))
    st.plotly_chart(fig, use_container_width=True)

    st.markdown(
        f"""
        **Daily Energy Balance Flow**:
        - ☀️ **Solar Generated**: `{ex['pv_kw'].sum() * 0.25:.1f} kWh`
        - 🔌 **Grid Import**: `{ex['import_kwh'].sum():.1f} kWh`
        - 🔋 **Battery Discharged**: `{ex['batt_kw'].clip(lower=0).sum() * 0.25:.1f} kWh`
        - 🚀 **Surplus Exported (P2P + Grid)**: `{exp_kwh:.1f} kWh`
        """
    )

# ------------------ TAB 2: OFFERS AND SETTLEMENT ------------------
with tab_offers:
    st.subheader("India Energy Stack: Peer-to-Peer Market Dispatch")
    st.caption("P2P surplus bids are strictly committed using P10 generation and P90 load to eliminate default risk under uncertainty.")

    if not dv.offers:
        st.info("ℹ️ No risk-free surplus exists for today after preserving local demand and the emergency reserve floor.")
    else:
        st.markdown(
            """
            <div style="display: flex; gap: 12px; margin-bottom: 16px;">
                <div style="flex: 1; background: #e0f2fe; padding: 12px; border-radius: 8px; border-left: 4px solid #0284c7;">
                    <strong style="color: #0369a1;">1. DRAFT</strong><br>
                    <small>Surplus sized via P10/P90; catalog/publish broadcast.</small>
                </div>
                <div style="flex: 1; background: #fef3c7; padding: 12px; border-radius: 8px; border-left: 4px solid #d97706;">
                    <strong style="color: #b45309;">2. ACTIVE</strong><br>
                    <small>Market matched, confirm & on_confirm exchanged.</small>
                </div>
                <div style="flex: 1; background: #dcfce7; padding: 12px; border-radius: 8px; border-left: 4px solid #16a34a;">
                    <strong style="color: #15803d;">3. COMPLETE & SETTLED</strong><br>
                    <small>Meter telemetry reconciled; net revenue disbursed.</small>
                </div>
            </div>
            """,
            unsafe_allow_html=True,
        )

        rows = []
        by_id = {t.offer_id: t for t in dv.trades}
        for o in dv.offers:
            t = by_id[o.offer_id]
            rows.append({
                "Trade Window": f"{o.start:%H:%M} - {o.end:%H:%M}",
                "Committed (kWh)": round(o.quantity_kwh, 2),
                "Floor Price (₹/kWh)": round(o.floor_price, 2),
                "Clearing Price (₹/kWh)": round(t.clearing_price, 2),
                "Delivered (kWh)": round(t.delivered_kwh, 2),
                "Shortfall (kWh)": round(t.shortfall_kwh, 2),
                "P2P Revenue (₹)": round(t.revenue_inr, 2),
                "Uplift vs DISCOM Grid (₹)": round(t.uplift_vs_export_inr, 2),
            })
        st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)

        msg = catalog_publish(site, dv.offers, now=dv.day - pd.Timedelta(hours=6))
        val_res = validate_publish(msg)
        status_badge = "✅ Passes the project's structural check" if not val_res else f"❌ Schema Failure: {val_res}"
        st.markdown(f"**Beckn DEG v2.0 `catalog/publish` Payload** &nbsp; `{status_badge}`")
        st.caption("Message structure follows the public beckn DEG P2P devkit and is checked by the project's own validator "
                   "(`ies.validate_publish`), not by an official conformance test. Nothing is sent to a live network and "
                   "the buyer is simulated.")
        st.json(msg, expanded=1)

        conf, onc = confirm_flow(msg, dv.offers, dv.trades, now=dv.day - pd.Timedelta(hours=5))
        stat = settled_status(msg, dv.offers, dv.trades, now=dv.day + pd.Timedelta(days=1))
        with st.expander("📄 View Beckn DEG Order Lifecycle Messages (confirm, on_confirm, on_status_settled)"):
            st.caption("Full contract consideration, revenue flows, and meter settlement payload.")
            st.json({"confirm": conf[0], "on_confirm": onc[0], "on_status_settled": stat[0]}, expanded=False)

# ------------------ TAB 3: FLEET / COMMUNITY POOLING ------------------
with tab_fleet:
    st.subheader("🌐 Virtual Power Plant (VPP): Fleet Offer Aggregation")
    st.caption("Individual prosumers often have small surplus blocks. AVISHKAR pools multiple sites into aggregated market bids on Beckn DEG and executes fair pro-rata settlements.")

    pooled = get_fleet_pooling(key, str(day), tuple(dv.offers))

    if not pooled:
        st.info("ℹ️ No sites have exportable surplus on this specific day to aggregate.")
    else:
        st.markdown(f"**Found {len(pooled)} Aggregated Market Window(s) across Participating Microgrid Prosumers:**")
        sites_in_pool = sorted({m for po in pooled for m in po.members})
        if len(sites_in_pool) < 2:
            st.caption(f"Only {sites_in_pool[0]} has surplus on this date, so there is nothing to pool it with. "
                       "Dates in 2023 can pool the shop and the clinic.")
        else:
            st.caption("Sites pooled: " + ", ".join(sites_in_pool) + ". The demo sites are in different cities, so this "
                       "illustrates the pooling and settlement maths; it is not a real shared meter.")

        p_rows = []
        for po in pooled:
            members_str = ", ".join([f"{m_id}: {qty:.2f} kWh" for m_id, qty in po.members.items()])
            p_rows.append({
                "Pool Window": f"{po.start:%H:%M} - {po.end:%H:%M}",
                "Aggregated Surplus (kWh)": round(po.quantity_kwh, 2),
                "Highest Floor Price (₹/kWh)": round(po.floor_price, 2),
                "Contributing Prosumers": members_str,
            })
        st.dataframe(pd.DataFrame(p_rows), use_container_width=True, hide_index=True)

        st.markdown("#### 💵 Interactive VPP Settlement Simulator")
        col_pool1, col_pool2 = st.columns(2)
        sim_delivered_ratio = col_pool1.slider("Fleet Delivery Realisation %", 50, 100, 95) / 100.0
        sim_market_price = col_pool2.number_input("Market Clearing Price (₹/kWh)", value=float(pooled[0].floor_price + 1.2), step=0.5)

        first_pool = pooled[0]
        actual_deliv = {m: round(qty * sim_delivered_ratio, 2) for m, qty in first_pool.members.items()}
        total_payout = sum(actual_deliv.values()) * sim_market_price
        payouts = split_money(first_pool, actual_deliv, total_payout)

        st.markdown(f"**Total Pool Gross Payout: ₹{total_payout:,.2f}** distributed pro-rata based on actual metered delivery:")
        split_df = pd.DataFrame([
            {"Site ID": s_id, "Delivered (kWh)": actual_deliv[s_id], "Pro-Rata Payout (₹)": round(payouts[s_id], 2)}
            for s_id in payouts
        ])
        st.dataframe(split_df, use_container_width=True, hide_index=True)

# ------------------ TAB 4: PAYBACK & SUBSIDY ------------------
with tab_payback:
    st.subheader("Financial Performance & Payback Period")
    st.caption("Replaying sampled days of the held-out period (one in every N, set below), annualised, "
               "comparing AVISHKAR EMS against idle and simple rule-based baselines.")

    every = st.select_slider("Replay Detail Sampling (days between sampled evaluations)", options=[28, 14, 7], value=7)
    pb = get_payback(key, every)
    table = pb.table
    st.caption(f"{pb.days} sampled days, covering {pb.months_covered} of 12 calendar months."
               + (" Months with no sampled day are missing, so the yearly figure leans toward the months that were sampled."
                  if pb.months_covered < 12 else "")
               + " The README and `results/` use a sampling of 7 days; other settings give slightly different figures.")
    if len(pb.non_optimal):
        st.warning(f"{len(pb.non_optimal)} sampled day(s) did not get an optimal plan from the solver, so these figures may be "
                   "unreliable: " + ", ".join(f"{d:%Y-%m-%d} ({s})" for d, s in zip(pb.non_optimal["day"], pb.non_optimal["status"], strict=True)))

    show = table.copy()
    show["annual_benefit_inr"] = show["annual_benefit_inr"].round(0)
    show["payback_years"] = show["payback_years"].round(2)
    if "payback_years_after_subsidy" in show:
        show["payback_years_after_subsidy"] = show["payback_years_after_subsidy"].round(2)
        if site.subsidy_inr:
            st.success(f"🏷️ **PM Surya Ghar: Muft Bijli Yojana Subsidy Applied**: ₹{site.subsidy_inr:,.0f} (Residential 3kW). "
                       f"Payback accelerates from {show.loc['EMS', 'payback_years']} to **{show.loc['EMS', 'payback_years_after_subsidy']} years**!")

    st.dataframe(show, use_container_width=True)
    st.bar_chart(show["annual_benefit_inr"])

    ems_b = table.loc["EMS", "annual_benefit_inr"]
    idle_b = table.loc["Baseline: self-consume + export (battery idle)", "annual_benefit_inr"]
    st.markdown(
        f"**Economic Value Added by AVISHKAR EMS**: **₹{ems_b - idle_b:,.0f} per year** "
        f"({(ems_b / idle_b - 1):.1%} uplift vs unmanaged battery).  \n"
        "_Benefit accounts for avoided electricity purchases under ToD bands, P2P uplift, export compensation, "
        "battery cycle wear, and stored energy delta._"
    )

    with st.expander("📈 Lifetime view: discounting, rising tariffs, wear and running costs (assumptions you can change)"):
        st.caption("The payback above is simple: system cost divided by one year's benefit. This view adds the things that "
                   "simple figure ignores. Every default is an illustrative assumption, not data: set your own.")
        a1, a2, a3, a4 = st.columns(4)
        disc = a1.slider("Discount rate (% a year)", 0.0, 15.0, 8.0, 0.5) / 100
        esc = a2.slider("Tariff rise (% a year)", 0.0, 10.0, 3.0, 0.5) / 100
        wear = a3.slider("Benefit lost to wear (% a year)", 0.0, 2.0, 0.5, 0.1) / 100
        om = a4.slider("Running cost (% of system cost a year)", 0.0, 3.0, 1.0, 0.1) / 100
        b1, b2 = st.columns(2)
        repl_year = b1.slider("Battery replaced in year (0 = never)", 0, 25, 0)
        repl_inr = b2.number_input("Battery replacement cost (₹)", value=float(site.battery_kwh * BATTERY_INR_PER_KWH), step=5000.0)
        params = Lifetime(discount=disc, escalation=esc, pv_degradation=wear, om_frac=om,
                          battery_replace_year=repl_year, battery_replace_inr=repl_inr)
        rows = {}
        for name, label in (("EMS", "EMS"), ("Baseline: self-consume + export (battery idle)", "Battery idle")):
            lt = lifetime_view(float(table.loc[name, "annual_benefit_inr"]), site.system_cost_inr, site.subsidy_inr, params)
            never = f"never within {params.years} years"
            rows[label] = {
                "Simple payback (years)": round(lt.simple_payback_years, 1),
                "Discounted payback (years)": never if lt.discounted_payback_years == float("inf") else round(lt.discounted_payback_years, 1),
                f"Net present value over {params.years} years (₹)": round(lt.npv_inr),
            }
        st.dataframe(pd.DataFrame(rows).T, use_container_width=True)
        if site.subsidy_inr:
            st.caption(f"Includes the ₹{site.subsidy_inr:,.0f} subsidy as a reduction of the up-front cost.")

    st.markdown("#### Forecast Band Coverage on Held-Out Test Period")
    st.dataframe(get_fq(key).round(3), use_container_width=True)
    st.caption("The 80% band is calibrated to cover 0.80 of outcomes (`band80_coverage`). Values well above 0.80 mean the "
               "band is wider than it needs to be, as for the near-repeating factory load profile at the shop and clinic.")

# ------------------ TAB 5: ADVISORY ------------------
with tab_advice:
    st.subheader("Explainable AI: Why the Plan Made These Decisions")
    for line in explain_day(s, dv.reserve, dv.offers, lang):
        st.markdown(f"- {line}")

    st.divider()
    st.subheader("⏰ Smart Appliance Scheduler (Demand Flexibility)")
    st.caption("Calculates the cheapest window to run heavy deferrable loads based on solar availability and ToD tariff rates.")

    a1, a2, a3 = st.columns(3)
    appl = a1.selectbox("Select Appliance", [
        "Geyser (2 kW, 1 h)",
        "Washing Machine (0.5 kW, 1.5 h)",
        "Water Pump (1.5 kW, 2 h)",
        "EV Charger (3.3 kW, 4 h)",
    ])
    kw_, hrs_ = {
        "Geyser (2 kW, 1 h)": (2.0, 1.0),
        "Washing Machine (0.5 kW, 1.5 h)": (0.5, 1.5),
        "Water Pump (1.5 kW, 2 h)": (1.5, 2.0),
        "EV Charger (3.3 kW, 4 h)": (3.3, 4.0),
    }[appl]
    lo_h = a2.slider("Earliest Permitted Start (Hour)", 0, 23, 6)
    hi_h = a3.slider("Must Finish By (Hour)", 1, 24, 22)

    bs = best_start(s, kw_, hrs_, float(lo_h), float(hi_h))
    if bs.empty:
        st.warning("Specified time window is shorter than appliance duration.")
    else:
        st.dataframe(bs, use_container_width=True, hide_index=True)

    st.divider()
    st.subheader("🔋 Sizing Advisor: How Big Should My Battery Be?")
    st.caption("Replays real measured data across multiple battery configurations to determine optimal backup and payback.")
    want = st.slider("Desired Outage Backup Duration (Hours)", 1, 12, int(site.backup_hours))
    adv = get_advice(key)
    st.dataframe(adv, use_container_width=True)
    st.info(advise_text(adv, want, lang))

# ------------------ TAB 6: MONITORING ------------------
with tab_monitor:
    st.subheader("🔍 Real-Time Inverter & PV String Anomaly Detection")
    st.caption("Compares generation telemetry against the physical model of the site to detect soiling, shading, or inverter faults. "
               "On this demo data the telemetry is itself modelled from real weather (no inverter logs), so only the injected fault can trigger a flag.")

    inject = st.checkbox("Inject Simulated String Fault (40% generation drop)", value=True)
    win, flags, summ = get_mon(key, str(day), inject)
    d0 = pd.Timestamp(day).tz_localize(win.index.tz)
    n_flag = int(flags.loc[(win.index >= d0) & (win.index < d0 + pd.Timedelta(days=1)), "flag"].sum())

    st.metric("Flagged 15-Minute Anomaly Intervals Today", n_flag,
              help="Triggered when output is persistently below 85% of modelled expectation in strong irradiance.")

    f2 = go.Figure()
    f2.add_trace(go.Scatter(x=win.index, y=win["expected_kw"], name="Modelled Expectation (healthy baseline)", line=dict(color="#16a34a", dash="dot")))
    f2.add_trace(go.Scatter(x=win.index, y=win["pv_kw"], name="Actual Telemetry", line=dict(color="#d97706")))
    bad = win[flags["flag"]]
    f2.add_trace(go.Scatter(x=bad.index, y=bad["pv_kw"], mode="markers", name="Fault Detected", marker=dict(color="#dc2626", size=6)))
    f2.update_layout(height=400, margin=dict(l=10, r=10, t=10, b=10), yaxis_title="kW", legend=dict(orientation="h", y=-0.1))
    st.plotly_chart(f2, use_container_width=True)
    st.dataframe(summ.round(1), use_container_width=True)

# ------------------ TAB 7: SHIFTABLE LOADS ------------------
with tab_flex:
    st.subheader("⏰ Flexibility Mining: Detected Load Bursts")
    st.caption("Automatically mines recurring high-demand spikes above baseline and computes the cost saving if shifted into peak solar hours.")
    flex = get_flex(key)
    if len(flex):
        st.dataframe(flex, use_container_width=True)
    else:
        st.info("No distinct recurring burst profiles detected in current load series.")

# ------------------ TAB 8: UPLOAD YOUR METER ------------------
with tab_upload:
    st.subheader("📂 Your Own Meter: Load Profile, Payback and Battery Advice")
    st.caption("Upload your utility smart-meter CSV (kW, W, kWh or Wh), or use the sample. You get its load profile and, below it, "
               "a payback and battery-size analysis that replays your own data (about 150 days or more). Weather is a real "
               "typical year from PVGIS; a place that is not bundled is downloaded once, so it needs internet.")

    up_file = st.file_uploader("Upload Smart Meter CSV", type=["csv"])
    if st.button("Load Pre-loaded Indian Household Meter (CEEW MH21)"):
        st.session_state["use_sample_meter"] = True
    if up_file is not None:
        st.session_state["use_sample_meter"] = False

    s_meter, meter_label = None, ""
    try:
        if up_file is not None:
            s_meter, meter_label = parse_meter(up_file.getvalue(), False), up_file.name
        elif st.session_state.get("use_sample_meter"):
            s_meter, meter_label = parse_meter(None, True), "ceew_MH21_15min.csv"
    except Exception as e:  # a user's file can fail to parse in many ways; show the reason instead of a traceback
        st.error(f"Error parsing meter file: {e}")

    if s_meter is None:
        st.info("Upload a smart meter CSV or click 'Load Pre-loaded Indian Household Meter' to see its profile and analysis.")
    else:
        st.success(f"✅ Loaded {len(s_meter):,} intervals from `{meter_label}` ({s_meter.index[0].date()} to {s_meter.index[-1].date()})")
        m_col1, m_col2, m_col3 = st.columns(3)
        m_col1.metric("Average Daily Consumption", f"{s_meter.resample('D').sum().mean() * 0.25:.1f} kWh/day")
        m_col2.metric("Peak Power Recorded", f"{s_meter.max():.2f} kW")
        m_col3.metric("Base Continuous Load", f"{s_meter.quantile(0.1):.2f} kW")

        fig_m = go.Figure()
        sample_week = s_meter.iloc[:96 * 7]
        fig_m.add_trace(go.Scatter(x=sample_week.index, y=sample_week, name="Metered Load (kW)", line=dict(color="#2563eb")))
        fig_m.update_layout(title="7-Day Sample Load Profile", height=320, margin=dict(l=10, r=10, t=35, b=10), yaxis_title="kW")
        st.plotly_chart(fig_m, use_container_width=True)

        st.divider()
        st.markdown("#### Payback and battery advice for this meter")
        is_sample = meter_label.startswith("ceew_MH21")
        with st.form("site_analysis"):
            f1, f2, f3 = st.columns(3)
            lat = f1.number_input("Latitude", value=27.49 if is_sample else 20.00, format="%.2f")
            lon = f2.number_input("Longitude", value=77.67 if is_sample else 78.00, format="%.2f")
            tilt = f3.number_input("Panel tilt (degrees)", value=20.0 if is_sample else 15.0)
            g1, g2, g3 = st.columns(3)
            kwp = g1.number_input("Solar size (kWp)", value=3.0, min_value=0.5)
            battery_kwh = g2.number_input("Battery (kWh, 0 = none)", value=5.0, min_value=0.0)
            cost = g3.number_input("System cost (₹)", value=305_000.0, step=10_000.0)
            h1, h2, h3 = st.columns(3)
            base_rate = h1.number_input("Energy rate (₹/kWh)", value=7.0, step=0.5)
            tariff_kind = h2.selectbox("Tariff shape", ["Flat", "Time-of-Day built from the rate (national minimum rules)"])
            export_rate = h3.number_input("Export credit (₹/kWh)", value=3.0, step=0.5)
            i1, i2, i3, i4 = st.columns(4)
            critical_kw = i1.number_input("Critical load in a cut (kW)", value=0.3, step=0.1)
            backup_h = i2.number_input("Backup hours wanted", value=4.0, step=1.0)
            commercial = i3.checkbox("Commercial connection", value=False)
            subsidy = i4.checkbox("PM Surya Ghar subsidy (homes)", value=is_sample and not commercial)
            run_analysis = st.form_submit_button("Run analysis")
        if run_analysis:
            try:
                tariff_args = {"base_rate": base_rate, "tod": tariff_kind.startswith("Time"), "export_rate": export_rate,
                               "commercial": commercial}
                st.session_state["site_report"] = (meter_label, get_site_report(
                    s_meter, tariff_args, lat=lat, lon=lon, kwp=kwp, cost=cost, battery_kwh=battery_kwh, tilt=tilt,
                    critical_kw=critical_kw, backup_hours=backup_h, commercial=commercial, subsidy=subsidy))
            except (AnalysisError, RuntimeError) as e:  # plain-language problems: too little data, weather not reachable
                st.error(str(e))
        saved = st.session_state.get("site_report")
        if saved and saved[0] == meter_label:
            rep = saved[1]
            ems, idle = rep.table.loc["EMS"], rep.table.loc[IDLE]
            r1, r2, r3 = st.columns(3)
            r1.metric("Yearly benefit with smart control", f"₹{ems['annual_benefit_inr']:,.0f}",
                      delta=f"₹{ems['annual_benefit_inr'] - idle['annual_benefit_inr']:,.0f} vs idle battery")
            r2.metric("Simple payback", f"{ems['payback_years']:.1f} years")
            if rep.site.subsidy_inr:
                r3.metric("Payback after subsidy", f"{ems['payback_years_after_subsidy']:.1f} years")
            st.caption(f"Replayed {rep.test_days} held-out days from {rep.days} days of data, covering {rep.months_covered} of "
                       "12 calendar months. Outages are not in a meter file, so none were assumed.")
            st.dataframe(rep.advice, use_container_width=True)
            st.info(advise_text(rep.advice, rep.backup_hours, lang))
            st.download_button("Download this report (Markdown)", report_markdown(rep, lang), file_name="my_site_report.md")
