/**
 * The two ways the app is used: 截图模式 answers screenshots, 对话模式 turns
 * what the other side of a call says into hints. Each picks its own AI profile
 * and has its own prompt scenes.
 */
export type AppMode = 'screenshot' | 'conversation'

/**
 * One saved AI endpoint: everything needed to send a request. The renderer
 * keeps and edits the list; main picks the one the current mode uses.
 */
export interface ApiProfile {
  id: string
  /** User-facing label, e.g. 「DeepSeek 主力」 */
  name: string
  apiBaseURL: string
  apiKey: string
  /** Extra request headers some platforms need, one `Name: Value` per line */
  apiHeaders: string
  model: string
  /**
   * Ask the model to skip its thinking phase (see main thinking.ts). Kept per
   * profile because whether it helps, and how it is spelled, depends on the
   * platform and model — and so a fast profile and a careful one can sit side by side.
   */
  disableThinking: boolean
  /**
   * Whether the model takes image input: true / false when the platform's model
   * list, the preset table or a refused screenshot said so, absent when unknown.
   * Only 截图模式 needs it; 对话模式 sends text alone.
   */
  vision?: boolean
}
