// Cupcake meets in Vancouver — render meeting times in Pacific Time so they
// look right regardless of where the server (Vercel = UTC) or the user's
// browser is. For non-meeting dates (commitment due dates, upload timestamps),
// keep using browser-local formatting.

import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz"

export const FORUM_TZ = "America/Vancouver"

// How long after a meeting's start time we still treat it as "current"
// (so members can find their update, view the meeting room, etc.).
// Forum meetings run ~3h; 8h gives a generous buffer for late finishes.
export const MEETING_PAST_AFTER_HOURS = 8

export function formatMeeting(iso: string, fmt: string): string {
  return formatInTimeZone(iso, FORUM_TZ, fmt)
}

export function meetingDate(iso: string): Date {
  return toZonedTime(iso, FORUM_TZ)
}

// Parse a `<input type="datetime-local">` value (e.g. "2026-05-15T18:00")
// as Vancouver wall-clock time and return its UTC ISO string. Without this,
// `new Date(local).toISOString()` on a UTC server (Vercel) interprets the
// string as UTC and shifts the meeting 7–8 hours earlier.
export function forumLocalInputToISO(local: string): string {
  return fromZonedTime(local, FORUM_TZ).toISOString()
}

// ISO string of the cutoff before which a meeting counts as "past".
// Anything with scheduled_at >= this is still considered current/upcoming.
export function meetingPastCutoffISO(now: Date = new Date()): string {
  return new Date(
    now.getTime() - MEETING_PAST_AFTER_HOURS * 60 * 60 * 1000
  ).toISOString()
}

export function isMeetingPast(iso: string, now: Date = new Date()): boolean {
  return new Date(iso).getTime() < now.getTime() - MEETING_PAST_AFTER_HOURS * 60 * 60 * 1000
}
