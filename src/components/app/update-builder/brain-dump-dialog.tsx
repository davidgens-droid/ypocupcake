"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useSearchParams } from "next/navigation"
import { Loader2, MessageCircleQuestion, Mic, Sparkles, Square } from "lucide-react"
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
import {
  isEmptyUpdate,
  updateContentSchema,
  type UpdateContent,
} from "@/lib/updates/schema"
import { InterviewMode } from "./interview-mode"

type Props = {
  /** The update as it currently stands in the builder. Decides CREATE vs REFINE. */
  currentContent: UpdateContent
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

const THINKING_MESSAGES = [
  "Reading your update…",
  "Finding the threads…",
  "Drafting feelings…",
  "Going deeper on significance…",
  "Pulling it together…",
  "Almost there…",
]

export function BrainDumpDialog({ currentContent, onContentReady }: Props) {
  // REFINE once the member has written anything; CREATE on an untouched update.
  const refining = !isEmptyUpdate(currentContent)
  // The dashboard links here with ?ai=brain-dump — open straight into the
  // dialog. Lazy-initialised (not an effect) so there's no extra render.
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(
    () => searchParams.get("ai") === "brain-dump"
  )
  // Monotonic id so a result from a superseded request is ignored.
  const requestId = useRef(0)
  // "interview" is only reachable in CREATE mode (see the mode switch below).
  const [mode, setMode] = useState<"freeform" | "interview">("freeform")
  // True from Start until the interview exits — blocks accidental dismissal.
  const [interviewActive, setInterviewActive] = useState(false)
  const [text, setText] = useState("")
  const [interim, setInterim] = useState("")
  const [recording, setRecording] = useState(false)
  const [supportsVoice, setSupportsVoice] = useState(false)
  const [pending, startTransition] = useTransition()
  const [thinkingMsg, setThinkingMsg] = useState(THINKING_MESSAGES[0])

  // Cycle thinking messages while pending so the dialog doesn't feel frozen.
  useEffect(() => {
    if (!pending) return
    setThinkingMsg(THINKING_MESSAGES[0])
    let i = 0
    const id = setInterval(() => {
      i = (i + 1) % THINKING_MESSAGES.length
      setThinkingMsg(THINKING_MESSAGES[i])
    }, 2200)
    return () => clearInterval(id)
  }, [pending])

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
    // Fold any still-interim speech into the payload so the last phrase the
    // member was saying when they tapped Generate isn't silently dropped.
    const payload = (
      text + (interim ? (text.endsWith(" ") || !text ? "" : " ") + interim : "")
    ).trim()
    if (recording) stopRecording()
    if (payload.length < 10) {
      toast.error("Brain-dump is a bit short — give me at least a paragraph.")
      return
    }
    // Refuse up front if the current draft wouldn't pass the app schema. The
    // server rejects it too — this just gives a precise message and guarantees
    // the server can never quietly treat a broken draft as "empty".
    const check = updateContentSchema.safeParse(currentContent)
    if (!check.success) {
      const path = check.error.issues[0]?.path.join(".") || "a field"
      toast.error(
        `Your draft has a problem in "${path}" (likely over its length limit). Fix that field, then try again.`
      )
      return
    }
    const myRequest = ++requestId.current
    startTransition(async () => {
      const result = await generateUpdateFromBrainDump({
        brainDump: payload,
        existing: check.data,
      })
      // Superseded by a newer request — ignore this result entirely.
      if (myRequest !== requestId.current) return
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      onContentReady(result.content)
      // Trust the server's decision on mode, not our pre-call guess.
      toast.success(
        result.mode === "refine"
          ? "Update refined. Review each field — nothing was dropped."
          : "Update structured. Review and edit each field."
      )
      setOpen(false)
      setText("")
      setInterim("")
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Never let Escape / backdrop / the X dismiss the dialog while a
        // request is in flight — the result would land on a closed dialog and
        // overwrite whatever the member did in the meantime.
        if ((pending || interviewActive) && !next) return
        // Closing always lands back on the typing view next time.
        if (!next) setMode("freeform")
        setOpen(next)
      }}
    >
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            // The update builder has a sticky bottom nav (Back / Next | Finalize)
            // at `bottom-16` on mobile / `bottom-0` on desktop, ~56px tall.
            // We sit the FAB clearly above it on every viewport so it never
            // covers the Finalize button on the review step.
            className="fixed right-4 z-30 gap-2 shadow-lg bottom-36 md:bottom-20"
          />
        }
      >
        <Sparkles className="size-4" />
        Brain-dump
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={!pending && !interviewActive}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4" />{" "}
            {refining
              ? "Refine your update"
              : mode === "interview"
                ? "Interview me"
                : "Brain-dump mode"}
          </DialogTitle>
          <DialogDescription>
            {refining
              ? "Add new thoughts, corrections, or details. I'll fold them into what you've already written — nothing gets dropped unless you say so."
              : mode === "interview"
                ? "A spoken, one-question-at-a-time conversation. I'll draw out what matters most this month, then turn it into your update."
                : "Talk or type freely. I'll structure it into your update fields and you can review every section before saving."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          {/* Keyed on `mode` alone (not `refining`): once the interview has
              generated content, `refining` flips true in the same batch as the
              close, and the closing animation must not flash the refine form. */}
          {mode === "interview" ? (
            <InterviewMode
              currentContent={currentContent}
              onGenerated={(c) => {
                onContentReady(c)
                toast.success("Update drafted from your interview. Review and edit each field.")
                setInterviewActive(false)
                // Anything typed before switching to the interview must not
                // pre-fill the next (refine) open.
                setText("")
                setInterim("")
                setOpen(false)
              }}
              onExit={() => {
                setInterviewActive(false)
                setMode("freeform")
              }}
              onActiveChange={setInterviewActive}
            />
          ) : pending ? (
            <div className="flex min-h-48 flex-col items-center justify-center gap-4 py-8">
              <div className="relative">
                <Loader2 className="size-12 animate-spin text-muted-foreground" />
                <Sparkles className="absolute inset-0 m-auto size-5 text-foreground" />
              </div>
              <p
                key={thinkingMsg}
                className="animate-in fade-in text-sm font-medium duration-500"
              >
                {thinkingMsg}
              </p>
              <p className="text-xs text-muted-foreground">
                {refining
                  ? "Claude is folding your new thoughts into your update. Usually 10–30s."
                  : "Claude is reasoning through your dump. Usually 10–30s."}
              </p>
            </div>
          ) : (
            <>
              <Textarea
                rows={6}
                value={
                  text +
                  (interim
                    ? (text.endsWith(" ") || !text ? "" : " ") + interim
                    : "")
                }
                onChange={(e) => {
                  if (recording) return // freeze edits while listening
                  setText(e.target.value)
                }}
                placeholder={
                  refining
                    ? "What's changed, or what would you add? e.g. \"Actually the business situation improved — we closed the deal. And add a goal about sleeping more.\""
                    : "What's been going on for you this last month? Business, family, personal — say it however it comes out."
                }
                autoFocus
                className={cn(
                  "min-h-32 max-h-[40dvh] resize-none",
                  interim && "italic"
                )}
              />
              <div className="flex items-center justify-between gap-2">
                {supportsVoice ? (
                  <Button
                    type="button"
                    size="sm"
                    variant={recording ? "default" : "outline"}
                    onClick={recording ? stopRecording : startRecording}
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
              {!refining && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit gap-2"
                  onClick={() => {
                    if (recording) stopRecording()
                    setMode("interview")
                  }}
                >
                  <MessageCircleQuestion className="size-4" />
                  Interview me instead
                </Button>
              )}
              <p className="text-xs text-muted-foreground">
                Privacy: processed by Claude. Anthropic doesn&apos;t train on
                your data. Only you ever see the result.
              </p>
            </>
          )}
        </div>
        {mode !== "interview" && (
          <div className="flex shrink-0 justify-end gap-2 border-t pt-3">
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
              className="gap-2"
            >
              {pending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />{" "}
                  {refining ? "Refining…" : "Structuring…"}
                </>
              ) : refining ? (
                "Refine update"
              ) : (
                "Generate update"
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
