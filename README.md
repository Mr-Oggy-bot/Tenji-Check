# TenjiCheck

Tactile paving accessibility platform with three modes on one shared database:

- **Inspect.** Pre-handover screening: photo → quality gate → AI screening → tile-grid geometry and rules → **mandatory human review** → PDF punch list → contractor repair photo → reinspection → closure → recorded handover decision.
- **Build.** GPS site surveys with geotagged observations, A* candidate corridors with an explainable cost breakdown, a material estimate, and engineer approval.
- **Report.** Public reporting of blocked or damaged tactile paths (photo and confirmed map pin), a reference number, status tracking, and staff triage with duplicate detection.

> *TenjiCheck screens. The engineer decides.* AI output is always a candidate for review. The software never certifies compliance, and anything it cannot measure reliably is flagged **verify on site**.

Requirement-by-requirement traceability, conflicts between the source PDFs, and what is not done are in [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md).

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 15 (React 19, TypeScript), Tailwind, Leaflet (OpenStreetMap tiles), Recharts. PWA with service worker and an IndexedDB offline upload queue |
| Backend | FastAPI, SQLAlchemy 2. SQLite by default, PostgreSQL via `TC_DATABASE_URL` |
| Vision | OpenCV quality gate; tile segmentation (classical baseline, or fine-tuned YOLOv8n-seg weights if provided); homography in tile units; YOLO-World open-vocabulary obstacle detection; OpenCV face/plate blurring |
| Reports | ReportLab PDFs, CSV exports |
| GIS | NetworkX A* over the surveyed track plus optional OpenStreetMap footpaths (Overpass) |

```
tenjicheck/
├── backend/            FastAPI app (app/), tests/, scripts/, models/ (downloaded weights, git-ignored)
│   └── app/
│       ├── api/        inspect.py · issues.py · build.py · insights.py · auth.py
│       ├── vision/     imageio · quality · tiles · geometry (homography) · obstacles · privacy · annotate · synthetic
│       ├── rules/      engine.py + references.yaml (versioned guideline clauses)
│       ├── gis/        geo · osm · routing (A*, cost model, materials)
│       ├── services/   analysis (orchestration) · media · documents (PDF/CSV) · guards (rate limit, idempotency)
│       └── workflow.py the only code allowed to change finding/report status
├── frontend/           Next.js app (src/app pages, src/components, src/lib), scripts/e2e.mjs
├── ml/                 make_splits · train · predict · evaluate · kappa · label guide · model/dataset cards
├── sample_images/      SYNTHETIC watermarked test images (python -m scripts.make_samples)
└── docs/               REQUIREMENTS.md · PRIVACY.md
```

## Run it locally (Windows; macOS/Linux equivalents noted)

Prerequisites: Python 3.11+ and Node 20+. You need two terminals.

**Terminal 1: backend (port 8000)**

```powershell
cd tenjicheck\backend
python -m venv .venv
.venv\Scripts\Activate.ps1                    # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
# Optional but recommended: real obstacle detection (~250 MB CPU PyTorch plus ~380 MB one-time model downloads)
pip install torch==2.5.1 torchvision==0.20.1 --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements-ml.txt
python scripts/fetch_models.py               # SegFormer-b0/b2 for the live path planner (~120 MB)
copy .env.example .env                       # then set TC_SECRET_KEY
python -m scripts.make_samples               # writes synthetic test photos to ..\sample_images
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

The first start creates `backend/data/tenjicheck.db`, private media storage and the demo accounts. The first photo screened downloads `yolov8s-worldv2.pt` (25 MB) and the CLIP text encoder (354 MB), embeds the prompt vocabulary, and saves `models/tenjicheck-yolov8s-worldv2-v19.pt`. Later starts do not need CLIP. Without PyTorch/Ultralytics the app still works: the UI reports "obstacle model unavailable" and you use manual tap-to-mark.

API docs are at http://127.0.0.1:8000/docs.

**Terminal 2: frontend (port 3000)**

```powershell
cd tenjicheck\frontend
npm install
npm run build
npm start                                    # or `npm run dev` for development
```

Open http://localhost:3000. The frontend proxies `/api` to the backend (`BACKEND_URL` overrides `http://127.0.0.1:8000`).

### Demo accounts (local only)

Password for all accounts: `tenjicheck-demo`. The login page has one-click buttons for each.

| Role | Email | Can |
|---|---|---|
| Inspector / reviewer | inspector@tenjicheck.local | review findings, punch lists, reinspect, close, handover, triage reports |
| Site engineer | engineer@tenjicheck.local | create projects/inspections, capture photos, manual findings, approve corridors |
| Contractor | contractor@tenjicheck.local | see assigned punch lists, submit repair photos, record surveys |
| Citizen | citizen@tenjicheck.local | report issues, track own reports |
| Administrator | admin@tenjicheck.local | everything, plus user and role management |

Seeded records (one project, four reports, one survey) are flagged **Demo data** in the UI.

### Five-minute demo script

1. **Engineer** → Inspections → *Main gate to library walkway* → upload `sample_images/synthetic_gap_2_tiles.jpg`. The AI proposes *Interrupted guide path, ≈2 tile units*. Upload `synthetic_blurry_retake.jpg` to see the quality gate.
2. **Inspector** → *Generate punch list* is blocked until review. Open the Review queue, confirm the gap and reject anything else with a reason, then generate the punch-list PDF.
3. **Contractor** → My fix tasks → submit `synthetic_continuous_ok.jpg` as the repair photo. The AI second look shows no defects.
4. **Inspector** → pass reinspection → close → *Record handover* (an engineer decision, not a certificate).
5. **Signed out** → Report an issue → photo, tap the map, confirm the pin → get a reference → Track a report.
6. **Contractor** → Site surveys → demo survey → *Generate candidates* → submit. **Engineer** approves the corridor.
7. **Admin** → Dashboard (100% review enforcement, recall *Pending*), Shared map, AI models.
8. **Engineer** → Live path planner → *Start camera* (or open a footpath photo/video) → the blue strip is the proposed route around obstacles, with the plan view and tile counts beside it. Pause, then *Save to survey* to keep it as a candidate segment.

### Live path planner

`/live` analyses camera frames on the server (nothing is stored) and proposes where a directional strip could be laid:

1. **Objects**: YOLO-World finds poles, bollards, vehicles, trees and similar objects. Confident detections (≥ 0.30) are always avoided. Weaker ones are avoided only if the surface model agrees the box is not ground; otherwise they are shown dashed as "weak".
2. **Surface**: SegFormer (ADE20K) groups pixels into paved walkway, unpaved, carriageway, hazard (steps, water, covers) or not walkable. It works from summed class probabilities with hysteresis, because these models confuse "footpath" and "road" at pedestrian height. Road only counts as a carriageway when vehicles are in view. Existing yellow tactile tiles are found by the colour baseline.
3. **Ground plane**: a flat-ground pinhole model maps pixels to a 6 m × 10 m bird's-eye grid at 0.1 m resolution. Camera tilt comes from the phone's orientation sensor, a manual slider, or an estimate from where the ground ends in the picture.
4. **Planner**: a dynamic programme walks forward 0.1 m per row. It keeps the strip on visible walkable ground with the chosen clearance (default 0.6 m from the strip edge, a planning assumption), penalises sideways moves and unpaved ground, and reuses existing tiles. It reports length, turns, minimum clearance, new directional tiles, 2 × 2 warning pads at turns and carriageway ends, and why the route stops.

Speed on a laptop CPU is about 1 s per frame (accurate, SegFormer-b2) or about 0.4 s (fast, b0). The view shows the analysed frame under its overlay, so the two always match, with a live inset for aiming. Camera access needs `https` or `localhost`. To use a phone on the same network, serve the frontend over HTTPS (for example with a tunnel).

**AI second opinion (optional).** Set `TC_GITHUB_MODELS_TOKEN` to a GitHub token with `models:read` permission. The *AI second opinion* button then sends the current frame to a vision LLM on [GitHub Models](https://github.com/marketplace/models) (`TC_GITHUB_MODELS_MODEL`, default `openai/gpt-4.1-mini`) and shows its route advice as a labelled LLM opinion. The token stays on the backend. This **sends the image to a third-party service** and is rate-limited on the free tier. It is off by default and was tested only against a mocked response, because no token was available here.

## Tests

| Suite | Command | What it covers |
|---|---|---|
| Backend (65 tests) | `cd backend && .venv\Scripts\python -m pytest -q` | quality gate, upload validation, homography accuracy on synthetic scenes, the three rules, fail-safes, state machines, routing, the full Inspect/Report/Build APIs, permissions, signed URLs, idempotency, rate limits, persistence across restart, ML tooling, the real YOLO-World detector (skipped if weights are absent), live planner geometry/planning/surface rules, the live API and the GitHub Models client (mocked) |
| Frontend types and lint | `cd frontend && npm run build` | TypeScript strict and ESLint |
| Browser end-to-end (22 steps) | servers running, then `cd frontend && npm install --no-save playwright-core@1.49.1 && npm run e2e` | every role's workflow in headless Chrome (installed Chrome is used, nothing downloaded); fails on console errors or HTTP 5xx; desktop and 390 px screenshots go to `e2e-screenshots/` |
| Live planner in the browser (7 steps) | `E2E_FEED=feed.mjpeg npm run e2e:live` (optional `E2E_PHOTO=photo.jpg`) | Chrome's fake camera plays a Motion-JPEG file; checks continuous frames, pause, settings, photo mode and the disabled second-opinion button |

The e2e test changes data (it records a handover on the demo inspection). Run it against a throwaway data directory, e.g. `$env:TC_DATA_DIR="$env:TEMP\tc-e2e"` before starting uvicorn.

## AI components: what is real and what is not

| Component | State |
|---|---|
| Quality gate | Real (variance-of-Laplacian blur, exposure). Thresholds configurable |
| Tile segmentation | **Untrained classical baseline** (HSV colour plus morphology; yellow tiles only). Set `TC_TILE_MODEL_PATH` to fine-tuned YOLOv8n-seg weights trained with `ml/training/train.py` |
| Tile-unit geometry | Real planar homography. The length scale is recovered from grout-joint periodicity. On synthetic scenes gaps measure within ±0.25 tiles. Assumes a straight strip and visible joints; otherwise *verify on site* |
| Obstacle detection | **Pretrained YOLO-World** with 19 text prompts (pole, bollard, tree trunk, manhole cover…). **Not fine-tuned**; expect false alarms, which reviewers reject. Synthetic drawn obstacles are usually not detected |
| Rules | Deterministic. Clause references in `rules/references.yaml` must be confirmed by a qualified accessibility reviewer |
| Live path planner | **Pretrained models, not fine-tuned on tactile paving**: SegFormer-b0/b2 (ADE20K) for surfaces plus YOLO-World for objects, a flat-ground camera model, and a deterministic planner. It was checked by eye on 12 openly licensed street photos; no accuracy has been measured. Clearance and warning-pad rules are planning assumptions, not clause values |
| Privacy blur | OpenCV Haar cascades; best effort with misses and false hits possible |
| Accuracy | **None claimed.** Recall target ≥ 0.80 is *pending* until `ml/evaluation/evaluate.py` runs on a labelled held-out route and writes `ml/evaluation/reports/latest.json` (then shown on the dashboard) |

Training workflow: label images (see `ml/dataset_docs/LABEL_GUIDE.md`) → `make_splits.py --holdout-route E` → `train.py` → `predict.py` on the test split → `evaluate.py --out ml/evaluation/reports/latest.json`.

## Release 3 and the assistant

Recurring inspection schedules (`/schedule`), site history and inspection comparison (`/history`), the restyled
shell and home page, and the optional "Ask TenjiCheck" CopilotKit assistant (GitHub Models) are described in
[docs/RELEASE3.md](docs/RELEASE3.md). The tactile route planner is described in [docs/PLANNER.md](docs/PLANNER.md). Deployment (Hugging Face Space, Docker) is in [docs/DEPLOY.md](docs/DEPLOY.md).

## Configuration

Settings use the `TC_` prefix (see `backend/.env.example`). Key ones: `TC_SECRET_KEY` (required for any shared deployment), `TC_DATABASE_URL`, `TC_DATA_DIR`, `TC_OBSTACLE_ENABLED`, `TC_TILE_MODEL_PATH`, `TC_OSM_ENABLED`, `TC_PUBLIC_RATE_LIMIT_PER_MINUTE`, `TC_SURFACE_QUALITY` (`accurate` or `fast`), `TC_GITHUB_MODELS_TOKEN`. To use PostgreSQL, run `pip install "psycopg[binary]"` and set `TC_DATABASE_URL=postgresql+psycopg://user:pass@host/db`. Tables are created on startup; there are no migration scripts yet.

## Known limitations

- The tile segmenter is a colour heuristic, not a trained model. Grey or unpainted tiles, strong colour casts and heavy shadows will produce wrong masks. Shadows read as gaps are the false alarm the review gate exists for.
- Geometry assumes a roughly straight strip on flat ground with visible grout joints. Curves, turns and steep angles fall back to *verify on site*.
- No PostGIS: spatial filtering happens in Python, which is fine at prototype scale.
- The rate limiter is in-memory, so per-process limits reset on restart. Background inference uses FastAPI background tasks rather than a durable queue.
- Live planner: distances depend on the camera tilt and height. A 5° tilt error moves a point 5 m ahead by about 1 m. Slopes, steps and kerbs break the flat-ground assumption. Close-up shots of a few tiles are out of scope. Brown or grey tactile tiles are not recognised as existing tiles (the colour baseline only sees yellow), and patterned paving is sometimes marked *not walkable*. Weak-detection fusion can drop a real low-confidence obstacle that the surface model also misses.
- Inspection photo analysis still runs PyTorch on FastAPI's background threads. The live planner uses one dedicated inference thread, because spreading frames across threads made inference about 6× slower.
- Browsers may pause GPS tracking in the background, so keep the screen on while surveying.
- Offline queueing covers photo uploads and public reports. Other actions need a connection.
- JWTs are stored in `localStorage` (prototype trade-off). Use HTTPS and consider httpOnly cookies for production.
- The OneDrive folder syncs `node_modules`, `.venv` and model weights. Exclude them from sync or move the project outside OneDrive.

## Data and licences

Map tiles and Overpass data come from © OpenStreetMap contributors (ODbL). Ultralytics/YOLO-World is AGPL-3.0: review this before any commercial deployment. CLIP weights are © OpenAI (MIT). SegFormer weights (NVIDIA, via Hugging Face) are under the **NVIDIA Source Code License for SegFormer, non-commercial use only**: replace them with a permissively licensed segmenter, or obtain a licence, before any commercial use. Sample images are synthetic drawings created by `scripts/make_samples.py`.
