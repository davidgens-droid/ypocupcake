-- Cupcake — extend role_type enum to cover the full slate from the
-- signed Forum Norms (Feb 2026): Secretary, Treasurer, Technology,
-- Retreat Planner, Timekeeper, Forum Norm Observer, Social Coordinator.
--
-- Run this in the Supabase SQL Editor. ALTER TYPE ... ADD VALUE statements
-- cannot be wrapped in a transaction in older Postgres, so each runs alone.

alter type role_type add value if not exists 'secretary';
alter type role_type add value if not exists 'treasurer';
alter type role_type add value if not exists 'technology';
alter type role_type add value if not exists 'retreat_planner';
alter type role_type add value if not exists 'timekeeper';
alter type role_type add value if not exists 'norm_observer';
alter type role_type add value if not exists 'social_coordinator';
