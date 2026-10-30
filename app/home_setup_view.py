"""Streamlit View for Individual Residential Home Setup, Optimization & Phase 7 Benchmark.

Complies with:
- Phase 1: Individual Home Onboarding, Configuration, Equipment specs, Tariffs & Goals.
- Phase 2: Home Energy Dashboard with honest telemetry status tagging.
- Phase 3 & 4: Energy balance engine with First Law conservation and goal-based optimization.
- Phase 5: Battery safety bounds (min/max SoC, power limits, non-contradictory commands).
- Phase 6: Flexible appliances and smart EV charging.
- Phase 7: Reproducible Benchmark & What-If scenario explorer.
- Phase 8: Community opt-in/opt-out with I^2*R feeder line losses and standalone isolation.
"""

from __future__ import annotations

from pathlib import Path

import plotly.graph_objects as go
import streamlit as st
from app.ui_html import html_block

from avishkar_ems.home_balance import (
    HomeEnergyBalanceEngine,
    IntervalTelemetry,
    route_community_exchange,
)
from avishkar_ems.home_profile import (
    HomeProfile,
    MeasurementMode,
    OptimizationGoal,
)

_PROFILE_DIR = Path(__file__).resolve().parent.parent / "data" / "home_profiles"
_DEFAULT_PROFILE_PATH = _PROFILE_DIR / "my_residential_home.json"


def _get_active_profile() -> HomeProfile:
    """Retrieves or initializes the active residential HomeProfile in session state."""
    if "home_profile" not in st.session_state:
        if _DEFAULT_PROFILE_PATH.exists():
            try:
                st.session_state["home_profile"] = HomeProfile.load_from_file(str(_DEFAULT_PROFILE_PATH))
            except Exception:
                st.session_state["home_profile"] = HomeProfile.create_phase7_demo_home()
        else:
            st.session_state["home_profile"] = HomeProfile.create_phase7_demo_home()
    return st.session_state["home_profile"]


def render_home_management_view() -> None:
    """Renders the comprehensive Individual Residential Home Energy Management View."""
    st.markdown("### 🏡 Residential Home Energy Management & Optimization")
    st.caption(
        "Individual home energy balance, battery protection, tariff optimization, and standalone solar self-consumption. "
        "Operates completely independently without requiring community participation."
    )

    profile = _get_active_profile()

    # Top Status Bar
    mode_badge = {
        MeasurementMode.SIMULATION: "🧪 SIMULATION MODE (Physics Engine Active)",
        MeasurementMode.USER_ENTERED: "📝 USER ENTERED DATA",
        MeasurementMode.HARDWARE_MEASURED: "⚡ LIVE HARDWARE TELEMETRY",
    }.get(profile.measurement_mode, "🧪 SIMULATION")

    opt_in_badge = "🌐 Community Opt-In: ACTIVE" if profile.community_opt_in else "🛡️ Standalone Mode: 100% AUTONOMOUS"

    st.markdown(html_block(f"""
        <div style="background: linear-gradient(90deg, #0d1b2a, #1b263b); border: 1px solid #415a77; border-radius: 8px; padding: 12px 18px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap;">
            <div>
                <strong style="color: #00e5ff; font-size: 16px;">🏠 {profile.home_name}</strong>
                <span style="color: #8da9c4; font-size: 13px; margin-left: 12px;">📍 {profile.location}</span>
            </div>
            <div style="margin-top: 6px;">
                <span style="background: #2a3d66; color: #e0e1dd; padding: 4px 10px; border-radius: 4px; font-size: 12px; margin-right: 8px;">{mode_badge}</span>
                <span style="background: {'#1b4332' if profile.community_opt_in else '#4a154b'}; color: {'#74c69d' if profile.community_opt_in else '#ff99c8'}; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: bold;">{opt_in_badge}</span>
            </div>
        </div>
        """),
        unsafe_allow_html=True,
    )

    sub_tabs = st.tabs([
        "⚡ Phase 7 Benchmark & What-If",
        "⚙️ Home Setup & Equipment",
        "🔋 Battery & Safety Guardrails",
        "🚗 EV & Flexible Appliances",
        "🌐 Community P2P Exchange (Phase 8)",
    ])

    # -------------------------------------------------------------------------
    # SUB-TAB 1: PHASE 7 BENCHMARK & LIVE WHAT-IF SIMULATOR
    # -------------------------------------------------------------------------
    with sub_tabs[0]:
        st.markdown("#### 🎯 Phase 7: Reproducible Home Energy Benchmark & Scenarios")
        st.caption(
            "Verifiable First Law Energy Balance ($P_{\\text{sources}} \\equiv P_{\\text{sinks}}$). "
            "Explore real-time dispatch decisions across solar, battery, appliances, and grid."
        )

        # Quick Preset Buttons
        st.markdown("**Select Benchmark Preset:**")
        p_col1, p_col2, p_col3, p_col4 = st.columns(4)

        if "sim_pv" not in st.session_state:
            st.session_state.sim_pv = 4.0
            st.session_state.sim_load = 1.5
            st.session_state.sim_soc = 60.0
            st.session_state.sim_buy = 8.0
            st.session_state.sim_sell = 3.0

        if p_col1.button("📌 Phase 7 Baseline", use_container_width=True):
            st.session_state.sim_pv = 4.0
            st.session_state.sim_load = 1.5
            st.session_state.sim_soc = 60.0
            st.session_state.sim_buy = 8.0
            st.session_state.sim_sell = 3.0

        if p_col2.button("🔋 Battery Full (95%)", use_container_width=True):
            st.session_state.sim_pv = 4.5
            st.session_state.sim_load = 1.5
            st.session_state.sim_soc = 95.0

        if p_col3.button("☁️ Solar Deficit (Cloudy)", use_container_width=True):
            st.session_state.sim_pv = 1.0
            st.session_state.sim_load = 3.5
            st.session_state.sim_soc = 50.0

        if p_col4.button("⚡ Peak Tariff Surge", use_container_width=True):
            st.session_state.sim_buy = 12.0
            st.session_state.sim_sell = 4.5

        # Interactive Sliders
        st.markdown("##### 🎛️ Live Operating Conditions")
        c1, c2, c3 = st.columns(3)
        pv_val = c1.slider("Solar PV Generation (kW):", 0.0, 10.0, float(st.session_state.sim_pv), 0.1)
        load_val = c2.slider("Household Base Load (kW):", 0.2, 8.0, float(st.session_state.sim_load), 0.1)
        soc_val = c3.slider("Battery State of Charge (%):", 0.0, 100.0, float(st.session_state.sim_soc), 1.0)

        c4, c5, c6 = st.columns(3)
        buy_val = c4.number_input("Grid Import Tariff (₹/kWh):", 1.0, 25.0, float(st.session_state.sim_buy), 0.5)
        sell_val = c5.number_input("Grid Export Tariff (₹/kWh):", 0.0, 20.0, float(st.session_state.sim_sell), 0.5)
        loss_toggle = c6.checkbox("Include Physical Conversion Losses", value=True)

        # Run Energy Balance Engine
        engine = HomeEnergyBalanceEngine(profile)
        telemetry = IntervalTelemetry(
            solar_generation_kw=pv_val,
            home_consumption_kw=load_val,
            battery_soc_pct=soc_val,
            grid_import_price_inr=buy_val,
            grid_export_price_inr=sell_val,
            measurement_mode=MeasurementMode.SIMULATION,
        )

        result = engine.evaluate_interval(telemetry, enable_losses=loss_toggle)

        # Key Metrics Row
        m1, m2, m3, m4, m5 = st.columns(5)
        m1.metric("☀️ Solar Generation", f"{result.solar_generation_kw:.2f} kW")
        m2.metric("🏠 Direct Home Use", f"{result.solar_direct_used_kw:.2f} kW")
        m3.metric(
            "🔋 Battery Action",
            f"+{result.battery_charge_kw:.2f} kW" if result.battery_charge_kw > 0 else (f"-{result.battery_discharge_kw:.2f} kW" if result.battery_discharge_kw > 0 else "Idle"),
            delta=f"SoC: {result.battery_soc_before_pct:.0f}% → {result.battery_soc_after_pct:.1f}%",
        )
        m4.metric(
            "🔌 Grid Transfer",
            f"Export {result.grid_export_kw:.2f} kW" if result.grid_export_kw > 0 else (f"Import {result.grid_import_kw:.2f} kW" if result.grid_import_kw > 0 else "Zero Grid"),
            delta="Export Revenue" if result.grid_export_kw > 0 else "Import Cost",
            delta_color="normal" if result.grid_export_kw > 0 else "inverse",
        )
        m5.metric(
            "💰 Interval Net Cost",
            f"₹{result.net_cost_inr:+.2f}",
            delta="Energy Self-Sufficient" if result.net_cost_inr <= 0 else "Grid Dependent",
            delta_color="normal" if result.net_cost_inr <= 0 else "inverse",
        )

        # Mathematical Energy Balance Proof
        st.markdown("##### 🔬 First Law Energy Balance Equation")
        p_sources = result.solar_generation_kw + result.battery_discharge_kw + result.grid_import_kw
        p_sinks = (
            result.home_consumption_kw
            + result.battery_charge_kw
            + result.flexible_load_kw
            + result.ev_charge_kw
            + result.grid_export_kw
            + result.inverter_loss_kw
            + result.battery_loss_kw
        )

        st.code(
            f"Sources: [PV: {result.solar_generation_kw:.2f} kW + BattDischarge: {result.battery_discharge_kw:.2f} kW + GridImport: {result.grid_import_kw:.2f} kW] = {p_sources:.3f} kW\n"
            f"Sinks:   [Load: {result.home_consumption_kw:.2f} kW + BattCharge: {result.battery_charge_kw:.2f} kW + Flex: {result.flexible_load_kw:.2f} kW + EV: {result.ev_charge_kw:.2f} kW + GridExport: {result.grid_export_kw:.2f} kW + Losses: {(result.inverter_loss_kw + result.battery_loss_kw):.2f} kW] = {p_sinks:.3f} kW\n"
            f"First Law Invariant Error: ΔE = {result.energy_balance_error_kw:.5f} kW  ==> {'BALANCED [PASSED]' if result.is_balanced else 'UNBALANCED [FAILED]'}",
            language="yaml",
        )

        # Recommendation and Applied Constraints
        rec_col, con_col = st.columns([1.2, 1])
        with rec_col:
            st.markdown("💡 **Optimization Recommendation & Rationale:**")
            st.info(result.recommendation_text)
            if result.assumptions:
                st.caption("Assumptions: " + ", ".join(result.assumptions))

        with con_col:
            st.markdown("🛡️ **Active Physical & Safety Constraints:**")
            if result.constraints_applied:
                for c in result.constraints_applied:
                    st.write(f"• `{c}`")
            else:
                st.write("• Nominal operation within all safe boundaries.")

            if result.warnings:
                for w in result.warnings:
                    st.warning(f"⚠️ {w}")

        # Power Flow Breakdown Chart
        fig = go.Figure()
        flows = {
            "Direct Solar": result.solar_direct_used_kw,
            "Battery Charge": result.battery_charge_kw,
            "Battery Discharge": -result.battery_discharge_kw,
            "Flexible Loads": result.flexible_load_kw,
            "EV Charging": result.ev_charge_kw,
            "Grid Export": result.grid_export_kw,
            "Grid Import": -result.grid_import_kw,
            "Conversion Loss": result.inverter_loss_kw + result.battery_loss_kw,
        }
        fig.add_trace(
            go.Bar(
                x=list(flows.keys()),
                y=list(flows.values()),
                marker_color=[
                    "#00e5ff" if v >= 0 and "Direct" in k else (
                        "#76c893" if "Charge" in k or "Export" in k else (
                            "#ffb703" if "Flex" in k or "EV" in k else (
                                "#e63946" if v < 0 else "#8da9c4"
                            )
                        )
                    )
                    for k, v in flows.items()
                ],
            )
        )
        fig.update_layout(
            title="Instantaneous Power Dispatch Breakdown (kW)",
            yaxis_title="Power (kW)",
            template="plotly_dark",
            height=300,
            margin={"l": 20, "r": 20, "t": 40, "b": 20},
        )
        st.plotly_chart(fig, use_container_width=True)

    # -------------------------------------------------------------------------
    # SUB-TAB 2: HOME SETUP & EQUIPMENT
    # -------------------------------------------------------------------------
    with sub_tabs[1]:
        st.markdown("#### ⚙️ Individual Home Profile & Equipment Parameters")
        st.caption("Configure equipment capacities, manufacturer limits, and DISCOM tariffs. Saved locally.")

        with st.form("home_config_form"):
            cfg1, cfg2 = st.columns(2)
            with cfg1:
                st.markdown("##### 📍 Site Information")
                home_name = st.text_input("Home Name / Identifier:", value=profile.home_name)
                location = st.text_input("Location / City:", value=profile.location)
                solar_kw = st.number_input("Solar Panel Capacity (kWp):", min_value=0.0, max_value=50.0, value=float(profile.solar_capacity_kw), step=0.5)

                st.markdown("##### ⚡ Inverter Specifications")
                inv_brand = st.selectbox("Inverter Brand / Model:", ["VICTRON", "GROWATT", "SUNGROW", "HUAWEI", "DEYE", "ENPHASE"], index=0)
                inv_rating = st.number_input("Inverter Rated Capacity (kW):", min_value=0.5, max_value=50.0, value=float(profile.inverter.rating_kw), step=0.5)
                inv_eff = st.slider("Inverter Conversion Efficiency (%):", 80.0, 99.5, float(profile.inverter.efficiency_fraction * 100.0), 0.5) / 100.0
                zero_export = st.checkbox("Zero-Export Enforced (Zero Reverse Power Flow)", value=profile.inverter.is_zero_export_enforced)

            with cfg2:
                st.markdown("##### 🎯 Optimization Strategy")
                goal_options = {
                    OptimizationGoal.MINIMIZE_BILLS: "💰 Minimize Electricity Bills (Maximizes battery & export savings)",
                    OptimizationGoal.MAXIMIZE_SELF_CONSUMPTION: "☀️ Maximize Solar Self-Consumption (Retains all green kWh locally)",
                    OptimizationGoal.REDUCE_GRID_IMPORTS: "🛡️ Reduce Grid Imports (Minimizes peak DISCOM dependency)",
                    OptimizationGoal.PRESERVE_BACKUP_RESERVE: "🔋 Preserve Backup Reserve (Maintains high emergency reserve)",
                }
                selected_goal_key = st.selectbox(
                    "Primary Home Optimization Goal:",
                    list(goal_options.keys()),
                    format_func=lambda k: goal_options[k],
                    index=list(goal_options.keys()).index(profile.optimization_goal),
                )

                st.markdown("##### 💵 DISCOM Tariffs")
                buy_tariff = st.number_input("Grid Purchase Price (₹/kWh):", min_value=0.5, max_value=30.0, value=float(profile.grid_purchase_tariff_inr), step=0.25)
                sell_tariff = st.number_input("Grid Export / Feed-in Tariff (₹/kWh):", min_value=0.0, max_value=20.0, value=float(profile.grid_export_tariff_inr), step=0.25)

                st.markdown("##### 🌐 Community Participation")
                community_opt = st.checkbox(
                    "Participate in Community Energy Sharing (Phase 8)",
                    value=profile.community_opt_in,
                    help="When disabled, your home operates 100% standalone and no surplus is routed externally.",
                )

            submit_save = st.form_submit_button("💾 Save Configuration Profile", use_container_width=True)

            if submit_save:
                profile.home_name = home_name
                profile.location = location
                profile.solar_capacity_kw = solar_kw
                profile.inverter.brand = inv_brand
                profile.inverter.rating_kw = inv_rating
                profile.inverter.efficiency_fraction = inv_eff
                profile.inverter.is_zero_export_enforced = zero_export
                profile.optimization_goal = selected_goal_key
                profile.grid_purchase_tariff_inr = buy_tariff
                profile.grid_export_tariff_inr = sell_tariff
                profile.community_opt_in = community_opt

                try:
                    profile.validate()
                    _PROFILE_DIR.mkdir(parents=True, exist_ok=True)
                    profile.save_to_file(str(_DEFAULT_PROFILE_PATH))
                    st.success("✅ Home profile successfully updated and persisted to disk!")
                except Exception as e:
                    st.error(f"❌ Configuration error: {e}")

    # -------------------------------------------------------------------------
    # SUB-TAB 3: BATTERY & SAFETY GUARDRAILS
    # -------------------------------------------------------------------------
    with sub_tabs[2]:
        st.markdown("#### 🔋 Battery Storage Limits & Safety Guardrails")
        st.caption("Configured protective boundaries preventing overcharging, deep-discharging, and cell degradation.")

        b_col1, b_col2 = st.columns(2)
        with b_col1:
            st.markdown("##### 🛡️ State-of-Charge (SoC) Protective Envelope")
            st.write(f"• **Capacity:** `{profile.battery.capacity_kwh:.1f} kWh` ({profile.battery.chemistry})")
            st.write(f"• **Minimum SoC Floor:** `{profile.battery.min_soc_pct:.1f}%` (Protects against deep discharge)")
            st.write(f"• **Maximum SoC Ceiling:** `{profile.battery.max_soc_pct:.1f}%` (Protects cell chemistry)")
            st.write(f"• **Preferred Backup Reserve:** `{profile.battery.preferred_backup_reserve_pct:.1f}%` (Protected emergency power)")

            # Visual SoC Gauge
            soc_fig = go.Figure(
                go.Indicator(
                    mode="gauge+number",
                    value=profile.battery.current_soc_pct,
                    title={"text": "Current Battery SoC"},
                    gauge={
                        "axis": {"range": [0, 100]},
                        "bar": {"color": "#00e5ff"},
                        "steps": [
                            {"range": [0, profile.battery.min_soc_pct], "color": "#e63946"},
                            {"range": [profile.battery.min_soc_pct, profile.battery.preferred_backup_reserve_pct], "color": "#ffb703"},
                            {"range": [profile.battery.preferred_backup_reserve_pct, profile.battery.max_soc_pct], "color": "#52b788"},
                            {"range": [profile.battery.max_soc_pct, 100], "color": "#e63946"},
                        ],
                    },
                )
            )
            soc_fig.update_layout(height=240, margin={"l": 20, "r": 20, "t": 30, "b": 20}, template="plotly_dark")
            st.plotly_chart(soc_fig, use_container_width=True)

        with b_col2:
            st.markdown("##### ⚡ Power & Invariant Enforcement")
            st.write(f"• **Max Charge Power:** `{profile.battery.max_charge_power_kw:.2f} kW`")
            st.write(f"• **Max Discharge Power:** `{profile.battery.max_discharge_power_kw:.2f} kW`")
            st.write(f"• **Roundtrip Efficiency:** `{(profile.battery.charge_efficiency * profile.battery.discharge_efficiency) * 100.0:.1f}%`")
            st.write(f"• **Hardware Protection:** `{'Verified Modbus Gateway' if profile.battery.is_verified_hardware else 'Simulation Sandbox'}`")

            st.markdown(html_block("""
                <div style="background: #112233; padding: 14px; border-radius: 6px; border-left: 4px solid #00e5ff; margin-top: 15px;">
                    <strong style="color: #00e5ff;">Non-Contradictory Command Guarantee:</strong><br/>
                    <span style="font-size: 13px; color: #cbd5e1;">
                    The balance engine mathematically guarantees that <code>P_charge * P_discharge ≡ 0</code>.
                    Simultaneous charging and discharging commands are structurally prohibited, preventing inverter bridge fault conditions.
                    </span>
                </div>
                """),
                unsafe_allow_html=True,
            )

    # -------------------------------------------------------------------------
    # SUB-TAB 4: EV & FLEXIBLE APPLIANCES
    # -------------------------------------------------------------------------
    with sub_tabs[3]:
        st.markdown("#### 🚗 EV Charger & Smart Flexible Appliances")
        st.caption("Manage deferred loads that absorb surplus solar power automatically before grid export.")

        ev_c, flex_c = st.columns(2)
        with ev_c:
            st.markdown("##### 🔌 Electric Vehicle (EV) Integration")
            st.write(f"• **EV Status:** `{'Connected' if profile.ev_charger.is_connected else 'Disconnected'}`")
            st.write(f"• **EV Battery:** `{profile.ev_charger.battery_capacity_kwh:.1f} kWh`")
            st.write(f"• **Current SoC:** `{profile.ev_charger.current_soc_pct:.1f}%` → **Target:** `{profile.ev_charger.target_soc_pct:.1f}%`")
            st.write(f"• **Max Charge Rate:** `{profile.ev_charger.max_charge_power_kw:.2f} kW`")
            st.write(f"• **Departure Time:** `{profile.ev_charger.departure_hour:02d}:00 hrs`")
            st.write(f"• **Preference Mode:** `{profile.ev_charger.charging_preference.value}`")

        with flex_c:
            st.markdown("##### 🧺 Smart Flexible Appliances")
            if profile.flexible_appliances:
                for app in profile.flexible_appliances:
                    st.write(
                        f"• **{app.name}**: `{app.nominal_power_kw:.2f} kW` | "
                        f"Run: `{app.required_runtime_hours:.1f}h` | "
                        f"Window: `{app.window_start_hour:02d}:00 - {app.window_end_hour:02d}:00` | "
                        f"Priority: `{app.priority}`"
                    )
            else:
                st.info("No flexible appliances configured.")

    # -------------------------------------------------------------------------
    # SUB-TAB 5: COMMUNITY P2P EXCHANGE (PHASE 8)
    # -------------------------------------------------------------------------
    with sub_tabs[4]:
        st.markdown("#### 🌐 Community Energy Sharing & Virtual Net Metering (Phase 8)")
        st.caption(
            "Peer-to-peer surplus routing across local microgrid feeders with $I^2R$ copper losses. "
            "Guarantees that opted-out homes remain 100% autonomous with zero external dependencies."
        )

        if not profile.community_opt_in:
            st.warning(
                "🛡️ **Standalone Isolation Active**: This home has NOT opted into community energy sharing. "
                "All solar energy is consumed locally or exported to DISCOM. No data or power is exposed to neighbors."
            )
            if st.button("Enable Community Opt-In for this Home"):
                profile.community_opt_in = True
                profile.save_to_file(str(_DEFAULT_PROFILE_PATH))
                st.rerun()
        else:
            st.success("✅ **Community Opt-In Active**: Participating in local surplus energy clearing.")

            # Run dynamic community simulation
            avail_surplus = max(0.0, float(st.session_state.get("sim_pv", 4.0)) - float(st.session_state.get("sim_load", 1.5)) - 1.0)
            st.markdown(f"**Available Community Export Surplus from this Home:** `{avail_surplus:.2f} kW`")

            p2p_res = route_community_exchange(
                seller_home_id=profile.home_id,
                surplus_kw=avail_surplus,
                seller_opted_in=profile.community_opt_in,
                buyer_home_id="neighbor_sharma_residence",
                buyer_opted_in=True,
                buyer_deficit_kw=2.0,
                feeder_resistance_ohms=0.08,
                feeder_voltage_v=230.0,
                community_clearing_price_inr=5.50,
                discom_retail_tariff_inr=float(profile.grid_purchase_tariff_inr),
                discom_export_tariff_inr=float(profile.grid_export_tariff_inr),
            )

            p1, p2, p3, p4 = st.columns(4)
            p1.metric("Transferred Power", f"{p2p_res['transferred_kw']:.2f} kW")
            p2.metric("Received Power (at Buyer)", f"{p2p_res['delivered_to_buyer_kw']:.2f} kW")
            p3.metric("I²R Copper Line Loss", f"{p2p_res['line_loss_kw']:.3f} kW")
            p4.metric("Community Net Benefit", f"₹{p2p_res['combined_social_benefit_inr']:.2f}/h")

            st.json(p2p_res)
