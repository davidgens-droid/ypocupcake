// Shared shapes for the "Interview Me" flow. Plain module (no "use server"/"use
// client") so both the server action and the client component can import it.

export type InterviewMessage = { role: "ai" | "user"; text: string }

export type InterviewCoverage = {
  business: boolean
  family: boolean
  personal: boolean
  coming_up: boolean
  vampire: boolean
  goal: boolean
  topic: boolean
  qol: boolean
}

export type InterviewAction = "ask" | "ready" | "done"

/** One turn of the interviewer. Fixed contract — the client depends on it. */
export type InterviewTurnResult = {
  /** ask: next question. ready: the wrap-up ("anything else, or generate?"). done: generate now. */
  action: InterviewAction
  /** The spoken line for ask/ready. Empty for done. */
  question: string
  coverage: InterviewCoverage
  /** One short private line of reasoning (never spoken). */
  note: string
}

export const COVERAGE_SECTIONS: { key: keyof InterviewCoverage; label: string }[] = [
  { key: "business", label: "Business" },
  { key: "family", label: "Family" },
  { key: "personal", label: "Personal" },
  { key: "coming_up", label: "Coming up" },
  { key: "vampire", label: "Energy vampire" },
  { key: "goal", label: "Goal" },
  { key: "topic", label: "Topic" },
  { key: "qol", label: "QoL scores" },
]

export const EMPTY_COVERAGE: InterviewCoverage = {
  business: false,
  family: false,
  personal: false,
  coming_up: false,
  vampire: false,
  goal: false,
  topic: false,
  qol: false,
}
