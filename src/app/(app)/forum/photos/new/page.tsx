import Link from "next/link"
import { ChevronLeft } from "lucide-react"

import { Button } from "@/components/ui/button"
import { PhotoUploader } from "@/components/app/photos/photo-uploader"
import { requireCurrentMember } from "@/lib/auth/current-member"

export default async function UploadPhotoPage() {
  const me = await requireCurrentMember()
  return (
    <div className="space-y-4">
      <Button
        size="sm"
        variant="ghost"
        render={<Link href="/forum/photos" />}
      >
        <ChevronLeft className="size-4" /> Photo Gallery
      </Button>
      <h1 className="font-heading text-2xl font-semibold">Upload photos</h1>
      <PhotoUploader forumId={me.forum_id} uploaderId={me.id} />
    </div>
  )
}
