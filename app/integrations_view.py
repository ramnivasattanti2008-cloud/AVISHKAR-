# ruff: noqa: C408, E402, I001
"""Integrations View for AVISHKAR EMS Dashboard.

Demonstrates and coordinates capabilities adapted from 11 verified open-source energy platforms:
1. SEM-Community: Proportional energy mixing & priority loads
2. EVCC: 4-mode EV smart charging & contactor protection
3. SolarFlow: Closed-loop PI zero-export grid limiting & Shelly relays
4. Smart Energy Manager: 24h cheapest price windows & multi-vendor register map
5. SunCore: Stepped thermal buffer & battery deficit back-off
6. Energy Manager: Spot-price spread arbitrage & peak grouping
7. HomeAssistant EMS: Sub-second 3-phase breaker headroom guard
8. Solar Battery Dispatch: Daylight-only error metrics & baseline benchmark
9. Microgrid Autopilot: Microgrid MPC fallback rules & island survival
10. Solectrus: Real-time power balance flow ledger, autarky & freshness
11. Flexcomm: Community virtual net metering & distribution line loss
"""

from __future__ import annotations

import streamlit as st

from avishkar_ems.integrations import (
    ArbitrageAction,
    BreakerHeadroomGuard,
    CommunityEnergySharing,
    CommunityMember,
    ControllableLoad,
    DispatchValidator,
    EnergyArbitrageScheduler,
    EvccChargerController,
    EvccMode,
    InverterBrand,
    MicrogridMpcController,
    SemCommunityCoordinator,
    SmartBatteryScheduler,
    SolarFlowLimiter,
    SolectrusMetrics,
    SunCoreThermalBuffer,
    ThermalDevice,
    ThermalDeviceType,
    TimeSlot,
)


def render_integrations_dashboard() -> None:
    """Renders the Surplus Intelligence & Multi-Repository Integrations tab."""
    st.subheader("🚀 13. Open-Source Surplus Intelligence & Multi-Engine Suite")
    st.caption(
        "Directly imported, adapted, and operating in AVISHKAR: algorithmic capabilities from "
        "11 premier international open-source energy management architectures."
    )

    # ---------------------------------------------------------------------------
    # SECTION 1: SEM-COMMUNITY & SOLECTRUS (POWER FLOWS & AUTARKY)
    # ---------------------------------------------------------------------------
    with st.expander("⚡ 1. SEM-Community & Solectrus: Proportional Power Mixing & Flow Ledger", expanded=True):
        st.markdown("##### 🔬 Physically Accurate Energy Mixing & Autarky Degree")
        st.markdown(
            "Adapted from **sem-community** (`flow_calculator.py`) and **solectrus** (`summary.rb`). "
            "Unlike simplistic subtraction, this calculates exact proportional electron mixing from "
            "generation sources to home, battery, EV, and grid sinks."
        )

        c1, c2, c3, c4 = st.columns(4)
        solar_in = c1.number_input("Solar Generation (kW)", min_value=0.0, max_value=25.0, value=6.0, step=0.5)
        grid_in = c2.number_input("Grid Import (kW)", min_value=0.0, max_value=25.0, value=2.0, step=0.5)
        batt_dis = c3.number_input("Battery Discharge (kW)", min_value=0.0, max_value=15.0, value=0.0, step=0.5)
        home_sink = c4.number_input("Home Load (kW)", min_value=0.0, max_value=25.0, value=4.0, step=0.5)

        c5, c6, c7, c8 = st.columns(4)
        batt_chg = c5.number_input("Battery Charge (kW)", min_value=0.0, max_value=15.0, value=2.0, step=0.5)
        ev_sink = c6.number_input("EV Charging (kW)", min_value=0.0, max_value=22.0, value=2.0, step=0.5)
        grid_exp = c7.number_input("Grid Export (kW)", min_value=0.0, max_value=25.0, value=0.0, step=0.5)
        telem_age = c8.number_input("Telemetry Age (seconds)", min_value=0, max_value=3600, value=45, step=15)

        sem_coord = SemCommunityCoordinator()
        flow_res = sem_coord.calculate_proportional_flows(
            solar_kw=solar_in,
            grid_import_kw=grid_in,
            battery_discharge_kw=batt_dis,
            home_load_kw=home_sink,
            battery_charge_kw=batt_chg,
            ev_charge_kw=ev_sink,
            grid_export_kw=grid_exp,
        )

        solectrus_bal = SolectrusMetrics.calculate_flow_balance(
            solar_generation=solar_in,
            home_consumption=home_sink,
            battery_charge=batt_chg,
            battery_discharge=batt_dis,
            grid_import=grid_in,
            grid_export=grid_exp,
        )

        freshness = SolectrusMetrics.evaluate_freshness(
            last_updated_timestamp=1000.0,
            current_time=1000.0 + telem_age,
        )

        m1, m2, m3, m4 = st.columns(4)
        m1.metric("Home Solar Share", f"{flow_res.home_solar_share_pct:.1f}%", "Proportional Electron Mixing")
        m2.metric("EV Solar Share", f"{flow_res.ev_solar_share_pct:.1f}%", "Pure Clean Power")
        m3.metric("Self-Consumption Ratio", f"{solectrus_bal.self_consumption_pct:.1f}%", "Solar Consumed Locally")
        m4.metric("Autarky Degree", f"{solectrus_bal.autarky_pct:.1f}%", f"Freshness: {freshness.status.value}")

        if not flow_res.is_balanced:
            st.warning(f"⚠️ Flow imbalance detected: Source {flow_res.total_source_kw} kW vs Destination {flow_res.total_dest_kw} kW.")
        else:
            st.success("✅ Power flow is mathematically balanced: Kirchhoff's first law satisfied.")

    # ---------------------------------------------------------------------------
    # SECTION 2: EVCC & HOMEASSISTANT EMS (EV & BREAKER HEADROOM)
    # ---------------------------------------------------------------------------
    with st.expander("🚗 2. EVCC & HomeAssistant EMS: Smart EV Charging & Breaker Guard", expanded=True):
        st.markdown("##### ⚡ 4-Mode EV State Machine & Sub-Second Main Breaker Protection")
        st.markdown(
            "Adapted from **evcc-io/evcc** (`loadpoint.go`) and **homeassistant-ems** (`strategy.py`). "
            "Guarantees that EV charging uses maximum surplus while safeguarding physical service fuses "
            "from tripping under sudden domestic appliance surges."
        )

        e_col1, e_col2, e_col3 = st.columns(3)
        ev_mode_sel = e_col1.selectbox("EVCC Charging Mode", ["PV", "MIN_PV", "NOW", "OFF"], index=0)
        ev_surplus = e_col2.slider("Available Solar Surplus (kW)", 0.0, 15.0, 4.5, 0.5)
        fuse_rating = e_col3.selectbox("Main Service Fuse Rating (A)", [25.0, 35.0, 50.0, 63.0], index=1)

        b_c1, b_c2, b_c3 = st.columns(3)
        phase1_a = b_c1.number_input("Phase 1 Current (A)", 0.0, 70.0, 16.0, 1.0)
        phase2_a = b_c2.number_input("Phase 2 Current (A)", 0.0, 70.0, 22.0, 1.0)
        phase3_a = b_c3.number_input("Phase 3 Current (A)", 0.0, 70.0, 14.0, 1.0)

        guard = BreakerHeadroomGuard(main_fuse_rating_a=fuse_rating, safety_margin_a=2.0)
        headroom = guard.calculate_headroom([phase1_a, phase2_a, phase3_a])

        evcc_ctrl = EvccChargerController(enable_delay_s=0.0, disable_delay_s=0.0)
        evcc_res = evcc_ctrl.dispatch(
            mode=EvccMode(ev_mode_sel.lower()),
            available_surplus_kw=ev_surplus,
        )

        r1, r2, r3, r4 = st.columns(4)
        r1.metric("EV Charging Target", f"{evcc_res.charge_power_kw:.2f} kW", f"Active: {evcc_res.is_charging}")
        r2.metric("EV Solar Power", f"{evcc_res.from_solar_kw:.2f} kW", f"Grid: {evcc_res.from_grid_kw:.2f} kW")
        r3.metric("Bottleneck Phase", f"Phase {headroom.bottleneck_phase}", f"Headroom: {headroom.available_headroom_a:.1f} A")
        r4.metric("Breaker Safe Limit", f"{headroom.safe_ev_current_a:.1f} A", f"Throttled: {headroom.is_limiting}")

        if headroom.is_limiting:
            st.warning(f"⚠️ {headroom.reason}")
        else:
            st.info(f"ℹ️ {headroom.reason}")

    # ---------------------------------------------------------------------------
    # SECTION 3: SOLARFLOW (ZERO-EXPORT PI LIMITER & SHELLY RELAYS)
    # ---------------------------------------------------------------------------
    with st.expander("🛡️ 3. SolarFlow: Closed-Loop Zero-Export Limiter & Shelly Relays", expanded=False):
        st.markdown("##### 🔄 PI Feedback Loop for Strict Zero-Export Grid Compliance")
        st.markdown(
            "Adapted from **lbsanto/SolarFlow**. When DISCOMs prohibit or penalize reverse power feed-in, "
            "this Proportional-Integral controller dynamically curtails inverter active power to keep grid export at 0.0 kW."
        )

        sf1, sf2, sf3 = st.columns(3)
        cur_solar = sf1.slider("Solar PV Output (kW)", 0.0, 15.0, 6.0, 0.5)
        cur_export = sf2.slider("Unconstrained Grid Export (kW)", 0.0, 10.0, 2.5, 0.5)
        target_exp = sf3.number_input("Target Export Ceiling (kW)", 0.0, 5.0, 0.0, 0.1)

        sf_limiter = SolarFlowLimiter(target_export_kw=target_exp, kp=0.8, ki=0.1)
        # Register standard home relays
        sf_limiter.register_load(ControllableLoad("pump", "Borewell Pump", 1.2, priority=1))
        sf_limiter.register_load(ControllableLoad("geyser", "Water Heater", 2.0, priority=2))
        sf_limiter.register_load(ControllableLoad("ac", "Inverter AC", 1.5, priority=3))

        inv_decision = sf_limiter.calculate_inverter_setpoint(
            current_solar_kw=cur_solar,
            current_grid_export_kw=cur_export,
        )
        relay_actions = sf_limiter.evaluate_relays(surplus_kw=cur_solar - 2.0)

        s_col1, s_col2, s_col3 = st.columns(3)
        s_col1.metric("Adjusted Inverter Limit", f"{inv_decision.suggested_inverter_power_kw:.2f} kW", f"Throttled: {inv_decision.is_throttled}")
        s_col2.metric("Export Suppression Error", f"{inv_decision.error_kw:.2f} kW", f"Target: {inv_decision.target_grid_export_kw:.1f} kW")
        s_col3.metric("Relay Switching Actions", f"{len(relay_actions)} loads dispatched", "Automated Shelly Control")

        st.caption(f"Status: {inv_decision.reason}")

    # ---------------------------------------------------------------------------
    # SECTION 4: SMART ENERGY MANAGER & ENERGY MANAGER (TARIFFS & REGISTERS)
    # ---------------------------------------------------------------------------
    with st.expander("📈 4. Smart Energy Manager & Energy Manager: Tariffs, Registers & Spread Arbitrage", expanded=False):
        st.markdown("##### 💰 Multi-Vendor Modbus Translation & Spot-Price Spread Optimization")
        st.markdown(
            "Adapted from **jirihelmich/smart-energy-manager** and **jyourstone/energy_manager** (BATT-15 algorithm). "
            "Discovers cheapest charging windows, translates targets into physical inverter registers, "
            "and schedules multi-cycle battery arbitrage based on price spread profitability."
        )

        sample_prices = [0.22, 0.20, 0.18, 0.12, 0.10, 0.11, 0.16, 0.25, 0.32, 0.35, 0.30, 0.28]
        sem_sched = SmartBatteryScheduler()
        cheapest_win = sem_sched.find_cheapest_charging_window(sample_prices, required_hours=3)

        arb_sched = EnergyArbitrageScheduler(battery_capacity_kwh=10.0, discharge_spread_threshold=0.06)
        time_slots = [TimeSlot(slot_index=i, price=p) for i, p in enumerate(sample_prices)]
        plan = arb_sched.plan_day_schedule(time_slots, initial_soc_kwh=3.0)

        t_col1, t_col2, t_col3 = st.columns(3)
        t_col1.metric("Cheapest Window", f"Hour {cheapest_win.start_hour}:00 - {cheapest_win.end_hour}:00", f"Avg: ₹{cheapest_win.avg_price:.2f}/kWh")
        charge_slots = sum(1 for p in plan if p.action == ArbitrageAction.CHARGE)
        dis_slots = sum(1 for p in plan if p.action in (ArbitrageAction.DISCHARGE, ArbitrageAction.EXPORT))
        t_col2.metric("Scheduled Battery Cycles", f"{charge_slots} Charge / {dis_slots} Discharge", "Spread-Optimized")

        brand_choice = t_col3.selectbox("Target Inverter Hardware", [InverterBrand.VICTRON, InverterBrand.GOODWE, InverterBrand.SOLAX, InverterBrand.SUNGROW], index=0)
        registers = sem_sched.generate_inverter_commands(brand_choice, target_charge_power_w=3000.0, target_discharge_power_w=0.0)

        reg_summary = ", ".join(f"Reg {r.register_address}: {r.value}" for r in registers)
        t_col3.caption(f"Hardware Modbus Setpoints: {reg_summary}")

    # ---------------------------------------------------------------------------
    # SECTION 5: SUNCORE & MICROGRID AUTOPILOT (THERMAL & BLACKOUT RESILIENCE)
    # ---------------------------------------------------------------------------
    with st.expander("🔋 5. SunCore & Microgrid Autopilot: Thermal Storage & Blackout Resilience", expanded=False):
        st.markdown("##### 🛡️ Stepped Water Heater Buffering & Critical Load Island Duration")
        st.markdown(
            "Adapted from **PXLJAKE/SunCore** and **isahan78/microgrid-autopilot**. "
            "Absorbs surplus into hot water boilers with battery deficit buffering, "
            "and calculates islanding resilience during grid failures."
        )

        sc1, sc2, sc3 = st.columns(3)
        thermal_surplus = sc1.slider("Solar Surplus for Heating (kW)", 0.0, 5.0, 1.8, 0.2)
        critical_load = sc2.slider("Essential Home Load (kW)", 0.5, 5.0, 1.5, 0.5)
        battery_kwh = sc3.slider("Battery Storage Capacity (kWh)", 5.0, 30.0, 15.0, 2.5)

        thermal_buf = SunCoreThermalBuffer(hysteresis_w=200.0)
        boiler = ThermalDevice("boiler_main", ThermalDeviceType.IMMERSION_HEATER, power_steps_kw=[0.0, 1.0, 2.0, 3.0])
        thermal_buf.register_device(boiler)
        alloc_res = thermal_buf.allocate("boiler_main", available_surplus_kw=thermal_surplus)

        micro_ctrl = MicrogridMpcController(battery_capacity_kwh=battery_kwh, initial_soc_pct=75.0)
        survival_hours = micro_ctrl.simulate_island_survival(critical_load_kw=critical_load)

        th1, th2, th3 = st.columns(3)
        th1.metric("Thermal Storage Power", f"{alloc_res.allocated_power_kw:.1f} kW", f"Step {alloc_res.allocated_step_idx} / 3")
        th2.metric("Thermal Status", alloc_res.reason)
        th3.metric("Blackout Island Survival", f"{survival_hours:.1f} Hours", f"At {critical_load:.1f} kW Essential Load")

    # ---------------------------------------------------------------------------
    # SECTION 6: SOLAR BATTERY DISPATCH & FLEXCOMM (METRICS & P2P SHARING)
    # ---------------------------------------------------------------------------
    with st.expander("🌐 6. Solar Battery Dispatch & Flexcomm: Daylight Validation & P2P Line Loss", expanded=False):
        st.markdown("##### 🔬 Accurate Daylight-Only Metrics & Virtual Net Metering with I²R Losses")
        st.markdown(
            "Adapted from **Quentinluoqz/solar-battery-dispatch** (`evaluate.py`) and **Enpower-project/Flexcomm**. "
            "Filters night-time zero-generation periods to prevent MAPE distortion, and routes peer-to-peer "
            "solar surplus with physical copper distribution losses."
        )

        validator = DispatchValidator(daylight_threshold_kw=0.05)
        demo_actuals = [0.0, 0.0, 0.2, 1.5, 3.8, 4.2, 3.1, 1.0, 0.1, 0.0]
        demo_preds = [0.02, 0.01, 0.3, 1.6, 3.5, 4.4, 2.9, 0.9, 0.05, 0.0]
        metrics = validator.evaluate_forecast(demo_actuals, demo_preds)

        p2p_sharing = CommunityEnergySharing(community_tariff_per_kwh=0.12)
        demo_members = [
            CommunityMember("site_1", "Sharma Villa", generation_kw=7.0, consumption_kw=2.0, distance_feeder_m=120.0),
            CommunityMember("site_2", "Verma Residence", generation_kw=1.0, consumption_kw=3.5, distance_feeder_m=80.0),
            CommunityMember("site_3", "Patel Dairy", generation_kw=0.0, consumption_kw=2.0, distance_feeder_m=200.0),
        ]
        sharing_summary = p2p_sharing.allocate_community_sharing(demo_members)

        v1, v2, v3, v4 = st.columns(4)
        v1.metric("Daylight Forecast MAE", f"{metrics.daylight_mae:.3f} kW", f"{metrics.daylight_hours_count} Daylight Hours")
        v2.metric("Daylight RMSE", f"{metrics.daylight_rmse:.3f} kW", f"Normalized: {metrics.nrmse_mean:.1%}")
        v3.metric("Community Energy Shared", f"{sharing_summary.internal_shared_kw:.2f} kW", f"{len(sharing_summary.trades)} P2P Trades")
        v4.metric("Feeder Line Loss (I²R)", f"{sharing_summary.total_line_loss_kw * 1000.0:.1f} W", "Physical Resistance Loss")
