"""Face detection (SCRFD / RetinaFace-style) + recognition (ArcFace, ResNet-50 backbone).

Uses the official InsightFace "buffalo_l" ONNX models directly through onnxruntime,
so no C++ compiler is needed on Windows.

  det_10g.onnx    -> SCRFD-10G face detector (boxes + 5 landmarks)
  w600k_r50.onnx  -> ArcFace IResNet-50 trained on WebFace600K (512-d embedding)
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort

from . import config

MODEL_DIR = config.MODEL_DIR
MODEL_FILES = ("det_10g.onnx", "w600k_r50.onnx")
MODEL_ZIP_URL = "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip"


def ensure_models(model_dir: Path = MODEL_DIR) -> None:
    """Download the two model files from InsightFace's official release if missing
    (they're too big for the repo). About 280 MB, once per Space start."""
    if all((model_dir / f).exists() for f in MODEL_FILES):
        return
    import tempfile
    import urllib.request
    import zipfile
    model_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        zpath = Path(tmp) / "buffalo_l.zip"
        print(f"Downloading face models from {MODEL_ZIP_URL} ...", flush=True)
        urllib.request.urlretrieve(MODEL_ZIP_URL, zpath)
        with zipfile.ZipFile(zpath) as z:
            for info in z.infolist():
                name = Path(info.filename).name
                if name in MODEL_FILES:
                    with z.open(info) as src, open(model_dir / name, "wb") as dst:
                        dst.write(src.read())
    missing = [f for f in MODEL_FILES if not (model_dir / f).exists()]
    if missing:
        raise RuntimeError(f"Model download incomplete, missing: {missing}")
    print("Face models ready.", flush=True)

# Standard ArcFace 112x112 reference landmark positions
# (left eye, right eye, nose, left mouth corner, right mouth corner)
ARCFACE_DST = np.array(
    [
        [38.2946, 51.6963],
        [73.5318, 51.5014],
        [56.0252, 71.7366],
        [41.5493, 92.3655],
        [70.7299, 92.2041],
    ],
    dtype=np.float32,
)


@dataclass
class Face:
    box: np.ndarray        # [x1, y1, x2, y2] in original image pixels
    score: float           # detection confidence
    kps: np.ndarray        # (5, 2) landmarks
    embedding: np.ndarray | None = None  # L2-normalised 512-d vector

    @property
    def width(self) -> float:
        return float(self.box[2] - self.box[0])


def _providers() -> list[str]:
    available = ort.get_available_providers()
    return [p for p in ("CUDAExecutionProvider", "CPUExecutionProvider") if p in available]


def _nms(dets: np.ndarray, thresh: float) -> list[int]:
    x1, y1, x2, y2, scores = dets[:, 0], dets[:, 1], dets[:, 2], dets[:, 3], dets[:, 4]
    areas = (x2 - x1 + 1) * (y2 - y1 + 1)
    order = scores.argsort()[::-1]
    keep: list[int] = []
    while order.size > 0:
        i = order[0]
        keep.append(int(i))
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        w = np.maximum(0.0, xx2 - xx1 + 1)
        h = np.maximum(0.0, yy2 - yy1 + 1)
        inter = w * h
        ovr = inter / (areas[i] + areas[order[1:]] - inter)
        order = order[np.where(ovr <= thresh)[0] + 1]
    return keep


def _umeyama(src: np.ndarray, dst: np.ndarray) -> np.ndarray:
    """Least-squares similarity transform (rotation + uniform scale + translation)
    mapping src -> dst. Returns a 2x3 matrix usable by cv2.warpAffine."""
    num, dim = src.shape
    src_mean = src.mean(axis=0)
    dst_mean = dst.mean(axis=0)
    src_d = src - src_mean
    dst_d = dst - dst_mean
    A = dst_d.T @ src_d / num
    d = np.ones((dim,), dtype=np.float64)
    if np.linalg.det(A) < 0:
        d[dim - 1] = -1
    U, S, Vt = np.linalg.svd(A)
    T = np.eye(dim + 1, dtype=np.float64)
    rank = np.linalg.matrix_rank(A)
    if rank == 0:
        return np.full((2, 3), np.nan)
    if rank == dim - 1:
        if np.linalg.det(U) * np.linalg.det(Vt) > 0:
            T[:dim, :dim] = U @ Vt
        else:
            s = d[dim - 1]
            d[dim - 1] = -1
            T[:dim, :dim] = U @ np.diag(d) @ Vt
            d[dim - 1] = s
    else:
        T[:dim, :dim] = U @ np.diag(d) @ Vt
    scale = 1.0 / src_d.var(axis=0).sum() * (S @ d)
    T[:dim, dim] = dst_mean - scale * (T[:dim, :dim] @ src_mean.T)
    T[:dim, :dim] *= scale
    return T[:2, :]


class FaceEngine:
    def __init__(self, model_dir: Path = MODEL_DIR):
        det_path = model_dir / "det_10g.onnx"
        rec_path = model_dir / "w600k_r50.onnx"
        for p in (det_path, rec_path):
            if not p.exists():
                raise FileNotFoundError(f"Model not found: {p}. See README for download steps.")
        providers = _providers()
        opts = ort.SessionOptions()
        opts.log_severity_level = 3  # hide harmless dynamic-shape warnings
        self.det = ort.InferenceSession(str(det_path), sess_options=opts, providers=providers)
        self.rec = ort.InferenceSession(str(rec_path), sess_options=opts, providers=providers)
        self.det_input = self.det.get_inputs()[0].name
        self.det_outputs = [o.name for o in self.det.get_outputs()]
        self.rec_input = self.rec.get_inputs()[0].name
        self.strides = [8, 16, 32]
        self.num_anchors = 2
        self._anchor_cache: dict[tuple[int, int, int], np.ndarray] = {}

    # ---------------- detection ----------------
    def detect(self, img: np.ndarray, det_size: int = 640, thresh: float = 0.5,
               nms_thresh: float = 0.4) -> list[Face]:
        h, w = img.shape[:2]
        # resize keeping aspect ratio, pad to det_size x det_size (top-left aligned)
        scale = det_size / max(h, w)
        new_w, new_h = int(round(w * scale)), int(round(h * scale))
        resized = cv2.resize(img, (new_w, new_h))
        canvas = np.zeros((det_size, det_size, 3), dtype=np.uint8)
        canvas[:new_h, :new_w] = resized

        blob = cv2.dnn.blobFromImage(canvas, 1.0 / 128, (det_size, det_size),
                                     (127.5, 127.5, 127.5), swapRB=True)
        outs = self.det.run(self.det_outputs, {self.det_input: blob})
        fmc = len(self.strides)

        all_scores, all_boxes, all_kps = [], [], []
        for idx, stride in enumerate(self.strides):
            scores = outs[idx].reshape(-1)
            bbox_preds = outs[idx + fmc].reshape(-1, 4) * stride
            kps_preds = outs[idx + fmc * 2].reshape(-1, 10) * stride
            fh, fw = det_size // stride, det_size // stride
            key = (fh, fw, stride)
            centers = self._anchor_cache.get(key)
            if centers is None:
                grid = np.stack(np.mgrid[:fh, :fw][::-1], axis=-1).astype(np.float32)
                centers = (grid * stride).reshape(-1, 2)
                centers = np.stack([centers] * self.num_anchors, axis=1).reshape(-1, 2)
                self._anchor_cache[key] = centers
            pos = np.where(scores >= thresh)[0]
            if pos.size == 0:
                continue
            c = centers[pos]
            b = bbox_preds[pos]
            boxes = np.stack([c[:, 0] - b[:, 0], c[:, 1] - b[:, 1],
                              c[:, 0] + b[:, 2], c[:, 1] + b[:, 3]], axis=-1)
            k = kps_preds[pos].reshape(-1, 5, 2) + c[:, None, :]
            all_scores.append(scores[pos])
            all_boxes.append(boxes)
            all_kps.append(k)

        if not all_scores:
            return []
        scores = np.concatenate(all_scores)
        boxes = np.concatenate(all_boxes) / scale
        kps = np.concatenate(all_kps) / scale
        dets = np.hstack([boxes, scores[:, None]]).astype(np.float32)
        keep = _nms(dets, nms_thresh)
        faces = []
        for i in keep:
            box = dets[i, :4].copy()
            box[[0, 2]] = np.clip(box[[0, 2]], 0, w)
            box[[1, 3]] = np.clip(box[[1, 3]], 0, h)
            faces.append(Face(box=box, score=float(dets[i, 4]), kps=kps[i]))
        faces.sort(key=lambda f: f.score, reverse=True)
        return faces

    # ---------------- recognition ----------------
    def align(self, img: np.ndarray, kps: np.ndarray) -> np.ndarray:
        M = _umeyama(kps.astype(np.float64), ARCFACE_DST.astype(np.float64))
        return cv2.warpAffine(img, M, (112, 112), borderValue=0.0)

    def embed(self, img: np.ndarray, faces: list[Face]) -> None:
        if not faces:
            return
        crops = [self.align(img, f.kps) for f in faces]
        blob = cv2.dnn.blobFromImages(crops, 1.0 / 127.5, (112, 112),
                                      (127.5, 127.5, 127.5), swapRB=True)
        feats = self.rec.run(None, {self.rec_input: blob})[0]
        feats = feats / np.linalg.norm(feats, axis=1, keepdims=True)
        for f, e in zip(faces, feats):
            f.embedding = e.astype(np.float32)

    def analyze(self, img: np.ndarray, det_size: int = 640, min_face_px: int = 16) -> list[Face]:
        faces = [f for f in self.detect(img, det_size=det_size) if f.width >= min_face_px]
        if not faces or max(f.score for f in faces) < 0.6:
            # nothing (or only weak fragments) found: maybe a close-up face
            close = self._detect_close_up(img, det_size)
            if close and (not faces or max(f.score for f in close) > max(f.score for f in faces)):
                faces = close
        self.embed(img, faces)
        return faces

    def _detect_close_up(self, img: np.ndarray, det_size: int) -> list[Face]:
        """The detector misses faces that fill most of the frame (passport-style
        close-ups). Pad the image so the face becomes smaller, then map back."""
        h, w = img.shape[:2]
        pad = max(h, w) // 2
        padded = cv2.copyMakeBorder(img, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=(0, 0, 0))
        faces = self.detect(padded, det_size=det_size)
        for f in faces:
            f.box = f.box - pad
            f.box[[0, 2]] = np.clip(f.box[[0, 2]], 0, w)
            f.box[[1, 3]] = np.clip(f.box[[1, 3]], 0, h)
            f.kps = f.kps - pad
        return faces

    def analyze_classroom(self, img: np.ndarray) -> list[Face]:
        """Group photo: run detection at a higher resolution so small faces
        at the back of the room are found."""
        long_side = max(img.shape[:2])
        det_size = 1280 if long_side >= 1000 else 640
        return self.analyze(img, det_size=det_size, min_face_px=12)


def decode_image(data: bytes) -> np.ndarray | None:
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return img
