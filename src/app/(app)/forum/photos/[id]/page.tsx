import Link from "next/link"
import Image from "next/image"
import { format, parseISO, formatDistanceToNow } from "date-fns"
import { ChevronLeft, Trash2 } from "lucide-react"
import { notFound } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ReactionBar } from "@/components/app/photos/reaction-bar"
import { CommentForm } from "@/components/app/photos/comment-form"
import { deleteComment, deletePhoto } from "@/lib/photos/actions"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"

type Params = Promise<{ id: string }>

export default async function PhotoDetailPage({ params }: { params: Params }) {
  const me = await requireCurrentMember()
  const { id } = await params
  const supabase = await createClient()

  const { data: photo } = await supabase
    .from("photos")
    .select("id, uploader_member_id, storage_path, caption, uploaded_at")
    .eq("id", id)
    .maybeSingle()
  if (!photo) notFound()

  const [{ data: members }, { data: reactions }, { data: comments }, signed] =
    await Promise.all([
      supabase.from("members").select("id, name"),
      supabase
        .from("photo_reactions")
        .select("member_id, emoji")
        .eq("photo_id", id),
      supabase
        .from("photo_comments")
        .select("id, member_id, body, created_at")
        .eq("photo_id", id)
        .order("created_at", { ascending: true }),
      supabase.storage
        .from("photos")
        .createSignedUrl(photo.storage_path, 60 * 60),
    ])

  const memberName = new Map((members ?? []).map((m) => [m.id, m.name]))
  const url = signed.data?.signedUrl ?? null
  const uploader = memberName.get(photo.uploader_member_id) ?? "—"
  const isMine = photo.uploader_member_id === me.id

  return (
    <div className="space-y-4">
      <Button size="sm" variant="ghost" render={<Link href="/forum/photos" />}>
        <ChevronLeft className="size-4" /> Photo Gallery
      </Button>

      <div className="overflow-hidden rounded-lg border bg-muted">
        {url && (
          <div className="relative w-full" style={{ aspectRatio: "4/3" }}>
            <Image
              src={url}
              alt={photo.caption ?? ""}
              fill
              className="object-contain"
              sizes="(min-width: 768px) 600px, 100vw"
              unoptimized
            />
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-sm">
          <span className="font-medium">{uploader}</span>
          <span className="ml-2 text-xs text-muted-foreground">
            {format(parseISO(photo.uploaded_at), "MMM d, yyyy")}
          </span>
        </p>
        {photo.caption && <p className="text-sm">{photo.caption}</p>}
      </div>

      <ReactionBar
        photoId={photo.id}
        currentMemberId={me.id}
        reactions={reactions ?? []}
      />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">
          Comments ({comments?.length ?? 0})
        </h2>
        <ul className="space-y-2">
          {(comments ?? []).map((c) => {
            const isMineComment = c.member_id === me.id
            return (
              <li key={c.id}>
                <Card>
                  <CardContent className="flex items-start justify-between gap-2 py-3 text-sm">
                    <div className="space-y-0.5">
                      <p>
                        <span className="font-medium">
                          {memberName.get(c.member_id) ?? "—"}
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {formatDistanceToNow(parseISO(c.created_at), {
                            addSuffix: true,
                          })}
                        </span>
                      </p>
                      <p className="whitespace-pre-line">{c.body}</p>
                    </div>
                    {isMineComment && (
                      <form action={deleteComment}>
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="photo_id" value={photo.id} />
                        <Button
                          type="submit"
                          size="sm"
                          variant="ghost"
                          title="Delete comment"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </form>
                    )}
                  </CardContent>
                </Card>
              </li>
            )
          })}
        </ul>
        <CommentForm photoId={photo.id} />
      </section>

      {isMine && (
        <section className="border-t pt-4">
          <form action={deletePhoto}>
            <input type="hidden" name="id" value={photo.id} />
            <Button type="submit" size="sm" variant="outline">
              <Trash2 className="size-4" /> Delete photo
            </Button>
          </form>
        </section>
      )}
    </div>
  )
}
