"""Inter-rater agreement (Cohen's kappa) between two independent labellers.

    python ml/evaluation/kappa.py labels_a.csv labels_b.csv
Each CSV has columns image_id,label (image-level label, e.g. the primary defect class or 'no_defect').
"""
import csv
import sys
from collections import Counter


def cohens_kappa(a: list[str], b: list[str]) -> float:
    if len(a) != len(b) or not a:
        raise ValueError("Label lists must be non-empty and the same length")
    n = len(a)
    po = sum(x == y for x, y in zip(a, b)) / n
    ca, cb = Counter(a), Counter(b)
    pe = sum(ca[k] * cb[k] for k in set(ca) | set(cb)) / (n * n)
    return 1.0 if pe == 1 else (po - pe) / (1 - pe)


def load(path: str) -> dict[str, str]:
    with open(path, newline="", encoding="utf-8") as f:
        return {r["image_id"]: r["label"] for r in csv.DictReader(f)}


if __name__ == "__main__":
    A, B = load(sys.argv[1]), load(sys.argv[2])
    common = sorted(set(A) & set(B))
    k = cohens_kappa([A[i] for i in common], [B[i] for i in common])
    print(f"images compared: {len(common)}  (only in A: {len(set(A) - set(B))}, only in B: {len(set(B) - set(A))})")
    print(f"Cohen's kappa: {k:.3f}")
