import Link from "next/link"
import { Sparkles, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  dismissPatternCard,
  getOrGeneratePatternCards,
} from "@/lib/ai/patterns"

export async function PatternCards() {
  const cards = await getOrGeneratePatternCards()
  if (cards.length === 0) return null

  return (
    <section className="space-y-2">
      <h2 className="font-heading text-sm font-semibold flex items-center gap-1.5">
        <Sparkles className="size-3.5 text-muted-foreground" />
        Patterns the AI noticed
      </h2>
      <div className="grid gap-2">
        {cards.map((c) => (
          <Card key={c.id} className="border-dashed">
            <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium leading-snug">
                {c.title}
              </CardTitle>
              <form action={dismissPatternCard}>
                <input type="hidden" name="id" value={c.id} />
                <Button
                  type="submit"
                  size="sm"
                  variant="ghost"
                  className="size-7 -my-1 -mr-2 px-1"
                  title="Dismiss"
                >
                  <X className="size-3" />
                </Button>
              </form>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">{c.detail}</p>
              {c.topic_suggestion && (
                <Button
                  variant="outline"
                  size="sm"
                  render={
                    <Link
                      href={`/forum/parking-lot/new?topic=${encodeURIComponent(c.topic_suggestion)}`}
                    />
                  }
                >
                  Park &ldquo;{c.topic_suggestion}&rdquo;
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}
