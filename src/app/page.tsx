import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function LandingPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <div className="max-w-md space-y-6">
        <p className="text-sm tracking-wide text-muted-foreground uppercase">
          Cupcake
        </p>
        <h1 className="font-heading text-4xl font-semibold leading-tight text-balance sm:text-5xl">
          The forum companion
        </h1>
        <p className="text-muted-foreground text-balance">
          Prep your update, run your meeting, and stay connected with your
          forum between gatherings.
        </p>
        <div className="flex justify-center pt-2">
          <Button size="lg" render={<Link href="/dashboard" />}>
            Open the app
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Members-only. Sign-in is by magic link.
        </p>
      </div>
    </main>
  )
}
