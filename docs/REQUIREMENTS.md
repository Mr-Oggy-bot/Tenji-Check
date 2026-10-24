# TenjiCheck — consolidated requirements & traceability

**Sources**
- **A** — *TenjiCheck PRD + TRD: Dataset & Training Guide* (Inspect / Build / Report platform, FR-01…FR-12, NFRs, dataset, model, API, GIS, testing)
- **B** — *PRIME_HAMSTER* pitch deck (pre-handover verification loop, 3 defect classes, architecture, evaluation protocol)
- **C** — *TenjiCheck Final Preview* deck (8-step loop, finding lifecycle, "no validated accuracy claimed", demo scenario)
- Context only: earlier PRD/TED PDFs and the Development Plan (.docx), which the three PDFs supersede where they differ.

Status: **Done** = implemented and covered by an automated test (pytest `backend/tests`, or the browser run `frontend/scripts/e2e.mjs`) · **Partial** = implemented with a documented limitation · **Not done** = not implemented (reason given).

## 1. Contradictions and how they were resolved

| # | Conflict | Resolution |
|---|---|---|
| 1 | A scopes three modes (Inspect/Build/Report); B/C scope the pre-handover loop only, with planning in "Release 1" and dashboards in "Release 3". | All three modes built. The Inspect verification loop is the core, as in the B/C demo. |
| 2 | Two lifecycles: A's issue states vs B/C's finding states. | Two entities. `Finding` (Inspect) follows B/C. `Issue` (Report) follows A. Both appear on one shared map and dashboard. Confirmed findings and open reports feed Build route barriers. |
| 3 | A specifies PostgreSQL + PostGIS; B/C specify PostgreSQL. Neither is installed locally. | SQLAlchemy with SQLite by default; set `TC_DATABASE_URL` for PostgreSQL. Geometry is stored as lat/lon (points) and JSON (lines); distances use haversine in Python. PostGIS is **not** used. |
| 4 | A: React + TS PWA; B/C: Next.js PWA. | Next.js 15 (React 19, TypeScript). |
| 5 | A: 8-class training taxonomy; B/C: 3 rule-based defect classes. | The rules emit the 3 B/C classes (plus a "not assessable" fail-safe). A's taxonomy is used for training/evaluation (`ml/common.py`) and report categories; outputs are mapped between the two. |
| 6 | Face/plate blurring is a storage feature in B but "planned" in C. | Implemented (OpenCV Haar, best-effort) on derived display images; originals kept immutable with restricted access. |
| 7 | B ticks "implemented & tested" for all models; C says no validated accuracy is claimed. | No accuracy is claimed. Recall shows **Pending** until `ml/evaluation/evaluate.py` writes a held-out report. |
| 8 | B: tile segmenter is "YOLOv8n-seg fine-tuned on Indian campus photos"; no such weights or labelled data exist here. | Plug-in slot for fine-tuned weights (`TC_TILE_MODEL_PATH`) plus a clearly labelled, untrained classical baseline. |

## 2. Feature checklist and traceability

### Inspect mode (pre-handover verification)

| ID | Requirement | Src | Frontend | Backend | Test | Status |
|---|---|---|---|---|---|---|
| I-1 | Capture/upload photo with context tag (segment / path end / crossing), preview, GPS optional | A FR-02, B, C | `CapturePhoto.tsx` on `/inspect/[id]` | `POST /inspections/{id}/photos` | e2e "upload photo…", `test_full_verification_loop` | Done |
| I-2 | Photo has ID, timestamp, project/site, context tag | A, Dev plan | photo cards | `Media` model | `test_full_verification_loop` | Done |
| I-3 | Reject invalid/corrupt/oversized/wrong-type files; re-encode | A NFR Security | error toast | `vision/imageio.py` | `test_upload_validation_rejects_bad_files`, `test_quality_gate_and_overrides` | Done |
| I-4 | Blur/exposure quality gate before inference; retake prompt; manual-review-only path | B, C step 2 | quality notice with Retake / Keep | `vision/quality.py` | `test_quality_gate_*`, e2e "blurry photo…" | Done |
| I-5 | Tile segmentation | B, C | analysis panel | `vision/tiles.py` | `test_vision.py` | Partial (untrained colour baseline; YOLOv8n-seg slot untested without weights) |
| I-6 | Open-vocabulary obstacle detection (text prompts) | B, C | detections in analysis panel | `vision/obstacles.py` (YOLO-World) | `test_detector_integration.py`, e2e | Done (pretrained, not fine-tuned) |
| I-7 | Homography: tile grid as ruler, gaps in tile units | B, C | measurement in finding | `vision/geometry.py` | `test_homography_measures_gaps_in_tile_units` (±0.25 tile on synthetic scenes) | Done |
| I-8 | "Verify on site" when grid absent/obscured, never a guessed measurement | B, C | amber badge and reason | `rules/engine.py` | `test_no_tiles_defers_to_verify_on_site` | Done |
| I-9 | Rule A: obstacle overlaps guide corridor | B, C | finding | `rules/engine.py` | `test_obstacle_inside_corridor_is_flagged`, `..._beside_...` | Done |
| I-10 | Rule B: gap wider than one tile, or a dead end | B, C | finding | `rules/engine.py` | `test_gap_wider_than_one_tile_is_interrupted_path`, utility-cover test | Done |
| I-11 | Rule C: missing warning tiles before kerb/crossing | B, C | finding | `rules/engine.py` | `test_crossing_without/with_warning_*` | Done |
| I-12 | Each rule cites a guideline clause (versioned) | B, C | rule reference on finding and PDF | `rules/references.yaml` | rules tests | Done (clauses pending expert review) |
| I-13 | AI output shows class, confidence, annotation; low confidence marked uncertain | A FR-03 | annotated image, confidence badge | `services/analysis.py`, `vision/annotate.py` | API test | Done |
| I-14 | Tap-to-mark manual fallback | B, C, Dev plan | `ImageAnnotator` (drawing mode) | `POST /inspections/{id}/findings` | e2e "tap-to-mark", API test | Done |
| I-15 | 100% of AI findings confirmed/rejected/corrected by an authorised reviewer | A FR-04, B, C | `/review`, `/findings/[id]` | `workflow.py`, `POST /findings/{id}/review` | API + e2e | Done |
| I-16 | Human decision stored separately from model prediction | A FR-04, NFR Audit | "Original AI output" panel | `Finding.ai_output`, `ai_predictions` | `test_full_verification_loop` | Done |
| I-17 | No punch list while any finding is unreviewed | B, C | 409 notice | `POST /inspections/{id}/punch-list` | API + e2e | Done |
| I-18 | Annotated PDF punch list: photo, rule reference, reviewer, status, date | B, C | Generate / Open PDF | `services/documents.py` | API (`%PDF`), e2e | Done |
| I-19 | Repair evidence → reinspection → verified → closed; failed reinspection returns to fix required | B, C | contractor `/tasks`, finding actions | state machine and guards | lifecycle event assertion in API test, e2e | Done |
| I-20 | Closure enforced by the backend (needs reinspection photo and reviewer) | B, C | — | `_check_finding_guards` | API test (409s) | Done |
| I-21 | AI second look on the repair photo (advisory) | C | "AI second look" | analysis on repair media | API test | Done |
| I-22 | Handover only when every finding is closed/rejected; recorded as a human decision, never a certificate | B, C | Record handover modal | `POST /inspections/{id}/handover` | API + e2e | Done |
| I-23 | Face/licence-plate blurring on stored display images | B, C | "region(s) blurred" badge | `vision/privacy.py` | `test_privacy_blur_*` | Partial (Haar cascades; misses and false hits possible) |
| I-24 | Proposed detour drawn for obstacle findings, marked "needs review" | C demo | annotated image | `vision/annotate.py` | visual | Done |
| I-25 | Inspection export (CSV) with caveats | A FR-10 | CSV button | `GET /inspections/{id}/export.csv` | API test | Done |

### Report mode (citizens)

| ID | Requirement | Src | Frontend | Backend | Test | Status |
|---|---|---|---|---|---|---|
| R-1 | Submit category, photo, optional description, location; receive reference ID | A FR-07 | `/report` | `POST /issues` | `test_public_report_and_tracking`, e2e | Done |
| R-2 | Map pin must be confirmed; draggable pin; photo-only if location denied | A §9.4, §8.4 | `/report` | validation | `test_report_validation`, e2e | Done |
| R-3 | Privacy notice; identity and raw photos never public | A §2.3, §10 | `/report` | `/issues/track/{ref}` redaction | `test_public_report_and_tracking` | Done |
| R-4 | Status tracking by reference | A | `/report/status`, `/report/mine` | `GET /issues/track/{ref}`, `/issues/mine` | API + e2e | Done |
| R-5 | Lifecycle submitted → under_review → assigned → in_progress → resolved / rejected (reason); reopen | A FR-08, §8.2 | `/reports/[id]` | `apply_issue_transition` | `test_duplicates_and_lifecycle` | Done |
| R-6 | Every status change records actor and timestamp | A FR-08 | status history | `status_events` | API test | Done |
| R-7 | Reviewer confirm/edit/reject of AI output | A FR-04 | Verify panel | `POST /issues/{id}/review` | API + e2e | Done |
| R-8 | Duplicate detection by proximity, time, category; flagged, never deleted | A FR-09 | badge, "Mark duplicate" | `find_possible_duplicates`, `mark-duplicate` | API test | Done |
| R-9 | Assign team; set severity; closure evidence | A journeys | Triage panel | `PATCH /issues/{id}/status`, `/evidence` | API + e2e | Done |
| R-10 | Rate limits on public submissions | A NFR | 429 toast | `services/guards.py` | `test_rate_limit` | Done (in-memory, single process) |
| R-11 | Staff queue with filters, search, sort, pagination; CSV export | A | `/reports` | `GET /issues`, `/issues/export.csv` | API test, e2e | Done |

### Build mode (contractor / planning engineer)

| ID | Requirement | Src | Frontend | Backend | Test | Status |
|---|---|---|---|---|---|---|
| B-1 | GPS track with timestamps; sampling policy; accuracy shown | A FR-05, §9.4 | `/build/[id]` watchPosition | `POST /surveys/{id}/track` | `test_survey_routes_and_approval` | Done (foreground only; background tracking not promised) |
| B-2 | Geotagged observations with photos; manual pin fallback | A FR-05 | Add observation | `POST /surveys/{id}/observations` | API test | Done |
| B-3 | Correct GPS drift / move pins | A §9.3 | draggable pins, remove points | `PATCH …/observations`, `DELETE …/track/{pid}` | API test | Done |
| B-4 | Candidate routes: A* with explicit cost (distance, barrier, crossing, uncertainty); score breakdown; missing data and assumptions | A FR-06, §9.2 | route cards | `gis/routing.py` | `test_routing.py`, API, e2e | Done |
| B-5 | Unknown never treated as accessible; impassable policy explicit | A §9.1–9.2 | notes | uncertainty penalty, `exclude_impassable` | `test_impassable_policy_removes_edges` | Done |
| B-6 | OSM pedestrian network context (attribution, ODbL) | A §4, §9 | checkbox | `gis/osm.py` (Overpass, cached) | `test_no_path_is_explained` (OSM disabled in tests) | Partial (live Overpass not covered by automated tests) |
| B-7 | Material estimate | B/C Release 1, C evaluation | route card | `estimate_materials` | `test_turns_and_material_estimate` | Done (planning estimate) |
| B-8 | Submit for approval; approval by someone other than the author; approved version preserved | A §9.3 | approve/reject | `/surveys/{id}/review`, `/routes/{id}/decision` | API + e2e | Done |
| B-9 | Survey export PDF/CSV | A FR-10 | buttons | `export.pdf`, `export.csv` | API test | Done |
| B-10 | Live camera path proposal: walkable surface plus obstacles to a strip route with clearance, existing-tile reuse and material counts (user request, beyond the PDFs) | user request | `/live` | `api/live.py`, `services/live.py`, `vision/{surface,groundplane,layplan}.py` | `test_live.py` (18), `e2e-live.mjs` (7 steps) | Done (pretrained, unvalidated; decision support) |
| B-11 | Optional vision-LLM second opinion via GitHub Models, token server-side | user request | `/live` button | `services/github_models.py` | mocked API test | Partial (never called against the live service; no token available) |

### Shared platform, NFRs, AI/ML

| ID | Requirement | Src | Where | Test | Status |
|---|---|---|---|---|---|
| P-1 | Role-aware navigation; unauthorised actions rejected server-side | A FR-01 | `AppShell.tsx`; `require_roles` | `test_role_checks`, citizen e2e | Done |
| P-2 | Shared map of findings, reports, surveys, approved corridors | A | `/map`, `GET /map/features` | e2e, API | Done |
| P-3 | Dashboard: defect types, status, age, clusters, period; derived from DB | A FR-12 | `/dashboard`, `GET /dashboard/summary` | e2e, API | Done |
| P-4 | Metrics: human review enforcement %, report completeness %, obstacle recall (pending) | B, C | dashboard tiles | API test asserts 100% / 100% | Done |
| P-5 | Offline draft capture and later sync, with visible unsynced state | A FR-11 (Could) | `lib/offline.ts`, header indicator | not automated | Partial (IndexedDB queue; no conflict UI beyond retry errors) |
| P-6 | PWA: manifest, service worker, phone/tablet/desktop | A, B, C | `public/` | build + mobile e2e | Done |
| P-7 | Accessibility: keyboard, focus, labels, contrast, touch targets, live regions | A NFR | ui components | manual review | Partial (no automated a11y audit run) |
| P-8 | Auditability: model output, human decision, status history, model version separate | A NFR | models + `audit_log` | API tests | Done |
| P-9 | Observability: request IDs, latency, model version, no image content logged | A NFR | `main.py` middleware | manual | Done |
| P-10 | Signed expiring media URLs; originals restricted | A §10 | `security.py` | `test_signed_media_urls` | Done |
| P-11 | Idempotency keys for safe retries | A NFR | photos, reports | `test_idempotent_upload` | Done |
| P-12 | Secrets via env; `.env.example`; dev secret warning | A §7.3 | `config.py` | health check reports `dev_secret_in_use` | Done |
| P-13 | Persistence across restarts | brief | SQLite file / PostgreSQL | `test_persistence_across_restart` | Done |
| P-14 | Demo data clearly labelled | A, C | `is_demo` badges | e2e screenshots | Done |
| M-1 | Custom dataset manifest, grouped split (no leakage), held-out route | A §4–5, B | `ml/training/make_splits.py` | `test_splits_*` | Done |
| M-2 | Two labellers + kappa | B | `ml/evaluation/kappa.py` | `test_cohens_kappa_known_values` | Done |
| M-3 | Training recipe (small pretrained model, modest augmentation, run record) | A §6 | `ml/training/train.py` | refuses empty data (manual) | Partial (**no model trained: no labelled data**) |
| M-4 | Per-class TP/FP/FN, recall-first, per condition; end-to-end pipeline evaluation | A §11, B | `ml/evaluation/predict.py`, `evaluate.py` | `test_matching_*`, `test_evaluate_*` | Done (tooling) / **results pending** |
| M-5 | Model and dataset cards | A §13 | `ml/MODEL_CARD.md`, `ml/DATASET_CARD.md` | — | Done (templates partly filled) |
| M-6 | Inference latency target < 3 s, measured | A NFR | dashboard latency tile | measured: ~0.5 s warm YOLO-World on CPU; 0.3–8 s per photo including first model load | Done (measured locally) |

### Release 3 (added)

| ID | Requirement | Source | Where | Test | Status |
|---|---|---|---|---|---|
| R3-1 | Recurring inspection schedules (cadence, due / due soon / overdue, pause) | B/C Release 3 | `/schedule`, `backend/app/api/recurring.py` | `test_schedule_lifecycle`, `e2e-release3.mjs` | Done |
| R3-2 | Inspection scheduler: start the due inspection, advance to the next due date, record on-time/late runs | B/C Release 3 | `POST /schedules/{id}/start` | `test_schedule_lifecycle` | Done (no e-mail/push reminders; due state is shown in the app) |
| R3-3 | Inspection history per site and comparison of two inspections (recurring / new / not seen again) | B/C Release 3 | `/history`, `backend/app/recurring/compare.py` | `test_history_and_compare`, `test_match_*` | Done (matching is heuristic: class + GPS ≤ 15 m) |

### Not implemented (out of scope or blocked)

| Item | Source | Reason |
|---|---|---|
| Tile height, texture wear, luminance contrast | B, C (explicitly excluded) | Not measurable from a 2-D photo |
| Automatic compliance certification | A, B, C | Explicitly never offered |
| Fine-tuned YOLOv8n-seg / validated recall | B | No labelled TenjiCheck dataset available; pipeline ready |
| PostGIS spatial queries | A | No PostgreSQL in this environment; Python haversine used instead |
| Managed authentication / HTTPS deployment | A §7 | Local prototype: JWT + bcrypt; deploy behind HTTPS |
