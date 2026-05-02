"use client"

import { useState, useTransition } from "react"
import { ChevronDown, Pencil, Trash2, X } from "lucide-react"
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
import { cn } from "@/lib/utils"
import { emailUpdateToSelf } from "@/lib/email/update-email"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import {
  FEELING_SUGGESTIONS,
  type Reflection,
  type UpdateContent,
} from "@/lib/updates/schema"
import type { ExplorationFormat } from "@/lib/types/domain"

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — Intro
// ─────────────────────────────────────────────────────────────────────────────
export function StepIntro() {
  return (
    <div className="space-y-4 text-center sm:text-left">
      <p className="font-heading text-lg font-medium italic">
        &ldquo;Every time I come to forum, I come to work on myself.&rdquo;
      </p>
      <h2 className="font-heading text-2xl font-semibold">
        Forum 5% Reflection
      </h2>
      <ul className="mx-auto inline-block space-y-1 text-sm text-muted-foreground sm:mx-0">
        <li>· 3–5 quality words to describe feelings</li>
        <li>· Situation — one sentence only</li>
        <li>· 5/5/90 Rule</li>
      </ul>
      <Card className="bg-muted/40">
        <CardContent className="py-3 text-sm text-muted-foreground">
          This update is private to you. Only you can see what you write.
        </CardContent>
      </Card>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — Quality of Life Snapshot
// ─────────────────────────────────────────────────────────────────────────────
type QoLProps = {
  value: UpdateContent["qol"]
  history?: Array<Record<string, number>>
  onChange: (next: UpdateContent["qol"]) => void
}

export function StepQoL({ value, history = [], onChange }: QoLProps) {
  const fields = [
    { key: "physical_health", label: "Physical Health" },
    { key: "mental_health", label: "Mental Health" },
    { key: "financial_health", label: "Financial Health" },
    { key: "friends_community", label: "Friends / Community" },
  ] as const

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-xl font-semibold">
          Quality of Life Snapshot
        </h2>
        <p className="text-sm text-muted-foreground">
          1 = struggling · 10 = thriving
        </p>
      </div>
      <div className="space-y-6">
        {fields.map((f) => {
          const series = history.map((h) => h[f.key]).filter((n) => typeof n === "number")
          const trend = trendDirection(series)
          return (
            <div key={f.key} className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm">{f.label}</Label>
                <span className="font-mono text-sm tabular-nums">
                  {value[f.key]}
                </span>
              </div>
              <Slider
                min={1}
                max={10}
                step={1}
                value={[value[f.key]]}
                onValueChange={(v) => {
                  const next = Array.isArray(v) ? v[0] : v
                  onChange({ ...value, [f.key]: next })
                }}
              />
              {series.length >= 2 && (
                <div className="flex items-center gap-2 pt-1">
                  <Sparkline values={series} />
                  <span className="text-xs text-muted-foreground">
                    Last {series.length} · {series.join(", ")}
                    {trend && <span className="ml-1">{trend}</span>}
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function trendDirection(series: number[]) {
  if (series.length < 2) return null
  const first = series[0]
  const last = series[series.length - 1]
  if (last > first) return "↑"
  if (last < first) return "↓"
  return "→"
}

function Sparkline({ values }: { values: number[] }) {
  const w = 80
  const h = 16
  const min = 1
  const max = 10
  const step = values.length > 1 ? w / (values.length - 1) : 0
  const pts = values
    .map(
      (v, i) =>
        `${(i * step).toFixed(1)},${(h - ((v - min) / (max - min)) * h).toFixed(1)}`
    )
    .join(" ")
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="text-muted-foreground"
      aria-hidden
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        points={pts}
      />
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Reflection — Feelings (chip input with suggestions)
// ─────────────────────────────────────────────────────────────────────────────
type FeelingsProps = {
  section: "Business" | "Family" | "Personal"
  value: Reflection["feelings"]
  onChange: (next: string[]) => void
}

export function StepFeelings({ section, value, onChange }: FeelingsProps) {
  const remaining = 5 - value.length

  const add = (word: string) => {
    const trimmed = word.trim()
    if (!trimmed) return
    if (value.includes(trimmed)) return
    if (value.length >= 5) return
    onChange([...value, trimmed])
  }
  const remove = (word: string) => onChange(value.filter((w) => w !== word))

  const suggestions = FEELING_SUGGESTIONS.filter(
    (w) => !value.includes(w)
  ).slice(0, 8)

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {section}
        </p>
        <h2 className="font-heading text-xl font-semibold">
          Strongest feelings this last month
        </h2>
        <p className="text-sm text-muted-foreground">3–5 words</p>
      </div>

      <div className="rounded-lg border bg-background p-3 min-h-[64px]">
        <div className="flex flex-wrap gap-2">
          {value.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => remove(w)}
              className="inline-flex items-center gap-1 rounded-full border bg-secondary px-2.5 py-1 text-xs"
            >
              {w}
              <X className="size-3 text-muted-foreground" />
            </button>
          ))}
          <ChipInput onAdd={add} disabled={value.length >= 5} />
        </div>
      </div>

      {suggestions.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Suggestions:</p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => add(w)}
                className="rounded-full border px-2.5 py-1 text-xs hover:bg-muted"
              >
                + {w}
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {value.length} / 5 added
        {value.length < 3 && " · need at least 3"}
        {remaining > 0 && remaining < 3 && ` · ${remaining} left`}
      </p>
    </div>
  )
}

function ChipInput({
  onAdd,
  disabled,
}: {
  onAdd: (s: string) => void
  disabled?: boolean
}) {
  return (
    <input
      disabled={disabled}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === ",") {
          e.preventDefault()
          const v = (e.currentTarget.value ?? "").trim()
          if (v) {
            onAdd(v)
            e.currentTarget.value = ""
          }
        }
      }}
      placeholder={disabled ? "" : "type & enter…"}
      className="min-w-[8rem] flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Reflection — Situation (one sentence)
// ─────────────────────────────────────────────────────────────────────────────
type SituationProps = {
  section: "Business" | "Family" | "Personal"
  value: string
  onChange: (next: string) => void
}

export function StepSituation({ section, value, onChange }: SituationProps) {
  const len = value.length
  const warn = len > 200
  const overFlow = len > 280

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {section}
        </p>
        <h2 className="font-heading text-xl font-semibold">The situation</h2>
        <p className="text-sm text-muted-foreground">
          What caused these feelings? One sentence only.
        </p>
      </div>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, 280))}
        rows={4}
        placeholder="One sentence…"
      />
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          💡 Detail belongs in significance.
        </span>
        <span
          className={
            overFlow
              ? "text-destructive"
              : warn
                ? "text-amber-600"
                : "text-muted-foreground"
          }
        >
          {len} / 280
        </span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Reflection — Significance (3 layers)
// ─────────────────────────────────────────────────────────────────────────────
type SignificanceProps = {
  section: "Business" | "Family" | "Personal"
  value: Reflection["significance"]
  onChange: (next: Reflection["significance"]) => void
}

export function StepSignificance({
  section,
  value,
  onChange,
}: SignificanceProps) {
  const setAt = (i: 0 | 1 | 2, v: string) => {
    const next: Reflection["significance"] = [...value] as Reflection["significance"]
    next[i] = v
    onChange(next)
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {section}
        </p>
        <h2 className="font-heading text-xl font-semibold">Significance</h2>
        <p className="text-sm text-muted-foreground">
          Why and why and why? Three layers.
        </p>
      </div>
      <ol className="space-y-3">
        {[0, 1, 2].map((i) => (
          <li key={i} className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              Layer {i + 1}
            </Label>
            <Textarea
              value={value[i]}
              onChange={(e) => setAt(i as 0 | 1 | 2, e.target.value)}
              rows={2}
            />
          </li>
        ))}
      </ol>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Step — Coming up
// ─────────────────────────────────────────────────────────────────────────────
type ComingUpProps = {
  value: UpdateContent["coming_up"]
  onChange: (next: UpdateContent["coming_up"]) => void
}

export function StepComingUp({ value, onChange }: ComingUpProps) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-heading text-xl font-semibold">
          The most important thing
        </h2>
        <p className="text-sm text-muted-foreground">
          Coming up in the next month
        </p>
      </div>
      <Textarea
        rows={3}
        value={value.text}
        onChange={(e) => onChange({ ...value, text: e.target.value })}
        placeholder="What is it?"
      />
      <div className="space-y-2">
        <Label className="text-sm">3 feeling words about it</Label>
        <FeelingChips
          value={value.feelings}
          onChange={(feelings) => onChange({ ...value, feelings })}
          max={3}
        />
      </div>
    </div>
  )
}

function FeelingChips({
  value,
  onChange,
  max,
}: {
  value: string[]
  onChange: (v: string[]) => void
  max: number
}) {
  const add = (w: string) => {
    const t = w.trim()
    if (!t) return
    if (value.includes(t)) return
    if (value.length >= max) return
    onChange([...value, t])
  }
  const remove = (w: string) => onChange(value.filter((x) => x !== w))
  return (
    <>
      <div className="rounded-lg border bg-background p-3 min-h-[52px]">
        <div className="flex flex-wrap gap-2">
          {value.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => remove(w)}
              className="inline-flex items-center gap-1 rounded-full border bg-secondary px-2.5 py-1 text-xs"
            >
              {w}
              <X className="size-3 text-muted-foreground" />
            </button>
          ))}
          <ChipInput onAdd={add} disabled={value.length >= max} />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {FEELING_SUGGESTIONS.filter((w) => !value.includes(w))
          .slice(0, 6)
          .map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => add(w)}
              className="rounded-full border px-2.5 py-1 text-xs hover:bg-muted"
              disabled={value.length >= max}
            >
              + {w}
            </button>
          ))}
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Step — Energy vampire
// ─────────────────────────────────────────────────────────────────────────────
export function StepVampire({
  value,
  onChange,
}: {
  value: string
  onChange: (s: string) => void
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-heading text-xl font-semibold">One energy vampire</h2>
        <p className="text-sm text-muted-foreground">
          Something or someone that drains you.
        </p>
      </div>
      <Textarea
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="What is it?"
      />
      <p className="text-xs text-muted-foreground">This stays private. Always.</p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Step — Goal
// ─────────────────────────────────────────────────────────────────────────────
export function StepGoal({
  value,
  onChange,
}: {
  value: UpdateContent["goal"]
  onChange: (v: UpdateContent["goal"]) => void
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-heading text-xl font-semibold">
          One goal to hold yourself to
        </h2>
      </div>
      <Textarea
        rows={3}
        value={value.text}
        onChange={(e) => onChange({ ...value, text: e.target.value })}
        placeholder="What's the goal?"
      />

      <div className="space-y-2">
        <Label className="text-sm">Time horizon</Label>
        <RadioGroup
          value={value.horizon}
          onValueChange={(h) =>
            onChange({ ...value, horizon: h as "day" | "week" | "month" })
          }
          className="flex gap-4"
        >
          {[
            ["day", "Day"],
            ["week", "Week"],
            ["month", "Month"],
          ].map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <RadioGroupItem value={k} /> {label}
            </label>
          ))}
        </RadioGroup>
      </div>

      <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3">
        <Switch
          checked={value.make_commitment}
          onCheckedChange={(b) =>
            onChange({ ...value, make_commitment: Boolean(b) })
          }
          id="goal-commitment"
        />
        <div>
          <Label htmlFor="goal-commitment" className="text-sm">
            Make this a forum Commitment
          </Label>
          <p className="text-xs text-muted-foreground">
            Visible to the group; surfaced at the next meeting.
          </p>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Step — Topic to present
// ─────────────────────────────────────────────────────────────────────────────
type TopicProps = {
  value: UpdateContent["topic"]
  onChange: (v: UpdateContent["topic"]) => void
  formats: ExplorationFormat[]
}

export function StepTopic({ value, onChange, formats }: TopicProps) {
  const filtered = formats.filter((f) => f.category === value.tool_category)

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-heading text-xl font-semibold">
          A topic to present and explore
        </h2>
        <p className="text-sm text-muted-foreground">
          Optional. Toggle on to publish to the Parking Lot.
        </p>
      </div>

      <Textarea
        rows={2}
        value={value.text}
        onChange={(e) => onChange({ ...value, text: e.target.value })}
        placeholder="What would you like to explore?"
      />

      <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3">
        <Switch
          checked={value.publish_to_parking_lot}
          onCheckedChange={(b) =>
            onChange({ ...value, publish_to_parking_lot: Boolean(b) })
          }
          id="topic-publish"
        />
        <div>
          <Label htmlFor="topic-publish" className="text-sm">
            Publish to Parking Lot
          </Label>
          <p className="text-xs text-muted-foreground">
            The czar can schedule this for a future meeting.
          </p>
        </div>
      </div>

      {value.publish_to_parking_lot && (
        <div className="space-y-4 rounded-lg border p-3">
          <div className="space-y-2">
            <Label className="text-sm">Add context (optional)</Label>
            <Textarea
              rows={3}
              value={value.context}
              onChange={(e) => onChange({ ...value, context: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm">Urgency</Label>
            <RadioGroup
              value={value.urgency}
              onValueChange={(u) =>
                onChange({ ...value, urgency: u as "low" | "med" | "high" })
              }
              className="flex gap-4"
            >
              {[
                ["low", "Low"],
                ["med", "Medium"],
                ["high", "High"],
              ].map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value={k} /> {label}
                </label>
              ))}
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label className="text-sm">Exploration type</Label>
            <RadioGroup
              value={value.tool_category}
              onValueChange={(c) => {
                const cat = c as "EQ" | "IQ"
                const firstOfCat = formats.find((f) => f.category === cat)
                onChange({
                  ...value,
                  tool_category: cat,
                  exploration_format:
                    firstOfCat?.code ?? value.exploration_format,
                })
              }}
              className="grid gap-2 sm:grid-cols-2"
            >
              <label className="flex items-start gap-2 rounded-lg border p-2 text-sm">
                <RadioGroupItem value="EQ" />
                <div>
                  <div className="font-medium">EQ</div>
                  <div className="text-xs text-muted-foreground">
                    Emotionally complex, &ldquo;feel with&rdquo;
                  </div>
                </div>
              </label>
              <label className="flex items-start gap-2 rounded-lg border p-2 text-sm">
                <RadioGroupItem value="IQ" />
                <div>
                  <div className="font-medium">IQ</div>
                  <div className="text-xs text-muted-foreground">
                    Fast, on point, share lessons
                  </div>
                </div>
              </label>
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label className="text-sm">Format</Label>
            <Select
              value={value.exploration_format}
              onValueChange={(f) =>
                onChange({ ...value, exploration_format: f ?? value.exploration_format })
              }
            >
              <SelectTrigger className="w-full">
                <span data-slot="select-value">
                  {(() => {
                    const f = filtered.find(
                      (x) => x.code === value.exploration_format
                    )
                    return f
                      ? `${f.display_name} · ${f.default_minutes}m`
                      : "Pick a format"
                  })()}
                </span>
              </SelectTrigger>
              <SelectContent>
                {filtered.map((f) => (
                  <SelectItem key={f.code} value={f.code}>
                    {f.display_name} · {f.default_minutes}m
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {filtered.find((f) => f.code === value.exploration_format) && (
              <p className="text-xs text-muted-foreground">
                {
                  filtered.find((f) => f.code === value.exploration_format)
                    ?.short_description
                }
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Step — Review & Finalize
// ─────────────────────────────────────────────────────────────────────────────
type ReviewProps = {
  content: UpdateContent
  ready: boolean
  onReadyChange: (b: boolean) => void
  onJumpTo: (step: number) => void
  onClearAll: () => void
  formats: ExplorationFormat[]
  meetingId: string
}

export function StepReview({
  content,
  ready,
  onReadyChange,
  onJumpTo,
  onClearAll,
  formats,
  meetingId,
}: ReviewProps) {
  const formatLabel =
    formats.find((f) => f.code === content.topic.exploration_format)
      ?.display_name ?? content.topic.exploration_format

  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-heading text-xl font-semibold">Review your update</h2>
        <p className="text-sm text-muted-foreground">
          Tap a section to expand it, or use the pencil to jump back and edit.
        </p>
      </div>

      <div className="space-y-2">
        <ReviewSection
          id="qol"
          title="Quality of Life"
          summary={`${content.qol.physical_health} · ${content.qol.mental_health} · ${content.qol.financial_health} · ${content.qol.friends_community}`}
          isOpen={open.has("qol")}
          onToggle={() => toggle("qol")}
          onEdit={() => onJumpTo(2)}
        >
          <QolDetail value={content.qol} />
        </ReviewSection>

        <ReviewSection
          id="business"
          title="Business"
          summary={content.business.feelings.join(", ")}
          isOpen={open.has("business")}
          onToggle={() => toggle("business")}
          onEdit={() => onJumpTo(3)}
        >
          <ReflectionDetail value={content.business} />
        </ReviewSection>

        <ReviewSection
          id="family"
          title="Family"
          summary={content.family.feelings.join(", ")}
          isOpen={open.has("family")}
          onToggle={() => toggle("family")}
          onEdit={() => onJumpTo(6)}
        >
          <ReflectionDetail value={content.family} />
        </ReviewSection>

        <ReviewSection
          id="personal"
          title="Personal"
          summary={content.personal.feelings.join(", ")}
          isOpen={open.has("personal")}
          onToggle={() => toggle("personal")}
          onEdit={() => onJumpTo(9)}
        >
          <ReflectionDetail value={content.personal} />
        </ReviewSection>

        <ReviewSection
          id="coming_up"
          title="Coming up"
          summary={content.coming_up.text}
          isOpen={open.has("coming_up")}
          onToggle={() => toggle("coming_up")}
          onEdit={() => onJumpTo(12)}
        >
          <ComingUpDetail value={content.coming_up} />
        </ReviewSection>

        <ReviewSection
          id="vampire"
          title="Energy vampire"
          summary={content.energy_vampire}
          isOpen={open.has("vampire")}
          onToggle={() => toggle("vampire")}
          onEdit={() => onJumpTo(13)}
        >
          <p className="whitespace-pre-line text-sm">
            {content.energy_vampire || (
              <span className="text-muted-foreground">—</span>
            )}
          </p>
        </ReviewSection>

        <ReviewSection
          id="goal"
          title="Goal"
          summary={`${content.goal.text}${content.goal.make_commitment ? " · 📣 commitment" : ""}`}
          isOpen={open.has("goal")}
          onToggle={() => toggle("goal")}
          onEdit={() => onJumpTo(14)}
        >
          <GoalDetail value={content.goal} />
        </ReviewSection>

        <ReviewSection
          id="topic"
          title="Topic to present"
          summary={
            content.topic.text
              ? `${content.topic.text}${
                  content.topic.publish_to_parking_lot
                    ? ` · ${content.topic.tool_category} · ${formatLabel}`
                    : ""
                }`
              : ""
          }
          isOpen={open.has("topic")}
          onToggle={() => toggle("topic")}
          onEdit={() => onJumpTo(15)}
        >
          <TopicDetail value={content.topic} formatLabel={formatLabel} />
        </ReviewSection>
      </div>

      <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3">
        <Switch
          checked={ready}
          onCheckedChange={(b) => onReadyChange(Boolean(b))}
          id="ready"
        />
        <div>
          <Label htmlFor="ready" className="text-sm">
            Mark me Ready for the next meeting
          </Label>
          <p className="text-xs text-muted-foreground">
            Means &ldquo;I have something to share.&rdquo; You can keep editing
            anytime.
          </p>
        </div>
      </div>

      <ExportRow meetingId={meetingId} />

      <ClearAllRow onConfirm={onClearAll} />
    </div>
  )
}

function ClearAllRow({ onConfirm }: { onConfirm: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit gap-2 text-destructive hover:bg-destructive/10"
          />
        }
      >
        <Trash2 className="size-4" />
        Clear all and start over
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Clear your update?</DialogTitle>
          <DialogDescription>
            This wipes every field in this update — Quality of Life sliders,
            feelings, situation, significance, coming-up, energy vampire, goal,
            and topic. <strong>This cannot be undone.</strong>
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              onConfirm()
              setOpen(false)
            }}
          >
            Yes, clear everything
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Review section helpers ────────────────────────────────────────────────
function ReviewSection({
  title,
  summary,
  isOpen,
  onToggle,
  onEdit,
  children,
}: {
  id: string
  title: string
  summary: string
  isOpen: boolean
  onToggle: () => void
  onEdit: () => void
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50"
      >
        <span className="flex items-center gap-2 font-medium">
          <ChevronDown
            className={cn(
              "size-4 text-muted-foreground transition-transform",
              isOpen && "rotate-180"
            )}
          />
          {title}
        </span>
        <span className="ml-3 line-clamp-1 max-w-[55%] text-right text-xs text-muted-foreground">
          {summary || "—"}
        </span>
      </button>
      {isOpen && (
        <div className="space-y-3 border-t px-3 py-3">
          {children}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onEdit()
              }}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <Pencil className="size-3" /> Edit this section
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function QolDetail({ value }: { value: UpdateContent["qol"] }) {
  const fields: Array<[keyof UpdateContent["qol"], string]> = [
    ["physical_health", "Physical Health"],
    ["mental_health", "Mental Health"],
    ["financial_health", "Financial Health"],
    ["friends_community", "Friends / Community"],
  ]
  return (
    <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
      {fields.map(([k, label]) => (
        <div key={k} className="rounded-md border bg-background p-2">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="font-mono text-lg tabular-nums">{value[k]}</dd>
        </div>
      ))}
    </dl>
  )
}

function ReflectionDetail({ value }: { value: Reflection }) {
  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Feelings
        </p>
        {value.feelings.length === 0 ? (
          <p className="text-muted-foreground">—</p>
        ) : (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {value.feelings.map((f) => (
              <span
                key={f}
                className="rounded-full border bg-secondary px-2 py-0.5 text-xs"
              >
                {f}
              </span>
            ))}
          </div>
        )}
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Situation
        </p>
        <p className="whitespace-pre-line">
          {value.situation || <span className="text-muted-foreground">—</span>}
        </p>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Significance
        </p>
        <ol className="mt-1 list-decimal space-y-1 pl-5">
          {value.significance.map((s, i) => (
            <li key={i} className="whitespace-pre-line">
              {s || <span className="text-muted-foreground">—</span>}
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

function ComingUpDetail({
  value,
}: {
  value: UpdateContent["coming_up"]
}) {
  return (
    <div className="space-y-2 text-sm">
      <p className="whitespace-pre-line">
        {value.text || <span className="text-muted-foreground">—</span>}
      </p>
      {value.feelings.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.feelings.map((f) => (
            <span
              key={f}
              className="rounded-full border bg-secondary px-2 py-0.5 text-xs"
            >
              {f}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function GoalDetail({ value }: { value: UpdateContent["goal"] }) {
  return (
    <div className="space-y-1 text-sm">
      <p className="whitespace-pre-line">
        {value.text || <span className="text-muted-foreground">—</span>}
      </p>
      {value.text && (
        <p className="text-xs text-muted-foreground">
          Horizon: {value.horizon}
          {value.make_commitment && " · 📣 forum commitment"}
        </p>
      )}
    </div>
  )
}

function TopicDetail({
  value,
  formatLabel,
}: {
  value: UpdateContent["topic"]
  formatLabel: string
}) {
  return (
    <div className="space-y-1 text-sm">
      <p className="whitespace-pre-line">
        {value.text || <span className="text-muted-foreground">—</span>}
      </p>
      {value.publish_to_parking_lot && value.text && (
        <>
          <p className="text-xs text-muted-foreground">
            Published to Parking Lot · {value.tool_category} · {formatLabel}
          </p>
          {value.context && (
            <p className="text-xs text-muted-foreground whitespace-pre-line">
              Context: {value.context}
            </p>
          )}
          <p className="text-xs text-muted-foreground capitalize">
            Urgency: {value.urgency}
          </p>
        </>
      )}
    </div>
  )
}

function ExportRow({ meetingId }: { meetingId: string }) {
  const [pending, startTransition] = useTransition()

  function onEmail() {
    startTransition(async () => {
      const result = await emailUpdateToSelf({ meetingId })
      if (result.ok) {
        toast.success("Sent. Check your inbox.")
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        size="sm"
        type="button"
        onClick={() => window.open(`/print/update/${meetingId}`, "_blank")}
      >
        Download PDF
      </Button>
      <Button
        variant="outline"
        size="sm"
        type="button"
        onClick={onEmail}
        disabled={pending}
      >
        {pending ? "Sending…" : "Email to me"}
      </Button>
    </div>
  )
}

// Used only by the wizard for export download
export function ExportButtons({
  onDownload,
  onEmail,
}: {
  onDownload?: () => void
  onEmail?: () => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" disabled onClick={onEmail}>
        Email to me
      </Button>
      <Button variant="outline" size="sm" disabled onClick={onDownload}>
        Download PDF
      </Button>
    </div>
  )
}

// suppress unused-import lint (Input is exported for future use)
export const _Input = Input
