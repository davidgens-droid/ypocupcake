"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Upload, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { createClient } from "@/lib/supabase/client"
import { recordPhoto } from "@/lib/photos/actions"

type Props = {
  forumId: string
  uploaderId: string
}

type Pending = {
  file: File
  preview: string
}

const MAX_DIMENSION = 2400

async function stripExifAndShrink(file: File): Promise<Blob> {
  const isJpegOrPng = ["image/jpeg", "image/png", "image/webp"].includes(file.type)
  if (!isJpegOrPng) return file

  const bitmap = await createImageBitmap(file)
  const scale = Math.min(
    1,
    MAX_DIMENSION / Math.max(bitmap.width, bitmap.height)
  )
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")!
  ctx.drawImage(bitmap, 0, 0, w, h)
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Failed to encode image")),
      "image/jpeg",
      0.9
    )
  })
}

export function PhotoUploader({ forumId, uploaderId }: Props) {
  const router = useRouter()
  const [items, setItems] = useState<Pending[]>([])
  const [caption, setCaption] = useState("")
  const [pending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).filter((f) =>
      f.type.startsWith("image/")
    )
    const next: Pending[] = files.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
    }))
    setItems((prev) => [...prev, ...next])
    if (inputRef.current) inputRef.current.value = ""
  }

  function removeAt(i: number) {
    setItems((prev) => {
      URL.revokeObjectURL(prev[i].preview)
      return prev.filter((_, idx) => idx !== i)
    })
  }

  async function uploadOne(p: Pending) {
    const supabase = createClient()
    const blob = await stripExifAndShrink(p.file)
    const id = crypto.randomUUID()
    const ext = "jpg"
    const path = `${forumId}/${uploaderId}/${id}.${ext}`

    const { error } = await supabase.storage
      .from("photos")
      .upload(path, blob, {
        contentType: "image/jpeg",
        upsert: false,
      })
    if (error) throw error

    await recordPhoto({
      storage_path: path,
      caption,
      tags: [],
    })
  }

  function onUpload() {
    if (items.length === 0) return
    startTransition(async () => {
      try {
        for (const p of items) {
          await uploadOne(p)
        }
        toast.success(`Uploaded ${items.length} photo${items.length === 1 ? "" : "s"}.`)
        router.push("/forum/photos")
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed.")
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {items.map((p, i) => (
          <div
            key={p.preview}
            className="relative aspect-square overflow-hidden rounded-md border"
          >
            <img
              src={p.preview}
              alt=""
              className="size-full object-cover"
            />
            <button
              type="button"
              onClick={() => removeAt(i)}
              className="absolute right-1 top-1 rounded-full bg-background/90 p-1 hover:bg-background"
              aria-label="Remove"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
        <label
          htmlFor="picker"
          className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed text-xs text-muted-foreground hover:bg-muted/50"
        >
          <Upload className="size-4" /> Add
        </label>
      </div>
      <input
        ref={inputRef}
        id="picker"
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={onPick}
      />

      <div className="space-y-2">
        <Label htmlFor="caption">Caption (applies to all selected)</Label>
        <Textarea
          id="caption"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={2}
          maxLength={500}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        EXIF metadata is stripped automatically; large images are resized to
        fit 2400px on the longest edge.
      </p>

      <div className="flex gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.back()}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button
          type="button"
          className="ml-auto"
          onClick={onUpload}
          disabled={pending || items.length === 0}
        >
          {pending
            ? "Uploading…"
            : `Upload ${items.length || ""} ${items.length === 1 ? "photo" : "photos"}`}
        </Button>
      </div>
    </div>
  )
}
