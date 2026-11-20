"""Pure helpers: geometry, image checks, face-to-student matching, evidence annotation."""
from __future__ import annotations

import math

import cv2
import numpy as np

from . import config
from .face_engine import Face


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def has_exif(data: bytes) -> bool:
    """Photos from a phone gallery / camera app carry an EXIF block. Frames captured
    from the live browser camera (canvas.toBlob) never do."""
    i = 2
    while i + 4 <= len(data) and data[i] == 0xFF:
        marker = data[i + 1]
        if marker == 0xDA:  # start of scan - no more metadata
            break
        seg_len = int.from_bytes(data[i + 2:i + 4], "big")
        if marker == 0xE1 and data[i + 4:i + 10] == b"Exif\x00\x00":
            return True
        i += 2 + seg_len
    return False


def parse_float(v: str | None) -> float | None:
    if v is None or str(v).strip() == "":
        return None
    try:
        f = float(v)
    except ValueError:
        return None
    return f if math.isfinite(f) else None


def match_faces(faces: list[Face], rolls: list[str], E: np.ndarray, owners: np.ndarray) -> list[dict]:
    """One-to-one assignment of detected faces to students (greedy on highest similarity).
    A face maps to at most one student and a student to at most one face per photo."""
    results = [{"roll_no": None, "similarity": None, "status": "unknown"} for _ in faces]
    if not faces or E.shape[0] == 0:
        return results
    F = np.stack([f.embedding for f in faces])
    raw = F @ E.T                                    # faces x enrolled photos
    S = np.full((len(faces), len(rolls)), -1.0, dtype=np.float32)
    for col, owner in enumerate(owners):            # best photo per student
        S[:, owner] = np.maximum(S[:, owner], raw[:, col])
    pairs = [(S[i, j], i, j) for i in range(S.shape[0]) for j in range(S.shape[1])
             if S[i, j] >= config.REVIEW_THRESHOLD]
    pairs.sort(reverse=True)
    used_f, used_s = set(), set()
    for sim, i, j in pairs:
        if i in used_f or j in used_s:
            continue
        used_f.add(i)
        used_s.add(j)
        results[i] = {
            "roll_no": rolls[j],
            "similarity": round(float(sim), 4),
            "status": "matched" if sim >= config.MATCH_THRESHOLD else "review",
        }
    return results


def annotate(img: np.ndarray, faces: list[Face], matches: list[dict], banner: str) -> np.ndarray:
    out = img.copy()
    h, w = out.shape[:2]
    t = max(2, int(round(max(h, w) / 600)))
    fs = max(0.5, max(h, w) / 1600)
    colors = {"matched": (60, 180, 75), "review": (0, 165, 255), "unknown": (60, 60, 230)}
    for f, m in zip(faces, matches):
        x1, y1, x2, y2 = [int(v) for v in f.box]
        c = colors[m["status"]]
        cv2.rectangle(out, (x1, y1), (x2, y2), c, t)
        label = m["roll_no"] or "?"
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, fs, t)
        ty = y1 - 4 if y1 - th - 8 > 0 else y2 + th + 4
        cv2.rectangle(out, (x1, ty - th - 4), (x1 + tw + 4, ty + 4), c, -1)
        cv2.putText(out, label, (x1 + 2, ty), cv2.FONT_HERSHEY_SIMPLEX, fs, (255, 255, 255), t)
    # tamper-evident stamp: subject, time and place burned into the evidence image
    bh = int(40 * fs) + 10
    cv2.rectangle(out, (0, h - bh), (w, h), (0, 0, 0), -1)
    cv2.putText(out, banner, (8, h - bh // 3), cv2.FONT_HERSHEY_SIMPLEX, fs * 0.8, (255, 255, 255),
                max(1, t - 1))
    return out
