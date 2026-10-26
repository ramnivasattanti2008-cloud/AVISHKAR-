# UNTESTED AS AN IMAGE: written on a machine whose Docker engine could not run, so `docker build` has never been run on this file.
# What it relies on was run outside Docker: the engine's tests pass in an empty virtual environment that holds exactly
# platform/engine/requirements-runtime.txt (platform/docs/DEPLOYMENT.md says how that was checked).
#
#   docker build -f platform/docker/engine.Dockerfile -t avishkar-engine platform
#   docker run --rm -e ENGINE_API_KEY=<16 or more characters> -p 8090:8090 avishkar-engine
#
# The engine holds no data and no secret but its key. It refuses to start without ENGINE_API_KEY (ENGINE_INSECURE_DEV=1 would
# disable that and must never be set here). Keep it on a private network: only the API calls it.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

COPY engine/requirements-runtime.txt ./requirements-runtime.txt
RUN pip install -r requirements-runtime.txt

COPY engine/avishkar_engine ./avishkar_engine

RUN useradd --system --no-create-home --uid 10001 engine
USER engine

EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8090/health', timeout=4).status == 200 else 1)"

CMD ["python", "-m", "uvicorn", "avishkar_engine.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8090"]
