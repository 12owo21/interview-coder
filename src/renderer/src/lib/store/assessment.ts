import { create } from 'zustand'
import type { AssessmentSnapshot } from '../../../../shared/assessment'

interface AssessmentStore {
  snapshot: AssessmentSnapshot | null
  sync: (snapshot: AssessmentSnapshot) => void
}

export const useAssessmentStore = create<AssessmentStore>((set) => ({
  snapshot: null,
  sync: (snapshot) =>
    set((state) => {
      if (state.snapshot && snapshot.revision < state.snapshot.revision) {
        // A streaming event can arrive before the initial get-snapshot reply.
        // Backfill only the same request's missing input, never stale output.
        if (
          !state.snapshot.rawInput &&
          snapshot.rawInput &&
          snapshot.runId === state.snapshot.runId &&
          snapshot.rawInput.requestId === state.snapshot.rawInputId
        )
          return { snapshot: { ...state.snapshot, rawInput: snapshot.rawInput } }
        return state
      }
      const previous = state.snapshot?.debug
      const debug =
        snapshot.debug && snapshot.debug.captureId === previous?.captureId
          ? { ...snapshot.debug, image: snapshot.debug.image ?? previous.image }
          : snapshot.debug
      const rawInput =
        snapshot.rawInput === undefined &&
        snapshot.runId === state.snapshot?.runId &&
        (!snapshot.rawInputId || snapshot.rawInputId === state.snapshot?.rawInput?.requestId)
          ? (state.snapshot?.rawInput ?? null)
          : (snapshot.rawInput ?? null)
      return { snapshot: { ...snapshot, debug, rawInput } }
    })
}))
