"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"

/**
 * The member's locked key copies ("wraps"). Spec §4–§5, §10. Everything
 * here moves opaque, already-encrypted material; the server never sees an
 * update key, a passphrase or a recovery code.
 */

export type ActionResult = { ok: true } | { ok: false; error: string }

export type KeyWrap = {
  id: string
  kind: "passkey" | "passphrase" | "recovery"
  credential_id: string | null
  transports: string[] | null
  prf_salt: string | null
  kdf_salt: string | null
  kdf_iterations: number | null
  wrapped_key: string
  label: string | null
  /** Identity of the update key this wrap locks (shared by all wraps of one setup). */
  key_id: string
  created_at: string
  last_used_at: string | null
}

const b64url = (min: number, max: number) => z.string().min(min).max(max).regex(/^[A-Za-z0-9_-]+$/)

const wrapInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("passkey"),
    credential_id: b64url(8, 1024),
    public_key: b64url(16, 4096).nullable(),
    transports: z.array(z.string().max(32)).max(8),
    prf_salt: b64url(16, 128),
    wrapped_key: b64url(40, 200),
    label: z.string().trim().max(80),
  }),
  z.object({
    kind: z.literal("passphrase"),
    kdf_salt: b64url(16, 128),
    kdf_iterations: z.number().int().min(100_000).max(5_000_000),
    wrapped_key: b64url(40, 200),
  }),
  z.object({
    kind: z.literal("recovery"),
    kdf_salt: b64url(16, 128),
    wrapped_key: b64url(40, 200),
  }),
])
export type WrapInput = z.infer<typeof wrapInputSchema>

function friendly(message: string): string {
  if (message.includes("already_set_up")) return "Protection is already set up on this account."
  if (message.includes("invalid_wraps")) return "Something was wrong with the setup data. Please try again."
  if (message.includes("not_member")) return "Your account isn't an active member of a forum."
  if (message.includes("not_authenticated")) return "You're signed out. Sign in and try again."
  if (message.includes("wrap_not_found")) return "That key copy no longer exists."
  return "Something went wrong. Please try again."
}

export async function getMyKeyWraps(): Promise<KeyWrap[]> {
  const me = await requireCurrentMember()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("member_key_wraps")
    .select("id, kind, credential_id, transports, prf_salt, kdf_salt, kdf_iterations, wrapped_key, label, key_id, created_at, last_used_at")
    .eq("member_id", me.id)
    .order("created_at", { ascending: true })
  // Never report "no keys" because the read failed: the caller would offer a
  // fresh setup to a member who already has one.
  if (error) throw new Error("Couldn't load your protection settings.")
  return (data ?? []) as KeyWrap[]
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DB_NOT_READY = "Cupcake's database is missing its latest update (0024). Ask your forum admin to apply it, then set up again."

/** The id of the member's CURRENT update key, or null when not set up. */
export async function getMyKeyId(): Promise<string | null> {
  const me = await requireCurrentMember()
  const supabase = await createClient()
  const { data } = await supabase.from("member_key_wraps").select("key_id").eq("member_id", me.id).limit(1).maybeSingle()
  return (data?.key_id as string | undefined) ?? null
}

export type SetupResult = { ok: true; keyId: string } | { ok: false; error: string; code?: "already_set_up" | "db_not_ready" }

/** First-time setup: all wraps at once, atomically (RPC). Returns the new key id. */
export async function setupMemberKeys(wraps: WrapInput[]): Promise<SetupResult> {
  const me = await requireCurrentMember()
  const parsed = z.array(wrapInputSchema).min(2).max(4).safeParse(wraps)
  if (!parsed.success) return { ok: false, error: "Something was wrong with the setup data. Please try again." }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("setup_member_keys", { p_wraps: parsed.data })
  if (error) {
    return {
      ok: false,
      error: friendly(error.message),
      code: error.message.includes("already_set_up") ? "already_set_up" : undefined,
    }
  }
  if (typeof data !== "string" || !UUID_RE.test(data)) {
    // An older copy of migration 0024 (no key id) is in the database. Undo the
    // half-setup so the member can simply try again once it is applied.
    await supabase.from("member_key_wraps").delete().eq("member_id", me.id)
    return { ok: false, error: DB_NOT_READY, code: "db_not_ready" }
  }
  revalidatePath("/", "layout")
  return { ok: true, keyId: data }
}

/** Register another device's passkey (for the member's current key). */
export async function addPasskeyWrap(wrap: WrapInput): Promise<ActionResult> {
  const me = await requireCurrentMember()
  const parsed = wrapInputSchema.safeParse(wrap)
  if (!parsed.success || parsed.data.kind !== "passkey") return { ok: false, error: "Bad passkey data." }
  const keyId = await getMyKeyId()
  if (!keyId) return { ok: false, error: "Set up protection first." }
  const supabase = await createClient()
  const { error } = await supabase.from("member_key_wraps").insert({ member_id: me.id, key_id: keyId, ...parsed.data })
  if (error) return { ok: false, error: friendly(error.message) }
  revalidatePath("/me/security")
  return { ok: true }
}

/** Set or change the passphrase / recovery code: one of each at most, replaced atomically (RPC). */
export async function replaceKeyWrap(wrap: WrapInput): Promise<ActionResult> {
  await requireCurrentMember()
  const parsed = wrapInputSchema.safeParse(wrap)
  if (!parsed.success || parsed.data.kind === "passkey") return { ok: false, error: "Bad key data." }
  const supabase = await createClient()
  const { error } = await supabase.rpc("replace_member_key_wrap", { p_wrap: parsed.data })
  if (error) return { ok: false, error: friendly(error.message) }
  revalidatePath("/me/security")
  return { ok: true }
}

/** Remove a passkey (or the passphrase) — never the last way in. */
export async function removeKeyWrap(id: string): Promise<ActionResult> {
  const me = await requireCurrentMember()
  const parsed = z.string().uuid().safeParse(id)
  if (!parsed.success) return { ok: false, error: "That key copy no longer exists." }
  const supabase = await createClient()
  const { data: wraps } = await supabase
    .from("member_key_wraps")
    .select("id, kind")
    .eq("member_id", me.id)
  const target = (wraps ?? []).find((w) => w.id === parsed.data)
  if (!target) return { ok: false, error: "That key copy no longer exists." }
  if (target.kind === "recovery") return { ok: false, error: "Generate a new recovery code instead of removing it." }
  const remainingMethods = (wraps ?? []).filter((w) => w.id !== parsed.data && w.kind !== "recovery").length
  if (remainingMethods === 0) {
    return { ok: false, error: "That's your only way to unlock. Add a passphrase or another device first." }
  }
  const { error } = await supabase.from("member_key_wraps").delete().eq("id", parsed.data).eq("member_id", me.id)
  if (error) return { ok: false, error: friendly(error.message) }
  revalidatePath("/me/security")
  return { ok: true }
}

export async function touchKeyWrap(id: string): Promise<void> {
  const me = await requireCurrentMember()
  const parsed = z.string().uuid().safeParse(id)
  if (!parsed.success) return
  const supabase = await createClient()
  await supabase
    .from("member_key_wraps")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", parsed.data)
    .eq("member_id", me.id)
}

/** "Start fresh": the caller's encrypted updates, cards and keys, atomically (RPC). */
export async function resetEncryptedData(confirmation: string): Promise<ActionResult> {
  await requireCurrentMember()
  if (confirmation !== "RESET") return { ok: false, error: "Type RESET to confirm." }
  const supabase = await createClient()
  const { error } = await supabase.rpc("reset_member_encrypted_data")
  if (error) return { ok: false, error: friendly(error.message) }
  revalidatePath("/", "layout")
  return { ok: true }
}
