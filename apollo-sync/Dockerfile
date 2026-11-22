FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY pyproject.toml ./
COPY apollo_sync ./apollo_sync
RUN pip install --no-cache-dir ".[service]" \
 && useradd --system --uid 10001 apollo \
 && mkdir -p /state && chown apollo /state
USER apollo

# Nur ausgehend: Apollo TCP 4722 und compute (/api/odbc/*). Keine Ports.
CMD ["python", "-m", "apollo_sync", "service"]
