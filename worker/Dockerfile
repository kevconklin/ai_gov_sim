FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 sim

WORKDIR /app
COPY worker/pyproject.toml worker/pyproject.toml
COPY worker/sim worker/sim
COPY worker/govern worker/govern
RUN pip install --no-cache-dir ./worker "psycopg[binary]>=3.2" "pandas>=2.2" "pyarrow>=16"

COPY config config
COPY db db
COPY analysis/rubrics analysis/rubrics

ENV SIM_DATA_DIR=/data SIM_REPO_ROOT=/app PYTHONUNBUFFERED=1
RUN mkdir -p /data && chown sim /data
USER sim
WORKDIR /app/worker
CMD ["python", "-m", "sim", "serve"]
