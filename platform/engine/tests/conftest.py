"""Shared helpers: build optimisation requests from plain values, camelCase on the wire like the real API."""

from __future__ import annotations

from typing import Any

from avishkar_engine.optimise import optimise
from avishkar_engine.schemas import OptimiseRequest


def request(n: int = 4, **over: Any) -> dict[str, Any]:
    """A small valid request: n hourly steps, no solar, flat load of 1 kW, flat import price 5, no export credit."""
    base: dict[str, Any] = {
        "stepHours": 1.0,
        "loadKw": [1.0] * n,
        "pvKw": [0.0] * n,
        "importPrice": [5.0] * n,
        "exportPrice": [0.0] * n,
    }
    base.update(over)
    return base


def battery(**over: Any) -> dict[str, Any]:
    """A perfect (lossless, wear-free) battery unless told otherwise, so hand calculations stay simple."""
    b: dict[str, Any] = {
        "capacityKwh": 10,
        "maxChargeKw": 10,
        "maxDischargeKw": 10,
        "chargeEfficiency": 1.0,
        "dischargeEfficiency": 1.0,
        "minSocKwh": 0,
        "maxSocKwh": 10,
        "initialSocKwh": 0,
        "wearInrPerKwh": 0,
    }
    b.update(over)
    return b


def run(payload: dict[str, Any]):
    return optimise(OptimiseRequest.model_validate(payload))
