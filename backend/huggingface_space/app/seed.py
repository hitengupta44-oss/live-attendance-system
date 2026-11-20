"""Load the 30 demo students (AI-generated faces) and subjects A–D.

Runs once at start-up when the Space variable SEED_DEMO=1 and the database has no students.
Demo subjects are assigned to the first admin account. Turn SEED_DEMO off afterwards.
"""
import csv
import traceback

from fastapi import HTTPException

from . import config
from .db import audit, get_db

SUBJECTS = [
    ("CS301", "A - Data Structures"),
    ("CS302", "B - Operating Systems"),
    ("CS303", "C - Database Systems"),
    ("CS304", "D - Computer Networks"),
]
SECTION = "CSE-3B"


def seed_demo(status: dict) -> None:
    from .main import enrol_embeddings, save_faces  # late import: main imports this module lazily too
    try:
        with get_db() as conn:
            if conn.execute("SELECT count(*) AS n FROM students").fetchone()["n"] > 0:
                status["seed"] = "skipped: students already exist"
                return
            admin = conn.execute("SELECT id::text AS id FROM profiles WHERE role='admin' ORDER BY created_at LIMIT 1").fetchone()
            if not admin:
                status["seed"] = "skipped: create the first admin (supabase/02_first_admin.sql) and restart"
                return
            for code, name in SUBJECTS:
                conn.execute("""INSERT INTO subjects (code, name, section, teacher_id, room_name)
                                VALUES (%s,%s,%s,%s,'Room 204') ON CONFLICT (code, section) DO NOTHING""",
                             (code, name, SECTION, admin["id"]))
        status["seed"] = "running"
        with open(config.DEMO_DIR / "students.csv", encoding="utf-8") as f:
            students = list(csv.DictReader(f))
        added, skipped = 0, []
        for st in students:
            photo = config.DEMO_DIR / "photos" / f"{st['roll_no']}.jpg"
            try:
                with get_db() as conn:
                    items = enrol_embeddings(conn, st["roll_no"], [(photo.name, photo.read_bytes())])
                    conn.execute("INSERT INTO students (roll_no, name, section) VALUES (%s,%s,%s)",
                                 (st["roll_no"], st["name"], st["section"]))
                    save_faces(conn, st["roll_no"], items)
                    audit(conn, None, "seed_student", roll_no=st["roll_no"])
                added += 1
                status["seed"] = f"running: {added}/{len(students)}"
            except HTTPException as e:
                skipped.append(f"{st['roll_no']}: {e.detail}")
        status["seed"] = f"done: {added} students added" + (f", skipped {skipped}" if skipped else "")
        print(status["seed"], flush=True)
    except Exception as e:
        traceback.print_exc()
        status["seed"] = f"error: {type(e).__name__}: {str(e)[:200]}"
