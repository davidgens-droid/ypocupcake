"use client"

import { Button } from "@/components/ui/button"

/**
 * Error boundary for the signed-in app. Without one, an error thrown by a
 * form-bound Server Action replaces the whole page with Next's default
 * "Application error" screen; this keeps the member on a page with a way
 * back. (Production scrubs the message, so it isn't shown.)
 */
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md space-y-4 py-16 text-center">
      <h1 className="font-heading text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">
        That didn&apos;t go through. Nothing was changed. Try again, or go back to
        the dashboard.
      </p>
      <div className="flex justify-center gap-2">
        <Button onClick={reset}>Try again</Button>
        <Button variant="outline" onClick={() => (window.location.href = "/dashboard")}>
          Dashboard
        </Button>
      </div>
    </div>
  )
}
