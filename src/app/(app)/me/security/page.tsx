import { SecuritySettings } from "@/components/app/security/security-settings"
import { requireCurrentMember } from "@/lib/auth/current-member"

export default async function SecurityPage() {
  const me = await requireCurrentMember()
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-heading text-2xl font-semibold">Security</h1>
        <p className="text-sm text-muted-foreground">
          Your updates are encrypted on your own devices. Manage how you unlock
          them here.
        </p>
      </header>
      <SecuritySettings member={{ id: me.id, email: me.email, name: me.name, forumName: me.forum.name }} />
    </div>
  )
}
