"""Wire format of the engine. camelCase on the wire (the API is TypeScript), snake_case in Python."""

from __future__ import annotations

import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel

MAX_STEPS = 400
STEP_HOURS = (0.25, 0.5, 1.0)

Mode = Literal["SAVE_MONEY", "INDEPENDENCE", "RESILIENCE", "GREEN", "REVENUE", "BALANCED"]


class Wire(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


def _finite(values: list[float], name: str) -> list[float]:
    if any(not math.isfinite(v) for v in values):
        raise ValueError(f"{name} contains a value that is not a finite number")
    return values


# ------------------------------------------------------------------ optimise: request


class BatteryIn(Wire):
    capacity_kwh: float = Field(gt=0, le=100_000)
    max_charge_kw: float = Field(gt=0, le=100_000)
    max_discharge_kw: float = Field(gt=0, le=100_000)
    charge_efficiency: float = Field(ge=0.5, le=1)
    discharge_efficiency: float = Field(ge=0.5, le=1)
    min_soc_kwh: float = Field(ge=0)
    max_soc_kwh: float = Field(gt=0)
    reserve_soc_kwh: float | None = Field(default=None, ge=0, description="Kept back for backup outside an outage; None for no reserve.")
    initial_soc_kwh: float = Field(ge=0)
    terminal_soc_kwh: float | None = Field(default=None, ge=0, description="Stored energy to end the horizon with. None: as much as it started with.")
    wear_inr_per_kwh: float = Field(default=0, ge=0, le=1000, description="Cost of wear per kWh drawn out of the battery.")
    cyclic: bool = Field(
        default=False,
        description="The horizon starts and ends at the same charge, which the planner chooses: for a typical day that repeats. initialSocKwh and terminalSocKwh are then not used (send any value in range).",
    )

    @model_validator(mode="after")
    def _ordered(self) -> BatteryIn:
        if self.max_soc_kwh > self.capacity_kwh + 1e-9:
            raise ValueError("maxSocKwh is above the capacity")
        if self.min_soc_kwh >= self.max_soc_kwh:
            raise ValueError("minSocKwh must be below maxSocKwh")
        if self.reserve_soc_kwh is not None and not (self.min_soc_kwh - 1e-9 <= self.reserve_soc_kwh <= self.max_soc_kwh + 1e-9):
            raise ValueError("reserveSocKwh must lie between minSocKwh and maxSocKwh")
        for name, v in (("initialSocKwh", self.initial_soc_kwh), ("terminalSocKwh", self.terminal_soc_kwh)):
            if v is not None and not (self.min_soc_kwh - 1e-9 <= v <= self.max_soc_kwh + 1e-9):
                raise ValueError(f"{name} must lie between minSocKwh and maxSocKwh")
        return self


class Outage(Wire):
    start_step: int = Field(ge=0)
    end_step: int = Field(gt=0, description="Exclusive.")

    @model_validator(mode="after")
    def _ordered(self) -> Outage:
        if self.end_step <= self.start_step:
            raise ValueError("an outage must end after it starts")
        return self


class GridIn(Wire):
    import_limit_kw: float | None = Field(default=None, gt=0)
    export_limit_kw: float | None = Field(default=None, ge=0)
    outages: list[Outage] = Field(default_factory=list, max_length=50)


class EvIn(Wire):
    energy_needed_kwh: float = Field(ge=0, le=1000, description="Energy the vehicle's battery must gain by departure.")
    charger_kw: float = Field(gt=0, le=350)
    charger_efficiency: float = Field(ge=0.5, le=1)
    available_from_step: int = Field(ge=0)
    departure_step: int = Field(gt=0, description="Charging must be complete before this step starts.")

    @model_validator(mode="after")
    def _ordered(self) -> EvIn:
        if self.departure_step <= self.available_from_step:
            raise ValueError("the vehicle must depart after it arrives")
        return self


class ApplianceIn(Wire):
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=120)
    power_kw: float = Field(gt=0, le=1000)
    duration_steps: int = Field(ge=1)
    earliest_start_step: int = Field(ge=0)
    latest_finish_step: int = Field(gt=0, description="Exclusive: the run must be over before this step starts.")
    interruptible: bool = False

    @model_validator(mode="after")
    def _fits(self) -> ApplianceIn:
        window = self.latest_finish_step - self.earliest_start_step
        if self.duration_steps > window:
            raise ValueError(f"{self.name} needs {self.duration_steps} steps but its window is only {max(window, 0)} steps long")
        return self


class OptimiseRequest(Wire):
    step_hours: float
    start_time: str | None = Field(default=None, description="ISO 8601 time of step 0; only used to word the reasons.")
    load_kw: list[float]
    pv_kw: list[float]
    import_price: list[float] = Field(description="INR per kWh bought from the grid, per step.")
    export_price: list[float] = Field(description="INR per kWh credited for export, per step (0 if none).")
    battery: BatteryIn | None = None
    grid: GridIn = Field(default_factory=GridIn)
    critical_kw: float = Field(default=0, ge=0, le=100_000, description="Load that is kept supplied in an outage; everything else is shed.")
    backup_hours: float = Field(default=0, ge=0, le=72, description="RESILIENCE mode keeps this many hours of critical load in the battery.")
    ev: EvIn | None = None
    appliances: list[ApplianceIn] = Field(default_factory=list, max_length=20)
    mode: Mode = "SAVE_MONEY"
    carbon_kg_per_kwh: list[float] | None = Field(default=None, description="Optional grid carbon intensity per step; weights GREEN mode.")
    time_limit_s: float = Field(default=20, gt=0, le=120)

    @field_validator("step_hours")
    @classmethod
    def _step(cls, v: float) -> float:
        if v not in STEP_HOURS:
            raise ValueError(f"stepHours must be one of {list(STEP_HOURS)}")
        return v

    @model_validator(mode="after")
    def _consistent(self) -> OptimiseRequest:
        n = len(self.load_kw)
        if not 2 <= n <= MAX_STEPS:
            raise ValueError(f"the horizon must have between 2 and {MAX_STEPS} steps, not {n}")
        series = {"pvKw": self.pv_kw, "importPrice": self.import_price, "exportPrice": self.export_price}
        if self.carbon_kg_per_kwh is not None:
            series["carbonKgPerKwh"] = self.carbon_kg_per_kwh
        for name, s in series.items():
            if len(s) != n:
                raise ValueError(f"{name} has {len(s)} values but loadKw has {n}: every series must cover the same steps")
        _finite(self.load_kw, "loadKw")
        _finite(self.pv_kw, "pvKw")
        _finite(self.import_price, "importPrice")
        _finite(self.export_price, "exportPrice")
        if min(self.load_kw) < 0 or min(self.pv_kw) < 0:
            raise ValueError("loadKw and pvKw cannot be negative")
        if min(self.import_price) < 0 or min(self.export_price) < 0:
            raise ValueError("prices cannot be negative")
        if max(self.load_kw) > 1e6 or max(self.pv_kw) > 1e6 or max(self.import_price) > 1000 or max(self.export_price) > 1000:
            raise ValueError("a value is far outside anything physical or priced in INR per kWh")
        if any(e > i + 1e-9 for e, i in zip(self.export_price, self.import_price, strict=True)):
            raise ValueError("an export price is above the import price at some step, which would let the grid be traded with itself: check the tariffs")
        for o in self.grid.outages:
            if o.end_step > n:
                raise ValueError("an outage ends after the horizon")
        if self.ev and (self.ev.departure_step > n):
            raise ValueError("the vehicle departs after the horizon")
        for a in self.appliances:
            if a.latest_finish_step > n:
                raise ValueError(f"{a.name}'s window ends after the horizon")
        if len({a.id for a in self.appliances}) != len(self.appliances):
            raise ValueError("appliance ids must be unique")
        return self


# ----------------------------------------------------------------- optimise: response


class SolverInfo(Wire):
    status: Literal["optimal", "infeasible", "error"]
    message: str
    objective: float | None
    seconds: float
    integer_variables: int


class Schedule(Wire):
    pv_used_kw: list[float]
    pv_curtailed_kw: list[float]
    grid_import_kw: list[float]
    grid_export_kw: list[float]
    battery_charge_kw: list[float]
    battery_discharge_kw: list[float]
    battery_soc_kwh: list[float]
    ev_charge_kw: list[float]
    appliance_kw: dict[str, list[float]]
    served_load_kw: list[float]
    unserved_kw: list[float]
    battery_initial_soc_kwh: float | None = Field(default=None, description="The charge the horizon started with. Always given when a battery is planned.")


class ApplianceResult(Wire):
    id: str
    name: str
    start_step: int | None = Field(description="First step of a non-interruptible run; None for an interruptible one.")
    run_steps: list[int]
    energy_kwh: float


class Totals(Wire):
    import_kwh: float
    export_kwh: float
    import_cost_inr: float
    export_revenue_inr: float
    wear_cost_inr: float
    net_cost_inr: float
    load_kwh: float
    pv_kwh: float
    pv_used_kwh: float
    curtailed_kwh: float
    battery_throughput_kwh: float
    battery_cycles: float
    ev_delivered_kwh: float
    ev_shortfall_kwh: float
    unserved_kwh: float
    self_consumption_ratio: float | None = Field(
        description="Share of PV generation that was not curtailed: used by the property, stored or sold. Despite the name, solar that is exported counts as used; "
        "it is not the share consumed on site (None when there is no PV)."
    )
    self_sufficiency_ratio: float | None = Field(description="Share of the load met without the grid (None when there is no load).")


class Baseline(Wire):
    description: str
    net_cost_inr: float
    import_kwh: float
    export_kwh: float
    unserved_kwh: float


class Decision(Wire):
    step: int
    kind: Literal["charge_battery", "discharge_battery", "export", "curtail", "ev_charge", "appliance", "import_peak", "shed"]
    kwh: float
    reason: str


class Validation(Wire):
    valid: bool
    max_balance_error_kw: float
    problems: list[str]


class OptimiseResponse(Wire):
    mode: Mode
    mode_weights: dict[str, float]
    solver: SolverInfo
    schedule: Schedule | None
    appliances: list[ApplianceResult]
    totals: Totals | None
    baseline: Baseline | None
    savings_inr: float | None = Field(description="Baseline net cost minus planned net cost (negative would mean the plan is worse than doing nothing).")
    decisions: list[Decision]
    validation: Validation
    notes: list[str]
