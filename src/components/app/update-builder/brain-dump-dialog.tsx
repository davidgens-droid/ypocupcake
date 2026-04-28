"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { Mic, Sparkles, Square } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { generateUpdateFromBrainDump } from "@/lib/ai/brain-dump"
import { cn } from "@/lib/utils"
import type { UpdateContent } from "@/lib/updates/schema"

type Props = {
  onContentReady: (content: UpdateContent) => void
}

// Minimal subset of the Web Speech API types we use. Avoids needing
// `lib.dom.iterable.d.ts` extensions and keeps TS happy across browsers.
type SpeechRecognitionEvent = {
  resultIndex: number
  results: ArrayLike<{
    isFinal: boolean
    0: { transcript: string }
  }>
}

type SpeechRecognitionInstance = {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onend: (() => void) | null
  onerror: ((event: { error?: string }) => void) | null
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function BrainDumpDialog({ onContentReady }: Props) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")
  const [interim, setInterim] = useState("")
  const [recording, setRecording] = useState(false)
  const [supportsVoice, setSupportsVoice] = useState(false)
  const [pending, startTransition] = useTransition()

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)

  useEffect(() => {
    setSupportsVoice(!!getSpeechRecognitionCtor())
  }, [])

  function startRecording() {
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) {
      toast.error("Voice input isn't supported in this browser. Try Chrome or Safari.")
      return
    }
    const recognition = new Ctor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = "en-US"

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalText = ""
      let interimText = ""
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i]
        if (r.isFinal) finalText += r[0].transcript
        else interimText += r[0].transcript
      }
      if (finalText) {
        setText((prev) => {
          const sep = prev && !prev.endsWith(" ") && !prev.endsWith("\n") ? " " : ""
          return prev + sep + finalText.trim() + " "
        })
      }
      setInterim(interimText)
    }
    recognition.onend = () => {
      setRecording(false)
      setInterim("")
    }
    recognition.onerror = (event) => {
      const code = event.error
      setRecording(false)
      setInterim("")
      if (code === "not-allowed" || code === "service-not-allowed") {
        toast.error("Microphone access denied. Allow it in your browser settings.")
      } else if (code !== "no-speech" && code !== "aborted") {
        toast.error(`Voice error: ${code ?? "unknown"}`)
      }
    }

    recognitionRef.current = recognition
    setRecording(true)
    recognition.start()
  }

  function stopRecording() {
    recognitionRef.current?.stop()
    recognitionRef.current = null
  }

  // Stop recording if dialog closes
  useEffect(() => {
    if (!open && recording) {
      stopRecording()
    }
  }, [open, recording])

  function onGenerate() {
    if (recording) stopRecording()
    if (text.trim().length < 10) {
      toast.error("Brain-dump is a bit short — give me at least a paragraph.")
      return
    }
    startTransition(async () => {
      const result = await generateUpdateFromBrainDump({ brainDump: text })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      onContentReady(result.content)
      toast.success("Update structured. Review and edit each field.")
      setOpen(false)
      setText("")
      setInterim("")
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="fixed bottom-20 right-4 z-30 gap-2 shadow-lg md:bottom-6"
          />
        }
      >
        <Sparkles className="size-4" />
        Brain-dump
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4" /> Brain-dump mode
          </DialogTitle>
          <DialogDescription>
            Talk or type freely. I&apos;ll structure it into your update fields
            and you can review every section before saving.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Textarea
            rows={10}
            value={text + (interim ? (text.endsWith(" ") || !text ? "" : " ") + interim : "")}
            onChange={(e) => {
              if (recording) return // freeze edits while listening
              setText(e.target.value)
            }}
            placeholder="What's been going on for you this last month? Business, family, personal — say it however it comes out."
            disabled={pending}
            autoFocus
            className={cn(interim && "italic")}
          />
          <div className="flex items-center justify-between gap-2">
            {supportsVoice ? (
              <Button
                type="button"
                size="sm"
                variant={recording ? "default" : "outline"}
                onClick={recording ? stopRecording : startRecording}
                disabled={pending}
                className={cn("gap-2", recording && "animate-pulse")}
              >
                {recording ? (
                  <>
                    <Square className="size-4 fill-current" /> Stop recording
                  </>
                ) : (
                  <>
                    <Mic className="size-4" /> Start recording
                  </>
                )}
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">
                Voice input not supported in this browser.
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {recording ? "Listening…" : `${text.length} chars`}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Privacy: this is processed by Claude with zero retention. Only you
            ever see the result.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onGenerate}
            disabled={pending || text.trim().length < 10}
          >
            {pending ? "Structuring…" : "Generate update"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
