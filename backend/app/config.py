"""Settings, all from environment variables (Hugging Face Space → Settings → Variables and secrets)."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent          # backend/ (the Space root)
MODEL_DIR = Path(os.getenv("MODEL_DIR", BASE_DIR / "models" / "buffalo_l"))
DEMO_DIR = BASE_DIR / "demo"


def _env_float(name: str, default: float) -> float:
    return float(os.getenv(name, default))


def _env_bool(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


# ---- Supabase (secrets) ----
SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
SUPABASE_SECRET_KEY = os.getenv("SUPABASE_SECRET_KEY", "").strip()   # secret / service_role key
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()                 # Session pooler connection string


def database_url_problem() -> str | None:
    """Plain-language check of the DATABASE_URL secret (never echoes the password)."""
    from urllib.parse import urlsplit
    u = DATABASE_URL
    if not u:
        return None
    if "[" in u or "]" in u:
        return "DATABASE_URL still contains [ ] brackets - replace [YOUR-PASSWORD] including the brackets"
    if not u.startswith(("postgresql://", "postgres://")):
        return "DATABASE_URL must start with postgresql://"
    if u.count("@") != 1:
        return "DATABASE_URL has more than one @ - an @ in the password must be written as %40"
    host = urlsplit(u).hostname or ""
    if host.startswith("db.") and host.endswith(".supabase.co"):
        return "DATABASE_URL is the Direct connection - use Connect > Session pooler instead (Hugging Face has no IPv6)"
    return None


REQUIRED_SECRETS = {"SUPABASE_URL": SUPABASE_URL, "SUPABASE_SECRET_KEY": SUPABASE_SECRET_KEY,
                    "DATABASE_URL": DATABASE_URL}

ENROL_BUCKET = "enrolment"
PHOTO_BUCKET = "class-photos"

# Browser origins allowed to call the API (your Vercel URL). Comma-separated.
ALLOWED_ORIGINS = [o.strip().rstrip("/") for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",") if o.strip()]

# Load the 30 demo students + 4 subjects on start-up if the database has no students yet.
SEED_DEMO = _env_bool("SEED_DEMO", False)
# Password for the 4 demo teacher accounts the seed creates (Space secret). Unset = no demo teachers.
DEMO_TEACHER_PASSWORD = os.getenv("DEMO_TEACHER_PASSWORD", "").strip()

# Time zone used for the time stamp burned into evidence photos.
TIMEZONE = os.getenv("TIMEZONE", "Asia/Kolkata")

# Cosine-similarity thresholds for ArcFace embeddings
MATCH_THRESHOLD = _env_float("MATCH_THRESHOLD", 0.50)    # >= : marked present automatically
REVIEW_THRESHOLD = _env_float("REVIEW_THRESHOLD", 0.30)  # >= : teacher must confirm

# Live-capture rules
CAPTURE_TOKEN_TTL_SEC = int(os.getenv("CAPTURE_TOKEN_TTL_SEC", 120))
LECTURE_MAX_MINUTES = int(os.getenv("LECTURE_MAX_MINUTES", 120))
REQUIRE_LOCATION = _env_bool("REQUIRE_LOCATION", True)
# Let teachers upload a saved class photo instead of using the live camera.
# Uploads skip the live-capture and location checks, so set to 0 for strict live-only mode.
ALLOW_PHOTO_UPLOAD = _env_bool("ALLOW_PHOTO_UPLOAD", True)
MAX_GPS_ACCURACY_M = _env_float("MAX_GPS_ACCURACY_M", 200)
ALLOWED_IP_PREFIXES = [p.strip() for p in os.getenv("ALLOWED_IP_PREFIXES", "").split(",") if p.strip()]
MIN_PHOTO_SIDE_PX = int(os.getenv("MIN_PHOTO_SIDE_PX", 640))
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", 15 * 1024 * 1024))

# Enrolment rules
MIN_ENROL_FACE_PX = int(os.getenv("MIN_ENROL_FACE_PX", 60))
