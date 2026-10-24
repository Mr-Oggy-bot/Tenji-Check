# Tactile Route Planner & Material Estimator

A separate module for designing tactile paving on a site plan and estimating materials from the actual tile
layout. It runs alongside Inspect, Report, Build and the live path planner, and does not change any of them.

**Where:** sidebar → Build → **Planning & Estimation** (`/planning`). Available to contractors, engineers,
inspectors and admins; citizens cannot open it.

## Workflow

1. **Create a project.** You can link it to an existing inspection site; this is a read-only reference.
2. **Site plan.** Upload a PNG, JPEG or WebP drawing. It is re-encoded with metadata stripped and stored privately.
   You can also draw on the blank 30 m × 20 m grid.
3. **Calibrate.** Click both ends of a known dimension and enter its length, or type a mm-per-pixel value.
   Checks and estimates are blocked until a scale is set.
4. **Draw the site.** Footpath, site boundary, entrances, destinations, crossings, kerb edges, stairs, trees,
   pillars, point obstacles and obstacle areas.
5. **Design the tactile layout.**
   - Draw directional **routes**: a centreline, 1–4 tiles wide. Points snap to existing points, and Shift gives 45° steps.
   - Add **warning areas**, as a rectangle or a polygon.
   - Place **single tiles** where needed.
   - **Suggest route** finds a clear path between two points on the footpath. The suggestion is an ordinary route you can edit.
6. **Edit.** Select, move, drag corners, drag midpoints to add corners, Delete, Undo/Redo (Ctrl+Z / Ctrl+Y), Save (Ctrl+S).
   Saves use optimistic locking, so a stale tab cannot overwrite newer work.
7. **Checks, Estimate and Compare** update automatically as you draw.
8. **Versions & report.**
   - *Save version* freezes the design together with its checks and estimate.
   - Download the PDF report or the CSV, then *Submit for review*. Submission is blocked while any check reports an error.
   - A reviewer (engineer, inspector or admin, but not the author) approves the version, or rejects it with a reason.

## Checks (`backend/app/planner/validation.py`)

| Severity | Checks |
|---|---|
| Error | missing scale; route through an obstacle or onto stairs; warning area over an obstacle |
| Warning | route outside the marked footpath; disconnected network; dead end; turn sharper than 90°; crossing, kerb or stairs approached by a route with no warning area; overlapping warning areas or routes (counted twice) |
| Needs professional review | low clearance to an obstacle; direction change without attention tiles; routes crossing; warning area not reached by the route; warning area with no apparent purpose; warning area shallower than the review depth; entrance or destination not served |

Thresholds are editable **planning assumptions, not clause values**: clearance 0.6 m, hazard approach 1.0 m,
warning depth 0.6 m, turn review at 30°. References come from the existing `rules/references.yaml` and are
marked as pending confirmation. **No check establishes compliance**; a qualified reviewer must assess the
design against the applicable, documented requirements.

## Estimate (`backend/app/planner/estimator.py`, engine `planner-estimator-1.0`)

The estimate is not "area ÷ tile area". The method:

1. A tile grid is laid over each straight run of a route, aligned with the direction of travel. Corners are
   mitred. Each warning area gets its own grid, aligned with its longest edge or a set angle.
2. Every grid cell is clipped against the geometry (Sutherland–Hodgman), which gives whole tiles, cut pieces
   with their dimensions, and slivers (pieces under 15% of a tile). Where a warning area overlaps a route,
   warning tiles replace directional ones.
3. Cut pieces are taken from reusable offcuts where they fit:
   - first fit, largest piece first, each offcut used once
   - 3 mm saw kerf; offcuts under 60 mm are treated as waste
   - directional offcuts are never rotated (the bars must stay aligned); warning offcuts may be rotated
   - any piece no offcut can supply comes from a new tile.
4. The output, per tile type:
   - area, whole tiles, cut pieces (from new tiles and from offcuts), slivers
   - tiles required, waste (m² and %), reusable offcuts left over
   - spare allowance (5%, minimum 2), packs and purchase quantity after pack rounding
   - material cost from the supplier prices, and an optional per-cut charge.
5. Results are deterministic and stored with each version, with the settings used, so they can be reproduced.

**Layout comparison** (`layouts.py`) tries three grid origins: start-aligned, centred and half-tile offset.
Only the grid position moves, never the coverage, strip width or warning areas. An option whose covered
area differs from the design's is marked invalid rather than offered. The option with the lowest cost and
least waste is labelled.

## Data

There are five new tables: `planning_projects`, `planning_site_images`, `planning_versions`,
`planning_estimates` and `planning_reviews`.

- They are created by the existing additive `create_all` at startup.
- No existing table, column or row is altered.
- Planner actions append to the existing `audit_log` (`planning.*` actions).
- Approved layouts are exposed read-only at `GET /api/v1/planning/approved-layouts?project_id=` so a future
  inspection enhancement can use them. Nothing in the current inspection workflow calls this endpoint.

## Access

- The owner has full access to their project.
- Other planners cannot see it at all (the API returns 404).
- Reviewers can open a project read-only only after a version has been submitted, and see only submitted or
  decided versions, never drafts.

## Tests

| Suite | Command |
|---|---|
| Backend (25 planner tests in `tests/test_planner.py`) | `cd backend && .venv\Scripts\python -m pytest tests/test_planner.py -q` |
| Browser (14 steps) | servers running, then `cd frontend && node scripts/e2e-planner.mjs` |

The browser test creates a planning project as the demo contractor and approves it as the demo inspector.

## Limitations

- Site plans must be images. PDF or CAD drawings need converting to PNG or JPEG first.
- Only square tiles of one size per project are supported. Curved routes have to be drawn as straight segments.
- Offcut reuse is a greedy heuristic, not an optimum. Angled pieces are sized by their bounding box, which is
  conservative.
- Where routes cross, the crossing square is counted in both routes (flagged for review).
- Route suggestion is a shortest clear path. It does not apply guideline-specific preferences, such as
  following building lines.
- One editor at a time: a second tab gets a "changed elsewhere" message rather than a merge.
- There is no project deletion in the UI, to avoid accidental data loss.
