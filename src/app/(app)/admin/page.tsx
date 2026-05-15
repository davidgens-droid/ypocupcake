import { redirect } from "next/navigation"

import { requireCurrentMember } from "@/lib/auth/current-member"

export default async function AdminIndex() {
  const me = await requireCurrentMember()
  redirect(me.is_admin ? "/admin/members" : "/admin/meetings")
}
