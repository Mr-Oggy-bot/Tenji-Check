"""Download the pretrained models used by the live path planner into backend/models.

    python scripts/fetch_models.py

SegFormer ADE20K checkpoints come from Hugging Face (NVIDIA, github.com/NVlabs/SegFormer): b0 (~15 MB, "fast")
and b2 (~105 MB, "accurate"). YOLO-World weights are fetched by Ultralytics on first use of the obstacle detector.
"""
from pathlib import Path

from transformers import SegformerForSemanticSegmentation, SegformerImageProcessor

MODELS = Path(__file__).resolve().parent.parent / "models"
SOURCES = {"segformer-b0-ade": "nvidia/segformer-b0-finetuned-ade-512-512",
           "segformer-b2-ade": "nvidia/segformer-b2-finetuned-ade-512-512"}

if __name__ == "__main__":
    for folder, source in SOURCES.items():
        out = MODELS / folder
        SegformerImageProcessor.from_pretrained(source).save_pretrained(out)
        SegformerForSemanticSegmentation.from_pretrained(source).save_pretrained(out)
        print(f"Saved {source} to {out}")
