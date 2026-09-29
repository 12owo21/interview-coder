/**
 * Consuming an AI text stream, shared by 截图模式's answers (shortcuts.ts) and
 * 对话模式's hints (conversation.ts), which each map the outcome to their own
 * IPC events.
 */

export type StreamOutcome =
  /** Ran to the end on its own */
  | { status: 'complete'; text: string }
  /** Cut short through the controller; the caller knows why */
  | { status: 'aborted'; text: string }
  | { status: 'failed'; text: string; error: unknown }

/**
 * Forward every chunk until the stream ends, fails or is aborted. Chunks still
 * arriving after an abort are dropped, so a request that replaced this one
 * never sees them.
 */
export async function consumeStream(
  createStream: (signal: AbortSignal) => AsyncIterable<string>,
  controller: AbortController,
  onChunk: (chunk: string) => void
): Promise<StreamOutcome> {
  const { signal } = controller
  let text = ''
  try {
    for await (const chunk of createStream(signal)) {
      if (signal.aborted) break
      text += chunk
      onChunk(chunk)
    }
  } catch (error) {
    // An abort surfaces as an AbortError; it is not a failure
    if (!signal.aborted) return { status: 'failed', text, error }
  }
  return { status: signal.aborted ? 'aborted' : 'complete', text }
}

type ApiError = Error & {
  responseBody?: string
  statusCode?: number
}

/**
 * Extract meaningful error message from API errors
 */
export function extractErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error) || '未知错误'
  }

  // Try to extract responseBody from AI SDK errors
  const apiError = error as ApiError

  // Try to parse responseBody for detailed message
  if (apiError.responseBody) {
    try {
      const body = JSON.parse(apiError.responseBody)
      if (body.message) {
        return body.message
      }
      if (body.error?.message) {
        return body.error.message
      }
    } catch {
      // If parsing fails, use responseBody as is
      if (typeof apiError.responseBody === 'string' && apiError.responseBody.length < 200) {
        return apiError.responseBody
      }
    }
  }

  // Fallback to error message
  return error.message || '未知错误'
}

/**
 * How platforms word "this model takes no images": OpenAI (`image_url is only
 * supported by certain models`), DeepSeek (`unknown variant \`image_url\``),
 * vLLM (`is not a multimodal model`), OpenRouter (`support image input`)…
 * Kept narrow on purpose: an image that is merely too large must not count.
 */
const IMAGE_REFUSAL =
  /image_url is only supported|unknown variant `image_url`|not a multi-?modal model|(?:does not|doesn't|not) supports? (?:image|vision)|support image input|不支持(?:图片|图像|多模态|视觉)/i

/** Whether the request failed because the model does not take image input */
export function isImageInputRefused(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const { statusCode, responseBody, message } = error as ApiError
  if (statusCode !== undefined && statusCode !== 400 && statusCode !== 422) return false
  return IMAGE_REFUSAL.test(`${responseBody ?? ''}\n${message}`)
}
