FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DATA_DIR=/data
WORKDIR /app

COPY pyproject.toml ./
COPY server ./server
RUN pip install --no-cache-dir . \
 && useradd --uid 10001 --create-home app \
 && mkdir -p /data && chown app:app /data

USER app
VOLUME ["/data"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD ["python", "-m", "server", "healthcheck"]
CMD ["python", "-m", "server", "serve"]
