# SmartAttend — live classroom attendance with face recognition

The teacher takes a **live** photo of the class in the web app. The system detects every face, matches each
one to the students' admission photos, maps them to roll numbers and marks attendance for that subject's lecture.
Gallery uploads are not possible, and every photo is stamped with server time and GPS location.

## Production setup
| Part | Service | Folder |
|---|---|---|
| Web app (live camera, review, admin, reports) | **Vercel** | `frontend/` |
| API + face recognition | **Hugging Face Space (Gradio SDK, free CPU)** | `backend/` |
| Database (Postgres + pgvector), login, photo storage | **Supabase** (Mumbai region) | `supabase/` |
| AI features (attendance assistant, notices, weekly summary) | **Groq API** | `backend/` |

**Status:** the backend still uses a built-in SQLite database and its own login. The move to Supabase,
Hugging Face and Vercel is in progress.

## Folders
```
frontend/                    web UI: index.html, app.js, style.css
backend/app/face_engine.py   face detection + alignment + ArcFace embeddings (ONNX Runtime)
backend/app/main.py          API: students, subjects, lectures, live-photo upload, save, reports
backend/app/config.py        settings (thresholds, live-capture rules)
backend/app/db.py            database layer (being replaced by Supabase)
backend/app/auth.py          login (being replaced by Supabase Auth)
backend/models/              face models (InsightFace buffalo_l)
backend/demo/                30 AI-generated demo students + 2 test class photos with answer keys
backend/tools/               seed_demo.py (load demo data), make_class_photo.py (make test photos)
supabase/                    database schema (next step)
```

## Keys and secrets
| Value | Where it goes | Secret? |
|---|---|---|
| Supabase Project URL | Vercel env + HF Space secrets | no |
| Supabase anon key | Vercel env (frontend) | no — designed to be public |
| Supabase service_role key | HF Space secrets only | **yes — never in frontend, GitHub or chat** |
| Groq API key | HF Space secrets only | **yes** |

## How recognition works
```
live camera frame ──► SCRFD face detector (finds all faces + 5 landmarks)
                      ──► align each face to 112×112
                      ──► ArcFace ResNet-50 → 512-number face embedding
                      ──► cosine similarity vs. admission-photo embeddings of THAT section only
                      ──► one-to-one assignment → roll no → present
```
| Similarity | Result |
|---|---|
| ≥ 0.50 | ✅ recognised, ticked automatically |
| 0.30 – 0.50 | 🟧 teacher must confirm |
| < 0.30 | ❓ unknown face (not enrolled / outsider) |

Measured on the demo photos: **20/20 correct in both, 0 wrong, 0 missed** (real matches 0.73–0.90; closest two
different students 0.42). The demo faces are edited copies of the admission photos, so this is easier than a real
classroom — run a one-week pilot with real photos before relying on it.

## Anti-proxy checks
| Check | Stops |
|---|---|
| Camera-only capture page (no file picker) | picking a photo from the gallery |
| Single-use capture token (valid 120 s) issued while the camera is open | replaying or scripting old photos |
| EXIF check: phone/gallery photos carry camera metadata, live browser frames don't | uploading saved photos |
| GPS required, accuracy ≤ 200 m, geofence around the room | taking attendance from outside the class |
| Server timestamp; uploads only within 120 min of lecture start | wrong-time photos |
| SHA-256 duplicate check | re-uploading the same photo |
| Enrolment refuses a face already enrolled under another roll no | one person holding two identities |
| Original photo kept as evidence + annotated copy with time/place stamp | disputes |
| Teacher overrides recorded as "manual" + full audit log | silent edits |
| Only admin can change attendance after it is saved | later tampering |

**Honest limit:** a browser app can't fully prove a photo is live. A technical user could fake GPS or script an upload
while the camera page is open. These checks stop casual proxying; a native app with device attestation would be stronger.

## Settings (environment variables)
`MATCH_THRESHOLD` (0.50), `REVIEW_THRESHOLD` (0.30), `CAPTURE_TOKEN_TTL_SEC` (120), `LECTURE_MAX_MINUTES` (120),
`REQUIRE_LOCATION` (true), `MAX_GPS_ACCURACY_M` (200), `ALLOWED_IP_PREFIXES` (empty = any).

## Before real students use it
1. Written consent for face photos (DPDP Act 2023) and an alternative for students who refuse.
2. Delete demo data and demo accounts.
3. One-week pilot alongside a normal roll call.
4. The InsightFace models are licensed for **non-commercial research only** — fine for a college project;
   a commercial deployment needs a licensed model.
5. Set a retention period for class photos.
