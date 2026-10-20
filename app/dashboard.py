# ruff: noqa: C408
"""Streamlit dashboard: today's plan, offers and settlement, payback, and live monitoring.

    streamlit run app/dashboard.py
"""

import logging
from pathlib import Path
import sys

_ROOT = Path(__file__).resolve().parent.parent
_SRC = _ROOT / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from plotly.subplots import make_subplots

from avishkar_ems.advisor import advise_text, battery_advice
from avishkar_ems.demo import day_view, forecast_quality, prepare, run_payback
from avishkar_ems.explain import explain_day
from avishkar_ems.flex import summarise
from avishkar_ems.ies import (
    catalog_publish,
    confirm_flow,
    settled_status,
    validate_flow,
    validate_publish,
)
from avishkar_ems.fleet import pool, split_money
from avishkar_ems.loads import best_start
from avishkar_ems.monitor import daily_summary, deviation_flags
from avishkar_ems.realdata import real_sites
from avishkar_ems.subsidy import pm_surya_ghar
from avishkar_ems.summary import plain_summary
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


st.title("⚡ UrjaSetu (ऊर्जा सेतु): Predictive Energy Management & P2P Dispatch")
st.markdown("##### *India-Ready Rooftop Solar Intelligence, Dynamic Outage Reserve & P2P Trading (India Energy Stack)*")
st.markdown(
    """
    <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px;">
        <span style="background:#1e293b; color:#38bdf8; padding:3px 10px; border-radius:12px; font-size:12px; border:1px solid #334155;">⚡ <b>Engine:</b> HiGHS LP Solver</span>
        <span style="background:#1e293b; color:#fbbf24; padding:3px 10px; border-radius:12px; font-size:12px; border:1px solid #334155;">☀️ <b>Forecast:</b> Conformal P10/P50/P90</span>
        <span style="background:#1e293b; color:#4ade80; padding:3px 10px; border-radius:12px; font-size:12px; border:1px solid #334155;">🛡️ <b>Reserve:</b> Dynamic Outage Floor</span>
        <span style="background:#1e293b; color:#a78bfa; padding:3px 10px; border-radius:12px; font-size:12px; border:1px solid #334155;">🤝 <b>P2P Protocol:</b> Beckn DEG v2.0 (IES)</span>
        <span style="background:#1e293b; color:#f472b6; padding:3px 10px; border-radius:12px; font-size:12px; border:1px solid #334155;">📑 <b>Tariffs:</b> Official State Commission Orders</span>
    </div>
    """,
    unsafe_allow_html=True,
)
st.caption("Built on EMHASS LP Engine • Beckn DEG v2.0 P2P Protocol • Real Weather (PVGIS/ERA5) & Measured CEEW Smart Meter Outages")

st.sidebar.markdown("## ⚡ UrjaSetu EMS")
st.sidebar.caption("Predictive Energy Management & Dispatch")
key = st.sidebar.selectbox("Select Site", list(real_sites()), index=1)
p = get_site(key)
site = p.site
st.sidebar.markdown(
    f"**{site.dc_kwp:.0f} kWp**, {site.battery_kwh:.0f} kWh battery  \n"
    f"Critical load {site.critical_kw:.1f} kW for {site.backup_hours:.0f} h  \n"
    f"System cost Rs {site.system_cost_inr:,.0f}  \nTariff: {site.tariff.name}")
test_days = pd.date_range(p.test_start, p.test_end)
day = st.sidebar.date_input("Day to plan", value=(p.test_start + pd.Timedelta(days=50)).date(),
                            min_value=test_days[0].date(), max_value=test_days[-1].date())
soc0 = st.sidebar.slider("Battery charge at midnight", 0.2, 1.0, 0.5, 0.05)

lang = st.sidebar.radio("Language / भाषा", ["en", "hi"], format_func=lambda x: {"en": "English", "hi": "हिन्दी"}[x])
tab_plan, tab_offers, tab_fleet, tab_payback, tab_advice, tab_monitor, tab_flex, tab_custom = st.tabs(
    ["Plan for the day", "Offers & Settlement", "Fleet Pooling (Multi-Site)", "Payback & Financials", "Advice & Scheduler", "Live Monitoring", "Shiftable Loads", "Analyse Custom Meter (CSV)"])

dv = day_view(p, str(day), soc_init=soc0)
s, ex = dv.plan.steps, dv.ems.steps
hours = s.index

st.info(plain_summary(dv, site.backup_hours, lang))
st.sidebar.caption("Privacy: all meter data stays on this machine. Only an offer (window, quantity, price) is ever "
                   "published, never your load profile.")

with tab_plan:
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Emergency reserve (hard floor)", f"{dv.reserve.floor_soc:.0%}",
              help=dv.reserve.reason)
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
    st.caption("Where each kWh goes today: " + ", ".join([
        f"PV generated {ex['pv_kw'].sum() * 0.25:.1f} kWh",
        f"bought from grid {ex['import_kwh'].sum():.1f} kWh",
        f"battery discharged {ex['batt_kw'].clip(lower=0).sum() * 0.25:.1f} kWh",
        f"exported {exp_kwh:.1f} kWh"]))

with tab_offers:
    if not dv.offers:
        st.info("No reliable surplus today, so nothing is committed to the market. That is the intended "
                "behaviour: offers are sized on P10 generation and P90 load.")
    else:
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

with tab_fleet:
    st.subheader("Community & Multi-Site Surplus Pooling")
    st.caption("Aggregates P2P surplus offers across independent rooftop sites into bulk commercial trade blocks. "
               "Floor price equals the highest member floor so no site sells at a loss; revenue splits pro rata.")

    fleet_offers = {}
    for s_key in real_sites():
        try:
            p_s = get_site(s_key)
            dv_s = day_view(p_s, str(day), soc_init=soc0)
            if dv_s.offers:
                fleet_offers[s_key] = dv_s.offers
        except Exception:
            pass

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

        st.markdown("##### Pro-Rata Settlement Simulator")
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
    st.dataframe(forecast_quality(p).round(3), use_container_width=True)
    st.caption("Forecast quality on the held-out year. band80_coverage should sit near 0.80.")

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
    want = st.slider("Hours of backup I want", 1, 12, int(site.backup_hours))
    adv = get_advice(key)
    st.dataframe(adv, use_container_width=True)
    st.info(advise_text(adv, want, lang))

with tab_monitor:
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

with tab_flex:
    st.caption("Bursts of use above the base load, grouped by time of day. The saving is an upper bound: it assumes the "
               "load moves into 10:00-16:00 and uses surplus that would otherwise be exported.")
    flex = summarise(p.df["load_kw"], p.df["import_rate"], site.tariff.export_rate)
    if len(flex):
        st.dataframe(flex, use_container_width=True)
    else:
        st.info("No clear bursts found in this load series.")

with tab_custom:
    st.subheader("Analyse Your Own Meter Data (CSV)")
    st.caption("Upload your smart meter CSV (from your utility or smart plug) to evaluate custom solar & battery payback.")

    sample_col1, sample_col2 = st.columns([1, 2])
    use_sample = sample_col1.button("Load Sample Meter Data (load_tool.csv)")
    user_file = sample_col2.file_uploader("Or Upload Smart Meter CSV (kW, W, kWh, or Wh)", type=["csv", "txt"])

    meter_series = None
    if user_file is not None:
        try:
            import tempfile
            with tempfile.NamedTemporaryFile(delete=False, suffix=".csv") as tmp:
                tmp.write(user_file.getvalue())
                tmp_path = tmp.name
            meter_series = read_meter_csv(tmp_path)
            st.success("Successfully parsed uploaded smart meter file!")
        except Exception as e:
            st.error(f"Error parsing uploaded file: {e}")
    elif use_sample:
        sample_path = _ROOT / "data/real/load_tool.csv"
        if sample_path.exists():
            meter_series = read_meter_csv(str(sample_path), sep=";", decimal=",")
            st.success("Loaded sample commercial smart meter data (35,000+ readings)!")

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
        user_kwp = eq1.number_input("Solar Array Size (kWp)", min_value=1.0, max_value=100.0, value=float(rec_kwp), step=0.5)
        user_batt = eq2.number_input("Battery Storage (kWh)", min_value=0.0, max_value=100.0, value=float(round(rec_kwp * 1.5, 1)), step=1.0)
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
