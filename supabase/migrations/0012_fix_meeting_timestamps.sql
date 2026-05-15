-- Reinterpret every meeting's stored scheduled_at as Vancouver wall-clock time.
--
-- Background: createMeeting/updateMeeting were doing
--   new Date(parsed.scheduled_at_local).toISOString()
-- on the Vercel server (UTC). That parsed e.g. "2026-05-15T18:00" as 6pm UTC
-- and stored it, when the admin meant 6pm Vancouver. Result: every meeting
-- shifted 7h (PDT) or 8h (PST) earlier than intended.
--
-- This migration takes each stored timestamp, strips the (wrong) UTC label
-- and reinterprets it as Vancouver local time, producing the correct UTC
-- instant. Handles DST automatically per meeting date.
--
-- Safe to run once. After this, all future creates/edits go through the
-- fixed forumLocalInputToISO() helper.

UPDATE meetings
SET scheduled_at = (scheduled_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Vancouver';
