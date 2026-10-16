-- Phase 0 — live-database catalog dump (read-only).
-- Run each statement in the Supabase SQL editor on the PRODUCTION project and
-- paste the results (CSV or JSON download is fine) back into the chat. They
-- are compared with supabase/migrations/* to write 0016_reconcile_live_policies.sql
-- so the repo matches what is actually live before 0017–0020 are applied.

-- 1. Every RLS policy in the public schema.
select tablename, policyname, cmd, permissive, roles, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- 2. Every function in the public schema, with its full definition.
select p.proname, pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by p.proname;

-- 3. Every trigger in the public schema.
select event_object_table, trigger_name, action_timing, event_manipulation, action_statement
from information_schema.triggers
where trigger_schema = 'public'
order by event_object_table, trigger_name;

-- 4. Table-level grants to the app roles (catches out-of-band GRANT/REVOKE).
select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
group by table_name, grantee
order by table_name, grantee;
