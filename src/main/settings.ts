import { app, dialog, ipcMain } from 'electron'
import type { CaptureRegion } from '../shared/capture-region'
import type { ApiProfile, AppMode } from '../shared/api-profile'
import type { HintMode } from '../shared/conversation'
import { DEFAULT_OCR_FILTER_MARGINS, normalizeOcrFilterMargins } from '../shared/ocr'
import { setToolbarOpacity, syncToolbarSettings } from './toolbar-window'
import { assessmentMemory, assessmentScoreMemory } from './assessment-memory'
import { configureAssessmentSessions } from './assessment/memory-sessions'

const settingsListeners = new Set<() => void>()
export function onSettingsChanged(listener: () => void): void {
  settingsListeners.add(listener)
}

export const DEFAULT_ASSESSMENT_PERSONALITY_PROMPT =
  '我活泼开朗，乐于沟通，有团队合作精神；情绪稳定，自制力较强，行动前会考虑后果。自信但不自负，认真负责但不过度追求完美，能兼顾质量与效率，尊重他人的贡献。'

ipcMain.handle('getAppVersion', () => {
  return app.getVersion()
})

ipcMain.handle('getAppSettings', () => {
  return settings
})

ipcMain.handle('updateAppSettings', (_event, _settings) => {
  Object.assign(settings, _settings)
  if ('ocrFilterMargins' in _settings) {
    settings.ocrFilterMargins = normalizeOcrFilterMargins(_settings.ocrFilterMargins)
  }
  if (
    'assessmentMemoryEnabled' in _settings ||
    'assessmentPersonalityPrompt' in _settings ||
    'assessmentMostLeastEnabled' in _settings
  ) {
    configureAssessmentSessions(assessmentMemory, assessmentScoreMemory, {
      memoryEnabled: settings.assessmentMemoryEnabled,
      mostLeastEnabled: settings.assessmentMostLeastEnabled,
      personality:
        settings.assessmentPersonalityPrompt.trim() || DEFAULT_ASSESSMENT_PERSONALITY_PROMPT
    })
  }
  for (const listener of settingsListeners) listener()
  if ('hideDockIcon' in _settings) {
    applyDockVisibility(settings.hideDockIcon)
  }
  if ('opacity' in _settings) {
    setToolbarOpacity(settings.opacity)
  }
  if ('toolbarHoverDelay' in _settings || 'theme' in _settings) {
    syncToolbarSettings({
      hoverDelay: settings.toolbarHoverDelay,
      theme: settings.theme
    })
  }
})

/** Show/hide the macOS dock icon. No-op on other platforms. */
export function applyDockVisibility(hidden: boolean): void {
  if (process.platform !== 'darwin') return
  if (hidden) {
    app.dock?.hide()
  } else {
    app.dock?.show()
  }
}

ipcMain.handle('selectScreenshotDir', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: '选择截图保存目录'
  })
  if (result.canceled || result.filePaths.length === 0) {
    return null
  }
  return result.filePaths[0]
})

ipcMain.handle('selectCodeDir', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: '选择代码保存目录'
  })
  if (result.canceled || result.filePaths.length === 0) {
    return null
  }
  return result.filePaths[0]
})

export const settings = {
  /** Window colour scheme, kept in sync with the renderer; see renderer lib/theme.ts */
  theme: 'dark' as 'dark' | 'light',
  apiBaseURL: process.env.API_BASE_URL || '',
  apiKey: process.env.API_KEY || '',
  /** Extra request headers, one `Name: Value` per line; see shared/request-headers.ts */
  apiHeaders: '',
  model: process.env.MODEL || '',
  /**
   * The active profile's 「关闭思考」, see thinking.ts. Must stay falsy here:
   * App.tsx fills blank renderer fields from main, so `true` would overwrite a
   * user's "off".
   */
  disableThinking: false,
  /** Every saved AI profile, synced from the renderer; each mode picks one by id */
  apiProfiles: [] as ApiProfile[],
  screenshotProfileId: '',
  conversationProfileId: '',
  assessmentProfileId: '',
  assessmentMemoryEnabled: false,
  assessmentMostLeastEnabled: false,
  assessmentCheckSelectedAnswers: true,
  assessmentOcrEnabled: false,
  assessmentOcrPreviewOnly: false,
  assessmentShowOcrDebug: false,
  ocrFilterMargins: { ...DEFAULT_OCR_FILTER_MARGINS },
  assessmentPersonalityPrompt: DEFAULT_ASSESSMENT_PERSONALITY_PROMPT,
  /** Use user-configured screen coordinates instead of model-provided boxes. */
  assessmentFixedClick: false,
  assessmentFixedPositions: {
    A: null as { x: number; y: number } | null,
    B: null as { x: number; y: number } | null,
    C: null as { x: number; y: number } | null,
    D: null as { x: number; y: number } | null
  } as Record<string, { x: number; y: number } | null>,
  assessmentNextPosition: null as { x: number; y: number } | null,
  /** 截图模式's system prompt, from the renderer's active scene */
  customPrompt: '',
  /** 对话模式's system prompt, from the renderer's active scene */
  conversationPrompt: '',
  /** 对话模式: hint on every finished sentence (`auto`) or only on the shortcut */
  conversationHintMode: 'auto' as HintMode,
  /** 对话模式: silence (ms) that ends a sentence in the recogniser */
  conversationSilenceMs: 800,
  /** 对话模式: a finished sentence shorter than this triggers no automatic hint */
  conversationMinChars: 4,
  /** Kept in sync with the renderer so the overlay toolbar can match the main window */
  opacity: 0.8,
  /**
   * Dwell time in ms before hovering a toolbar button fires it; 0 disables hover
   * triggering. The real default lives in the renderer store: App.tsx fills blank
   * renderer fields from here, so a truthy default would overwrite a user's "off".
   */
  toolbarHoverDelay: 0,
  /** Screen to capture: `cursor` follows the mouse, anything else is a fixed `Display.id` */
  captureScreen: 'cursor',
  /** Crop every screenshot to this area of one screen; null captures the whole screen */
  captureRegion: null as CaptureRegion | null,
  screenshotAutoSave: false,
  screenshotDir: '',
  /** Save the code block of a finished answer as a source file */
  codeAutoSave: false,
  codeSaveDir: '',
  /** Base file name for saved code; blank falls back to `Test` */
  codeFileBaseName: 'Test',
  /** `sequence` appends a number (Test1, Test2); `overwrite` reuses one name */
  codeNamingMode: 'sequence' as 'sequence' | 'overwrite',
  /** Copy the code block of a finished answer to the system clipboard */
  codeCopyToClipboard: false,
  dashscopeApiKey: '',
  hideDockIcon: false,
  audioInputDeviceId: '',
  audioOutputDeviceId: ''
}

export type AppSettings = typeof settings

/**
 * The profile a mode sends its requests with. Until the renderer has synced
 * its list (or with only `.env` configured) the flat fields are all there is.
 */
export function getModeProfile(mode: AppMode): ApiProfile {
  const id = mode === 'screenshot' ? settings.screenshotProfileId : settings.conversationProfileId
  const profile = settings.apiProfiles.find((p) => p.id === id)
  if (profile) return profile
  return {
    id: '',
    name: '',
    apiBaseURL: settings.apiBaseURL,
    apiKey: settings.apiKey,
    apiHeaders: settings.apiHeaders,
    model: settings.model,
    disableThinking: settings.disableThinking
  }
}

/** The profile used by the experimental 做题 mode. */
export function getAssessmentProfile(): ApiProfile {
  const profile = settings.apiProfiles.find((p) => p.id === settings.assessmentProfileId)
  if (profile) return profile
  return {
    id: '',
    name: '',
    apiBaseURL: settings.apiBaseURL,
    apiKey: settings.apiKey,
    apiHeaders: settings.apiHeaders,
    model: settings.model,
    disableThinking: settings.disableThinking
  }
}
