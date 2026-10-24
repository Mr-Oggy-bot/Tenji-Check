# Model card: TenjiCheck screening pipeline (v0.1, prototype)

| Field | Value |
|---|---|
| Components | (1) `classical-hsv-baseline:0.1.0` tile segmenter (untrained heuristic); (2) `yolo-world:tenjicheck-yolov8s-worldv2-v19`, pretrained YOLO-World v2-S with 19 text prompts, **not fine-tuned**; (3) homography tile-unit geometry; (4) rules `hg2021-draft-1`; (5) live path planner: `segformer-b0-ade` / `segformer-b2-ade` (NVIDIA SegFormer, ADE20K, **not fine-tuned**) for walkable surface, the same YOLO-World detector, a flat-ground camera model and a dynamic-programming strip planner |
| Base checkpoint | `yolov8s-worldv2.pt` (Ultralytics 8.3.55, AGPL-3.0); CLIP ViT-B/32 text encoder (OpenAI, MIT), used once to embed the prompts |
| Training data | **None.** No TenjiCheck-specific training has been performed |
| Data split | n/a. When trained, split by route or site with `ml/training/make_splits.py` and hold one route out from day one |
| Evaluation | **Pending.** No held-out evaluation exists. Synthetic-scene unit tests check geometry (gap length within ±0.25 tile) and rule logic only; they are not accuracy metrics |
| Latency | ~0.5 s per image (YOLO-World, CPU, warm); first image includes a ~25 s model load. Live planner: ~1.0 s per frame (b2) or ~0.4 s (b0) on the development laptop CPU, measured on the running server |
| Known limitations | Live planner: ADE20K confuses footpath/road/floor at pedestrian height (mitigated, not solved, by probability grouping and vehicle context); flat-ground and known-tilt assumptions; checked by eye only on 12 openly licensed photos. Yellow tiles only (segmenter); straight strips with visible joints (geometry); open-vocabulary false positives and misses (detector); lighting, shadows, wet surfaces; Indian campus styles not represented in any training data |
| Intended use | Decision support for authorised inspectors during pre-handover inspection. Every output is reviewed by a human |
| Licence | SegFormer weights: NVIDIA Source Code License (non-commercial). YOLO-World/Ultralytics: AGPL-3.0 |
| Out-of-scope use | Navigation guidance for blind pedestrians (the live planner proposes where to *lay* tiles; it is not a walking aid); automatic compliance certification; unreviewed construction approval; tile height, wear or contrast assessment |
| Deployment hash | Recorded in the `model_versions` table at first use; fill in from `run_record.json` after training |
