# ruff: noqa: C408
"""Streamlit dashboard: today's plan, offers and settlement, payback, and live monitoring.

    streamlit run app/dashboard.py
"""

import logging

import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from plotly.subplots import make_subplots

from avishkar_ems.demo import day_view, forecast_quality, prepare, run_payback
from avishkar_ems.ies import catalog_publish, validate_publish
from avishkar_ems.monitor import daily_summary, deviation_flags
from avishkar_ems.sim import demo_sites

logging.disable(logging.WARNING)
st.set_page_config(page_title="AVISHKAR EMS", layout="wide")


@st.cache_resource(show_spinner="Training P10/P50/P90 forecast models...")
def get_site(key: str):
    return prepare(key)


@st.cache_data(show_spinner="Replaying a year of days with the EMS and the baselines...")
def get_payback(key: str, every_days: int):
    ev = run_payback(get_site(key), every_days=every_days)
    return ev.payback_table(), ev.ems, ev.trades


st.title("AVISHKAR EMS: predictive energy management for Indian solar sites")
st.caption("Built on EMHASS. Weather is real (PVGIS/ERA5, 2021-2023) and load is a measured profile; outages, P2P prices "
           "and tariffs are assumptions until the organisers' dataset is loaded.")

key = st.sidebar.selectbox("Site", list(demo_sites()), index=1)
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

tab_plan, tab_offers, tab_payback, tab_monitor = st.tabs(
    ["Plan for the day", "Offers and settlement", "Payback", "Monitoring"])

dv = day_view(p, str(day), soc_init=soc0)
s, ex = dv.plan.steps, dv.ems.steps
hours = s.index

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

with tab_payback:
    every = st.select_slider("Replay detail (days between sampled days)", options=[28, 14, 7], value=28)
    table, ems_totals, trades = get_payback(key, every)
    show = table.copy()
    show["annual_benefit_inr"] = show["annual_benefit_inr"].round(0)
    show["payback_years"] = show["payback_years"].round(2)
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
