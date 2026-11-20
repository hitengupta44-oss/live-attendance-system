# Supabase setup (about 10 minutes)

## 1. Create the project
supabase.com → **New project**
- Name: `live-attendance`
- Database password: strong; save it in your password manager
- Region: **South Asia (Mumbai)** (keeps student data in India, DPDP Act)
- Plan: Free

Wait about 2 minutes for it to finish setting up.

## 2. Create the tables, face search and private photo storage
**SQL Editor → New query** → paste all of `01_schema.sql` → **Run**.
It should say *Success. No rows returned*.

Check: **Table Editor** lists 10 tables (profiles, students, student_faces, subjects, sessions,
capture_tokens, photos, detections, attendance, audit_log). Each shows an **RLS enabled** badge.
**Storage** lists 2 private buckets: `enrolment` and `class-photos`.

## 3. Turn off public sign-up
**Authentication → Sign In / Providers**
- **Allow new users to sign up: OFF**. Only accounts the admin creates can log in.
- Email provider: ON (default).

## 4. Create yourself as the first admin
1. **Authentication → Users → Add user → Create new user**: your email and a strong password,
   and tick **Auto Confirm User**.
2. **SQL Editor**: open `02_first_admin.sql`, replace the email with yours, then **Run**.
   The last query should show your email with role `admin`.

## 5. Note the 3 values (do NOT paste keys into chat or save them in files)
**Project Settings → API Keys** (and **Data API** for the URL). Keep this tab open; you'll paste them
straight into Hugging Face and Vercel in the next steps:

| Value | Looks like | Goes into | Secret? |
|---|---|---|---|
| Project URL | `https://abcd1234.supabase.co` | Hugging Face Space **and** Vercel | no |
| Publishable key (or legacy **anon** key) | `sb_publishable_…` / `eyJ…` | Vercel | no, it's public by design |
| Secret key (or legacy **service_role** key) | `sb_secret_…` / `eyJ…` | Hugging Face Space **Secrets** only | **YES** |

Then tell Claude "Supabase is ready". You can share the **Project URL**, which isn't secret.
