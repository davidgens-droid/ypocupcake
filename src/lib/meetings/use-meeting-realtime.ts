"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

import { createClient } from "@/lib/supabase/client"

/**
 * Subscribe a client component to realtime changes on a meeting and its
 * rounds, then trigger a Next.js router refresh so the server-rendered page
 * re-fetches and re-renders. Cheap fix that doesn't require lifting all the
 * server data into client state.
 */
export function useMeetingRealtime(meetingId: string) {
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`meeting:${meetingId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "meeting_rounds",
          filter: `meeting_id=eq.${meetingId}`,
        },
        () => router.refresh()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "meetings",
          filter: `id=eq.${meetingId}`,
        },
        () => router.refresh()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [meetingId, router])
}
