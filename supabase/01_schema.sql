-- =====================================================================
-- SmartAttend — Supabase schema
-- Run once in Supabase → SQL Editor → New query → paste → Run.
-- Safe to re-run: everything uses IF NOT EXISTS / ON CONFLICT.
--
-- Security model
--   * The browser only uses Supabase to LOG IN (anon key).
--   * All data is read/written by the backend (Hugging Face Space) with the
--     service_role key, which bypasses RLS.
--   * Every table has Row Level Security ON and NO policies, so the public
--     anon key cannot read or change any table directly.
--   * Face photos live in PRIVATE storage buckets.
-- =====================================================================

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------
-- Staff accounts (one row per Supabase Auth user who may use the app)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
    id         uuid primary key references auth.users (id) on delete cascade,
    full_name  text not null,
    role       text not null check (role in ('admin', 'teacher')),
    created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Students and their face embeddings (ArcFace, 512 numbers each)
-- ---------------------------------------------------------------------
create table if not exists public.students (
    roll_no    text primary key check (roll_no ~ '^[A-Za-z0-9][A-Za-z0-9/_-]{0,31}$'),
    name       text not null,
    section    text not null,
    created_at timestamptz not null default now()
);
create index if not exists idx_students_section on public.students (section);

create table if not exists public.student_faces (
    id         bigint generated always as identity primary key,
    roll_no    text not null references public.students (roll_no) on delete cascade,
    photo_path text not null,                       -- path inside the 'enrolment' bucket
    embedding  extensions.vector(512) not null,
    created_at timestamptz not null default now()
);
create index if not exists idx_faces_roll on public.student_faces (roll_no);
create index if not exists idx_faces_embedding on public.student_faces
    using hnsw (embedding extensions.vector_cosine_ops);

-- ---------------------------------------------------------------------
-- Subjects (A, B, C, D… per section) with optional classroom geofence
-- ---------------------------------------------------------------------
create table if not exists public.subjects (
    id            bigint generated always as identity primary key,
    code          text not null,
    name          text not null,
    section       text not null,
    teacher_id    uuid not null references public.profiles (id),
    room_name     text,
    room_lat      double precision check (room_lat between -90 and 90),
    room_lng      double precision check (room_lng between -180 and 180),
    room_radius_m double precision check (room_radius_m > 0 and room_radius_m <= 5000),
    unique (code, section),
    check ((room_lat is null) = (room_lng is null))
);
create index if not exists idx_subjects_teacher on public.subjects (teacher_id);

-- ---------------------------------------------------------------------
-- Lectures, live-capture tokens, photos, detections, attendance
-- ---------------------------------------------------------------------
create table if not exists public.sessions (
    id           bigint generated always as identity primary key,
    subject_id   bigint not null references public.subjects (id) on delete cascade,
    teacher_id   uuid not null references public.profiles (id),
    started_at   timestamptz not null default now(),
    status       text not null default 'open' check (status in ('open', 'finalized')),
    finalized_at timestamptz
);
create index if not exists idx_sessions_subject on public.sessions (subject_id, started_at desc);

create table if not exists public.capture_tokens (
    token      text primary key,
    session_id bigint not null references public.sessions (id) on delete cascade,
    issued_at  timestamptz not null default now(),
    expires_at timestamptz not null,
    used       boolean not null default false
);
create index if not exists idx_tokens_expiry on public.capture_tokens (expires_at);

create table if not exists public.photos (
    id             bigint generated always as identity primary key,
    session_id     bigint not null references public.sessions (id) on delete cascade,
    file_path      text not null,                   -- original, in 'class-photos' bucket
    annotated_path text not null,                   -- copy with boxes + time/place stamp
    sha256         text not null unique,            -- blocks re-uploading the same photo
    captured_at    timestamptz not null default now(),
    lat            double precision,
    lng            double precision,
    accuracy_m     double precision,
    distance_m     double precision,
    client_ip      text,
    user_agent     text,
    faces_detected integer not null
);
create index if not exists idx_photos_session on public.photos (session_id);

create table if not exists public.detections (
    id         bigint generated always as identity primary key,
    photo_id   bigint not null references public.photos (id) on delete cascade,
    box        real[] not null,                    -- [x1, y1, x2, y2] in pixels
    det_score  real not null,
    roll_no    text references public.students (roll_no) on delete set null,
    similarity real,
    status     text not null check (status in ('matched', 'review', 'unknown'))
);
create index if not exists idx_detections_photo on public.detections (photo_id);

create table if not exists public.attendance (
    session_id bigint not null references public.sessions (id) on delete cascade,
    roll_no    text not null references public.students (roll_no) on delete cascade,
    status     text not null check (status in ('present', 'absent')),
    similarity real,
    source     text not null check (source in ('auto', 'teacher')),
    primary key (session_id, roll_no)
);
create index if not exists idx_attendance_roll on public.attendance (roll_no);

create table if not exists public.audit_log (
    id      bigint generated always as identity primary key,
    ts      timestamptz not null default now(),
    user_id uuid,
    action  text not null,
    details jsonb
);
create index if not exists idx_audit_ts on public.audit_log (ts desc);

-- ---------------------------------------------------------------------
-- Face search: closest enrolled face to a new one (duplicate-identity check)
-- ---------------------------------------------------------------------
create or replace function public.nearest_face(query extensions.vector(512), exclude_roll text default null)
returns table (roll_no text, similarity double precision)
language sql stable
set search_path = public, extensions
as $$
    select f.roll_no, 1 - (f.embedding <=> query) as similarity
    from public.student_faces f
    where exclude_roll is null or f.roll_no <> exclude_roll
    order by f.embedding <=> query
    limit 1;
$$;

-- ---------------------------------------------------------------------
-- Lock everything down: RLS on, no policies, no grants to browser roles
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
    foreach t in array array['profiles', 'students', 'student_faces', 'subjects', 'sessions',
                             'capture_tokens', 'photos', 'detections', 'attendance', 'audit_log']
    loop
        execute format('alter table public.%I enable row level security', t);
        execute format('revoke all on public.%I from anon, authenticated', t);
    end loop;
end $$;
revoke execute on function public.nearest_face(extensions.vector, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Private storage for face photos (only the backend's service key can access)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
    ('enrolment',    'enrolment',    false, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
    ('class-photos', 'class-photos', false, 15728640, array['image/jpeg'])
on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;
