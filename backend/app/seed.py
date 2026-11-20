"""Demo data: subjects A–D, one demo teacher per subject, and 30 demo students (AI-generated faces).

Runs at start-up when the Space variable SEED_DEMO=1. Every step is safe to repeat:
- subjects are created if missing;
- the 4 demo teachers are created if missing (needs the DEMO_TEACHER_PASSWORD secret), and each
  demo subject is assigned to its teacher;
- students are loaded only when the database has none.
Turn SEED_DEMO off afterwards.
"""
import csv
import traceback

from fastapi import HTTPException

from . import config, supa
from .db import audit, get_db

SUBJECTS = [
    ("CS301", "A - Data Structures"),
    ("CS302", "B - Operating Systems"),
    ("CS303", "C - Database Systems"),
    ("CS304", "D - Computer Networks"),
]
SECTION = "CSE-3B"

# subject code -> (teacher name, login email). example.com is reserved for examples: no real inbox.
DEMO_TEACHERS = {
    "CS301": ("Prof. Ananya Rao", "ds.teacher@example.com"),
    "CS302": ("Prof. Vikram Sethi", "os.teacher@example.com"),
    "CS303": ("Prof. Meera Iyer", "dbms.teacher@example.com"),
    "CS304": ("Prof. Rohan Kapoor", "cn.teacher@example.com"),
}


def seed_teachers() -> str:
    pw = config.DEMO_TEACHER_PASSWORD
    if not pw:
        return "demo teachers skipped (set the DEMO_TEACHER_PASSWORD secret)"
    if len(pw) < 8:
        return "demo teachers skipped (DEMO_TEACHER_PASSWORD must be at least 8 characters)"
    created = 0
    for code, (name, email) in DEMO_TEACHERS.items():
        with get_db() as conn:
            row = conn.execute("SELECT id::text AS id FROM auth.users WHERE lower(email)=%s", (email,)).fetchone()
        if row:
            uid = row["id"]
        else:
            uid = supa.admin_create_user(email, pw, name)
            created += 1
        with get_db() as conn:
            conn.execute("INSERT INTO profiles (id, full_name, role) VALUES (%s,%s,'teacher') ON CONFLICT (id) DO NOTHING",
                         (uid, name))
            conn.execute("UPDATE subjects SET teacher_id=%s WHERE code=%s AND section=%s", (uid, code, SECTION))
            if not row:
                audit(conn, None, "seed_teacher", email=email, subject=code)
    return f"{len(DEMO_TEACHERS)} demo teachers ready ({created} new)"


def seed_students(status: dict) -> str:
    from .main import enrol_embeddings, save_faces  # late import: main imports this module lazily too
    with get_db() as conn:
        if conn.execute("SELECT count(*) AS n FROM students").fetchone()["n"] > 0:
            return "students already exist"
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
            status["seed"] = f"running: students {added}/{len(students)}"
        except HTTPException as e:
            skipped.append(f"{st['roll_no']}: {e.detail}")
    return f"{added} students added" + (f", skipped {skipped}" if skipped else "")


def seed_demo(status: dict) -> None:
    try:
        with get_db() as conn:
            admin = conn.execute("SELECT id::text AS id FROM profiles WHERE role='admin' ORDER BY created_at LIMIT 1").fetchone()
            if not admin:
                status["seed"] = "skipped: create the first admin (supabase/02_first_admin.sql) and restart"
                return
            for code, name in SUBJECTS:
                conn.execute("""INSERT INTO subjects (code, name, section, teacher_id, room_name)
                                VALUES (%s,%s,%s,%s,'Room 204') ON CONFLICT (code, section) DO NOTHING""",
                             (code, name, SECTION, admin["id"]))
        status["seed"] = "running: teachers"
        try:
            teachers = seed_teachers()
        except Exception as e:  # don't block the students on a teacher problem
            traceback.print_exc()
            teachers = f"demo teachers error: {str(e)[:200]}"
        status["seed"] = "running: students"
        students = seed_students(status)
        status["seed"] = f"done: {teachers}; {students}"
        print(status["seed"], flush=True)
    except Exception as e:
        traceback.print_exc()
        status["seed"] = f"error: {type(e).__name__}: {str(e)[:200]}"
