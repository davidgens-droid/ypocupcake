// Meeting times are rendered in the FORUM's timezone (each forum has one,
// forums.timezone) so they look right regardless of where the server
// (Vercel = UTC) or the member's browser is. For non-meeting dates
// (commitment due dates, upload timestamps), keep using browser-local
// formatting. Server code passes `me.forum.timezone`; client components get
// it as a `timezone` prop. The parameter is required on purpose: a call site
// that forgets it fails to compile instead of silently showing another
// forum's wall-clock time.

import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz"

// How long after a meeting's start time we still treat it as "current"
// (so members can find their update, view the meeting room, etc.).
// Forum meetings run ~3h; 8h gives a generous buffer for late finishes.
export const MEETING_PAST_AFTER_HOURS = 8

/** The value format of `<input type="datetime-local">`. */
export const DATETIME_LOCAL_FORMAT = "yyyy-MM-dd'T'HH:mm"

export function formatMeeting(iso: string, fmt: string, timezone: string): string {
  return formatInTimeZone(iso, timezone, fmt)
}

export function meetingDate(iso: string, timezone: string): Date {
  return toZonedTime(iso, timezone)
}

// Parse a `<input type="datetime-local">` value (e.g. "2026-05-15T18:00")
// as wall-clock time in the forum's zone and return its UTC ISO string.
// Without this, `new Date(local).toISOString()` on a UTC server (Vercel)
// interprets the string as UTC and shifts the meeting by the zone offset.
export function forumLocalInputToISO(local: string, timezone: string): string {
  return fromZonedTime(local, timezone).toISOString()
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
