"""Assigns train/val/test splits by capture group (route, site or session), never by individual image.

Adjacent frames from one walk stay in one split, which prevents leakage. A whole route can be held out as the
locked test set from day one (e.g. --holdout-route E).

    python ml/training/make_splits.py manifest.csv --out manifest_split.csv --group capture_route_id --holdout-route E
"""
import argparse
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import read_manifest, write_manifest  # noqa: E402


def assign_splits(rows: list[dict], group: str = "capture_route_id", ratios=(0.7, 0.15, 0.15),
                  holdout: str | None = None, seed: int = 13) -> list[dict]:
    groups: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        key = (r.get(group) or "").strip()
        if not key:
            raise ValueError(f"Row {r.get('image_id')} has no '{group}'; every image needs a capture group")
        groups[key].append(r)
    keys = sorted(groups)
    if holdout:
        if holdout not in groups:
            raise ValueError(f"Holdout group '{holdout}' not found in column '{group}'")
        for r in groups[holdout]:
            r["split"] = "test"
        keys.remove(holdout)
        ratios = (ratios[0] / (ratios[0] + ratios[1]), ratios[1] / (ratios[0] + ratios[1]), 0.0)
    random.Random(seed).shuffle(keys)
    total = sum(len(groups[k]) for k in keys)
    targets = {"train": ratios[0] * total, "val": ratios[1] * total, "test": ratios[2] * total}
    filled = Counter()
    for k in sorted(keys, key=lambda k: -len(groups[k])):  # place big groups first
        split = max(targets, key=lambda s: targets[s] - filled[s])
        for r in groups[k]:
            r["split"] = split
        filled[split] += len(groups[k])
    return rows


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("manifest", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--group", default="capture_route_id")
    ap.add_argument("--holdout-route", default=None)
    ap.add_argument("--seed", type=int, default=13)
    a = ap.parse_args()
    rows = assign_splits(read_manifest(a.manifest), a.group, holdout=a.holdout_route, seed=a.seed)
    write_manifest(a.out, rows)
    c = Counter(r["split"] for r in rows)
    print(f"Wrote {a.out}: " + ", ".join(f"{k}={v}" for k, v in sorted(c.items())))


if __name__ == "__main__":
    main()
