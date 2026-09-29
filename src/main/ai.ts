import { streamText, type ModelMessage } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { settings, getModeProfile } from './settings'
import type { ApiProfile, AppMode } from '../shared/api-profile'
import { buildRequestHeaders } from '../shared/request-headers'
import { createThinkingOffFetch } from './thinking'

// The system prompts are fully managed by the renderer (prompt scenes in the
// settings store, one active scene per mode) and synced here via
// updateAppSettings on app startup
function getSystemPrompt(mode: AppMode, extra?: string) {
  const prompt = mode === 'screenshot' ? settings.customPrompt : settings.conversationPrompt
  return [prompt, extra].filter(Boolean).join('\n\n') || undefined
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
