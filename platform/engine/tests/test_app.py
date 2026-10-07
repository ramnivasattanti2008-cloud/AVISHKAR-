"""The HTTP layer: authentication, error shape, and a real optimisation over the wire."""

from __future__ import annotations

import pytest
from avishkar_engine.app import EngineConfigError, create_app
from conftest import battery, request
from fastapi.testclient import TestClient

KEY = "k" * 32


@pytest.fixture
def client():
    return TestClient(create_app(api_key=KEY))


def post(client: TestClient, payload, key: str | None = KEY, **headers):
    h = {"x-engine-key": key} if key else {}
    return client.post("/v1/optimise", json=payload, headers={**h, **headers})


def test_health_is_open_and_names_the_solver(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok" and body["highs"] and "SAVE_MONEY" in body["modes"]


def test_a_request_without_the_key_or_with_a_wrong_one_is_refused(client):
    for headers in ({}, {"x-engine-key": "wrong"}, {"x-engine-key": KEY[:-1]}):
        r = client.post("/v1/optimise", json=request(2), headers=headers)
        assert r.status_code == 401
        assert r.json()["error"]["code"] == "UNAUTHENTICATED"


def test_an_optimisation_over_the_wire_in_camel_case(client):
    r = post(client, request(4, loadKw=[0, 0, 2, 2], importPrice=[1, 1, 10, 10], battery=battery(capacityKwh=4, maxSocKwh=4)))
    assert r.status_code == 200
    body = r.json()
    assert body["solver"]["status"] == "optimal"
    assert body["savingsInr"] == pytest.approx(36.0, abs=1e-4)
    assert body["validation"]["valid"] is True
    assert body["schedule"]["batteryChargeKw"][:2] == pytest.approx([2.0, 2.0], abs=1e-6) or sum(body["schedule"]["batteryChargeKw"]) == pytest.approx(4.0)
    assert "battery_charge_kw" not in body["schedule"]


def test_bad_input_is_a_clear_400_in_the_platform_error_shape(client):
    r = post(client, request(4, pvKw=[0, 0]))
    assert r.status_code == 400
    e = r.json()["error"]
    assert e["code"] == "VALIDATION_FAILED"
    assert "every series must cover the same steps" in e["message"]
    assert e["requestId"]


def test_a_type_error_names_its_field(client):
    r = post(client, request(4, loadKw="lots"))
    assert r.status_code == 400
    assert "loadKw" in r.json()["error"]["message"]


def test_the_request_id_is_echoed_or_made(client):
    assert post(client, request(2), **{"x-request-id": "abc-123"}).headers["x-request-id"] == "abc-123"
    assert post(client, request(2)).headers["x-request-id"]


def test_an_oversized_body_is_refused_before_it_is_read(client):
    r = client.post("/v1/optimise", content=b"x" * 5_000_000, headers={"x-engine-key": KEY, "content-type": "application/json"})
    assert r.status_code == 413
    assert r.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"


def test_unknown_routes_use_the_same_error_shape(client):
    r = client.get("/v1/nope")
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"


def test_the_engine_will_not_start_open_by_accident(monkeypatch):
    monkeypatch.delenv("ENGINE_API_KEY", raising=False)
    monkeypatch.delenv("ENGINE_INSECURE_DEV", raising=False)
    with pytest.raises(EngineConfigError, match="ENGINE_API_KEY is not set"):
        create_app()
    with pytest.raises(EngineConfigError, match="at least 16"):
        create_app(api_key="short")


def test_insecure_dev_mode_is_explicit_and_works_without_a_key():
    c = TestClient(create_app(insecure_dev=True))
    assert c.post("/v1/optimise", json=request(2)).status_code == 200


def test_the_key_comes_from_the_environment(monkeypatch):
    monkeypatch.setenv("ENGINE_API_KEY", "e" * 20)
    c = TestClient(create_app())
    assert c.post("/v1/optimise", json=request(2)).status_code == 401
    assert c.post("/v1/optimise", json=request(2), headers={"x-engine-key": "e" * 20}).status_code == 200


def test_an_internal_failure_does_not_leak_details(client, monkeypatch):
    import avishkar_engine.app as app_module

    def boom(_):
        raise RuntimeError("secret internals")

    monkeypatch.setattr(app_module, "optimise", boom)
    c = TestClient(create_app(api_key=KEY), raise_server_exceptions=False)
    r = c.post("/v1/optimise", json=request(2), headers={"x-engine-key": KEY})
    assert r.status_code == 500
    assert "secret" not in r.text
    assert r.json()["error"]["code"] == "INTERNAL"


def test_solar_forecast_and_evaluate_over_the_wire(client):
    ghi = [0.0] * 6 + [100.0, 300.0, 500.0, 650.0, 700.0, 650.0, 500.0, 300.0, 100.0] + [0.0] * 9
    body = {
        "location": {"latitude": 12.97, "longitude": 77.59, "altitudeM": 900},
        "system": {"capacityKwp": 3.3, "tiltDeg": 13, "azimuthDeg": 180},
        "weather": {"startTime": "2026-03-20T00:00:00Z", "convention": "end", "ghiWm2": ghi, "temperatureC": [28.0] * 24},
    }
    r = client.post("/v1/solar/forecast", json=body, headers={"x-engine-key": KEY})
    assert r.status_code == 200
    out = r.json()
    assert len(out["p50Kw"]) == 24 and out["p10Kw"] is None and out["calibration"] is None
    assert out["kwhP50"] > 0 and max(out["p50Kw"]) <= out["clearSkyKw"][out["p50Kw"].index(max(out["p50Kw"]))] + 1e-6
    assert "p50_kw" not in out

    ev = client.post("/v1/solar/evaluate", json={"forecastKw": out["p50Kw"], "actualKw": out["p50Kw"]}, headers={"x-engine-key": KEY})
    assert ev.status_code == 200 and ev.json()["forecast"]["maeKw"] == 0


def test_load_forecast_over_the_wire(client):
    import math

    kwh = [1.0 + 0.5 * math.sin(2 * math.pi * (h % 24) / 24) for h in range(24 * 30)]
    body = {"history": {"startTime": "2026-01-05T00:00:00+05:30", "intervalMinutes": 60, "kwh": kwh}, "horizonHours": 24}
    r = client.post("/v1/load/forecast", json=body, headers={"x-engine-key": KEY})
    assert r.status_code == 200
    out = r.json()
    assert out["status"] == "ok" and len(out["p50Kw"]) == 24 and out["selectedMethod"]
    assert {m["method"] for m in out["methods"]} >= {"same_hour_of_week", "last_week"}


def test_the_forecast_routes_need_the_key_and_report_bad_input_clearly(client):
    assert client.post("/v1/load/forecast", json={}).status_code == 401
    assert client.post("/v1/solar/forecast", json={}).status_code == 401
    r = client.post("/v1/solar/forecast", json={"location": {"latitude": 99, "longitude": 0}, "system": {}, "weather": {}}, headers={"x-engine-key": KEY})
    assert r.status_code == 400 and r.json()["error"]["code"] == "VALIDATION_FAILED"
