"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"
import { ENVELOPE_RE, MAX_ENVELOPE_CHARS } from "@/lib/updates/envelope"

export type ActionResult = { ok: true } | { ok: false; error: string }

const cardsSchema = z.object({
  sourceUpdateCount: z.number().int().min(1),
  keyId: z.string().uuid(),
  cards: z
    .array(
      z.object({
        id: z.string().uuid(),
        payloadEnc: z.string().max(MAX_ENVELOPE_CHARS).regex(ENVELOPE_RE),
      })
    )
    .max(3),
})

/** Store device-encrypted pattern cards (ids generated on the device, bound into the ciphertext). */
export async function savePatternCards(input: {
  sourceUpdateCount: number
  keyId: string
  cards: { id: string; payloadEnc: string }[]
}): Promise<ActionResult> {
  const me = await requireCurrentMember()
  const parsed = cardsSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: "Bad card data." }
  const supabase = await createClient()
  // Never store cards encrypted with a key that is no longer the member's current one.
  const { data: current } = await supabase.from("member_key_wraps").select("id").eq("member_id", me.id).eq("key_id", parsed.data.keyId).limit(1).maybeSingle()
  if (!current) return { ok: false, error: "This device is using an old key. Lock and unlock again." }
  if (parsed.data.cards.length === 0) return { ok: true }
  const { error } = await supabase.from("ai_pattern_cards").insert(
    parsed.data.cards.map((c) => ({
      id: c.id,
      member_id: me.id,
      payload_enc: c.payloadEnc,
      source_update_count: parsed.data.sourceUpdateCount,
    }))
  )
  if (error) return { ok: false, error: "Couldn't save the pattern cards." }
  revalidatePath("/dashboard")
  return { ok: true }
}

export async function dismissPatternCard(id: string): Promise<ActionResult> {
  const me = await requireCurrentMember()
  const parsed = z.string().uuid().safeParse(id)
  if (!parsed.success) return { ok: false, error: "Bad card id." }
  const supabase = await createClient()
  const { error } = await supabase
    .from("ai_pattern_cards")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("id", parsed.data)
    .eq("member_id", me.id)
  if (error) return { ok: false, error: "Couldn't dismiss the card." }
  revalidatePath("/dashboard")
  return { ok: true }
}
