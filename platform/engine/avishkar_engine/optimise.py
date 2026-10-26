"""Energy planner: one explicit linear (or mixed-integer) programme over the horizon, solved with HiGHS (spec sections 17 to 21).

Per step t of `step_hours` hours the programme chooses grid import and export, how much solar to use, battery charge and
discharge, EV charging and when each flexible appliance runs, so as to minimise a mode-weighted cost subject to:

  energy balance   pv_used + import + discharge + unserved = served_load + charge + ev + appliances + export
  battery          soc[t] = soc[t-1] + charge_eff * charge * dt - discharge * dt / discharge_eff, within [min, max],
                   with a backup reserve outside outages, power limits, and a terminal level
  grid             import and export limits; in an outage both are zero and only the critical load is served
  EV               the energy needed is delivered between arrival and departure (or the shortfall is reported)
  appliances       each runs for its duration inside its window (non-interruptible ones are binary start choices)

The plan is never trusted on its own account: `validate` recomputes every balance from the returned schedule, and a plan that
fails is returned flagged SIMULATION INVALID (spec sections 64 and 67). Costs are always reported at the true prices, whatever
the mode weights were. Nothing here reads a database or the network.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp
from scipy.sparse import coo_matrix

from avishkar_engine.schemas import (
    ApplianceResult,
    Baseline,
    Decision,
    OptimiseRequest,
    OptimiseResponse,
    Schedule,
    SolverInfo,
    Totals,
    Validation,
)

# ---- penalties (INR per kWh) that make a constraint soft but expensive: the programme always returns a plan and reports the miss
UNSERVED_INR_PER_KWH = 10_000.0
EV_SHORTFALL_INR_PER_KWH = 1_000.0
APPLIANCE_SKIPPED_INR_PER_KWH = 1_000.0
RESERVE_SHORTFALL_INR_PER_KWH = 100.0
TIE_BREAK = 1e-6  # prefers using solar to wasting it, and not charging and discharging at once, when nothing else decides
TOL = 1e-6


@dataclass(frozen=True)
class ModeWeights:
    """How a mode trades money against other things. These are preferences, not prices: they are returned with every plan."""

    import_cost: float = 1.0
    export_revenue: float = 1.0
    import_energy_penalty: float = 0.0  # INR per kWh imported, on top of its price
    use_backup_hours: bool = False  # keep `backup_hours` of critical load in the battery

    def as_dict(self) -> dict[str, float]:
        return {"importCost": self.import_cost, "exportRevenue": self.export_revenue, "importEnergyPenalty": self.import_energy_penalty, "backupReserve": float(self.use_backup_hours)}


MODE_WEIGHTS: dict[str, ModeWeights] = {
    "SAVE_MONEY": ModeWeights(),
    "INDEPENDENCE": ModeWeights(import_energy_penalty=3.0),
    "GREEN": ModeWeights(import_energy_penalty=2.0),
    "REVENUE": ModeWeights(import_cost=0.5, export_revenue=1.0),
    "RESILIENCE": ModeWeights(use_backup_hours=True),
    "BALANCED": ModeWeights(import_energy_penalty=1.0),
}


class _Model:
    """Variables with bounds, costs and integrality, and sparse linear rows."""

    def __init__(self) -> None:
        self.lb: list[float] = []
        self.ub: list[float] = []
        self.cost: list[float] = []
        self.integer: list[int] = []
        self._r: list[int] = []
        self._c: list[int] = []
        self._v: list[float] = []
        self.row_lb: list[float] = []
        self.row_ub: list[float] = []

    def var(self, lb: float, ub: float, cost: float = 0.0, integer: bool = False) -> int:
        self.lb.append(lb)
        self.ub.append(ub)
        self.cost.append(cost)
        self.integer.append(1 if integer else 0)
        return len(self.lb) - 1

    def row(self, terms: list[tuple[int, float]], lo: float, hi: float) -> None:
        r = len(self.row_lb)
        for c, v in terms:
            if v != 0.0:
                self._r.append(r)
                self._c.append(c)
                self._v.append(v)
        self.row_lb.append(lo)
        self.row_ub.append(hi)

    def eq(self, terms: list[tuple[int, float]], rhs: float) -> None:
        self.row(terms, rhs, rhs)

    def solve(self, time_limit: float):
        a = coo_matrix((self._v, (self._r, self._c)), shape=(len(self.row_lb), len(self.lb))).tocsr()
        return milp(
            c=np.array(self.cost),
            constraints=LinearConstraint(a, np.array(self.row_lb), np.array(self.row_ub)),
            integrality=np.array(self.integer),
            bounds=Bounds(np.array(self.lb), np.array(self.ub)),
            options={"time_limit": time_limit, "presolve": True},
        )


@dataclass
class _Layout:
    imp: list[int] = field(default_factory=list)
    exp: list[int] = field(default_factory=list)
    pvu: list[int] = field(default_factory=list)
    chg: list[int] = field(default_factory=list)
    dis: list[int] = field(default_factory=list)
    soc: list[int] = field(default_factory=list)
    soc0: int | None = None  # the starting charge as a variable, when the battery is cyclic
    evc: list[int] = field(default_factory=list)
    ush: list[int] = field(default_factory=list)
    reserve_short: list[int] = field(default_factory=list)
    terminal_short: int | None = None
    ev_short: int | None = None
    app_power: dict[str, list[list[tuple[int, float]]]] = field(default_factory=dict)  # per step: (variable, kW per unit)
    app_vars: dict[str, list[tuple[int, int]]] = field(default_factory=dict)  # (variable, start step) for binary starts
    app_cont: dict[str, list[int]] = field(default_factory=dict)  # per step variable for interruptible
    app_skip: dict[str, int] = field(default_factory=dict)


def _label(req: OptimiseRequest, step: int) -> str:
    if req.start_time:
        try:
            t = datetime.fromisoformat(req.start_time) + timedelta(hours=step * req.step_hours)
            return t.strftime("%H:%M")
        except ValueError:
            pass
    return f"step {step}"


def _outage_mask(req: OptimiseRequest) -> np.ndarray:
    m = np.zeros(len(req.load_kw), dtype=bool)
    for o in req.grid.outages:
        m[o.start_step : o.end_step] = True
    return m


def _effective_load(req: OptimiseRequest, outage: np.ndarray) -> np.ndarray:
    load = np.array(req.load_kw, dtype=float)
    return np.where(outage, np.minimum(load, req.critical_kw), load)


def _reserve_floor(req: OptimiseRequest, outage: np.ndarray, weights: ModeWeights) -> np.ndarray:
    """Lowest state of charge allowed at the end of each step, in kWh: the reserve outside outages, only the minimum inside."""
    b = req.battery
    assert b is not None
    reserve = b.reserve_soc_kwh if b.reserve_soc_kwh is not None else b.min_soc_kwh
    if weights.use_backup_hours and req.critical_kw > 0 and req.backup_hours > 0:
        # keep enough in the battery to carry the critical load for the hours asked, counting what the discharge efficiency costs
        reserve = max(reserve, min(b.max_soc_kwh, b.min_soc_kwh + req.critical_kw * req.backup_hours / b.discharge_efficiency))
    floor = np.full(len(outage), max(b.min_soc_kwh, reserve))
    floor[outage] = b.min_soc_kwh
    return floor


def optimise(req: OptimiseRequest) -> OptimiseResponse:
    started = time.perf_counter()
    n = len(req.load_kw)
    dt = req.step_hours
    weights = MODE_WEIGHTS[req.mode]
    outage = _outage_mask(req)
    eff_load = _effective_load(req, outage)
    pv = np.array(req.pv_kw, dtype=float)
    pi = np.array(req.import_price, dtype=float)
    pe = np.array(req.export_price, dtype=float)
    carbon = np.array(req.carbon_kg_per_kwh, dtype=float) if req.carbon_kg_per_kwh is not None else None
    b = req.battery
    notes: list[str] = []

    # finite bounds keep the programme bounded whatever the prices
    app_total = sum(a.power_kw for a in req.appliances)
    big_imp = float(np.max(eff_load) + (b.max_charge_kw if b else 0) + (req.ev.charger_kw if req.ev else 0) + app_total + 1.0)
    big_exp = float(np.max(pv) + (b.max_discharge_kw if b else 0) + 1.0)
    imp_ub = req.grid.import_limit_kw if req.grid.import_limit_kw is not None else big_imp
    exp_ub = req.grid.export_limit_kw if req.grid.export_limit_kw is not None else big_exp

    # when export is worth more to the weighted objective than the import it needs, the two must not happen in the same step
    exclusive = bool(np.any(weights.export_revenue * pe > weights.import_cost * pi + weights.import_energy_penalty + TOL))
    if exclusive:
        notes.append("In this mode export is valued above the cost of the import it needs, so import and export are kept apart within each step.")

    m = _Model()
    L = _Layout()
    imp_cost = weights.import_cost * pi * dt + weights.import_energy_penalty * dt
    if carbon is not None and req.mode == "GREEN":
        imp_cost = imp_cost + 5.0 * carbon * dt  # an INR 5 per kg shadow price: a preference, stated in the mode weights notes
        notes.append("GREEN mode weighted import by the carbon intensity you supplied at INR 5 per kg CO2, a preference and not a market price.")

    for t in range(n):
        out = bool(outage[t])
        z = m.var(0, 1, 0.0, integer=True) if exclusive else None
        i = m.var(0, 0.0 if out else imp_ub, float(imp_cost[t]))
        e = m.var(0, 0.0 if out else exp_ub, float(-weights.export_revenue * pe[t] * dt))
        L.imp.append(i)
        L.exp.append(e)
        if z is not None:
            m.row([(i, 1.0), (z, -imp_ub if np.isfinite(imp_ub) else -big_imp)], -np.inf, 0.0)
            m.row([(e, 1.0), (z, exp_ub if np.isfinite(exp_ub) else big_exp)], -np.inf, exp_ub if np.isfinite(exp_ub) else big_exp)
        L.pvu.append(m.var(0, float(pv[t]), -TIE_BREAK * dt))
        # load that cannot be supplied is allowed, at a prohibitive price, so there is always a plan to report on
        L.ush.append(m.var(0, float(eff_load[t]), UNSERVED_INR_PER_KWH * dt))
        if b:
            L.chg.append(m.var(0, b.max_charge_kw, TIE_BREAK * dt))
            L.dis.append(m.var(0, b.max_discharge_kw, (b.wear_inr_per_kwh / b.discharge_efficiency + TIE_BREAK) * dt))
    if b:
        floor = _reserve_floor(req, outage, weights)
        if b.cyclic:
            L.soc0 = m.var(b.min_soc_kwh, b.max_soc_kwh)
        for t in range(n):
            L.soc.append(m.var(0.0, b.max_soc_kwh))
            L.reserve_short.append(m.var(0, b.max_soc_kwh, RESERVE_SHORTFALL_INR_PER_KWH))
            m.row([(L.soc[t], 1.0), (L.reserve_short[t], 1.0)], float(floor[t]), np.inf)  # soc + shortfall >= floor
            prev = [(L.soc[t - 1], -1.0)] if t else ([(L.soc0, -1.0)] if L.soc0 is not None else [])
            rhs = b.initial_soc_kwh if t == 0 and L.soc0 is None else 0.0
            m.eq([(L.soc[t], 1.0), *prev, (L.chg[t], -b.charge_efficiency * dt), (L.dis[t], dt / b.discharge_efficiency)], rhs)
        L.terminal_short = m.var(0, b.max_soc_kwh, RESERVE_SHORTFALL_INR_PER_KWH)
        if L.soc0 is not None:
            m.row([(L.soc[n - 1], 1.0), (L.soc0, -1.0), (L.terminal_short, 1.0)], 0.0, np.inf)  # ends at least where it began
        else:
            terminal = b.terminal_soc_kwh if b.terminal_soc_kwh is not None else b.initial_soc_kwh
            m.row([(L.soc[n - 1], 1.0), (L.terminal_short, 1.0)], float(terminal), np.inf)
    if req.ev:
        ev = req.ev
        for t in range(n):
            ub = ev.charger_kw if ev.available_from_step <= t < ev.departure_step and not outage[t] else 0.0
            L.evc.append(m.var(0, ub, TIE_BREAK * dt))
        L.ev_short = m.var(0, ev.energy_needed_kwh, EV_SHORTFALL_INR_PER_KWH)
        m.row([*[(L.evc[t], ev.charger_efficiency * dt) for t in range(n)], (L.ev_short, 1.0)], ev.energy_needed_kwh, np.inf)
    app_by_step: dict[int, list[tuple[int, float]]] = {t: [] for t in range(n)}
    for a in req.appliances:
        d = a.duration_steps
        energy = a.power_kw * d * dt
        if a.interruptible:
            vs = []
            for t in range(n):
                ok = a.earliest_start_step <= t < a.latest_finish_step and not outage[t]
                v = m.var(0, 1.0 if ok else 0.0, TIE_BREAK * dt)
                vs.append(v)
                if ok:
                    app_by_step[t].append((v, a.power_kw))
            short = m.var(0, float(d), APPLIANCE_SKIPPED_INR_PER_KWH * a.power_kw * dt)
            m.eq([*[(v, 1.0) for v in vs], (short, 1.0)], float(d))
            L.app_cont[a.id] = vs
            L.app_skip[a.id] = short
        else:
            starts = [s for s in range(a.earliest_start_step, a.latest_finish_step - d + 1) if not outage[s : s + d].any()]
            sv = [(m.var(0, 1, TIE_BREAK * dt, integer=True), s) for s in starts]
            skip = m.var(0, 1, APPLIANCE_SKIPPED_INR_PER_KWH * energy, integer=True)
            m.eq([*[(v, 1.0) for v, _ in sv], (skip, 1.0)], 1.0)
            for v, s in sv:
                for t in range(s, s + d):
                    app_by_step[t].append((v, a.power_kw))
            L.app_vars[a.id] = sv
            L.app_skip[a.id] = skip
    # energy balance per step
    for t in range(n):
        terms = [(L.pvu[t], 1.0), (L.imp[t], 1.0), (L.ush[t], 1.0), (L.exp[t], -1.0)]
        if b:
            terms += [(L.dis[t], 1.0), (L.chg[t], -1.0)]
        if req.ev:
            terms.append((L.evc[t], -1.0))
        terms += [(v, -p) for v, p in app_by_step[t]]
        m.eq(terms, float(eff_load[t]))

    res = m.solve(req.time_limit_s)
    seconds = time.perf_counter() - started
    n_int = int(sum(m.integer))
    if res.x is None or res.status not in (0, 1):
        status = "infeasible" if res.status == 2 else "error"
        return OptimiseResponse(
            mode=req.mode, mode_weights=weights.as_dict(), solver=SolverInfo(status=status, message=str(res.message), objective=None, seconds=seconds, integer_variables=n_int),
            schedule=None, appliances=[], totals=None, baseline=None, savings_inr=None, decisions=[],
            validation=Validation(valid=False, max_balance_error_kw=0.0, problems=["no plan was produced"]), notes=notes,
        )
    if res.status == 1:
        notes.append("The solver stopped at its time limit; this is the best plan it found, not a proven optimum.")

    x = res.x
    sched, app_results = _extract(req, L, x, eff_load, outage)
    totals = _totals(req, sched, pi, pe, weights)
    base = _baseline(req, pi, pe, eff_load, outage)
    validation = validate(req, sched)
    if b:
        rs = float(max(x[v] for v in L.reserve_short))
        ts = float(x[L.terminal_short]) if L.terminal_short is not None else 0.0
        if rs > 1e-4:
            notes.append(f"The backup reserve could not be fully held: at worst the battery is {rs:.2f} kWh below it (it starts below it or cannot be charged fast enough).")
        if ts > 1e-4:
            target = "where it began" if b.cyclic else f"at {b.terminal_soc_kwh if b.terminal_soc_kwh is not None else b.initial_soc_kwh:.2f} kWh"
            notes.append(f"The battery cannot end the horizon {target}: it ends {ts:.2f} kWh below.")
    if totals.ev_shortfall_kwh > 1e-4:
        notes.append(f"The vehicle cannot receive all the energy it needs before it leaves: {totals.ev_shortfall_kwh:.2f} kWh short (charger power and time).")
    if totals.unserved_kwh > 1e-4:
        notes.append(f"Some load cannot be supplied: {totals.unserved_kwh:.2f} kWh would go unserved (in an outage only the critical load is kept on; otherwise the grid limit or equipment is too small).")
    for ar, a in zip(app_results, req.appliances, strict=True):
        if ar.energy_kwh < a.power_kw * a.duration_steps * dt - 1e-4:
            notes.append(f"{a.name} could not be fitted into its window and is not scheduled.")
    if not validation.valid:
        notes.append("SIMULATION INVALID: the plan fails its own energy checks and must not be shown as a plan.")

    return OptimiseResponse(
        mode=req.mode,
        mode_weights=weights.as_dict(),
        solver=SolverInfo(status="optimal", message=str(res.message), objective=float(res.fun), seconds=seconds, integer_variables=n_int),
        schedule=sched,
        appliances=app_results,
        totals=totals,
        baseline=base,
        savings_inr=round(base.net_cost_inr - totals.net_cost_inr, 4),
        decisions=_decisions(req, sched, pi, pe, eff_load),
        validation=validation,
        notes=notes,
    )


def _arr(x: np.ndarray, idx: list[int]) -> np.ndarray:
    return np.array([x[i] for i in idx], dtype=float)


def _clean(a: np.ndarray) -> list[float]:
    """Solver noise (1e-12 below zero, 1e-9 above a bound) is rounded away so a plan reads and re-validates cleanly."""
    out = np.where(np.abs(a) < 1e-9, 0.0, a)
    return [float(v) for v in np.round(out, 9)]


def _extract(req: OptimiseRequest, L: _Layout, x: np.ndarray, eff_load: np.ndarray, outage: np.ndarray) -> tuple[Schedule, list[ApplianceResult]]:
    n = len(req.load_kw)
    dt = req.step_hours
    zeros = np.zeros(n)
    pvu = _arr(x, L.pvu)
    ush = _arr(x, L.ush)
    app_kw: dict[str, np.ndarray] = {}
    results: list[ApplianceResult] = []
    for a in req.appliances:
        p = np.zeros(n)
        if a.interruptible:
            vs = L.app_cont[a.id]
            p = np.array([x[v] * a.power_kw for v in vs])
            steps = [t for t in range(n) if p[t] > 1e-9]
            start = None
        else:
            start = None
            for v, s in L.app_vars[a.id]:
                if x[v] > 0.5:
                    start = s
                    p[s : s + a.duration_steps] = a.power_kw
            steps = list(range(start, start + a.duration_steps)) if start is not None else []
        app_kw[a.id] = p
        results.append(ApplianceResult(id=a.id, name=a.name, start_step=start, run_steps=steps, energy_kwh=round(float(p.sum() * dt), 6)))
    sched = Schedule(
        pv_used_kw=_clean(pvu),
        pv_curtailed_kw=_clean(np.array(req.pv_kw) - pvu),
        grid_import_kw=_clean(_arr(x, L.imp)),
        grid_export_kw=_clean(_arr(x, L.exp)),
        battery_charge_kw=_clean(_arr(x, L.chg) if L.chg else zeros),
        battery_discharge_kw=_clean(_arr(x, L.dis) if L.dis else zeros),
        battery_soc_kwh=_clean(_arr(x, L.soc) if L.soc else zeros),
        ev_charge_kw=_clean(_arr(x, L.evc) if L.evc else zeros),
        appliance_kw={k: _clean(v) for k, v in app_kw.items()},
        served_load_kw=_clean(eff_load - ush),
        unserved_kw=_clean(ush),
        battery_initial_soc_kwh=(round(float(x[L.soc0]), 6) if L.soc0 is not None else req.battery.initial_soc_kwh) if req.battery else None,
    )
    return sched, results


def _totals(req: OptimiseRequest, s: Schedule, pi: np.ndarray, pe: np.ndarray, w: ModeWeights) -> Totals:
    dt = req.step_hours
    imp = np.array(s.grid_import_kw)
    exp = np.array(s.grid_export_kw)
    dis = np.array(s.battery_discharge_kw)
    pvu = np.array(s.pv_used_kw)
    ev = np.array(s.ev_charge_kw)
    served = np.array(s.served_load_kw)
    b = req.battery
    wear = float((b.wear_inr_per_kwh / b.discharge_efficiency) * dis.sum() * dt) if b else 0.0
    imp_cost = float((pi * imp).sum() * dt)
    exp_rev = float((pe * exp).sum() * dt)
    pv_total = float(np.sum(req.pv_kw) * dt)
    load_total = float(np.sum(req.load_kw) * dt)
    app = sum((np.array(v) for v in s.appliance_kw.values()), np.zeros(len(imp)))
    # consumption is what the home, the vehicle and the appliances actually used; self-sufficiency is the share of it that the
    # grid did not supply (grid energy that charged the battery counts as grid energy, so cycling it cannot flatter the figure)
    consumption = float((served + ev + app).sum() * dt)
    delivered = float(ev.sum() * (req.ev.charger_efficiency if req.ev else 1.0) * dt)
    need = req.ev.energy_needed_kwh if req.ev else 0.0
    thr = float(dis.sum() * dt / b.discharge_efficiency) if b else 0.0
    return Totals(
        import_kwh=round(float(imp.sum() * dt), 6),
        export_kwh=round(float(exp.sum() * dt), 6),
        import_cost_inr=round(imp_cost, 4),
        export_revenue_inr=round(exp_rev, 4),
        wear_cost_inr=round(wear, 4),
        net_cost_inr=round(imp_cost - exp_rev + wear, 4),
        load_kwh=round(load_total, 6),
        pv_kwh=round(pv_total, 6),
        pv_used_kwh=round(float(pvu.sum() * dt), 6),
        curtailed_kwh=round(float(np.sum(s.pv_curtailed_kw) * dt), 6),
        battery_throughput_kwh=round(thr, 6),
        battery_cycles=round(thr / b.capacity_kwh, 6) if b else 0.0,
        ev_delivered_kwh=round(delivered, 6),
        ev_shortfall_kwh=round(max(need - delivered, 0.0), 6),
        unserved_kwh=round(float(np.sum(s.unserved_kw) * dt), 6),
        self_consumption_ratio=round(float(pvu.sum() / np.sum(req.pv_kw)), 6) if pv_total > 0 else None,
        self_sufficiency_ratio=round(float(np.clip(1.0 - imp.sum() * dt / consumption, 0.0, 1.0)), 6) if consumption > 0 else None,
    )


def _baseline(req: OptimiseRequest, pi: np.ndarray, pe: np.ndarray, eff_load: np.ndarray, outage: np.ndarray) -> Baseline:
    """What happens with no optimisation: solar serves load directly, the rest is exported (or wasted if export earns nothing),
    the battery sits idle, the vehicle charges as soon as it arrives and appliances start as early as they may."""
    n = len(req.load_kw)
    dt = req.step_hours
    pv = np.array(req.pv_kw)
    demand = eff_load.copy()
    if req.ev:
        left = req.ev.energy_needed_kwh
        for t in range(req.ev.available_from_step, req.ev.departure_step):
            if left <= 1e-12 or outage[t]:
                continue
            kw = min(req.ev.charger_kw, left / (req.ev.charger_efficiency * dt))
            demand[t] += kw
            left -= kw * req.ev.charger_efficiency * dt
    for a in req.appliances:
        for t in range(a.earliest_start_step, min(a.earliest_start_step + a.duration_steps, n)):
            if not outage[t]:
                demand[t] += a.power_kw
    direct = np.minimum(pv, demand)
    deficit = demand - direct
    surplus = pv - direct
    imp = np.where(outage, 0.0, deficit)
    unserved = np.where(outage, np.minimum(deficit, eff_load), 0.0)
    exp = np.where(outage, 0.0, surplus)
    if req.grid.import_limit_kw is not None:
        imp = np.minimum(imp, req.grid.import_limit_kw)
    if req.grid.export_limit_kw is not None:
        exp = np.minimum(exp, req.grid.export_limit_kw)
    cost = float((pi * imp).sum() * dt - (pe * exp).sum() * dt)
    return Baseline(
        description="No optimisation: solar serves the load directly, the surplus is exported, the battery stays idle, the vehicle charges on arrival and appliances start at their earliest time.",
        net_cost_inr=round(cost, 4),
        import_kwh=round(float(imp.sum() * dt), 6),
        export_kwh=round(float(exp.sum() * dt), 6),
        unserved_kwh=round(float(unserved.sum() * dt), 6),
    )


def validate(req: OptimiseRequest, s: Schedule) -> Validation:
    """Recompute the physics of a plan from scratch. A plan that breaks conservation of energy or a limit is not a plan."""
    n = len(req.load_kw)
    dt = req.step_hours
    outage = _outage_mask(req)
    eff_load = _effective_load(req, outage)
    pvu, imp, exp = np.array(s.pv_used_kw), np.array(s.grid_import_kw), np.array(s.grid_export_kw)
    chg, dis, soc = np.array(s.battery_charge_kw), np.array(s.battery_discharge_kw), np.array(s.battery_soc_kwh)
    ev, ush, served = np.array(s.ev_charge_kw), np.array(s.unserved_kw), np.array(s.served_load_kw)
    app = sum((np.array(v) for v in s.appliance_kw.values()), np.zeros(n))
    problems: list[str] = []

    balance = pvu + imp + dis - (served + chg + ev + app + exp)
    max_err = float(np.max(np.abs(balance))) if n else 0.0
    if max_err > 1e-5:
        t = int(np.argmax(np.abs(balance)))
        problems.append(f"energy does not balance at step {t}: {balance[t]:+.6f} kW unaccounted for")
    if np.any(np.abs(served + ush - eff_load) > 1e-5):
        problems.append("served plus unserved load does not equal the load to be supplied")
    if np.any(np.concatenate([pvu, imp, exp, chg, dis, ev, ush, soc]) < -1e-7):
        problems.append("a flow or a state of charge is negative")
    if np.any(pvu > np.array(req.pv_kw) + 1e-6):
        problems.append("more solar is used than is generated")
    if req.grid.import_limit_kw is not None and np.any(imp > req.grid.import_limit_kw + 1e-6):
        problems.append("the import limit is exceeded")
    if req.grid.export_limit_kw is not None and np.any(exp > req.grid.export_limit_kw + 1e-6):
        problems.append("the export limit is exceeded")
    if np.any((imp > 1e-7) & outage) or np.any((exp > 1e-7) & outage):
        problems.append("the grid is used during an outage")
    b = req.battery
    if b:
        start = s.battery_initial_soc_kwh if b.cyclic else b.initial_soc_kwh
        if start is None or not (b.min_soc_kwh - 1e-6 <= start <= b.max_soc_kwh + 1e-6):
            problems.append("the charge the horizon starts with is missing or outside the battery's range")
            start = b.initial_soc_kwh
        prev = np.concatenate([[start], soc[:-1]])
        dyn = soc - (prev + b.charge_efficiency * chg * dt - dis * dt / b.discharge_efficiency)
        if np.any(np.abs(dyn) > 1e-5):
            problems.append(f"the battery's state of charge does not follow its charge and discharge at step {int(np.argmax(np.abs(dyn)))}")
        if np.any(soc > b.max_soc_kwh + 1e-6) or np.any(soc < b.min_soc_kwh - 1e-6):
            problems.append("the battery leaves its allowed state-of-charge range")
        if np.any(chg > b.max_charge_kw + 1e-6) or np.any(dis > b.max_discharge_kw + 1e-6):
            problems.append("a battery power limit is exceeded")
        if np.any((chg > 1e-6) & (dis > 1e-6)):
            problems.append("the battery charges and discharges in the same step")
    elif np.any(chg > 1e-9) or np.any(dis > 1e-9):
        problems.append("a battery is used but none exists")
    if req.ev:
        e = req.ev
        if np.any(ev[: e.available_from_step] > 1e-7) or np.any(ev[e.departure_step :] > 1e-7):
            problems.append("the vehicle is charged while it is away")
        if np.any(ev > e.charger_kw + 1e-6):
            problems.append("the charger limit is exceeded")
    elif np.any(ev > 1e-9):
        problems.append("a vehicle is charged but none exists")
    for a in req.appliances:
        p = np.array(s.appliance_kw.get(a.id, np.zeros(n)))
        if np.any(p[: a.earliest_start_step] > 1e-7) or np.any(p[a.latest_finish_step :] > 1e-7):
            problems.append(f"{a.name} runs outside its window")
        if np.any(p > a.power_kw + 1e-6):
            problems.append(f"{a.name} draws more than its rated power")
        if np.any((p > 1e-7) & outage):
            problems.append(f"{a.name} runs during an outage")
        if not a.interruptible and np.any(p > 1e-7):
            idx = np.nonzero(p > 1e-7)[0]
            if len(idx) != a.duration_steps or idx[-1] - idx[0] + 1 != a.duration_steps:
                problems.append(f"{a.name} is not one unbroken run of {a.duration_steps} steps")
    return Validation(valid=not problems, max_balance_error_kw=round(max_err, 9), problems=problems)


def _decisions(req: OptimiseRequest, s: Schedule, pi: np.ndarray, pe: np.ndarray, eff_load: np.ndarray, limit: int = 120) -> list[Decision]:
    """The notable choices of the plan in words. Reasons name the prices and flows that explain each one, nothing speculative."""
    n = len(req.load_kw)
    dt = req.step_hours
    out: list[Decision] = []
    chg, dis = np.array(s.battery_charge_kw), np.array(s.battery_discharge_kw)
    imp, exp, pvu = np.array(s.grid_import_kw), np.array(s.grid_export_kw), np.array(s.pv_used_kw)
    curt, ev = np.array(s.pv_curtailed_kw), np.array(s.ev_charge_kw)
    min_kwh = 0.02
    discharge_steps = [t for t in range(n) if dis[t] * dt > min_kwh]
    for t in range(n):
        lab = _label(req, t)
        if chg[t] * dt > min_kwh:
            pv_surplus = pvu[t] - eff_load[t]
            if pv_surplus >= chg[t] * 0.5 and pe[t] < pi[t]:
                why = f"stored surplus solar at {lab} instead of exporting it at INR {pe[t]:.2f} per kWh, to use later when grid power costs more"
            else:
                later = [pi[u] for u in discharge_steps if u > t]
                tail = f", ahead of the INR {max(later):.2f} per kWh peak" if later else ""
                why = f"charged from the grid at INR {pi[t]:.2f} per kWh{tail}"
            out.append(Decision(step=t, kind="charge_battery", kwh=round(float(chg[t] * dt), 4), reason=why))
        if dis[t] * dt > min_kwh:
            out.append(Decision(step=t, kind="discharge_battery", kwh=round(float(dis[t] * dt), 4), reason=f"discharged at {lab} to avoid importing at INR {pi[t]:.2f} per kWh" if imp[t] < 1e-6 else f"discharged at {lab} (grid import is still INR {pi[t]:.2f} per kWh)"))
        if exp[t] * dt > min_kwh:
            why = (
                f"exported at {lab} for INR {pe[t]:.2f} per kWh"
                if pe[t] > 0
                else f"surplus solar flowed out to the grid uncredited at {lab}: export earns nothing here and nothing else could use it"
            )
            out.append(Decision(step=t, kind="export", kwh=round(float(exp[t] * dt), 4), reason=why))
        if curt[t] * dt > min_kwh:
            why = "the export limit was reached" if req.grid.export_limit_kw is not None and exp[t] >= req.grid.export_limit_kw - 1e-6 else ("the grid is down" if _outage_mask(req)[t] else "the battery was full and export earns nothing or is not allowed")
            out.append(Decision(step=t, kind="curtail", kwh=round(float(curt[t] * dt), 4), reason=f"solar was curtailed at {lab} because {why}"))
        if ev[t] * dt > min_kwh:
            out.append(Decision(step=t, kind="ev_charge", kwh=round(float(ev[t] * dt), 4), reason=f"vehicle charged at {lab} (INR {pi[t]:.2f} per kWh, inside its time before departure)"))
        if imp[t] * dt > min_kwh and pi[t] >= np.percentile(pi, 75) and pi.max() > pi.min():
            out.append(Decision(step=t, kind="import_peak", kwh=round(float(imp[t] * dt), 4), reason=f"imported at {lab} at INR {pi[t]:.2f} per kWh: load could not be met any cheaper (no stored energy or solar left)"))
        if eff_load[t] < req.load_kw[t] - 1e-9:
            out.append(Decision(step=t, kind="shed", kwh=round(float((req.load_kw[t] - eff_load[t]) * dt), 4), reason=f"non-critical load shed at {lab}: the grid is down and only the critical load is kept on"))
    for a in req.appliances:
        p = np.array(s.appliance_kw.get(a.id, np.zeros(n)))
        idx = np.nonzero(p > 1e-7)[0]
        if len(idx):
            first, last = int(idx[0]), int(idx[-1])
            cheapest = int(np.argmin(pi[a.earliest_start_step : a.latest_finish_step])) + a.earliest_start_step
            out.append(Decision(step=first, kind="appliance", kwh=round(float(p.sum() * dt), 4), reason=f"{a.name} placed from {_label(req, first)} to {_label(req, last + 1)}, inside its window, where energy is cheapest given solar and tariff (cheapest import in its window is at {_label(req, cheapest)})"))
    out.sort(key=lambda d: (d.step, d.kind))
    return out[:limit]
