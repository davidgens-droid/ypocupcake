// Plain module (no "use server"/"use client") shared by the listening-mode
// server action and the review UI.

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
