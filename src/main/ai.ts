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
  fixedPositions = false,
  personalityPrompt = '',
  request?: { profile: ApiProfile; system: string }
) {
  const profile = request?.profile ?? getAssessmentProfile()
  const openai = createProvider(profile)
  const { textStream } = streamText({
    model: openai.chat(getModel(profile)),
    system: request?.system ?? [
      personalityPrompt.trim()
        ? `被测者的个人性格设定如下：\n<personality>\n${personalityPrompt.trim()}\n</personality>\n请依据该性格作答，并与本次测评前后的答案保持一致。`
        : '',
      '你是一个屏幕题目识别器。识别当前截图中的所有选项并选择正确答案。选项数量不固定，可能是单选、多选，也可能要求按顺序连续选择多个选项。',
      '只输出一个 JSON 对象，不要 Markdown、解释或其他文字。',
      '只返回实际存在的选项：两项题返回 A、B，三项题返回 A、B、C，不要补齐到四项。判断题的“正确/错误”“是/否”等按钮也作为选项；没有字母标签时按屏幕从上到下、同一行从左到右编号为 A、B 等，保留按钮原文，answers 仍返回对应字母。',
      fixedPositions
        ? '格式必须是 {"question":"原题目","answers":["A"],"options":{"A":{"text":"选项A"}},"next":{"required":false}}。options 必须包含截图中实际出现的所有选项，选项键按 A、B、C… 顺序使用，只返回选项文本。'
        : '格式必须是 {"question":"原题目","answers":["A"],"options":{"A":{"text":"选项A","left":0,"top":0,"right":0,"bottom":0}},"next":{"required":false,"left":0,"top":0,"right":0,"bottom":0}}。options 必须包含截图中实际出现的所有选项，选项键按 A、B、C… 顺序使用。',
      'answers 必须是非空数组，只能包含实际返回的选项键；单选返回一个元素，多选返回多个元素，有顺序要求时严格按点击顺序排列。不要排序，不要解释，不要重复元素。',
      '如果截图中有明确的“下一步/继续/提交”等按钮且答题后需要点击它，next.required 返回 true，并返回该按钮矩形；否则 next.required 返回 false。',
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
