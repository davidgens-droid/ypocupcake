import type { GameStore, Snapshot } from "@/lib/saladbowl/store"
import type { GameState } from "@/lib/saladbowl/types"

/** What every in-game screen receives. `state` is `snap.state`, never null here. */
export interface ScreenProps {
  store: GameStore
  snap: Snapshot
  state: GameState
}
