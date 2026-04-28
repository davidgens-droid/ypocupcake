// Cupcake meets in Vancouver — render meeting times in Pacific Time so they
// look right regardless of where the server (Vercel = UTC) or the user's
// browser is. For non-meeting dates (commitment due dates, upload timestamps),
// keep using browser-local formatting.

import { formatInTimeZone, toZonedTime } from "date-fns-tz"

export const FORUM_TZ = "America/Vancouver"

export function formatMeeting(iso: string, fmt: string): string {
  return formatInTimeZone(iso, FORUM_TZ, fmt)
}

export function meetingDate(iso: string): Date {
  return toZonedTime(iso, FORUM_TZ)
}
