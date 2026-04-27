import Link from "next/link"
import Image from "next/image"
import { format, parseISO } from "date-fns"
import { Upload } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"

const SIGNED_URL_TTL_SECONDS = 60 * 60 // 1 hour

export default async function PhotoGalleryPage() {
  await requireCurrentMember()
  const supabase = await createClient()

  const [{ data: photos }, { data: members }] = await Promise.all([
    supabase
      .from("photos")
      .select("id, uploader_member_id, storage_path, caption, uploaded_at")
      .order("uploaded_at", { ascending: false })
      .limit(60),
    supabase.from("members").select("id, name"),
  ])

  const memberName = new Map((members ?? []).map((m) => [m.id, m.name]))

  const signed = await Promise.all(
    (photos ?? []).map(async (p) => {
      // Note: Supabase image transforms require Pro plan; we client-side
      // shrink to 2400px on upload, so serving the original is fine here.
      const { data } = await supabase.storage
        .from("photos")
        .createSignedUrl(p.storage_path, SIGNED_URL_TTL_SECONDS)
      return { ...p, url: data?.signedUrl ?? null }
    })
  )

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Photo Gallery</h1>
          <p className="text-sm text-muted-foreground">
            Forum-shared. Uploads are private to Cupcake.
          </p>
        </div>
        <Button size="sm" render={<Link href="/forum/photos/new" />}>
          <Upload className="size-4" /> Upload
        </Button>
      </header>

      {signed.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nothing in the gallery yet. Be the first to upload.
          </CardContent>
        </Card>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {signed.map((p) => (
            <li key={p.id}>
              <Link
                href={`/forum/photos/${p.id}`}
                className="block overflow-hidden rounded-lg border"
              >
                <div className="relative aspect-square w-full bg-muted">
                  {p.url ? (
                    <Image
                      src={p.url}
                      alt={p.caption ?? ""}
                      fill
                      sizes="(min-width: 640px) 33vw, 50vw"
                      className="object-cover"
                      unoptimized
                    />
                  ) : null}
                </div>
                <div className="px-2 py-1.5 text-xs">
                  <p className="font-medium">
                    {memberName.get(p.uploader_member_id) ?? "—"}
                  </p>
                  <p className="text-muted-foreground">
                    {format(parseISO(p.uploaded_at), "MMM d")}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
