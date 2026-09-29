import { create } from 'zustand'

interface AppState {
  ignoreMouse: boolean
  /** 对话模式's page is on screen; the toolbar window shows that mode's buttons */
  inConversationPage: boolean
}

interface AppStore extends AppState {
  setIgnoreMouse: (ignore: boolean) => void
  toggleIgnoreMouse: () => void
  /** Adopt what main reports; it sends its whole state, of which these are the fields used here */
  syncAppState: (state: AppState) => void
}

const defaultState: AppState = {
  ignoreMouse: false,
  inConversationPage: false
}

export const useAppStore = create<AppStore>()((set) => ({
  ...defaultState,
  setIgnoreMouse: (ignore) => {
    set({ ignoreMouse: ignore })
  },
  toggleIgnoreMouse: () => {
    set((state) => ({ ignoreMouse: !state.ignoreMouse }))
  },
  syncAppState: (state) => {
    set({ ignoreMouse: state.ignoreMouse, inConversationPage: state.inConversationPage })
  }
}))
