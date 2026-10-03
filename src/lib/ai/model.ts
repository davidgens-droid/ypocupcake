// Single source of truth for which Claude model the app's AI features use.
// Every feature (brain-dump, pattern cards, parking-lot merge) imports this,
// so a model upgrade is one line here and nothing drifts onto a mixed set.
//
// All three call sites use the same request shape — adaptive thinking plus a
// json_schema output_config — which has been live-verified against this model.
export const AI_MODEL = "claude-fable-5-1"
