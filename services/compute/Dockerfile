# compute — FastAPI. Multi-Stage, non-root, kein --reload, kein Access-Log.
# System-Abhängigkeiten für Dokumente (LibreOffice, poppler, zbar) kommen mit
# den jeweiligen Modulen dazu, nicht vorher.
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

FROM base AS deps
COPY requirements.txt .
RUN pip install -r requirements.txt

# Tests brauchen eine Datenbank (Migrationen, RLS, KPI-Funktionen) und laufen
# deshalb nicht beim Bauen, sondern über docker-compose.test.yml.
FROM deps AS test
COPY requirements-dev.txt .
RUN pip install -r requirements-dev.txt
COPY . .

FROM deps AS runtime
RUN useradd --system --uid 10001 --no-create-home compute
COPY alembic.ini .
COPY alembic ./alembic
COPY app ./app
USER compute
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log", "--log-level", "warning"]
