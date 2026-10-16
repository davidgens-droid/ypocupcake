import { redirect } from "next/navigation"

import { ForumSettingsForm } from "@/components/app/admin/forum-settings-form"
import { requireCurrentMember } from "@/lib/auth/current-member"

export default async function AdminSettingsPage() {
  const me = await requireCurrentMember()
  if (!me.is_admin) redirect("/admin/meetings")

  // Server-side list so the <select> renders identically on both ends.
  const timezones = Intl.supportedValuesOf("timeZone")

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-heading text-base font-semibold">Forum settings</h2>
        <p className="text-sm text-muted-foreground">
          Your forum&apos;s name and the timezone its meetings are scheduled in.
          Admins only.
        </p>
      </div>

      <ForumSettingsForm
        name={me.forum.name}
        timezone={me.forum.timezone}
        timezones={timezones}
      />
    </div>
  )
}
