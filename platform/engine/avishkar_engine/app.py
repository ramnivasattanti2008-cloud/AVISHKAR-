"""HTTP face of the engine. Internal: only the platform API calls it, with a shared key."""

from __future__ import annotations

import hmac
import os
import uuid

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from avishkar_engine import __version__, load, solar
from avishkar_engine.forecast_schemas import (
    LoadForecastRequest,
    LoadForecastResponse,
    SolarEvaluateRequest,
    SolarEvaluateResponse,
    SolarForecastRequest,
    SolarForecastResponse,
)
from avishkar_engine.optimise import MODE_WEIGHTS, optimise
from avishkar_engine.schemas import OptimiseRequest, OptimiseResponse

MAX_BODY_BYTES = 4_000_000
MIN_KEY_LENGTH = 16


class EngineConfigError(RuntimeError):
    pass


def _error(status: int, code: str, message: str, request_id: str, details: object | None = None) -> JSONResponse:
    body: dict[str, object] = {"error": {"code": code, "message": message, "requestId": request_id}}
    if details is not None:
        body["error"]["details"] = details  # type: ignore[index]
    return JSONResponse(status_code=status, content=body, headers={"x-request-id": request_id})


def create_app(api_key: str | None = None, insecure_dev: bool | None = None) -> FastAPI:
    """Build the app. A key is required unless ENGINE_INSECURE_DEV=1: the engine never starts open by accident."""
    key = api_key if api_key is not None else os.environ.get("ENGINE_API_KEY")
    insecure = insecure_dev if insecure_dev is not None else os.environ.get("ENGINE_INSECURE_DEV") == "1"
    if key is not None and len(key) < MIN_KEY_LENGTH:
        raise EngineConfigError(f"ENGINE_API_KEY must be at least {MIN_KEY_LENGTH} characters")
    if key is None and not insecure:
        raise EngineConfigError("ENGINE_API_KEY is not set. Set it, or set ENGINE_INSECURE_DEV=1 for local development only.")

    app = FastAPI(
        title="AVISHKAR engine",
        version=__version__,
        description="Planning, forecasting and simulation for the AVISHKAR platform. Stateless and internal: send the data, get the arithmetic and how it was done.",
    )

    def authorise(x_engine_key: str | None = Header(default=None)) -> None:
        if key is None:
            return
        if x_engine_key is None or not hmac.compare_digest(x_engine_key.encode(), key.encode()):
            raise HTTPException(status_code=401, detail="A valid x-engine-key header is required.")

    @app.middleware("http")
    async def request_id_and_size(request: Request, call_next):
        rid = request.headers.get("x-request-id") or str(uuid.uuid4())
        request.state.request_id = rid
        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > MAX_BODY_BYTES:
            return _error(413, "PAYLOAD_TOO_LARGE", f"The request is larger than {MAX_BODY_BYTES // 1_000_000} MB.", rid)
        response = await call_next(request)
        response.headers["x-request-id"] = rid
        return response

    @app.exception_handler(RequestValidationError)
    async def invalid(request: Request, exc: RequestValidationError):
        parts = []
        for e in exc.errors():
            msg = str(e.get("msg", "")).removeprefix("Value error, ")
            loc = ".".join(str(p) for p in e.get("loc", ()) if p != "body")
            parts.append(msg if e.get("type") == "value_error" or not loc else f"{loc}: {msg}")
        return _error(400, "VALIDATION_FAILED", "The request is not valid: " + "; ".join(parts), request.state.request_id)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException):
        code = {401: "UNAUTHENTICATED", 404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED"}.get(exc.status_code, "HTTP_ERROR")
        return _error(exc.status_code, code, str(exc.detail), getattr(request.state, "request_id", str(uuid.uuid4())))

    @app.exception_handler(Exception)
    async def crashed(request: Request, exc: Exception):
        return _error(500, "INTERNAL", "The engine failed on this request.", getattr(request.state, "request_id", str(uuid.uuid4())))

    @app.get("/health", tags=["system"], summary="Is the engine up")
    def health() -> dict[str, object]:
        import highspy
        import scipy

        return {"status": "ok", "version": __version__, "scipy": scipy.__version__, "highs": highspy.Highs().version(), "modes": sorted(MODE_WEIGHTS)}

    @app.post("/v1/optimise", tags=["planning"], summary="Plan a horizon", response_model=OptimiseResponse, response_model_by_alias=True, dependencies=[Depends(authorise)])
    def plan(req: OptimiseRequest) -> OptimiseResponse:
        """Choose battery, grid, solar, EV and appliance schedules that minimise a mode-weighted cost. The plan is re-checked
        from scratch before it is returned (`validation`); an invalid plan must not be shown as a plan."""
        return optimise(req)

    @app.post("/v1/solar/forecast", tags=["forecasting"], summary="Forecast solar output from a weather forecast", response_model=SolarForecastResponse, response_model_by_alias=True, dependencies=[Depends(authorise)])
    def solar_forecast(req: SolarForecastRequest) -> SolarForecastResponse:
        """A physical PV model driven by the irradiance forecast. The 10th to 90th percentile band exists only when the past errors
        of that forecast are supplied (`errorHistory`); otherwise none is claimed."""
        return solar.forecast(req)

    @app.post("/v1/solar/evaluate", tags=["forecasting"], summary="Score a solar forecast against what happened", response_model=SolarEvaluateResponse, response_model_by_alias=True, dependencies=[Depends(authorise)])
    def solar_evaluate(req: SolarEvaluateRequest) -> SolarEvaluateResponse:
        """MAE, RMSE, MAPE, WAPE and bias, next to the persistence and clear-sky baselines the forecast has to beat."""
        return solar.evaluate(req)

    @app.post("/v1/load/forecast", tags=["forecasting"], summary="Forecast a property's load from its own history", response_model=LoadForecastResponse, response_model_by_alias=True, dependencies=[Depends(authorise)])
    def load_forecast(req: LoadForecastRequest) -> LoadForecastResponse:
        """Weekly-lagged baselines and a conformally calibrated quantile model, compared on a chronological holdout. The response
        says which won, by how much, and how often the 80% band held on hours it had not seen."""
        return load.forecast(req)

    return app
