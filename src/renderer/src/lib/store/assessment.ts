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
      if (state.snapshot && snapshot.revision < state.snapshot.revision) return state
      const previous = state.snapshot?.debug
      const debug =
        snapshot.debug && snapshot.debug.captureId === previous?.captureId
          ? { ...snapshot.debug, image: snapshot.debug.image ?? previous.image }
          : snapshot.debug
      return { snapshot: { ...snapshot, debug } }
    })
}))
