import { ipcMain } from 'electron'

/**
 * Runs when the page on screen changes. Click-through is suspended while the
 * settings page is up (see `applyIgnoreMouse` in shortcuts.ts), and the
 * toolbar shows the buttons of the mode on screen, so both need to be told.
 */
let onPageChange: (() => void) | null = null

export function setPageChangeHandler(handler: () => void): void {
  onPageChange = handler
}

ipcMain.handle('updateAppState', (_event, next: Partial<AppState>) => {
  const before = { ...state }
  Object.assign(state, next)
  if (
    state.inSettingsPage !== before.inSettingsPage ||
    state.inConversationPage !== before.inConversationPage ||
    state.inAssessmentPage !== before.inAssessmentPage
  ) {
    onPageChange?.()
  }
})

// A window that loads after the last broadcast (the toolbar) asks for it
ipcMain.handle('getAppState', () => state)

export const state = {
  /** 截图模式's page is on screen */
  inCoderPage: false,
  /** 对话模式's page is on screen */
  inConversationPage: false,
  /** 做题模式's page is on screen; its toolbar only exposes common actions */
  inAssessmentPage: false,
  /**
   * Whether the settings page is on screen. Click-through is suspended there:
   * every control needed to turn it back off lives on that page, so applying it
   * would leave the user with a window they cannot click.
   */
  inSettingsPage: false,
  ignoreMouse: false
}

export type AppState = typeof state

/** One of the mode pages is on screen, where the shortcuts act */
export function inModePage(): boolean {
  return state.inCoderPage || state.inConversationPage || state.inAssessmentPage
}
