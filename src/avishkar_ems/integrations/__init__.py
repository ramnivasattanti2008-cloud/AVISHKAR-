"""External Energy Management System Integrations for AVISHKAR.

Curated, adapted, and production-tested algorithms imported from premier
open-source energy repositories:

1. SemCommunityCoordinator (traktore-org/sem-community, MIT)
   Proportional power mixing and priority load state management.
2. EvccChargerController (evcc-io/evcc, Apache-2.0)
   4-mode solar EV charging state machine, phase switching & contactor safety delays.
3. SolarFlowLimiter (lbsanto/SolarFlow, Apache-2.0)
   Closed-loop PI zero-export grid limiting & Shelly relay control.
4. SmartBatteryScheduler (jirihelmich/smart-energy-manager, MIT)
   Dynamic tariff window discovery & multi-vendor inverter register mapping.
5. SunCoreThermalBuffer (PXLJAKE/SunCore, Apache-2.0)
   Thermal immersion / heat pump allocation, hysteresis bands & battery deficit buffering.
6. EnergyArbitrageScheduler (jyourstone/energy_manager, Apache-2.0)
   Spot-price spread arbitrage, peak grouping & virtual battery simulation.
7. BreakerHeadroomGuard (thomasgodon/homeassistant-ems, MIT)
   Sub-second main service breaker headroom guard & anti-hunting filter.
8. DispatchValidator (Quentinluoqz/solar-battery-dispatch, MIT)
   Daylight-only error metrics (MAE/RMSE/nRMSE) & holdout strategy evaluation.
9. MicrogridMpcController (isahan78/microgrid-autopilot, MIT)
   Microgrid MPC dispatch, carbon optimization & deterministic fallback rules.
10. SolectrusMetrics (solectrus/solectrus, MIT)
    Power flow ledger, autarky degree, self-consumption & telemetry freshness scoring.
11. CommunityEnergySharing (Enpower-project/Flexcomm, Clean-room implementation)
    Peer-to-peer community sharing, virtual net metering & distribution line-loss modeling.
"""

from __future__ import annotations

from avishkar_ems.integrations.breaker_headroom import (
    BreakerHeadroomGuard,
    HeadroomResult,
    PhaseReading,
)
from avishkar_ems.integrations.dispatch_validator import (
    DispatchStrategyComparison,
    DispatchValidator,
    ForecastMetrics,
)
from avishkar_ems.integrations.energy_arbitrage import (
    ArbitrageAction,
    ArbitragePlanSlot,
    EnergyArbitrageScheduler,
    TimeSlot,
)
from avishkar_ems.integrations.evcc_controller import (
    ChargerPhase,
    EvccChargerController,
    EvccDispatchResult,
    EvccMode,
)
from avishkar_ems.integrations.flexcomm_sharing import (
    CommunityEnergySharing,
    CommunityMember,
    CommunitySharingSummary,
    CommunityTradeResult,
)
from avishkar_ems.integrations.microgrid_mpc import (
    DispatchSource,
    MicrogridMpcController,
    MicrogridStepResult,
)
from avishkar_ems.integrations.sem_coordinator import (
    DevicePriority,
    ProportionalFlowResult,
    SemCommunityCoordinator,
)
from avishkar_ems.integrations.smart_battery_scheduler import (
    CheapestWindow,
    InverterBrand,
    InverterRegisterCommand,
    PriceSlot,
    SmartBatteryScheduler,
)
from avishkar_ems.integrations.solarflow_limiter import (
    ControllableLoad,
    InverterLimitDecision,
    RelayAction,
    SolarFlowLimiter,
)
from avishkar_ems.integrations.solectrus_metrics import (
    FlowBalanceResult,
    FreshnessScore,
    FreshnessStatus,
    SolectrusMetrics,
)
from avishkar_ems.integrations.suncore_thermal import (
    SunCoreThermalBuffer,
    ThermalAllocationResult,
    ThermalDevice,
    ThermalDeviceType,
)

__all__ = [
    # SEM Community
    "SemCommunityCoordinator",
    "ProportionalFlowResult",
    "DevicePriority",
    # EVCC
    "EvccChargerController",
    "EvccMode",
    "ChargerPhase",
    "EvccDispatchResult",
    # SolarFlow
    "SolarFlowLimiter",
    "ControllableLoad",
    "RelayAction",
    "InverterLimitDecision",
    # Smart Energy Manager
    "SmartBatteryScheduler",
    "InverterBrand",
    "PriceSlot",
    "CheapestWindow",
    "InverterRegisterCommand",
    # SunCore
    "SunCoreThermalBuffer",
    "ThermalDevice",
    "ThermalDeviceType",
    "ThermalAllocationResult",
    # Energy Manager
    "EnergyArbitrageScheduler",
    "ArbitrageAction",
    "TimeSlot",
    "ArbitragePlanSlot",
    # HomeAssistant EMS
    "BreakerHeadroomGuard",
    "PhaseReading",
    "HeadroomResult",
    # Solar Battery Dispatch
    "DispatchValidator",
    "ForecastMetrics",
    "DispatchStrategyComparison",
    # Microgrid Autopilot
    "MicrogridMpcController",
    "DispatchSource",
    "MicrogridStepResult",
    # Solectrus
    "SolectrusMetrics",
    "FlowBalanceResult",
    "FreshnessScore",
    "FreshnessStatus",
    # Flexcomm
    "CommunityEnergySharing",
    "CommunityMember",
    "CommunityTradeResult",
    "CommunitySharingSummary",
]

