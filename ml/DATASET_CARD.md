# Dataset card: TenjiCheck tactile paving dataset (to be collected)

| Field | Record |
|---|---|
| Purpose | Tactile-defect detection, tile-region segmentation, hard negatives |
| Sources | Custom photos collected under the protocol in the PRD+TRD §4.4. Candidate public context datasets (Mapillary Vistas, Cityscapes, BDD100K) are **not** tactile-defect datasets; verify each licence before use |
| Rights | Record the permission basis and licence for every image in the manifest `license` column |
| Composition | *To fill:* images per class, site, route, device, lighting and weather. Planning target 300–1,500 images for a prototype (PRD+TRD §4.3) |
| Annotation | `dataset_docs/LABEL_GUIDE.md` v0.1; two independent labellers on the evaluation set; kappa reported |
| Splits | Grouped by capture route (`make_splits.py`); one route held out as the locked test set from day one; no near-duplicate frames across splits |
| Privacy | Faces and plates blurred before sharing; exact GPS access restricted; retention period to be defined |
| Known gaps | *To fill after audit.* Expect few natural defects (staged ones must be flagged), limited weather and lighting variety, and a single campus |
| Current status | **No labelled data in this repository.** `sample_images/` contains synthetic drawings for UI testing only |
