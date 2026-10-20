import type { ApiProfile } from './api-profile'

/** Display order is also the shortcut cycle order. Prompt scenes remain separate. */
export const APP_MODES = [
  {
    id: 'assessment',
    label: '做题模式',
    shortLabel: '做题',
    path: '/assessment',
    profileKey: 'assessmentProfileId',
    requiresVision: true
  },
  {
    id: 'screenshot',
    label: '截图模式',
    shortLabel: '截图',
    path: '/',
    profileKey: 'screenshotProfileId',
    requiresVision: true
  },
  {
    id: 'conversation',
    label: '对话模式',
    shortLabel: '对话',
    path: '/conversation',
    profileKey: 'conversationProfileId',
    requiresVision: false
  }
] as const

export type ModeId = (typeof APP_MODES)[number]['id']
export type ModeProfileKey = (typeof APP_MODES)[number]['profileKey']

export function getModeDefinition(mode: ModeId): (typeof APP_MODES)[number] {
  return APP_MODES.find((item) => item.id === mode)!
}

export const MODE_PATHS = Object.fromEntries(
  APP_MODES.map((mode) => [mode.id, mode.path])
) as Record<ModeId, string>
export const MODE_NAMES = Object.fromEntries(
  APP_MODES.map((mode) => [mode.id, mode.label])
) as Record<ModeId, string>

/** Settings/help/tool windows do not participate in cycling. */
export function nextModePath(path: string): string | null {
  const index = APP_MODES.findIndex((mode) => mode.path === path)
  return index === -1 ? null : APP_MODES[(index + 1) % APP_MODES.length].path
}

export function supportsMode(profile: ApiProfile, mode: ModeId): boolean {
  return !getModeDefinition(mode).requiresVision || profile.vision !== false
}

/** Prefer the neighbour, but avoid assigning a known text-only model to image input. */
export function fallbackModeProfile(
  mode: ModeId,
  profiles: ApiProfile[],
  preferredId: string
): ApiProfile | undefined {
  const preferred = profiles.find((profile) => profile.id === preferredId)
  return (
    (preferred && supportsMode(preferred, mode) ? preferred : undefined) ??
    profiles.find((profile) => supportsMode(profile, mode)) ??
    preferred ??
    profiles[0]
  )
}
