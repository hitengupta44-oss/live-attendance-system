"""Generate a synthetic classroom photo for testing.

Picks N random students from demo/students.csv and seats them in a drawn classroom
(4 rows of desks, back rows smaller/blurrier like a real photo taken from the front).
Each face is changed from its admission photo (mirroring, tilt, lighting, colour,
blur, noise) so recognition is not a pixel-identical match.

Run:  python tools/make_class_photo.py --count 20 --seed 1 --out demo/class_photo_A.jpg
Also writes <out>_expected.txt with the roll numbers that are in the photo.
"""
import argparse
import csv
import random
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from app.face_engine import FaceEngine  # noqa: E402

W, H = 2400, 1600
ROWS = [  # (seats, head-centre y, scale) back row first
    (5, 390, 0.46),
    (5, 565, 0.60),
    (5, 775, 0.79),
    (5, 1035, 1.00),
]
SHIRTS = [(70, 50, 160), (160, 90, 40), (40, 120, 40), (200, 200, 200), (30, 30, 30), (50, 80, 180),
          (120, 40, 120), (0, 140, 200), (90, 90, 90), (180, 130, 60), (60, 60, 140), (230, 230, 240)]


def draw_room(rng: random.Random) -> np.ndarray:
    img = np.zeros((H, W, 3), np.uint8)
    for y in range(H):  # wall gradient then floor
        if y < 760:
            t = y / 760
            img[y] = (int(205 - 25 * t), int(222 - 25 * t), int(232 - 25 * t))
        else:
            t = (y - 760) / (H - 760)
            img[y] = (int(95 + 30 * t), int(110 + 30 * t), int(125 + 30 * t))
    for wx in (180, 820, 1460, 2000):  # windows on the back wall
        cv2.rectangle(img, (wx, 120), (wx + 300, 420), (235, 215, 170), -1)
        cv2.rectangle(img, (wx, 120), (wx + 300, 420), (90, 90, 90), 8)
        cv2.line(img, (wx + 150, 120), (wx + 150, 420), (90, 90, 90), 6)
        cv2.line(img, (wx, 270), (wx + 300, 270), (90, 90, 90), 6)
    cv2.circle(img, (1200, 80), 45, (245, 245, 245), -1)  # clock
    cv2.circle(img, (1200, 80), 45, (60, 60, 60), 5)
    cv2.line(img, (1200, 80), (1200, 50), (30, 30, 30), 4)
    cv2.line(img, (1200, 80), (1222, 92), (30, 30, 30), 4)
    cv2.rectangle(img, (0, 740), (W, 770), (70, 85, 100), -1)  # skirting
    noise = np.random.default_rng(rng.randint(0, 10**6)).normal(0, 3, img.shape)
    return np.clip(img + noise, 0, 255).astype(np.uint8)


def head_patch(photo: np.ndarray, face, size: int, rng: random.Random, blur: float) -> tuple[np.ndarray, np.ndarray]:
    """Cut the head (face + hair) out of an admission photo and alter it."""
    x1, y1, x2, y2 = face.box
    fw = x2 - x1
    cx, cy = (x1 + x2) / 2, (y1 + y2) / 2 - 0.12 * (y2 - y1)
    half = 0.95 * fw
    pad = int(half) + 10
    big = cv2.copyMakeBorder(photo, pad, pad, pad, pad, cv2.BORDER_REPLICATE)
    crop = big[int(cy - half + pad):int(cy + half + pad), int(cx - half + pad):int(cx + half + pad)]
    crop = cv2.resize(crop, (size, size), interpolation=cv2.INTER_AREA)
    if rng.random() < 0.5:
        crop = cv2.flip(crop, 1)
    M = cv2.getRotationMatrix2D((size / 2, size / 2), rng.uniform(-9, 9), rng.uniform(0.95, 1.05))
    crop = cv2.warpAffine(crop, M, (size, size), borderMode=cv2.BORDER_REPLICATE)
    # lighting / colour temperature / contrast
    f = crop.astype(np.float32)
    f = f * rng.uniform(0.8, 1.15) + rng.uniform(-18, 18)
    f *= np.array([rng.uniform(0.92, 1.05), 1.0, rng.uniform(0.95, 1.1)], np.float32)
    crop = np.clip(f, 0, 255).astype(np.uint8)
    if blur > 0:
        crop = cv2.GaussianBlur(crop, (0, 0), blur)
    mask = np.zeros((size, size), np.float32)
    cv2.ellipse(mask, (size // 2, int(size * 0.53)), (int(size * 0.36), int(size * 0.46)), 0, 0, 360, 1.0, -1)
    mask = cv2.GaussianBlur(mask, (0, 0), size * 0.015)
    return crop, mask


def paste(canvas: np.ndarray, patch: np.ndarray, mask: np.ndarray, x: int, y: int) -> None:
    h, w = patch.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(canvas.shape[1], x + w), min(canvas.shape[0], y + h)
    if x0 >= x1 or y0 >= y1:
        return
    p = patch[y0 - y:y1 - y, x0 - x:x1 - x].astype(np.float32)
    m = mask[y0 - y:y1 - y, x0 - x:x1 - x, None]
    region = canvas[y0:y1, x0:x1].astype(np.float32)
    canvas[y0:y1, x0:x1] = (p * m + region * (1 - m)).astype(np.uint8)


def draw_student(canvas, photo, face, cx, cy, s, rng):
    size = int(300 * s)
    shirt = rng.choice(SHIRTS)
    skin = tuple(int(v) for v in np.median(
        photo[int(face.kps[2][1]):int(face.kps[2][1]) + 20, int(face.kps[2][0]) - 30:int(face.kps[2][0]) - 10]
        .reshape(-1, 3), axis=0))
    cv2.ellipse(canvas, (cx, int(cy + 270 * s)), (int(175 * s), int(210 * s)), 0, 180, 360, shirt, -1)
    cv2.rectangle(canvas, (int(cx - 175 * s), int(cy + 270 * s)), (int(cx + 175 * s), int(cy + 420 * s)), shirt, -1)
    cv2.rectangle(canvas, (int(cx - 38 * s), int(cy + 70 * s)), (int(cx + 38 * s), int(cy + 140 * s)), skin, -1)
    blur = 1.4 if s < 0.55 else 0.8 if s < 0.7 else 0.0
    patch, mask = head_patch(photo, face, size, rng, blur)
    paste(canvas, patch, mask, cx - size // 2, int(cy - size * 0.52))
    # desk in front of the student
    top = int(cy + 250 * s)
    dw = int(250 * s)
    pts = np.array([[cx - dw, top], [cx + dw, top], [cx + dw + int(25 * s), top + int(45 * s)],
                    [cx - dw - int(25 * s), top + int(45 * s)]], np.int32)
    cv2.fillPoly(canvas, [pts], (60, 105, 150))
    cv2.rectangle(canvas, (cx - dw - int(25 * s), top + int(45 * s)), (cx + dw + int(25 * s), top + int(170 * s)),
                  (45, 80, 120), -1)
    if rng.random() < 0.6:  # notebook on desk
        bx = cx + rng.randint(-int(120 * s), int(60 * s))
        cv2.rectangle(canvas, (bx, top + int(8 * s)), (bx + int(70 * s), top + int(32 * s)), (235, 235, 235), -1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=20)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--out", default="demo/class_photo_A.jpg")
    args = ap.parse_args()
    seats = sum(r[0] for r in ROWS)
    if not 1 <= args.count <= seats:
        sys.exit(f"--count must be 1..{seats}")

    with open(ROOT / "demo" / "students.csv", encoding="utf-8") as f:
        students = list(csv.DictReader(f))
    rng = random.Random(args.seed)
    chosen = rng.sample(students, args.count)
    engine = FaceEngine()

    canvas = draw_room(rng)
    seat_list = [(ri, k) for ri, row in enumerate(ROWS) for k in range(row[0])]
    used_seats = sorted(rng.sample(seat_list, args.count))  # back rows first (drawing order)
    for (ri, k), st in zip(used_seats, chosen):
        n, y, s = ROWS[ri]
        span = W * (0.60 + 0.30 * ri / (len(ROWS) - 1))
        stagger = 0.28 if ri % 2 else -0.05  # alternate rows sit between the heads in front
        x = int(W / 2 - span / 2 + span * (k + 0.5 + stagger) / n + rng.uniform(-20, 20) * s)
        photo = cv2.imread(str(ROOT / "demo" / "photos" / f"{st['roll_no']}.jpg"))
        faces = engine.analyze(photo)
        if len(faces) != 1:
            sys.exit(f"{st['roll_no']}: expected 1 face in admission photo, found {len(faces)}")
        draw_student(canvas, photo, faces[0], x, int(y + rng.uniform(-12, 12) * s), s, rng)

    # camera feel: slight blur, sensor noise, JPEG compression
    canvas = cv2.GaussianBlur(canvas, (0, 0), 0.6)
    noise = np.random.default_rng(args.seed).normal(0, 4, canvas.shape)
    canvas = np.clip(canvas.astype(np.float32) + noise, 0, 255).astype(np.uint8)
    out = ROOT / args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out), canvas, [cv2.IMWRITE_JPEG_QUALITY, 88])
    expected = sorted(s["roll_no"] for s in chosen)
    out.with_name(out.stem + "_expected.txt").write_text("\n".join(expected) + "\n")
    print(f"Wrote {out} with {len(expected)} students:")
    print(", ".join(expected))


if __name__ == "__main__":
    main()
