import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { InviteLinkPanel } from "@/components/app/admin/invite-link-panel"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"

export type InviteLinkRow = {
  id: string
  token: string
  created_at: string
  expires_at: string
  max_uses: number | null
  uses: number
  revoked_at: string | null
}

export default async function AdminInvitePage() {
  const me = await requireCurrentMember()
  if (!me.is_admin) redirect("/admin/meetings")
  const supabase = await createClient()

  const [{ data: links }, { data: joiners }] = await Promise.all([
    supabase
      .from("forum_invite_links")
      .select("id, token, created_at, expires_at, max_uses, uses, revoked_at")
      .eq("forum_id", me.forum_id)
      .order("created_at", { ascending: false })
      .returns<InviteLinkRow[]>(),
    supabase
      .from("members")
      .select("id, name, created_at, joined_via_link_id, status")
      .eq("forum_id", me.forum_id)
      .not("joined_via_link_id", "is", null)
      .order("created_at", { ascending: false }),
  ])

  // The link must carry the public origin members will open it from.
  const h = await headers()
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? ""
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")
  const origin = `${proto}://${host}`

  const now = new Date().getTime()
  const all = links ?? []
  const active =
    all.find(
      (l) =>
        !l.revoked_at &&
        new Date(l.expires_at).getTime() > now &&
        (l.max_uses == null || l.uses < l.max_uses)
    ) ?? null

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-heading text-base font-semibold">Invite link</h2>
        <p className="text-sm text-muted-foreground">
          Share one link with your members; anyone who opens it signs in with
          their email and joins {me.forum.name}. Revoke it any time.
        </p>
      </div>

      <InviteLinkPanel
        origin={origin}
        active={active}
        history={all.filter((l) => l.id !== active?.id)}
        joiners={(joiners ?? []).map((j) => ({
          id: j.id,
          name: j.name,
          joinedAt: j.created_at,
          linkId: j.joined_via_link_id as string,
          status: j.status as string,
        }))}
      />
    </div>
  )
}
