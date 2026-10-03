"""Day-ahead planner: EMHASS's LP optimiser driven by our forecasts, reserve floor and tariffs.

EMHASS stays untouched. We build its configuration from the site metadata, feed it P50 forecasts,
Indian time-of-day prices and an expected P2P-aware export price, and set the battery minimum SOC
to the emergency reserve floor so the reserve is a hard constraint inside the optimiser.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import copy
import logging
import pathlib
from dataclasses import dataclass
from functools import lru_cache

import numpy as np
import orjson
import pandas as pd

import emhass
from avishkar_ems.reserve import ReserveDecision
from avishkar_ems.site import SiteSpec

STEP_H = 0.25  # 15-minute resolution

_EMHASS_ROOT = pathlib.Path(emhass.__file__).resolve().parent
_EMHASS_CONF = {
    "data_path": _EMHASS_ROOT.parent.parent / "data/",
    "root_path": _EMHASS_ROOT,
    "defaults_path": _EMHASS_ROOT / "data/config_defaults.json",
    "associations_path": _EMHASS_ROOT / "data/associations.csv",
}
_log = logging.getLogger("avishkar_ems.planner")


def _run(coro):
    """Run a coroutine whether or not an event loop is already running in this thread."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coro).result()


@lru_cache(maxsize=1)
def _base_params() -> dict:
    from emhass.utils import build_config, build_params, build_secrets, get_logger

    logger, _ = get_logger("emhass_base", _EMHASS_CONF, save_to_file=False)
    logger.setLevel(logging.WARNING)

    async def build():
        config = await build_config(_EMHASS_CONF, logger, _EMHASS_CONF["defaults_path"])
        _, secrets = await build_secrets(_EMHASS_CONF, logger, no_response=True)
        return await build_params(_EMHASS_CONF, secrets, config, logger)

    return _run(build())


@dataclass
class DayPlan:
    steps: pd.DataFrame  # 15-min plan, kW. batt_kw: + discharge, - charge. grid_kw: + import, - export
    floor_soc: float
    reserve: ReserveDecision
    status: str


def expected_prod_price(site: SiteSpec, export_rate: np.ndarray, p2p_fcst: np.ndarray,
                        p2p_share: float = 0.0, p2p_mask: np.ndarray | None = None) -> np.ndarray:
    """Price the LP should assume for exported kWh.

    By default exports earn only the grid export rate. Inside `p2p_mask` (windows where a P2P offer
    has been committed) they earn the expected P2P price net of charges. `p2p_share` is a blunt
    alternative that applies a fixed expected share everywhere; it is kept for experiments.
    """
    gain = np.clip(p2p_fcst - site.tariff.p2p_charges - export_rate, 0.0, None)
    if p2p_mask is not None:
        return export_rate + np.where(p2p_mask, gain, 0.0)
    return export_rate + p2p_share * gain


def plan_day(
    site: SiteSpec,
    pv_bands: pd.DataFrame,
    load_bands: pd.DataFrame,
    import_rate: np.ndarray,
    export_rate: np.ndarray,
    p2p_fcst: np.ndarray,
    soc_init: float,
    reserve: ReserveDecision,
    p2p_share: float = 0.0,
    p2p_mask: np.ndarray | None = None,
    soc_final: float | None = None,
) -> DayPlan:
    """Plan one day (96 steps) using P50 forecasts and the hard reserve floor."""
    from emhass.optimization import Optimization
    from emhass.utils import get_logger, get_yaml_parse

    params = copy.deepcopy(_base_params())
    no_loads = {  # this EMS plans PV, battery and grid only; EMHASS defaults to 2 deferrable loads
        "number_of_deferrable_loads": 0, "nominal_power_of_deferrable_loads": [],
        "minimum_power_of_deferrable_loads": [], "operating_hours_of_each_deferrable_load": [],
        "start_timesteps_of_each_deferrable_load": [], "end_timesteps_of_each_deferrable_load": [],
        "treat_deferrable_load_as_semi_cont": [], "set_deferrable_load_single_constant": [],
        "set_deferrable_startup_penalty": [], "deferrable_load_max_cost": [],
        "set_deferrable_max_startups": [], "cost_forecast_per_deferrable_load": [],
    }
    overrides = {
        **no_loads,
        "set_use_battery": True, "set_use_pv": True, "set_total_pv_sell": False,
        "weight_battery_discharge": float(site.wear_inr_per_kwh), "weight_battery_charge": 0.0,
        "maximum_power_from_grid": 100_000, "maximum_power_to_grid": 100_000,
        "battery_nominal_energy_capacity": site.battery_kwh * 1000.0,
        "battery_minimum_state_of_charge": float(reserve.floor_soc),
        "battery_maximum_state_of_charge": 1.0,
        "battery_target_state_of_charge": float(max(reserve.floor_soc, min(soc_init, 0.6))),
        "battery_discharge_power_max": site.battery_kw * 1000.0,
        "battery_charge_power_max": site.battery_kw * 1000.0,
        "battery_discharge_efficiency": site.one_way_eff, "battery_charge_efficiency": site.one_way_eff,
        "inverter_ac_output_max": site.ac_kw * 1000.0, "inverter_ac_input_max": site.ac_kw * 1000.0,
    }
    for key, value in overrides.items():  # each key lives in one section; set it wherever it exists
        placed = False
        for section in params.values():
            if isinstance(section, dict) and key in section:
                section[key] = value
                placed = True
        if not placed:
            raise KeyError(f"EMHASS config has no parameter '{key}'; EMHASS version mismatch?")
    logger, _ = get_logger("emhass_plan", _EMHASS_CONF, save_to_file=False)
    logger.setLevel(logging.WARNING)
    rh, optim_conf, plant_conf = get_yaml_parse(orjson.dumps(params).decode(), logger)
    rh["optimization_time_step"] = pd.Timedelta(minutes=15)

    index = pv_bands.index
    pv_w = pv_bands["p50"].to_numpy(dtype=float) * 1000.0
    load_w = load_bands["p50"].to_numpy(dtype=float) * 1000.0
    prod = expected_prod_price(site, export_rate, p2p_fcst, p2p_share, p2p_mask)
    df = pd.DataFrame(
        {"p_pv_forecast": pv_w, "p_load_forecast": load_w, "unit_load_cost": import_rate,
         "unit_prod_price": prod}, index=index)
    opt = Optimization(rh, optim_conf, plant_conf, "unit_load_cost", "unit_prod_price", "profit",
                       _EMHASS_CONF, logger)
    if soc_final is None:
        soc_final = float(max(reserve.floor_soc, min(soc_init, 0.6)))
    res = opt.perform_optimization(df, pv_w, load_w, import_rate, prod,
                                   soc_init=float(soc_init), soc_final=soc_final)
    steps = pd.DataFrame(index=index)
    steps["pv_p10"], steps["pv_p50"], steps["pv_p90"] = (pv_bands[c].to_numpy() for c in ("p10", "p50", "p90"))
    steps["load_p10"], steps["load_p50"], steps["load_p90"] = (load_bands[c].to_numpy() for c in ("p10", "p50", "p90"))
    steps["batt_kw"] = res["P_batt"].to_numpy() / 1000.0
    steps["grid_kw"] = res["P_grid"].to_numpy() / 1000.0
    steps["soc"] = res["SOC_opt"].to_numpy()
    steps["import_rate"], steps["export_rate"], steps["prod_price_used"] = import_rate, export_rate, prod
    return DayPlan(steps, float(reserve.floor_soc), reserve, str(opt.optim_status))
