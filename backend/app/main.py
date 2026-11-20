"""SmartAttend API - live classroom attendance with face recognition.

Data: Supabase Postgres (+pgvector). Photos: Supabase Storage (private). Logins: Supabase Auth.
Started by ../app.py (Hugging Face Space).
"""
from __future__ import annotations

import hashlib
import re
import secrets
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import cv2
import numpy as np
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

from . import config, supa
from .auth import current_user, require_admin
from .db import audit, close_pool, get_db, open_pool, vec
from .face_engine import FaceEngine, decode_image, ensure_models
from .logic import annotate, has_exif, haversine_m, match_faces, parse_float

engine: FaceEngine | None = None
STATUS: dict = {"models": "not loaded", "database": "not connected", "seed": "off"}


def get_engine() -> FaceEngine:
    if engine is None:
        raise HTTPException(503, "Face models are still loading. Try again in a minute.")
    return engine


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global engine
    missing = [k for k, v in config.REQUIRED_SECRETS.items() if not v]
    problem = config.database_url_problem()
    if missing:
        STATUS["database"] = f"missing secrets: {', '.join(missing)}"
    elif problem:
        STATUS["database"] = f"error: {problem}"
    else:
        try:
            open_pool()
            with get_db() as conn:
                conn.execute("SELECT 1 FROM profiles LIMIT 1")
            STATUS["database"] = "connected"
        except Exception as e:  # keep the Space up so the status page can show the problem
            STATUS["database"] = f"error: {type(e).__name__}: {str(e)[:200]}"
    try:
        ensure_models()
        engine = FaceEngine()
        STATUS["models"] = "loaded"
    except Exception as e:
        STATUS["models"] = f"error: {e}"
    if config.SEED_DEMO and engine and STATUS["database"] == "connected":
        from .seed import seed_demo
        threading.Thread(target=seed_demo, args=(STATUS,), daemon=True).start()
    yield
    close_pool()


app = FastAPI(title="SmartAttend API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

ROLL_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9/_-]{0,31}$")


# ============================================================ helpers
def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else ""


def local_now() -> datetime:
    try:
        return datetime.now(ZoneInfo(config.TIMEZONE))
    except Exception:
        return datetime.now(timezone.utc)


def get_subject(conn, subject_id: int, user: dict) -> dict:
    row = conn.execute("SELECT *, teacher_id::text AS teacher_id FROM subjects WHERE id=%s", (subject_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Subject not found")
    if user["role"] != "admin" and row["teacher_id"] != user["id"]:
        raise HTTPException(403, "This subject is not assigned to you")
    return row


def get_session(conn, session_id: int, user: dict) -> tuple[dict, dict]:
    row = conn.execute("SELECT *, teacher_id::text AS teacher_id FROM sessions WHERE id=%s", (session_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Lecture not found")
    return row, get_subject(conn, row["subject_id"], user)


def section_gallery(conn, section: str):
    """All enrolled face embeddings for one section -> (rolls, names, matrix, owner index per row)."""
    students = conn.execute("SELECT roll_no, name FROM students WHERE section=%s ORDER BY roll_no", (section,)).fetchall()
    rolls = [s["roll_no"] for s in students]
    names = {s["roll_no"]: s["name"] for s in students}
    idx = {r: i for i, r in enumerate(rolls)}
    rows = conn.execute(
        """SELECT f.roll_no, f.embedding::real[] AS emb FROM student_faces f
           JOIN students s ON s.roll_no = f.roll_no WHERE s.section=%s""", (section,)).fetchall()
    embs = [np.asarray(r["emb"], dtype=np.float32) for r in rows]
    owners = [idx[r["roll_no"]] for r in rows]
    E = np.stack(embs) if embs else np.zeros((0, 512), dtype=np.float32)
    return rolls, names, E, np.array(owners, dtype=np.int64)


def session_summary(conn, session: dict, subject: dict) -> dict:
    rolls, names, _, _ = section_gallery(conn, subject["section"])
    enrolled = {r["roll_no"] for r in conn.execute(
        """SELECT DISTINCT f.roll_no FROM student_faces f JOIN students s ON s.roll_no = f.roll_no
           WHERE s.section=%s""", (subject["section"],))}
    best: dict[str, dict] = {}
    for d in conn.execute(
        """SELECT d.roll_no, d.similarity, d.status FROM detections d JOIN photos p ON p.id = d.photo_id
           WHERE p.session_id=%s AND d.roll_no IS NOT NULL""", (session["id"],)):
        cur = best.get(d["roll_no"])
        if cur is None or d["similarity"] > cur["similarity"]:
            best[d["roll_no"]] = d
    final = {r["roll_no"]: r for r in conn.execute(
        "SELECT roll_no, status, source FROM attendance WHERE session_id=%s", (session["id"],))}
    students = []
    for r in rolls:
        b = best.get(r)
        students.append({
            "roll_no": r, "name": names[r], "enrolled_face": r in enrolled,
            "detected": b["status"] if b else "not_seen",
            "similarity": round(float(b["similarity"]), 4) if b else None,
            "final_status": final[r]["status"] if r in final else None,
            "final_source": final[r]["source"] if r in final else None,
        })
    photos = conn.execute(
        """SELECT p.id, p.captured_at, p.lat, p.lng, p.accuracy_m, p.distance_m, p.faces_detected,
                  count(*) FILTER (WHERE d.status='matched') AS matched,
                  count(*) FILTER (WHERE d.status='review')  AS review,
                  count(*) FILTER (WHERE d.status='unknown') AS unknown
           FROM photos p LEFT JOIN detections d ON d.photo_id = p.id
           WHERE p.session_id=%s GROUP BY p.id ORDER BY p.id""", (session["id"],)).fetchall()
    teacher = conn.execute("SELECT full_name FROM profiles WHERE id=%s", (session["teacher_id"],)).fetchone()
    subject_out = {**subject, "student_count": len(rolls)}
    return {
        "session": {**session, "teacher_name": teacher["full_name"] if teacher else None},
        "subject": subject_out,
        "photos": photos,
        "students": students,
        "counts": {
            "total": len(rolls),
            "auto_present": sum(1 for s in students if s["detected"] == "matched"),
            "needs_review": sum(1 for s in students if s["detected"] == "review"),
            "not_seen": sum(1 for s in students if s["detected"] == "not_seen"),
        },
    }


# ============================================================ me / staff
@app.get("/api/me")
def me(user: dict = Depends(current_user)):
    return user


class UserIn(BaseModel):
    email: str = Field(min_length=3, max_length=200, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    full_name: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=8, max_length=72)
    role: str = Field(default="teacher", pattern=r"^(admin|teacher)$")


@app.get("/api/users")
def list_users(user: dict = Depends(require_admin)):
    with get_db() as conn:
        return conn.execute(
            """SELECT p.id::text AS id, p.full_name, p.role, u.email FROM profiles p
               JOIN auth.users u ON u.id = p.id ORDER BY p.created_at""").fetchall()


@app.post("/api/users")
def create_user(body: UserIn, user: dict = Depends(require_admin)):
    email = body.email.strip().lower()
    try:
        uid = supa.admin_create_user(email, body.password, body.full_name.strip())
    except supa.SupabaseError as e:
        raise HTTPException(409 if e.status == 422 else 400, str(e))
    try:
        with get_db() as conn:
            conn.execute("INSERT INTO profiles (id, full_name, role) VALUES (%s,%s,%s)",
                         (uid, body.full_name.strip(), body.role))
            audit(conn, user["id"], "create_user", email=email, role=body.role)
    except Exception:
        supa.admin_delete_user(uid)  # don't leave a login without a profile
        raise
    return {"id": uid}


# ============================================================ students (admin)
@app.get("/api/students")
def list_students(section: str | None = None, user: dict = Depends(current_user)):
    q = """SELECT s.roll_no, s.name, s.section, count(f.id) AS face_count
           FROM students s LEFT JOIN student_faces f ON f.roll_no = s.roll_no"""
    args: tuple = ()
    if section:
        q += " WHERE s.section=%s"
        args = (section,)
    q += " GROUP BY s.roll_no ORDER BY s.section, s.roll_no"
    with get_db() as conn:
        return conn.execute(q, args).fetchall()


def enrol_embeddings(conn, roll_no: str, files: list[tuple[str, bytes]]) -> list[tuple[bytes, np.ndarray]]:
    """Validate admission photos: exactly one clear face each, and the face must not already
    belong to another student (stops one person holding two roll numbers)."""
    eng = get_engine()
    out = []
    for fname, data in files:
        img = decode_image(data)
        if img is None:
            raise HTTPException(400, f"{fname}: not a valid image")
        faces = [f for f in eng.analyze(img, det_size=640) if f.score >= 0.6]
        if not faces:
            raise HTTPException(400, f"{fname}: no face found. Use a clear, front-facing photo.")
        if len(faces) > 1:
            raise HTTPException(400, f"{fname}: {len(faces)} faces found. Admission photo must show only the student.")
        if faces[0].width < config.MIN_ENROL_FACE_PX:
            raise HTTPException(400, f"{fname}: face too small ({int(faces[0].width)}px). Use a closer photo.")
        out.append((data, faces[0].embedding))
    for _, emb in out:
        hit = conn.execute("SELECT roll_no, similarity FROM nearest_face(%s::extensions.vector, %s)",
                           (vec(emb), roll_no)).fetchone()
        if hit and hit["similarity"] >= 0.6:
            raise HTTPException(409, f"This face is already enrolled as roll no {hit['roll_no']} "
                                     f"(similarity {hit['similarity']:.2f}).")
    if len(out) > 1:
        A = np.stack([e for _, e in out])
        if float((A @ A.T).min()) < 0.3:
            raise HTTPException(400, "The uploaded photos do not look like the same person.")
    return out


def save_faces(conn, roll_no: str, items: list[tuple[bytes, np.ndarray]]) -> None:
    safe = re.sub(r"[^A-Za-z0-9_-]", "_", roll_no)
    for data, emb in items:
        path = f"{safe}/{secrets.token_hex(6)}.jpg"
        supa.upload(config.ENROL_BUCKET, path, data)
        conn.execute("INSERT INTO student_faces (roll_no, photo_path, embedding) VALUES (%s,%s,%s::extensions.vector)",
                     (roll_no, path, vec(emb)))


@app.post("/api/students")
def create_student(roll_no: str = Form(...), name: str = Form(...), section: str = Form(...),
                   photos: list[UploadFile] = File(...), user: dict = Depends(require_admin)):
    roll_no, name, section = roll_no.strip(), name.strip(), section.strip().upper()
    if not ROLL_RE.match(roll_no):
        raise HTTPException(400, "Roll no may contain letters, digits, / _ - (max 32)")
    if not name or not section:
        raise HTTPException(400, "Name and section are required")
    files = [(p.filename or "photo", p.file.read()) for p in photos]
    with get_db() as conn:
        if conn.execute("SELECT 1 FROM students WHERE roll_no=%s", (roll_no,)).fetchone():
            raise HTTPException(409, "Roll no already exists")
        items = enrol_embeddings(conn, roll_no, files)
        conn.execute("INSERT INTO students (roll_no, name, section) VALUES (%s,%s,%s)", (roll_no, name, section))
        save_faces(conn, roll_no, items)
        audit(conn, user["id"], "enrol_student", roll_no=roll_no, photos=len(items))
    return {"roll_no": roll_no, "faces": len(items)}


@app.post("/api/students/{roll_no}/photos")
def add_student_photos(roll_no: str, photos: list[UploadFile] = File(...), user: dict = Depends(require_admin)):
    files = [(p.filename or "photo", p.file.read()) for p in photos]
    with get_db() as conn:
        if not conn.execute("SELECT 1 FROM students WHERE roll_no=%s", (roll_no,)).fetchone():
            raise HTTPException(404, "Student not found")
        items = enrol_embeddings(conn, roll_no, files)
        for _, emb in items:
            row = conn.execute(
                "SELECT max(1 - (embedding <=> %s::extensions.vector)) AS s FROM student_faces WHERE roll_no=%s",
                (vec(emb), roll_no)).fetchone()
            if row["s"] is not None and row["s"] < 0.3:
                raise HTTPException(400, "New photo does not look like this student's existing photos.")
        save_faces(conn, roll_no, items)
        audit(conn, user["id"], "add_student_photos", roll_no=roll_no, photos=len(items))
    return {"ok": True}


@app.delete("/api/students/{roll_no}")
def delete_student(roll_no: str, user: dict = Depends(require_admin)):
    with get_db() as conn:
        paths = [r["photo_path"] for r in conn.execute("SELECT photo_path FROM student_faces WHERE roll_no=%s", (roll_no,))]
        if conn.execute("DELETE FROM students WHERE roll_no=%s", (roll_no,)).rowcount == 0:
            raise HTTPException(404, "Student not found")
        audit(conn, user["id"], "delete_student", roll_no=roll_no)
    supa.remove(config.ENROL_BUCKET, paths)  # biometric photos go with the student
    return {"ok": True}


# ============================================================ subjects
class SubjectIn(BaseModel):
    code: str = Field(min_length=1, max_length=20)
    name: str = Field(min_length=1, max_length=80)
    section: str = Field(min_length=1, max_length=20)
    teacher_id: str
    room_name: str | None = None
    room_lat: float | None = Field(default=None, ge=-90, le=90)
    room_lng: float | None = Field(default=None, ge=-180, le=180)
    room_radius_m: float | None = Field(default=None, gt=0, le=5000)


@app.get("/api/subjects")
def list_subjects(user: dict = Depends(current_user)):
    q = """SELECT s.*, s.teacher_id::text AS teacher_id, p.full_name AS teacher_name,
                  (SELECT count(*) FROM students st WHERE st.section = s.section) AS student_count
           FROM subjects s JOIN profiles p ON p.id = s.teacher_id"""
    args: tuple = ()
    if user["role"] != "admin":
        q += " WHERE s.teacher_id=%s"
        args = (user["id"],)
    with get_db() as conn:
        return conn.execute(q + " ORDER BY s.section, s.code", args).fetchall()


@app.post("/api/subjects")
def create_subject(body: SubjectIn, user: dict = Depends(require_admin)):
    if (body.room_lat is None) != (body.room_lng is None):
        raise HTTPException(400, "Give both latitude and longitude, or neither")
    code, section = body.code.strip().upper(), body.section.strip().upper()
    with get_db() as conn:
        if not conn.execute("SELECT 1 FROM profiles WHERE id::text=%s", (body.teacher_id,)).fetchone():
            raise HTTPException(400, "Teacher not found")
        if conn.execute("SELECT 1 FROM subjects WHERE code=%s AND section=%s", (code, section)).fetchone():
            raise HTTPException(409, "This subject code already exists for that section")
        row = conn.execute(
            """INSERT INTO subjects (code, name, section, teacher_id, room_name, room_lat, room_lng, room_radius_m)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
            (code, body.name.strip(), section, body.teacher_id, body.room_name or None, body.room_lat, body.room_lng,
             (body.room_radius_m or 100) if body.room_lat is not None else None)).fetchone()
        audit(conn, user["id"], "create_subject", code=code, section=section)
        return {"id": row["id"]}


@app.delete("/api/subjects/{subject_id}")
def delete_subject(subject_id: int, user: dict = Depends(require_admin)):
    with get_db() as conn:
        paths = conn.execute(
            """SELECT p.file_path, p.annotated_path FROM photos p JOIN sessions s ON s.id = p.session_id
               WHERE s.subject_id=%s""", (subject_id,)).fetchall()
        if conn.execute("DELETE FROM subjects WHERE id=%s", (subject_id,)).rowcount == 0:
            raise HTTPException(404, "Subject not found")
        audit(conn, user["id"], "delete_subject", subject_id=subject_id)
    supa.remove(config.PHOTO_BUCKET, [x for p in paths for x in (p["file_path"], p["annotated_path"])])
    return {"ok": True}


# ============================================================ lectures
class SessionIn(BaseModel):
    subject_id: int


@app.post("/api/sessions")
def start_session(body: SessionIn, user: dict = Depends(current_user)):
    with get_db() as conn:
        subject = get_subject(conn, body.subject_id, user)
        row = conn.execute("INSERT INTO sessions (subject_id, teacher_id) VALUES (%s,%s) RETURNING id",
                           (subject["id"], user["id"])).fetchone()
        audit(conn, user["id"], "start_session", session_id=row["id"], subject=subject["code"])
        return {"id": row["id"]}


@app.get("/api/sessions")
def list_sessions(subject_id: int, user: dict = Depends(current_user)):
    with get_db() as conn:
        get_subject(conn, subject_id, user)
        return conn.execute(
            """SELECT se.*, se.teacher_id::text AS teacher_id,
                      (SELECT count(*) FROM attendance a WHERE a.session_id=se.id AND a.status='present') AS present,
                      (SELECT count(*) FROM photos p WHERE p.session_id=se.id) AS photo_count
               FROM sessions se WHERE subject_id=%s ORDER BY id DESC LIMIT 100""", (subject_id,)).fetchall()


@app.get("/api/sessions/{session_id}")
def session_detail(session_id: int, user: dict = Depends(current_user)):
    with get_db() as conn:
        session, subject = get_session(conn, session_id, user)
        return session_summary(conn, session, subject)


def check_session_open(session: dict) -> None:
    if session["status"] != "open":
        raise HTTPException(409, "Attendance for this lecture is already saved")
    if datetime.now(timezone.utc) - session["started_at"] > timedelta(minutes=config.LECTURE_MAX_MINUTES):
        raise HTTPException(409, f"This lecture was started more than {config.LECTURE_MAX_MINUTES} minutes ago. "
                                 "Start a new lecture.")


@app.post("/api/sessions/{session_id}/capture-token")
def capture_token(session_id: int, user: dict = Depends(current_user)):
    """Issued while the live camera is open. Single use, short-lived."""
    with get_db() as conn:
        session, _ = get_session(conn, session_id, user)
        check_session_open(session)
        tok = secrets.token_urlsafe(24)
        conn.execute("INSERT INTO capture_tokens (token, session_id, expires_at) "
                     "VALUES (%s, %s, now() + make_interval(secs => %s::double precision))",
                     (tok, session_id, config.CAPTURE_TOKEN_TTL_SEC))
        conn.execute("DELETE FROM capture_tokens WHERE expires_at < now() - interval '1 day'")
        return {"token": tok, "expires_in": config.CAPTURE_TOKEN_TTL_SEC}


@app.post("/api/sessions/{session_id}/photos")
def upload_class_photo(session_id: int, request: Request, image: UploadFile = File(...),
                       capture_token: str | None = Form(None), lat: str | None = Form(None), lng: str | None = Form(None),
                       accuracy: str | None = Form(None), user: dict = Depends(current_user)):
    data = image.file.read(config.MAX_UPLOAD_BYTES + 1)
    ip = client_ip(request)
    uploaded = not capture_token  # a saved photo chosen from the device, not a live capture
    with get_db() as conn:
        session, subject = get_session(conn, session_id, user)
        check_session_open(session)
        if config.ALLOWED_IP_PREFIXES and not any(ip.startswith(p) for p in config.ALLOWED_IP_PREFIXES):
            raise HTTPException(403, "Uploads are only allowed from the college network")
        if uploaded and not config.ALLOW_PHOTO_UPLOAD:
            raise HTTPException(403, "Photo upload is turned off. Use the live camera.")
        tok = None
        if not uploaded:
            # live-capture token: burn it now, in its own committed transaction
            tok = conn.execute(
                """UPDATE capture_tokens SET used = true
                   WHERE token=%s AND session_id=%s AND used = false
                   RETURNING expires_at < now() AS expired""", (capture_token, session_id)).fetchone()
    if not uploaded:
        if not tok:
            raise HTTPException(403, "Invalid capture. Photos must be taken with the live camera.")
        if tok["expired"]:
            raise HTTPException(403, "Camera session expired. Reopen the camera and capture again.")

    if len(data) > config.MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Image too large")
    if not uploaded:
        if not data.startswith(b"\xff\xd8"):
            raise HTTPException(400, "Only live JPEG captures are accepted")
        if has_exif(data):
            raise HTTPException(400, "This looks like a saved/gallery photo (camera metadata found). "
                                     "Use the live camera in the app.")
    img = decode_image(data)
    if img is None:
        raise HTTPException(400, "Could not read the image. Use a JPG or PNG photo.")
    if max(img.shape[:2]) < config.MIN_PHOTO_SIDE_PX:
        raise HTTPException(400, f"Image resolution too low (need at least {config.MIN_PHOTO_SIDE_PX}px)")
    sha = hashlib.sha256(data).hexdigest()

    if uploaded:  # store a clean JPEG (also drops EXIF/location metadata from the file)
        stored = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 92])[1].tobytes()
    else:
        stored = data

    flat, flng, facc = parse_float(lat), parse_float(lng), parse_float(accuracy)
    distance = None
    if uploaded:
        # the teacher's position says nothing about where a saved photo was taken: record only
        if flat is None or flng is None or not (-90 <= flat <= 90 and -180 <= flng <= 180):
            flat = flng = facc = None
    elif flat is None or flng is None:
        if config.REQUIRE_LOCATION:
            raise HTTPException(400, "Location is required. Allow location access in the browser.")
        flat = flng = facc = None
    else:
        if not (-90 <= flat <= 90 and -180 <= flng <= 180):
            raise HTTPException(400, "Invalid location")
        if facc is not None and facc > config.MAX_GPS_ACCURACY_M:
            raise HTTPException(400, f"GPS accuracy too low ({facc:.0f} m). Move near a window and retry.")
        if subject["room_lat"] is not None:
            distance = haversine_m(flat, flng, subject["room_lat"], subject["room_lng"])
            allowed = (subject["room_radius_m"] or 100) + min(facc or 0, 50)
            if distance > allowed:
                raise HTTPException(403, f"You are {distance:.0f} m from {subject['room_name'] or 'the classroom'}. "
                                         "Attendance can only be taken inside the classroom.")

    with get_db() as conn:
        if conn.execute("SELECT 1 FROM photos WHERE sha256=%s", (sha,)).fetchone():
            raise HTTPException(409, "This exact photo was already uploaded")
        faces = get_engine().analyze_classroom(img)
        if not faces:
            raise HTTPException(422, "No faces detected. Make sure the class is visible and well lit.")
        rolls, _, E, owners = section_gallery(conn, subject["section"])
        matches = match_faces(faces, rolls, E, owners)

        now = local_now()
        base = f"{session_id}/{now.strftime('%Y%m%d_%H%M%S')}_{sha[:10]}"
        loc = "uploaded photo" if uploaded else (f"{flat:.5f},{flng:.5f}" if flat is not None else "no GPS")
        banner = f"{subject['code']} {subject['section']} | {now.strftime('%Y-%m-%d %H:%M:%S %Z')} | {loc}"
        ok, ann = cv2.imencode(".jpg", annotate(img, faces, matches, banner), [cv2.IMWRITE_JPEG_QUALITY, 85])
        supa.upload(config.PHOTO_BUCKET, f"{base}.jpg", stored)
        supa.upload(config.PHOTO_BUCKET, f"{base}_annotated.jpg", ann.tobytes())

        photo_id = conn.execute(
            """INSERT INTO photos (session_id, file_path, annotated_path, sha256, lat, lng, accuracy_m, distance_m,
                                   client_ip, user_agent, faces_detected)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
            (session_id, f"{base}.jpg", f"{base}_annotated.jpg", sha, flat, flng, facc, distance, ip,
             request.headers.get("user-agent", "")[:300], len(faces))).fetchone()["id"]
        with conn.cursor() as cur:
            cur.executemany(
                "INSERT INTO detections (photo_id, box, det_score, roll_no, similarity, status) VALUES (%s,%s,%s,%s,%s,%s)",
                [(photo_id, [float(v) for v in f.box], float(f.score), m["roll_no"], m["similarity"], m["status"])
                 for f, m in zip(faces, matches)])
        n = {k: sum(m["status"] == k for m in matches) for k in ("matched", "review", "unknown")}
        audit(conn, user["id"], "upload_photo", session_id=session_id, photo_id=photo_id, faces=len(faces),
              mode="upload" if uploaded else "live", **n)
        summary = session_summary(conn, session, subject)
        summary["last_photo"] = {"id": photo_id, "faces": len(faces), **n}
        return summary


@app.get("/api/photos/{photo_id}/{kind}")
def get_photo(photo_id: int, kind: str, user: dict = Depends(current_user)):
    if kind not in ("annotated", "original"):
        raise HTTPException(404)
    with get_db() as conn:
        p = conn.execute("SELECT * FROM photos WHERE id=%s", (photo_id,)).fetchone()
        if not p:
            raise HTTPException(404, "Photo not found")
        get_session(conn, p["session_id"], user)  # access check
    data = supa.download(config.PHOTO_BUCKET, p["annotated_path"] if kind == "annotated" else p["file_path"])
    return Response(content=data, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})


class FinalizeIn(BaseModel):
    present: list[str]


@app.post("/api/sessions/{session_id}/finalize")
def finalize(session_id: int, body: FinalizeIn, user: dict = Depends(current_user)):
    with get_db() as conn:
        session, subject = get_session(conn, session_id, user)
        if session["status"] == "finalized" and user["role"] != "admin":
            raise HTTPException(409, "Already saved. Only an admin can change it now.")
        if not conn.execute("SELECT 1 FROM photos WHERE session_id=%s", (session_id,)).fetchone():
            raise HTTPException(400, "Take at least one class photo before saving attendance")
        by_roll = {s["roll_no"]: s for s in session_summary(conn, session, subject)["students"]}
        present = set(body.present)
        unknown = present - by_roll.keys()
        if unknown:
            raise HTTPException(400, f"Not in section {subject['section']}: {', '.join(sorted(unknown))}")
        overrides, rows = [], []
        for roll, s in by_roll.items():
            is_present = roll in present
            auto = s["detected"] == "matched"
            source = "auto" if is_present == auto and s["detected"] != "review" else "teacher"
            if source == "teacher":
                overrides.append({"roll_no": roll, "detected": s["detected"], "marked": "present" if is_present else "absent"})
            rows.append((session_id, roll, "present" if is_present else "absent", s["similarity"], source))
        with conn.cursor() as cur:
            cur.executemany(
                """INSERT INTO attendance (session_id, roll_no, status, similarity, source) VALUES (%s,%s,%s,%s,%s)
                   ON CONFLICT (session_id, roll_no) DO UPDATE SET status=excluded.status,
                   similarity=excluded.similarity, source=excluded.source""", rows)
        conn.execute("UPDATE sessions SET status='finalized', finalized_at=now() WHERE id=%s", (session_id,))
        audit(conn, user["id"], "finalize_session", session_id=session_id, present=len(present),
              total=len(by_roll), teacher_overrides=overrides)
        session, subject = get_session(conn, session_id, user)
        return session_summary(conn, session, subject)


# ============================================================ reports
@app.get("/api/reports/subject/{subject_id}")
def subject_report(subject_id: int, user: dict = Depends(current_user)):
    with get_db() as conn:
        subject = get_subject(conn, subject_id, user)
        total = conn.execute("SELECT count(*) AS n FROM sessions WHERE subject_id=%s AND status='finalized'",
                             (subject_id,)).fetchone()["n"]
        rows = conn.execute(
            """SELECT st.roll_no, st.name, count(a.roll_no) FILTER (WHERE a.status='present') AS attended
               FROM students st
               LEFT JOIN attendance a ON a.roll_no = st.roll_no
                    AND a.session_id IN (SELECT id FROM sessions WHERE subject_id=%s AND status='finalized')
               WHERE st.section=%s GROUP BY st.roll_no, st.name ORDER BY st.roll_no""",
            (subject_id, subject["section"])).fetchall()
        students = [{**r, "total": total, "percent": round(100 * r["attended"] / total, 1) if total else None} for r in rows]
        return {"subject": subject, "lectures": total, "students": students}


@app.get("/api/reports/student/{roll_no}")
def student_report(roll_no: str, user: dict = Depends(current_user)):
    with get_db() as conn:
        st = conn.execute("SELECT roll_no, name, section FROM students WHERE roll_no=%s", (roll_no,)).fetchone()
        if not st:
            raise HTTPException(404, "Student not found")
        q = """SELECT su.code, su.name,
                      (SELECT count(*) FROM sessions s WHERE s.subject_id=su.id AND s.status='finalized') AS total,
                      (SELECT count(*) FROM attendance a JOIN sessions s ON s.id=a.session_id
                        WHERE s.subject_id=su.id AND s.status='finalized' AND a.roll_no=%s AND a.status='present') AS attended
               FROM subjects su WHERE su.section=%s"""
        args: tuple = (roll_no, st["section"])
        if user["role"] != "admin":
            q += " AND su.teacher_id=%s"
            args += (user["id"],)
        subjects = [{**r, "percent": round(100 * r["attended"] / r["total"], 1) if r["total"] else None}
                    for r in conn.execute(q + " ORDER BY su.code", args)]
        return {"student": st, "subjects": subjects}


@app.get("/api/config")
def public_config():
    return {"match_threshold": config.MATCH_THRESHOLD, "review_threshold": config.REVIEW_THRESHOLD,
            "require_location": config.REQUIRE_LOCATION, "capture_token_ttl": config.CAPTURE_TOKEN_TTL_SEC,
            "allow_photo_upload": config.ALLOW_PHOTO_UPLOAD}


@app.get("/api/health")
def health():
    return {"service": "SmartAttend API", **STATUS}
