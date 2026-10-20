import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import codingPrompt from './prompts/coding.md?raw'
import englishExamPrompt from './prompts/english-exam.md?raw'
import aptitudeTestPrompt from './prompts/aptitude-test.md?raw'
import generalQaPrompt from './prompts/general-qa.md?raw'
import techInterviewPrompt from './prompts/tech-interview.md?raw'
import behavioralInterviewPrompt from './prompts/behavioral-interview.md?raw'
import englishInterviewPrompt from './prompts/english-interview.md?raw'
import { DEFAULT_THEME, type Theme } from '../theme'
import {
  knownVision,
  normalizeBaseURL,
  resolveLinkedModel,
  type ModelSwitchReason
} from '../providers'
import { createProfile, type ApiProfile } from '../api-profiles'
import type { CaptureRegion } from '../../../../shared/capture-region'
import { isMouseParkingRegion, type MouseParkingRegion } from '../../../../shared/mouse-parking'
import type { AppMode } from '../../../../shared/api-profile'
import {
  APP_MODES,
  getModeDefinition,
  supportsMode,
  fallbackModeProfile,
  type ModeId
} from '../../../../shared/app-modes'
import type { HintMode } from '../../../../shared/conversation'
import {
  DEFAULT_OCR_FILTER_MARGINS,
  normalizeOcrFilterMargins,
  type OcrFilterMargins
} from '../../../../shared/ocr'

export type { Theme }
export type { ApiProfile }
export type { AppMode, HintMode }

export interface PromptScene {
  id: string
  name: string
  prompt: string
  isPreset: boolean
  /** The mode the scene belongs to; scenes saved before modes existed are 截图模式 ones */
  mode?: AppMode
}

export const CODING_SCENE_ID = 'coding'
export const TECH_INTERVIEW_SCENE_ID = 'tech-interview'

/** The scene a mode falls back to when its own is gone */
const DEFAULT_SCENE_ID: Record<AppMode, string> = {
  screenshot: CODING_SCENE_ID,
  conversation: TECH_INTERVIEW_SCENE_ID
}

/** Default prompts for all preset scenes, maintained as Markdown files under ./prompts */
export const PRESET_SCENE_PROMPTS: Record<string, string> = {
  [CODING_SCENE_ID]: codingPrompt,
  'english-exam': englishExamPrompt,
  'aptitude-test': aptitudeTestPrompt,
  'general-qa': generalQaPrompt,
  [TECH_INTERVIEW_SCENE_ID]: techInterviewPrompt,
  'behavioral-interview': behavioralInterviewPrompt,
  'english-interview': englishInterviewPrompt
}

export function sceneMode(scene: PromptScene): AppMode {
  return scene.mode ?? 'screenshot'
}

const createPresetScenes = (): PromptScene[] => [
  {
    id: CODING_SCENE_ID,
    name: '解算法题',
    prompt: PRESET_SCENE_PROMPTS[CODING_SCENE_ID],
    isPreset: true
  },
  {
    id: 'english-exam',
    name: '英语考试',
    prompt: PRESET_SCENE_PROMPTS['english-exam'],
    isPreset: true
  },
  {
    id: 'aptitude-test',
    name: '能力测评',
    prompt: PRESET_SCENE_PROMPTS['aptitude-test'],
    isPreset: true
  },
  {
    id: 'general-qa',
    name: '通用问答',
    prompt: PRESET_SCENE_PROMPTS['general-qa'],
    isPreset: true
  },
  {
    id: TECH_INTERVIEW_SCENE_ID,
    name: '技术面试',
    prompt: PRESET_SCENE_PROMPTS[TECH_INTERVIEW_SCENE_ID],
    isPreset: true,
    mode: 'conversation'
  },
  {
    id: 'behavioral-interview',
    name: '行为面试',
    prompt: PRESET_SCENE_PROMPTS['behavioral-interview'],
    isPreset: true,
    mode: 'conversation'
  },
  {
    id: 'english-interview',
    name: '英文面试',
    prompt: PRESET_SCENE_PROMPTS['english-interview'],
    isPreset: true,
    mode: 'conversation'
  }
]

/**
 * The scene list: the presets the user has not deleted, in their fixed order
 * and keeping edited prompts, then the user's own. A preset added in a later
 * version is not in `removed`, so it still reaches existing users.
 */
function assembleScenes(saved: PromptScene[], removed: string[]): PromptScene[] {
  return [
    ...createPresetScenes()
      .filter((p) => !removed.includes(p.id))
      .map((p) => {
        const kept = saved.find((s) => s.id === p.id)
        // An emptied (or restored) preset gets its default prompt back. Its mode
        // always comes from the table, never from the saved copy
        return kept?.prompt.trim() ? { ...kept, mode: p.mode } : p
      }),
    ...saved.filter((s) => !s.isPreset)
  ]
}

/**
 * Derive a mode's system prompt from its active scene: `customPrompt` for
 * 截图模式, `conversationPrompt` for 对话模式, both read by the main process
 */
function composePrompt(scenes: PromptScene[], sceneId: string, mode: AppMode): string {
  const scene = scenes.find((s) => s.id === sceneId && sceneMode(s) === mode)
  if (!scene) return PRESET_SCENE_PROMPTS[DEFAULT_SCENE_ID[mode]]
  // An emptied preset scene falls back to its default prompt
  return scene.prompt.trim() || PRESET_SCENE_PROMPTS[scene.id] || ''
}

/** The store keys holding a mode's active scene and the prompt derived from it */
const SCENE_KEYS = {
  screenshot: { sceneId: 'activeSceneId', prompt: 'customPrompt' },
  conversation: { sceneId: 'conversationSceneId', prompt: 'conversationPrompt' }
} as const

/** Both modes' prompts, recomputed after any change to the scene list */
function composePrompts(
  scenes: PromptScene[],
  activeSceneId: string,
  conversationSceneId: string
): { customPrompt: string; conversationPrompt: string } {
  return {
    customPrompt: composePrompt(scenes, activeSceneId, 'screenshot'),
    conversationPrompt: composePrompt(scenes, conversationSceneId, 'conversation')
  }
}

/** Whether any of a mode's preset scenes was deleted and can be restored */
export function hasRemovedPresets(removedIds: string[], mode: AppMode): boolean {
  return scenesOf(createPresetScenes(), mode).some((p) => removedIds.includes(p.id))
}

/** A mode's scenes, in list order */
export function scenesOf(scenes: PromptScene[], mode: AppMode): PromptScene[] {
  return scenes.filter((s) => sceneMode(s) === mode)
}

/** `captureScreen` value for capturing whichever screen the mouse is on */
export const CAPTURE_SCREEN_CURSOR = 'cursor'

/** How captured screenshots are shown on the main page, ordered by how much room they take */
export type ScreenshotDisplay = 'none' | 'count' | 'gallery'

/** What to do when a saved code file would collide with an existing one */
export type CodeNamingMode = 'sequence' | 'overwrite'

/** Immutably replace one profile, leaving the rest untouched */
function patchProfile(
  profiles: ApiProfile[],
  id: string,
  patch: Partial<Omit<ApiProfile, 'id'>>
): ApiProfile[] {
  return profiles.map((p) => (p.id === id ? { ...p, ...withVision(p, patch) } : p))
}

/**
 * When a patch changes a profile's model, what is known about its image input
 * no longer applies: start over from the preset table (the settings page then
 * refines it from the platform's model list)
 */
function withVision(
  profile: ApiProfile | undefined,
  patch: Partial<Omit<ApiProfile, 'id'>>
): Partial<Omit<ApiProfile, 'id'>> {
  if (patch.model === undefined || patch.model === profile?.model || 'vision' in patch) return patch
  return { ...patch, vision: knownVision(patch.model) }
}

/** The live fields that are a mirror of the active profile */
const CREDENTIAL_KEYS = ['apiBaseURL', 'apiKey', 'apiHeaders', 'model', 'disableThinking'] as const

/** Same as `patchProfile`, but a no-op when `id` matches nothing */
function patchActiveProfile(
  profiles: ApiProfile[],
  id: string,
  patch: Partial<Omit<ApiProfile, 'id'>>
): ApiProfile[] {
  return profiles.some((p) => p.id === id) ? patchProfile(profiles, id, patch) : profiles
}

export const OPACITY_MIN = 0.1
export const OPACITY_MAX = 1
export const OPACITY_STEP = 0.05

interface Settings {
  /** Window colour scheme; `light` is a white background with dark text */
  theme: Theme
  /** Saved AI endpoints; the one being edited is mirrored onto the fields below */
  apiProfiles: ApiProfile[]
  /**
   * Which entry of `apiProfiles` the settings page edits. Not the one in use:
   * each mode picks its own (`screenshotProfileId` / `conversationProfileId`)
   */
  activeProfileId: string
  /** The profile 截图模式 sends screenshots with; its model should take images */
  screenshotProfileId: string
  /** The profile 对话模式 asks for hints with; text only, so a fast model suits it */
  conversationProfileId: string
  /** The profile used by the experimental 做题 mode */
  assessmentProfileId: string
  assessmentMemoryEnabled: boolean
  assessmentMostLeastEnabled: boolean
  assessmentCheckSelectedAnswers: boolean
  assessmentOcrEnabled: boolean
  assessmentOcrPreviewOnly: boolean
  assessmentShowOcrDebug: boolean
  ocrFilterMargins: OcrFilterMargins
  assessmentPersonalityPrompt: string
  assessmentFixedClick: boolean
  assessmentFixedPositions: Record<string, { x: number; y: number } | null>
  assessmentNextPosition: { x: number; y: number } | null
  assessmentSmoothMouse: boolean
  assessmentMouseParkingEnabled: boolean
  assessmentMouseParkingRegions: MouseParkingRegion[]
  /**
   * Whether the user has ever saved an API key. The welcome dialog keys off
   * this rather than the live `apiKey`, so switching to a profile that is still
   * blank does not pop the dialog back up over what the user is doing.
   */
  hasConfiguredApi: boolean
  apiBaseURL: string
  /** API Base URL entries the user created from the picker, kept as a shortcut list */
  customBaseURLs: string[]
  apiKey: string
  /** Extra request headers, one `Name: Value` per line */
  apiHeaders: string
  model: string
  /** The active profile's 「关闭思考」 */
  disableThinking: boolean
  /** Custom models created before they were kept per API Base URL; offered for every URL */
  customModels: string[]
  /** Custom models the user created, keyed by normalized API Base URL */
  customModelsByBaseURL: Record<string, string[]>
  /** Last model used with each normalized API Base URL, restored when switching back */
  modelByBaseURL: Record<string, string>
  /** 截图模式's system prompt, derived from `activeSceneId` */
  customPrompt: string
  /** 对话模式's system prompt, derived from `conversationSceneId` */
  conversationPrompt: string

  scenes: PromptScene[]
  /** 截图模式's scene (the name predates 对话模式) */
  activeSceneId: string
  conversationSceneId: string
  /** Preset scenes the user deleted; kept so the next load does not bring them back */
  removedPresetSceneIds: string[]

  opacity: number
  /** Allow resizing the main window and overlay toolbar */
  resizable: boolean
  /** Show the click-through overlay toolbar above the main window */
  showOverlayToolbar: boolean
  /** 隐藏主页面底部的快捷键提醒文字 */
  hideShortcutHints: boolean
  /** Dwell time in ms before hovering a toolbar button fires it; 0 disables hover triggering */
  toolbarHoverDelay: number
  /** How the captured screenshots are shown above the solution */
  screenshotDisplay: ScreenshotDisplay
  /** 截取哪块屏幕：`cursor` 跟随鼠标，其余为固定屏幕的 `Display.id` */
  captureScreen: string
  /** 只截取某块屏幕上的这块区域；为 null 时截取整个屏幕 */
  captureRegion: CaptureRegion | null

  screenshotAutoSave: boolean
  screenshotDir: string

  /** 把 AI 生成的代码自动保存为源文件（算法题解答） */
  codeAutoSave: boolean
  /** 代码保存目录；为空时不保存 */
  codeSaveDir: string
  /** 保存代码时的文件名（不含扩展名）；为空时用默认的 Test */
  codeFileBaseName: string
  /** 重名时：sequence 依次编号（Test1、Test2），overwrite 覆盖同一个文件 */
  codeNamingMode: CodeNamingMode
  /** 把 AI 生成的代码自动复制到系统剪贴板 */
  codeCopyToClipboard: boolean

  dashscopeApiKey: string

  hideDockIcon: boolean

  audioInputDeviceId: string
  audioOutputDeviceId: string

  /** The mode shown last, restored on the next start */
  lastMode: ModeId
  /** 对话模式: hint as soon as the other side finishes a sentence, or only on the shortcut */
  conversationHintMode: HintMode
  /** 对话模式: silence (ms) after which the recogniser ends a sentence; shorter hints sooner */
  conversationSilenceMs: number
  /** 对话模式: a finished sentence shorter than this (punctuation aside) triggers no automatic hint */
  conversationMinChars: number
  /** 对话模式: hide the transcript column to give the hints the whole window */
  conversationTranscriptHidden: boolean
}

/** A model change made on the user's behalf when the API Base URL changed */
export interface ModelSwitch {
  from: string
  to: string
  reason: ModelSwitchReason
}

interface SettingsStore extends Settings {
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  /** Change the API Base URL and carry the model over to the new platform's spelling */
  setApiBaseURL: (url: string) => ModelSwitch | null
  /** Change the model, remembering it for the current API Base URL */
  setModel: (model: string) => void
  /** Switch to another saved profile, carrying the live fields with it */
  setActiveProfile: (id: string) => void
  /** Add a profile, either blank or copied from the active one */
  addProfile: (name: string, copyActive?: boolean) => string
  /** Rename a profile */
  renameProfile: (id: string, name: string) => void
  /** Update one field of a profile; keeps the live fields in sync when it is active */
  updateProfile: (id: string, patch: Partial<Omit<ApiProfile, 'id'>>) => void
  /** Remove a profile; refuses to remove the last one */
  removeProfile: (id: string) => boolean
  /** Make a mode send its requests with this profile */
  setModeProfile: (mode: ModeId, id: string) => void
  /**
   * Step a mode to its next profile, for the keyboard shortcut. 截图模式 skips
   * the ones known not to take images. Null when there is nothing to step to.
   */
  cycleProfile: (mode: ModeId, step?: number) => ApiProfile | null
  /** Record that an API key has been saved, so the welcome dialog stays away */
  markApiConfigured: () => void
  /**
   * Change one of the live credential fields, keeping the active profile's
   * own copy in step. Every settings-page input must go through this rather
   * than `updateSetting`, otherwise the edit lives only in the flat fields and
   * is lost the moment the user switches profiles or restarts.
   */
  updateCredential: (patch: Partial<Pick<ApiProfile, (typeof CREDENTIAL_KEYS)[number]>>) => void
  addCustomModel: (baseURL: string, model: string) => void
  removeCustomModel: (baseURL: string, model: string) => void
  /** Step the window opacity within [OPACITY_MIN, OPACITY_MAX] */
  adjustOpacity: (delta: number) => void
  syncSettings: (settings: Partial<Settings>) => void
  /** Make a scene its mode's active one */
  setActiveScene: (id: string) => void
  /** Step a mode to its next scene, wrapping at the end, and report its name */
  cycleScene: (mode: AppMode) => string
  updateScenePrompt: (id: string, prompt: string) => void
  addScene: (name: string, mode: AppMode) => string
  /** Delete a scene, preset or not; refuses to delete the last one of its mode */
  removeScene: (id: string) => boolean
  /** Bring back a mode's deleted preset scenes, with their default prompts */
  restorePresetScenes: (mode: AppMode) => void
}

// 新安装或持久化数据缺少字段时使用的初值；已有用户保存的值会覆盖对应默认值。
const defaultSettings: Settings = {
  theme: DEFAULT_THEME, // 界面主题，DEFAULT_THEME 当前为深色（dark），也可设为 light
  apiProfiles: [], // 保存的 AI 配置列表，加载持久化设置时补齐初始配置
  activeProfileId: 'profile-default', // AI 模型设置页当前编辑的配置 ID，不代表所有模式实际使用的配置
  screenshotProfileId: '', // 截图模式使用的 AI 配置 ID，空值在加载设置时自动补齐
  conversationProfileId: '', // 对话模式使用的 AI 配置 ID，空值在加载设置时自动补齐
  assessmentProfileId: '', // 做题模式使用的 AI 配置 ID，空值在加载设置时自动补齐
  assessmentMemoryEnabled: false, // 性格测评逐题记忆开关，默认不记录和引用前面题目的答案
  assessmentMostLeastEnabled: false, // 最符合／最不符合模式，开启后按评分先选最高分、再选最低分
  assessmentCheckSelectedAnswers: false, // 检查已选选项，默认在补充分析时跳过已选项，避免重复点击
  assessmentOcrEnabled: true, // 做题时使用本地 OCR 文字框定位，当前默认开启
  assessmentOcrPreviewOnly: false, // 仅预览识别与点击计划；默认关闭，允许实际点击并循环做题
  assessmentShowOcrDebug: false, // 显示 OCR 调试图开关；预览模式下仍会显示调试图
  ocrFilterMargins: { ...DEFAULT_OCR_FILTER_MARGINS }, // OCR 边缘过滤范围：上下左右默认各 100 原图像素，单边为 0 时不过滤该边
  assessmentPersonalityPrompt:
    '我活泼开朗，乐于沟通，有团队合作精神；情绪稳定，自制力较强，行动前会考虑后果。自信但不自负，认真负责但不过度追求完美，能兼顾质量与效率，尊重他人的贡献。', // 个人性格描述，启用性格测评或最高／最低评分模式时加入系统提示词
  assessmentFixedClick: false, // 固定坐标开关，开启后优先使用用户配置的选项和下一步位置
  assessmentFixedPositions: { A: null, B: null, C: null, D: null }, // 各选项的屏幕物理像素坐标 { x, y }；null 表示未配置，可增删选项
  assessmentNextPosition: null, // 固定的下一步按钮坐标 { x, y }，单位为屏幕物理像素；null 表示未配置
  assessmentSmoothMouse: false, // 平滑移动鼠标开关，默认关闭；开启后沿当前实现的直线路径移动
  assessmentMouseParkingEnabled: false, // 截图前移开鼠标的开关，默认关闭，用于减少选项悬停高亮干扰
  assessmentMouseParkingRegions: [], // 允许鼠标停放的屏幕区域列表，物理像素坐标；空列表时不启用停放
  hasConfiguredApi: false, // 是否曾保存过非空 API Key，用于控制首次配置引导是否显示
  apiBaseURL: '', // 当前编辑配置的 API 地址镜像，初始为空；修改应通过配置更新方法同步
  customBaseURLs: [], // 用户自行添加的 API 地址列表，供地址选择器复用
  apiKey: '', // 当前编辑配置的 API Key 镜像，默认未填写
  apiHeaders: '', // 当前编辑配置的自定义请求头，每行 Name: Value，默认无额外请求头
  model: '', // 当前编辑配置的模型名称镜像，初始为空
  disableThinking: false, // 当前编辑配置的关闭思考开关，默认不主动关闭模型思考
  customModels: [], // 旧版保存的全局自定义模型列表，兼容保留，在各 API 地址下均可选
  customModelsByBaseURL: {}, // 按规范化 API 地址分别保存的自定义模型列表
  modelByBaseURL: {}, // 记录各 API 地址上次使用的模型，切换回该地址时可恢复
  customPrompt: PRESET_SCENE_PROMPTS[CODING_SCENE_ID], // 截图模式系统提示词，初始使用编程场景，后续由当前场景生成
  conversationPrompt: PRESET_SCENE_PROMPTS[TECH_INTERVIEW_SCENE_ID], // 对话模式系统提示词，初始使用技术面试场景，后续由当前场景生成
  scenes: createPresetScenes(), // 初始化截图和对话模式的预设提示词场景列表
  activeSceneId: CODING_SCENE_ID, // 截图模式当前场景 ID，默认选中编程场景
  conversationSceneId: TECH_INTERVIEW_SCENE_ID, // 对话模式当前场景 ID，默认选中技术面试场景
  removedPresetSceneIds: [], // 用户已删除的预设场景 ID，防止下次启动自动补回

  opacity: 0.8, // 窗口不透明度，范围 0.1～1；0.8 表示 80% 不透明
  resizable: true, // 允许拖动主窗口边缘调整大小，默认开启
  showOverlayToolbar: true, // 模式页面显示悬浮工具栏，默认开启
  hideShortcutHints: false, // 隐藏页面底部快捷键提示文字，默认不隐藏
  toolbarHoverDelay: 1000, // 悬停工具栏按钮触发操作的等待时间，单位毫秒；1000 为 1 秒，0 禁用悬停触发
  screenshotDisplay: 'gallery', // 截图展示方式，gallery 表示显示全部截图缩略图
  captureScreen: CAPTURE_SCREEN_CURSOR, // 截图屏幕选择，cursor 表示跟随鼠标所在屏幕，也可指定屏幕 ID
  captureRegion: null, // 截图裁剪区域，null 表示截取整屏；非空时使用指定屏幕上的比例区域

  screenshotAutoSave: false, // 自动保存截图到磁盘，默认关闭
  screenshotDir: '', // 截图保存目录，空值时使用系统图片目录下的 InterviewCoder 文件夹

  codeAutoSave: false, // 回答完成后自动将首个代码块保存为源文件，默认关闭
  codeSaveDir: '', // 生成代码的保存目录，未设置目录时不保存文件
  codeFileBaseName: 'Test', // 生成代码的文件名主体，不含扩展名，默认 Test
  codeNamingMode: 'sequence', // 代码命名策略：sequence 依次编号，overwrite 覆盖同名文件
  codeCopyToClipboard: false, // 回答完成后自动复制首个代码块到剪贴板，默认关闭

  dashscopeApiKey: '', // 阿里云 DashScope 语音识别 API Key，默认未填写

  hideDockIcon: false, // 隐藏 macOS Dock 图标，默认不隐藏；其他系统不生效

  audioInputDeviceId: '', // 语音输入设备 ID，空值表示采集系统音频，非空表示指定麦克风
  audioOutputDeviceId: '', // 音频上下文使用的输出设备 ID，空值表示系统默认设备

  lastMode: 'screenshot', // 上次停留的模式，初次启动为截图模式，后续按保存的模式恢复
  conversationHintMode: 'auto', // 对话提示触发方式：auto 自动生成，manual 由用户手动触发
  conversationSilenceMs: 800, // 语音识别判定一句话结束的静音时长，单位毫秒，默认 800
  conversationMinChars: 4, // 自动生成对话提示所需的最少有效字符数，默认 4，标点等不计入
  conversationTranscriptHidden: false // 隐藏对话模式转录文字列，默认显示；隐藏后提示区域可占满宽度
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      ...defaultSettings,
      updateSetting: (key, value) => {
        set({ [key]: value })
        // Setting a key from anywhere in the UI means the user is set up, so
        // the welcome dialog stays away from then on (see `hasConfiguredApi`)
        if (key === 'apiKey' && typeof value === 'string' && value.trim()) {
          set({ hasConfiguredApi: true })
        }
      },
      setApiBaseURL: (url) => {
        const state = get()
        const from = normalizeBaseURL(state.apiBaseURL)
        const to = normalizeBaseURL(url)
        if (from === to) {
          set({ apiBaseURL: url })
          return null
        }
        const modelByBaseURL = { ...state.modelByBaseURL }
        if (state.model) modelByBaseURL[from] = state.model
        const linked = resolveLinkedModel({
          model: state.model,
          baseURL: to,
          remembered: modelByBaseURL[to],
          customModels: state.customModelsByBaseURL[to] ?? []
        })
        const model = linked?.model ?? state.model
        if (model) modelByBaseURL[to] = model
        set({
          apiBaseURL: url,
          model,
          modelByBaseURL,
          apiProfiles: patchActiveProfile(state.apiProfiles, state.activeProfileId, {
            apiBaseURL: url,
            model
          })
        })
        return linked && linked.model !== state.model
          ? { from: state.model, to: linked.model, reason: linked.reason }
          : null
      },
      setModel: (model) => {
        set((state) => {
          const key = normalizeBaseURL(state.apiBaseURL)
          const modelByBaseURL = { ...state.modelByBaseURL }
          if (model) modelByBaseURL[key] = model
          else delete modelByBaseURL[key]
          // The active profile owns the value, so keep it in step
          return {
            model,
            modelByBaseURL,
            apiProfiles: patchActiveProfile(state.apiProfiles, state.activeProfileId, { model })
          }
        })
      },
      setActiveProfile: (id) => {
        set((state) => {
          const profile = state.apiProfiles.find((p) => p.id === id)
          if (!profile) return {}
          // Restore the profile's own model spelling for its platform
          return {
            activeProfileId: id,
            apiBaseURL: profile.apiBaseURL,
            apiKey: profile.apiKey,
            apiHeaders: profile.apiHeaders,
            model: profile.model,
            disableThinking: profile.disableThinking
          }
        })
      },
      addProfile: (name, copyActive = false) => {
        const state = get()
        const source = copyActive
          ? state.apiProfiles.find((p) => p.id === state.activeProfileId)
          : undefined
        const profile = createProfile({
          name,
          apiBaseURL: source?.apiBaseURL ?? '',
          apiKey: source?.apiKey ?? '',
          apiHeaders: source?.apiHeaders ?? '',
          model: source?.model ?? '',
          disableThinking: source?.disableThinking ?? false,
          vision: source?.vision
        })
        // Only opened for editing: which profile each mode uses is left alone
        set({
          apiProfiles: [...state.apiProfiles, profile],
          activeProfileId: profile.id,
          apiBaseURL: profile.apiBaseURL,
          apiKey: profile.apiKey,
          apiHeaders: profile.apiHeaders,
          model: profile.model,
          disableThinking: profile.disableThinking
        })
        return profile.id
      },
      renameProfile: (id, name) => {
        set((state) => ({
          apiProfiles: patchProfile(state.apiProfiles, id, { name })
        }))
      },
      updateProfile: (id, patch) => {
        set((state) => {
          const apiProfiles = patchProfile(state.apiProfiles, id, patch)
          // Any key saved anywhere means the user is set up
          const configured =
            state.hasConfiguredApi ||
            (typeof patch.apiKey === 'string' && patch.apiKey.trim() !== '')
          // The active profile is mirrored onto the live fields the main
          // process reads, so editing it must update those too
          if (id !== state.activeProfileId) return { apiProfiles, hasConfiguredApi: configured }
          return {
            apiProfiles,
            hasConfiguredApi: configured,
            ...(patch.apiBaseURL !== undefined ? { apiBaseURL: patch.apiBaseURL } : {}),
            ...(patch.apiKey !== undefined ? { apiKey: patch.apiKey } : {}),
            ...(patch.apiHeaders !== undefined ? { apiHeaders: patch.apiHeaders } : {}),
            ...(patch.model !== undefined ? { model: patch.model } : {}),
            ...(patch.disableThinking !== undefined
              ? { disableThinking: patch.disableThinking }
              : {})
          }
        })
      },
      removeProfile: (id) => {
        const state = get()
        if (state.apiProfiles.length <= 1) return false
        const index = state.apiProfiles.findIndex((p) => p.id === id)
        if (index === -1) return false

        const apiProfiles = state.apiProfiles.filter((p) => p.id !== id)
        // A mode that used it hands over to its neighbour
        const next = apiProfiles[Math.min(index, apiProfiles.length - 1)]
        const modeProfiles: Partial<Settings> = {}
        for (const mode of APP_MODES) {
          if (state[mode.profileKey] === id) {
            modeProfiles[mode.profileKey] = fallbackModeProfile(mode.id, apiProfiles, next.id)!.id
          }
        }
        if (id !== state.activeProfileId) {
          set({ apiProfiles, ...modeProfiles })
          return true
        }
        // Removing the one being edited opens its neighbour instead
        set({
          apiProfiles,
          ...modeProfiles,
          activeProfileId: next.id,
          apiBaseURL: next.apiBaseURL,
          apiKey: next.apiKey,
          apiHeaders: next.apiHeaders,
          model: next.model,
          disableThinking: next.disableThinking
        })
        return true
      },
      setModeProfile: (mode, id) => {
        const profile = get().apiProfiles.find((p) => p.id === id)
        if (!profile || !supportsMode(profile, mode)) return
        set({ [getModeDefinition(mode).profileKey]: id })
      },
      cycleProfile: (mode, step = 1) => {
        const state = get()
        const currentId = state[getModeDefinition(mode).profileKey]
        // Stepping onto a profile that cannot read screenshots would only fail
        const candidates = state.apiProfiles.filter(
          (p) => supportsMode(p, mode) || p.id === currentId
        )
        if (candidates.length < 2) return null
        const index = Math.max(
          0,
          candidates.findIndex((p) => p.id === currentId)
        )
        const count = candidates.length
        const next = candidates[(((index + step) % count) + count) % count]
        get().setModeProfile(mode, next.id)
        return next
      },
      markApiConfigured: () => {
        if (!get().hasConfiguredApi) set({ hasConfiguredApi: true })
      },
      updateCredential: (patch) => {
        set((state) => {
          const configured =
            state.hasConfiguredApi ||
            (typeof patch.apiKey === 'string' && patch.apiKey.trim() !== '')
          return {
            ...patch,
            hasConfiguredApi: configured,
            apiProfiles: patchActiveProfile(state.apiProfiles, state.activeProfileId, patch)
          }
        })
      },
      addCustomModel: (baseURL, model) => {
        set((state) => {
          const key = normalizeBaseURL(baseURL)
          const list = state.customModelsByBaseURL[key] ?? []
          if (list.includes(model) || state.customModels.includes(model)) return {}
          return {
            customModelsByBaseURL: { ...state.customModelsByBaseURL, [key]: [...list, model] }
          }
        })
      },
      removeCustomModel: (baseURL, model) => {
        set((state) => {
          const key = normalizeBaseURL(baseURL)
          const customModelsByBaseURL = { ...state.customModelsByBaseURL }
          const list = (customModelsByBaseURL[key] ?? []).filter((m) => m !== model)
          if (list.length > 0) customModelsByBaseURL[key] = list
          else delete customModelsByBaseURL[key]
          return {
            customModels: state.customModels.filter((m) => m !== model),
            customModelsByBaseURL
          }
        })
      },
      adjustOpacity: (delta) => {
        const raw = get().opacity + delta
        // Round to 2 decimals to avoid float drift across repeated presses
        const opacity = Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, Math.round(raw * 100) / 100))
        set({ opacity })
      },
      syncSettings: (settings) => {
        set(settings)
        // Credentials filled in from main (.env) belong to the active profile too
        const credentials = Object.fromEntries(
          CREDENTIAL_KEYS.filter((key) => settings[key] !== undefined).map((key) => [
            key,
            settings[key]
          ])
        )
        if (Object.keys(credentials).length > 0) get().updateCredential(credentials)
      },
      setActiveScene: (id) => {
        set((state) => {
          const scene = state.scenes.find((s) => s.id === id)
          if (!scene) return {}
          const mode = sceneMode(scene)
          const keys = SCENE_KEYS[mode]
          return { [keys.sceneId]: id, [keys.prompt]: composePrompt(state.scenes, id, mode) }
        })
      },
      cycleScene: (mode) => {
        const state = get()
        const scenes = scenesOf(state.scenes, mode)
        if (scenes.length === 0) return ''
        const activeId = state[SCENE_KEYS[mode].sceneId]
        // An unknown active id starts over from the first scene
        const next = scenes[(scenes.findIndex((s) => s.id === activeId) + 1) % scenes.length]
        get().setActiveScene(next.id)
        return next.name
      },
      updateScenePrompt: (id, prompt) => {
        set((state) => {
          const scenes = state.scenes.map((s) => (s.id === id ? { ...s, prompt } : s))
          return {
            scenes,
            ...composePrompts(scenes, state.activeSceneId, state.conversationSceneId)
          }
        })
      },
      addScene: (name, mode) => {
        const id = `custom-${Date.now()}`
        set((state) => {
          const scenes = [...state.scenes, { id, name, prompt: '', isPreset: false, mode }]
          const keys = SCENE_KEYS[mode]
          return { scenes, [keys.sceneId]: id, [keys.prompt]: composePrompt(scenes, id, mode) }
        })
        return id
      },
      removeScene: (id) => {
        const state = get()
        const removed = state.scenes.find((s) => s.id === id)
        if (!removed) return false
        const mode = sceneMode(removed)
        const siblings = scenesOf(state.scenes, mode)
        // One must remain per mode, or there is nothing to pick and no prompt to edit
        if (siblings.length <= 1) return false

        const scenes = state.scenes.filter((s) => s.id !== id)
        const keys = SCENE_KEYS[mode]
        // Removing the active scene hands over to its neighbour in the same mode
        const index = siblings.findIndex((s) => s.id === id)
        const remaining = siblings.filter((s) => s.id !== id)
        const activeId =
          state[keys.sceneId] === id
            ? remaining[Math.min(index, remaining.length - 1)].id
            : state[keys.sceneId]
        set({
          scenes,
          [keys.sceneId]: activeId,
          [keys.prompt]: composePrompt(scenes, activeId, mode),
          // Presets are rebuilt on every load, so a deleted one must be remembered
          ...(removed.isPreset
            ? { removedPresetSceneIds: [...state.removedPresetSceneIds, id] }
            : {})
        })
        return true
      },
      restorePresetScenes: (mode) => {
        set((state) => {
          const presetIds = new Set(scenesOf(createPresetScenes(), mode).map((s) => s.id))
          const removedPresetSceneIds = state.removedPresetSceneIds.filter(
            (id) => !presetIds.has(id)
          )
          const scenes = assembleScenes(state.scenes, removedPresetSceneIds)
          return {
            scenes,
            removedPresetSceneIds,
            ...composePrompts(scenes, state.activeSceneId, state.conversationSceneId)
          }
        })
      }
    }),
    {
      name: 'interview-coder-settings',
      version: 8,
      migrate: (persisted, version) => {
        const state = persisted as Partial<Settings>
        // Drop the legacy codeLanguage field (language now lives in the prompt text)
        delete (state as Record<string, unknown>).codeLanguage
        if (version < 8) {
          // Hover-delay options are now 0.5s / 1s / 2s; snap the retired ones
          // so the Select still matches an item
          if (state.toolbarHoverDelay === 800 || state.toolbarHoverDelay === 1200) {
            state.toolbarHoverDelay = 1000
          }
        }
        if (version < 5) {
          // Convert the legacy free-form customPrompt into a custom scene
          const scenes = createPresetScenes()
          let activeSceneId = CODING_SCENE_ID
          const legacyPrompt = (state.customPrompt ?? '').trim()
          if (legacyPrompt) {
            const id = `custom-${Date.now()}`
            scenes.push({ id, name: '自定义场景', prompt: legacyPrompt, isPreset: false })
            activeSceneId = id
          }
          return { ...state, scenes, activeSceneId }
        }
        return state
      },
      merge: (persisted, current) => {
        const state = { ...current, ...(persisted as Partial<Settings>) }
        // The old fractional picker rectangle cannot be converted without its display.
        // Start manual coordinates empty and disabled until the user saves them.
        if (
          !Array.isArray(state.assessmentMouseParkingRegions) ||
          !state.assessmentMouseParkingRegions.every(isMouseParkingRegion)
        ) {
          state.assessmentMouseParkingRegions = []
        }
        if (!state.assessmentMouseParkingRegions.length) state.assessmentMouseParkingEnabled = false
        state.ocrFilterMargins = normalizeOcrFilterMargins(state.ocrFilterMargins)
        // Rebuild the presets on every load, so ones added in a later version
        // show up for existing users; the ones the user deleted stay out
        const persistedScenes = Array.isArray(state.scenes) ? state.scenes : []
        state.removedPresetSceneIds = Array.isArray(state.removedPresetSceneIds)
          ? state.removedPresetSceneIds
          : []
        state.scenes = assembleScenes(persistedScenes, state.removedPresetSceneIds)
        for (const mode of ['screenshot', 'conversation'] as const) {
          // Deleting refuses a mode's last scene, but a hand-edited store could
          // still arrive without any; its presets are the only sensible offer then
          if (scenesOf(state.scenes, mode).length === 0) {
            const presetIds = new Set(scenesOf(createPresetScenes(), mode).map((s) => s.id))
            state.removedPresetSceneIds = state.removedPresetSceneIds.filter(
              (id) => !presetIds.has(id)
            )
            state.scenes = assembleScenes(persistedScenes, state.removedPresetSceneIds)
          }
          const key = SCENE_KEYS[mode].sceneId
          const scenes = scenesOf(state.scenes, mode)
          if (!scenes.some((s) => s.id === state[key])) state[key] = scenes[0].id
        }
        Object.assign(
          state,
          composePrompts(state.scenes, state.activeSceneId, state.conversationSceneId)
        )
        state.apiProfiles = reconcileApiProfiles(state)
        // Before modes existed the profile being edited was the one in use
        for (const mode of APP_MODES) {
          const key = mode.profileKey
          if (!state.apiProfiles.some((p) => p.id === state[key])) {
            state[key] = fallbackModeProfile(
              mode.id,
              state.apiProfiles,
              state.screenshotProfileId || state.activeProfileId
            )!.id
          }
        }
        return state
      }
    }
  )
)

/**
 * Keep the profile list and the live API fields consistent after a rehydrate.
 *
 * Runs on every load, which covers all the cases at once: a fresh install (no
 * profiles yet), an upgrade from a version that had only the flat fields (adopt
 * them as the first profile, so nobody loses the key they already entered), and
 * an ordinary load (trust the stored list).
 */
function reconcileApiProfiles(state: Settings): ApiProfile[] {
  // Profiles saved before custom headers, the thinking switch or the image
  // flag existed carry none of them
  const profiles = (Array.isArray(state.apiProfiles) ? state.apiProfiles : []).map((p) => ({
    ...p,
    apiHeaders: p.apiHeaders ?? '',
    disableThinking: p.disableThinking ?? false,
    vision: p.vision ?? knownVision(p.model ?? '')
  }))
  const active = profiles.find((p) => p.id === state.activeProfileId)

  if (profiles.length === 0) {
    const seeded: ApiProfile = {
      id: state.activeProfileId || 'profile-default',
      name: '配置1',
      apiBaseURL: state.apiBaseURL ?? '',
      apiKey: state.apiKey ?? '',
      apiHeaders: state.apiHeaders ?? '',
      model: state.model ?? '',
      disableThinking: false,
      vision: knownVision(state.model ?? '')
    }
    state.activeProfileId = seeded.id
    state.hasConfiguredApi = !!seeded.apiKey.trim()
    return [seeded]
  }

  if (!active) {
    // The stored active id points nowhere (removed by hand, or restored from a
    // backup): fall back to the first profile rather than leaving nothing set
    const first = profiles[0]
    state.activeProfileId = first.id
    state.apiBaseURL = first.apiBaseURL
    state.apiKey = first.apiKey
    state.apiHeaders = first.apiHeaders
    state.model = first.model
    state.disableThinking = first.disableThinking
    state.hasConfiguredApi = hasAnyApiKey(profiles)
    return profiles
  }

  // Upgrades from before this flag existed: any saved key counts as configured,
  // so an existing user is never met by the welcome dialog again
  state.hasConfiguredApi = state.hasConfiguredApi || hasAnyApiKey(profiles)

  // The active profile owns the credentials and the flat fields are its mirror
  // — the ones the main process reads to send requests and take screenshots.
  // The profile wins, so the stored URL / key / model come back on restart.
  const resolved = {
    apiBaseURL: active.apiBaseURL || state.apiBaseURL,
    apiKey: active.apiKey || state.apiKey,
    model: active.model || state.model
  }
  state.apiBaseURL = resolved.apiBaseURL
  state.apiKey = resolved.apiKey
  state.model = resolved.model
  // Headers and the thinking switch came in with profiles, so no flat value
  // predates them to adopt
  state.apiHeaders = active.apiHeaders
  state.disableThinking = active.disableThinking

  // A profile saved before these fields existed adopts whatever the flat
  // fields held, so an upgrade never silently blanks the user's credentials
  const needsSeeding =
    active.apiBaseURL !== resolved.apiBaseURL ||
    active.apiKey !== resolved.apiKey ||
    active.model !== resolved.model

  return needsSeeding ? patchProfile(profiles, active.id, resolved) : profiles
}

/** Whether at least one profile has a usable API key */
function hasAnyApiKey(profiles: ApiProfile[]): boolean {
  return profiles.some((p) => (p.apiKey ?? '').trim() !== '')
}
