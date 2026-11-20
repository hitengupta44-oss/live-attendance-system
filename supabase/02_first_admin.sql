-- =====================================================================
-- Make your own login the first SmartAttend admin.
--
-- 1. Supabase → Authentication → Users → "Add user" → "Create new user"
--    Enter YOUR email + a strong password, tick "Auto Confirm User".
-- 2. Replace the email below with that same email, then Run.
-- After this, add every other teacher/admin from the app's Staff page.
-- =====================================================================

insert into public.profiles (id, full_name, role)
select id, 'Administrator', 'admin'
from auth.users
where email = 'REPLACE-WITH-YOUR-EMAIL@example.com'
on conflict (id) do update set role = 'admin';

-- Check: should list exactly one row with role = admin
select p.full_name, p.role, u.email
from public.profiles p join auth.users u on u.id = p.id;
