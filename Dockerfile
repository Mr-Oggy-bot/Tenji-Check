# TenjiCheck in one container (used for the Hugging Face Space): FastAPI backend on 127.0.0.1:8000 behind the
# Next.js server on :7860. The browser only talks to Next.js, which proxies /api to the backend.

# --- web: build the Next.js app ------------------------------------------------------------------
FROM node:22-bookworm-slim AS web
ENV NEXT_TELEMETRY_DISABLED=1 SCARF_ANALYTICS=false COPILOTKIT_TELEMETRY_DISABLED=true
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build && npm prune --omit=dev

# --- runtime -------------------------------------------------------------------------------------
FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=web /usr/local/bin/node /usr/local/bin/node

# Hugging Face runs the container as uid 1000.
RUN useradd -m -u 1000 user
ENV HOME=/home/user PATH=/home/user/.local/bin:$PATH PIP_NO_CACHE_DIR=1 PYTHONUNBUFFERED=1 \
    YOLO_CONFIG_DIR=/home/user/.config/Ultralytics HF_HOME=/home/user/.cache/huggingface \
    NEXT_TELEMETRY_DISABLED=1 COPILOTKIT_TELEMETRY_DISABLED=true \
    TC_DATA_DIR=/home/user/data BACKEND_URL=http://127.0.0.1:8000
USER user
WORKDIR /home/user/app

COPY --chown=user backend/requirements.txt backend/requirements-ml.txt backend/
RUN pip install --user torch==2.5.1 torchvision==0.20.1 --index-url https://download.pytorch.org/whl/cpu \
    && pip install --user -r backend/requirements.txt -r backend/requirements-ml.txt

COPY --chown=user backend/ backend/
COPY --chown=user ml/ ml/
COPY --chown=user sample_images/ sample_images/
# Bake the models into the image so the first request does not download them:
# SegFormer b0/b2 (live planner surface) and YOLO-World with TenjiCheck's prompts (obstacles).
RUN cd backend && python scripts/fetch_models.py \
    && python -c "from app.vision.obstacles import YoloWorldDetector; YoloWorldDetector('yolov8s-worldv2.pt', 0.1)" \
    && rm -rf /home/user/.cache/clip

COPY --chown=user --from=web /app/frontend/.next frontend/.next
COPY --chown=user --from=web /app/frontend/node_modules frontend/node_modules
COPY --chown=user --from=web /app/frontend/public frontend/public
COPY --chown=user --from=web /app/frontend/package.json frontend/next.config.mjs frontend/
COPY --chown=user deploy/start.sh deploy/start.sh

EXPOSE 7860
CMD ["sh", "deploy/start.sh"]
