# ─────────────────────────────────────────────────────────────────────────────
# Single-container build: compile the React frontend, then serve it + the FastAPI
# API from one Python process. Designed for Google Cloud Run.
# ─────────────────────────────────────────────────────────────────────────────

# ---- Stage 1: build the React dashboard ----
FROM node:20-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build          # outputs to /app/frontend/dist

# ---- Stage 2: Python backend that also serves the built frontend ----
FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8080
WORKDIR /app

# ffmpeg: needed to sample video frames server-side for Media Compliance OCR.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install -r requirements.txt

# Backend source + runtime config
COPY src/ ./src/
COPY config/ ./config/

# Knowledge base collected from the scrapers (mentions.jsonl, competitors.json, keywords.json).
# .dockerignore excludes data/cases/ and data/state/, so only the stored knowledge base ships.
COPY data/ ./data/

# Built frontend from stage 1 (FastAPI serves it at "/")
COPY --from=frontend /app/frontend/dist ./frontend/dist

EXPOSE 8080
# Cloud Run injects $PORT; bind to it.
CMD ["sh", "-c", "exec uvicorn src.api:app --host 0.0.0.0 --port ${PORT:-8080}"]
