"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ChevronLeft, Check } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  emptyUpdateContent,
  updateContentSchema,
  type UpdateContent,
} from "@/lib/updates/schema"
import { saveUpdateDraft, finalizeUpdate } from "@/lib/updates/actions"
import type { ExplorationFormat } from "@/lib/types/domain"

import {
  StepIntro,
  StepQoL,
  StepFeelings,
  StepSituation,
  StepSignificance,
  StepComingUp,
  StepVampire,
  StepGoal,
  StepTopic,
  StepReview,
} from "./steps"

const TOTAL_STEPS = 16

type Props = {
  meetingId: string
  meetingLabel: string
  initialContent: UpdateContent
  initialReady: boolean
  formats: ExplorationFormat[]
}

export function UpdateBuilder({
  meetingId,
  meetingLabel,
  initialContent,
  initialReady,
  formats,
}: Props) {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [content, setContent] = useState<UpdateContent>(initialContent)
  const [ready, setReady] = useState(initialReady)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [pending, startTransition] = useTransition()

  // Auto-save on step change (skip the very first render).
  const prev = useRef(step)
  useEffect(() => {
    if (prev.current === step) return
    prev.current = step
    startTransition(async () => {
      try {
        const parsed = updateContentSchema.parse(content)
        await saveUpdateDraft({ meetingId, content: parsed })
        setSavedAt(new Date())
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't save draft."
        )
      }
    })
  }, [step, content, meetingId])

  const setBusiness = (k: keyof UpdateContent["business"], v: unknown) =>
    setContent((c) => ({ ...c, business: { ...c.business, [k]: v } }))
  const setFamily = (k: keyof UpdateContent["family"], v: unknown) =>
    setContent((c) => ({ ...c, family: { ...c.family, [k]: v } }))
  const setPersonal = (k: keyof UpdateContent["personal"], v: unknown) =>
    setContent((c) => ({ ...c, personal: { ...c.personal, [k]: v } }))

  const onFinalize = () => {
    startTransition(async () => {
      try {
        await finalizeUpdate({ meetingId, content, ready })
        toast.success(
          ready ? "Update finalized — you're Ready." : "Update saved."
        )
        router.push("/dashboard")
        router.refresh()
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't finalize update."
        )
      }
    })
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col">
      {/* Top bar */}
      <div className="mb-4 flex items-center justify-between text-sm">
        <Button
          size="sm"
          variant="ghost"
          render={<Link href="/dashboard" />}
        >
          <ChevronLeft className="size-4" /> Dashboard
        </Button>
        <span className="text-xs text-muted-foreground">
          {pending
            ? "Saving…"
            : savedAt
              ? `Saved ${savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              : "Draft"}
        </span>
      </div>

      {/* Progress dots */}
      <div className="mb-1 flex justify-center gap-1.5">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            onClick={() => setStep(n)}
            className={cn(
              "size-2 rounded-full transition-colors",
              n < step
                ? "bg-foreground"
                : n === step
                  ? "bg-foreground ring-2 ring-foreground/20"
                  : "bg-muted-foreground/25"
            )}
            aria-label={`Go to step ${n}`}
          />
        ))}
      </div>
      <p className="text-center text-xs text-muted-foreground">
        Step {step} of {TOTAL_STEPS} · {meetingLabel}
      </p>

      {/* Step body */}
      <div className="my-6 min-h-[24rem]">
        {step === 1 && <StepIntro />}

        {step === 2 && (
          <StepQoL
            value={content.qol}
            onChange={(qol) => setContent((c) => ({ ...c, qol }))}
          />
        )}

        {step === 3 && (
          <StepFeelings
            section="Business"
            value={content.business.feelings}
            onChange={(v) => setBusiness("feelings", v)}
          />
        )}
        {step === 4 && (
          <StepSituation
            section="Business"
            value={content.business.situation}
            onChange={(v) => setBusiness("situation", v)}
          />
        )}
        {step === 5 && (
          <StepSignificance
            section="Business"
            value={content.business.significance}
            onChange={(v) => setBusiness("significance", v)}
          />
        )}

        {step === 6 && (
          <StepFeelings
            section="Family"
            value={content.family.feelings}
            onChange={(v) => setFamily("feelings", v)}
          />
        )}
        {step === 7 && (
          <StepSituation
            section="Family"
            value={content.family.situation}
            onChange={(v) => setFamily("situation", v)}
          />
        )}
        {step === 8 && (
          <StepSignificance
            section="Family"
            value={content.family.significance}
            onChange={(v) => setFamily("significance", v)}
          />
        )}

        {step === 9 && (
          <StepFeelings
            section="Personal"
            value={content.personal.feelings}
            onChange={(v) => setPersonal("feelings", v)}
          />
        )}
        {step === 10 && (
          <StepSituation
            section="Personal"
            value={content.personal.situation}
            onChange={(v) => setPersonal("situation", v)}
          />
        )}
        {step === 11 && (
          <StepSignificance
            section="Personal"
            value={content.personal.significance}
            onChange={(v) => setPersonal("significance", v)}
          />
        )}

        {step === 12 && (
          <StepComingUp
            value={content.coming_up}
            onChange={(coming_up) => setContent((c) => ({ ...c, coming_up }))}
          />
        )}
        {step === 13 && (
          <StepVampire
            value={content.energy_vampire}
            onChange={(energy_vampire) =>
              setContent((c) => ({ ...c, energy_vampire }))
            }
          />
        )}
        {step === 14 && (
          <StepGoal
            value={content.goal}
            onChange={(goal) => setContent((c) => ({ ...c, goal }))}
          />
        )}
        {step === 15 && (
          <StepTopic
            value={content.topic}
            onChange={(topic) => setContent((c) => ({ ...c, topic }))}
            formats={formats}
          />
        )}
        {step === 16 && (
          <StepReview
            content={content}
            ready={ready}
            onReadyChange={setReady}
            onJumpTo={setStep}
            formats={formats}
          />
        )}
      </div>

      {/* Bottom nav */}
      <div className="sticky bottom-16 flex items-center justify-between border-t bg-background py-3 md:bottom-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          disabled={step === 1}
        >
          <ChevronLeft className="size-4" /> Back
        </Button>
        {step < TOTAL_STEPS ? (
          <Button
            size="sm"
            onClick={() => setStep((s) => Math.min(TOTAL_STEPS, s + 1))}
          >
            Next
          </Button>
        ) : (
          <Button size="sm" onClick={onFinalize} disabled={pending}>
            <Check className="size-4" />
            {pending ? "Saving…" : "Finalize update"}
          </Button>
        )}
      </div>
    </div>
  )
}
