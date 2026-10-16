// Shared, dependency-free helpers for the forum charter (text and/or an
// uploaded document). Safe to import from server and client code.

export type CharterDocument = {
  path: string
  name: string
  size: number
  type: string
  uploaded_at: string
}

export type CharterSettings = {
  text: string
  document: CharterDocument | null
  updatedAt: string | null
}

/** Reads the charter fields out of forums.settings, tolerating any shape. */
export function parseCharterSettings(settings: unknown): CharterSettings {
  const s = (settings && typeof settings === "object" ? settings : {}) as Record<string, unknown>
  const text = typeof s.charter === "string" ? s.charter : ""
  let document: CharterDocument | null = null
  const d = s.charter_document
  if (d && typeof d === "object") {
    const o = d as Record<string, unknown>
    if (typeof o.path === "string" && typeof o.name === "string") {
      document = {
        path: o.path,
        name: o.name,
        size: typeof o.size === "number" ? o.size : 0,
        type: typeof o.type === "string" ? o.type : "",
        uploaded_at: typeof o.uploaded_at === "string" ? o.uploaded_at : "",
      }
    }
  }
  const updatedAt = typeof s.charter_updated_at === "string" ? s.charter_updated_at : null
  return { text, document, updatedAt }
}

/** Signed URLs for opening the document: short-lived, generated per page view. */
export const CHARTER_SIGNED_URL_TTL = 10 * 60

export const CHARTER_MAX_BYTES = 20 * 1024 * 1024

/** Accepted file types, by extension → the MIME type the bucket allows. */
export const CHARTER_MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
}
export const CHARTER_ACCEPT = Object.keys(CHARTER_MIME_BY_EXT).map((e) => `.${e}`).join(",")

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
