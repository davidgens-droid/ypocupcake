"use client"

import { X } from "lucide-react"

import { Button } from "@/components/ui/button"
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
  onChange: (next: UpdateContent["qol"]) => void
}

export function StepQoL({ value, onChange }: QoLProps) {
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
        {fields.map((f) => (
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
          </div>
        ))}
      </div>
    </div>
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
  formats: ExplorationFormat[]
}

export function StepReview({
  content,
  ready,
  onReadyChange,
  onJumpTo,
  formats,
}: ReviewProps) {
  const formatLabel =
    formats.find((f) => f.code === content.topic.exploration_format)
      ?.display_name ?? content.topic.exploration_format

  const Section = ({
    title,
    summary,
    onClick,
  }: {
    title: string
    summary: string
    onClick: () => void
  }) => (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-lg border bg-card px-3 py-2 text-left text-sm hover:bg-muted/50"
    >
      <span className="font-medium">{title}</span>
      <span className="ml-3 line-clamp-1 max-w-[60%] text-right text-xs text-muted-foreground">
        {summary || "—"}
      </span>
    </button>
  )

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-heading text-xl font-semibold">Review your update</h2>
        <p className="text-sm text-muted-foreground">Tap any section to edit.</p>
      </div>

      <div className="space-y-2">
        <Section
          title="Quality of Life"
          summary={`${content.qol.physical_health} · ${content.qol.mental_health} · ${content.qol.financial_health} · ${content.qol.friends_community}`}
          onClick={() => onJumpTo(2)}
        />
        <Section
          title="Business"
          summary={content.business.feelings.join(", ")}
          onClick={() => onJumpTo(3)}
        />
        <Section
          title="Family"
          summary={content.family.feelings.join(", ")}
          onClick={() => onJumpTo(6)}
        />
        <Section
          title="Personal"
          summary={content.personal.feelings.join(", ")}
          onClick={() => onJumpTo(9)}
        />
        <Section
          title="Coming up"
          summary={content.coming_up.text}
          onClick={() => onJumpTo(12)}
        />
        <Section
          title="Energy vampire"
          summary={content.energy_vampire}
          onClick={() => onJumpTo(13)}
        />
        <Section
          title="Goal"
          summary={`${content.goal.text}${content.goal.make_commitment ? " · 📣 commitment" : ""}`}
          onClick={() => onJumpTo(14)}
        />
        <Section
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
          onClick={() => onJumpTo(15)}
        />
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
