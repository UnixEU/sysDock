FROM python:3.11-slim

WORKDIR /app

# docker-compose CLI is required for Compose stack operations (create_from_compose, update_compose_file).
# gcc removed — bcrypt and asyncpg ship pre-compiled wheels for CPython 3.11/linux-amd64.
# If the build fails on a non-amd64 platform, add gcc back.
RUN apt-get update && apt-get install -y --no-install-recommends \
    docker-compose \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code and migration metadata
COPY ./app ./app
COPY ./alembic ./alembic
COPY ./alembic.ini ./alembic.ini
COPY ./start.sh ./start.sh

# Create a non-root user. Added to the docker group so it can reach the Docker
# socket if mounted directly in development (the socket-proxy is used in production).
RUN groupadd -g 999 docker 2>/dev/null || true && \
    adduser --disabled-password --gecos '' --uid 1000 --ingroup docker appuser && \
    chmod +x /app/start.sh && \
    chown -R appuser:docker /app

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"

CMD ["./start.sh"]
