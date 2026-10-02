import { streamText, type ModelMessage } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { settings, getAssessmentProfile, getModeProfile } from './settings'
import type { ApiProfile, AppMode } from '../shared/api-profile'
import { buildRequestHeaders } from '../shared/request-headers'
import { createThinkingOffFetch } from './thinking'
import { getKnowledgePrompt } from './knowledge'

// The system prompts are fully managed by the renderer (prompt scenes in the
// settings store, one active scene per mode) and synced here via
// updateAppSettings on app startup. The mode's 资料库 material goes first
function getSystemPrompt(mode: AppMode, extra?: string) {
  const prompt = mode === 'screenshot' ? settings.customPrompt : settings.conversationPrompt
  return [getKnowledgePrompt(mode), prompt, extra].filter(Boolean).join('\n\n') || undefined
}

/** Tell the user once that the active model ignores the profile's 「关闭思考」 */
function reportThinkingRefused(model: string) {
  const mainWindow = global.mainWindow
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('thinking-unsupported', model)
}

function createProvider(profile: ApiProfile) {
  return createOpenAI({
    baseURL: profile.apiBaseURL,
    apiKey: profile.apiKey,
    headers: buildRequestHeaders(profile.apiKey, profile.apiHeaders),
    // Only when asked for: a plain request is the one every platform accepts
    ...(profile.disableThinking
      ? { fetch: createThinkingOffFetch(profile.apiBaseURL, reportThinkingRefused) }
      : {})
  })
}

function getModel(profile: ApiProfile) {
  const fallbackModel = profile.apiBaseURL.includes('siliconflow')
    ? 'Qwen/Qwen3-VL-32B-Instruct'
    : 'gpt-5-mini'
  return profile.model || fallbackModel
}

function streamWith(
  mode: AppMode,
  messages: ModelMessage[],
  abortSignal: AbortSignal | undefined,
  extraSystem?: string
) {
  const profile = getModeProfile(mode)
  const openai = createProvider(profile)

  const { textStream } = streamText({
    model: openai.chat(getModel(profile)),
    system: getSystemPrompt(mode, extraSystem),
    messages,
    abortSignal,
    onError: (err) => {
      throw err.error ?? err
    }
  })
  return textStream
}

/** Experimental 做题模式: return a strict answer plus option coordinates. */
export function getAssessmentStream(
  messages: ModelMessage[],
  abortSignal?: AbortSignal,
  fixedPositions = false
) {
  const profile = getAssessmentProfile()
  const openai = createProvider(profile)
  const { textStream } = streamText({
    model: openai.chat(getModel(profile)),
    system: [
      '你是一个屏幕题目识别器。识别当前截图中的四个选项并选择正确答案。题目可能是单选、多选，也可能要求按顺序连续选择多个选项。',
      '只输出一个 JSON 对象，不要 Markdown、解释或其他文字。',
      fixedPositions
        ? '格式必须是 {"question":"原题目","answers":["A"],"options":{"A":{"text":"选项A"},"B":{"text":"选项B"},"C":{"text":"选项C"},"D":{"text":"选项D"}}}。只返回选项文本，不要返回坐标。'
        : '格式必须是 {"question":"原题目","answers":["A"],"options":{"A":{"text":"选项A","left":0,"top":0,"right":0,"bottom":0},"B":{"text":"选项B","left":0,"top":0,"right":0,"bottom":0},"C":{"text":"选项C","left":0,"top":0,"right":0,"bottom":0},"D":{"text":"选项D","left":0,"top":0,"right":0,"bottom":0}}}。',
      'answers 必须是非空数组，只能包含 A、B、C、D；单选返回一个元素，多选返回多个元素，有顺序要求时严格按点击顺序排列。不要排序，不要解释，不要重复元素。',
      ...(fixedPositions
        ? []
        : ['每个矩形框必须紧贴对应选项按钮，坐标是截图像素，程序会使用矩形中心点击。'])
    ].join('\n'),
    messages,
    abortSignal,
    onError: (err) => {
      throw err.error ?? err
    }
  })
  return textStream
}

export function getSolutionStream(messages: ModelMessage[], abortSignal?: AbortSignal) {
  return streamWith('screenshot', messages, abortSignal)
}

export function getFollowUpStream(
  messages: ModelMessage[],
  userQuestion: string,
  abortSignal?: AbortSignal
) {
  // Add the user's follow-up question to the conversation
  const updatedMessages: ModelMessage[] = [
    ...messages,
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: userQuestion
        }
      ]
    }
  ]
  return streamWith('screenshot', updatedMessages, abortSignal)
}

export function getGeneralStream(messages: ModelMessage[], abortSignal?: AbortSignal) {
  return streamWith(
    'screenshot',
    messages,
    abortSignal,
    '注意：如果有多张截图，请结合所有截图内容进行完整分析，不要遗漏任何部分。'
  )
}

/** 对话模式: a hint for what the other side just said, with the conversation profile */
export function getHintStream(messages: ModelMessage[], abortSignal?: AbortSignal) {
  return streamWith('conversation', messages, abortSignal)
}
