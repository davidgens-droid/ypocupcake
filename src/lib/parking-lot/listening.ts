// Plain module (no "use server"/"use client") shared by the listening-mode
// route handler, the runner (client) and the review UI.

/**
 * First line of the context on every parking-lot item that listening mode
 * suggested. Provenance lives in the item itself (no schema change), and the
 * review screen turns this line into a badge.
 */
export const LISTENING_NOTE = "Suggested by listening mode."

export function splitListeningNote(context: string | null | undefined): {
  fromListening: boolean
  body: string
} {
  if (!context) return { fromListening: false, body: "" }
  if (context.startsWith(LISTENING_NOTE)) {
    return { fromListening: true, body: context.slice(LISTENING_NOTE.length).trim() }
  }
  return { fromListening: false, body: context }
}

/** Longest transcript the extraction accepts (it clips, never rejects). */
export const LISTENING_MAX_CHARS = 40_000

export type ListeningTopic = { topic: string; context: string }
export type ListeningExtractResult =
  | { ok: true; topics: ListeningTopic[] }
  | { ok: false; error: string }
