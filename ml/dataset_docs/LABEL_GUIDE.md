# Label guide v0.1 (TenjiCheck)

Apply labels consistently. If you cannot confidently decide, set `needs_review=yes` in the manifest. **Do not force a positive label.** "Uncertain" is not a trained class.

| ID | Label | Definition | Annotation |
|---|---|---|---|
| 0 | blocked_tactile_path | An object visibly occupies or blocks the tactile guidance strip | Box around the object |
| 1 | damaged_tactile_tile | Visible break, missing piece, severe displacement or surface damage to a tile | Box |
| 2 | missing_tactile_tile | Expected tactile section is absent, supported by clear visual context (e.g. no warning band before a kerb) | Box over the region where tiles are expected |
| 3 | interrupted_guidance_path | Visible gap or discontinuity in the directional route | Box spanning the gap |
| 4 | warning_tile_present | Warning (dot) tiles | Polygon mask |
| 5 | directional_tile_present | Directional (bar) tiles | Polygon mask |
| 6 | ordinary_obstacle | Object on the footpath that does not touch the strip | Box |
| — | (no label file content) | Hard negative: no target defect | Empty `.txt` file, kept in the dataset |

Format: YOLO (`class xc yc w h`, normalised 0–1) for boxes; Ultralytics polygon format for masks.

Rules:
1. Label tile regions (4, 5) separately from defects (0–3, 6).
2. Record in the manifest: `image_id, file, capture_site_id, capture_route_id, capture_session_id, capture_date, device_class, lighting, defect_staged, annotator, label_version, source, license, needs_review`.
3. Staged defects must be marked `defect_staged=yes`.
4. Two independent labellers label the evaluation set. Report Cohen's kappa (`ml/evaluation/kappa.py`) and resolve disagreements before scoring.
5. Blur faces and plates before sharing images outside the team. Keep exact GPS restricted.
6. If the taxonomy changes, bump `label_version` and re-review the affected labels.
