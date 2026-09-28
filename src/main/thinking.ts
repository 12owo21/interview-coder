/**
 * Asking the model to skip its thinking phase.
 *
 * The app never shows a model's reasoning, so while a thinking model reasons
 * the user stares at a spinner. Measured with a screenshot of an easy problem,
 * switching it off took DeepSeek V4.1 Flash and GLM-4.5V from 4–28s to 1–2s
 * before the first visible character; models that do not think by default are
 * unaffected.
 *
 * The OpenAI chat body has no standard field for this and every platform
 * spells it differently, so the fields are merged into the outgoing request
 * body by a fetch wrapper.
 */

/** Hosts whose own spelling applies to every model; mirrors renderer lib/providers.ts */
const OPENROUTER_HOSTS = ['openrouter.ai']
const OPENAI_HOSTS = ['api.openai.com']

/**
 * What a platform says when it refuses one of the fields below, whatever the
 * wording: OpenAI's `Unknown parameter: 'enable_thinking'`, SiliconFlow's
 * `does not support parameter \`enable_thinking\``, OpenRouter's `Reasoning is
 * mandatory for this endpoint`. SiliconFlow names `enable_thinking` even when
 * only `thinking` was sent, so the match covers every spelling rather than just
 * the ones sent.
 */
const THINKING_FIELD_ERROR = /thinking|reasoning/i

/** The API Base URL's host; an empty URL means the SDK default, i.e. OpenAI itself */
function hostOf(baseURL: string): string {
  const url = baseURL.trim()
  if (!url) return OPENAI_HOSTS[0]
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function onHosts(host: string, hosts: string[]): boolean {
  return hosts.some((h) => host === h || host.endsWith(`.${h}`))
}

/** The request-body fields that turn thinking off for this platform and model */
export function thinkingOffFields(baseURL: string, model: string): Record<string, unknown> {
  const host = hostOf(baseURL)
  // OpenRouter translates its own field for whichever model it routes to
  if (onHosts(host, OPENROUTER_HOSTS)) return { reasoning: { enabled: false } }
  // OpenAI rejects every field it does not know, so it gets only its own. A
  // proxy serving GPT models under their own names behaves the same
  if (onHosts(host, OPENAI_HOSTS) || /^(gpt-|o\d)/i.test(model)) {
    return { reasoning_effort: 'none' }
  }
  // DeepSeek, Zhipu and Doubao read `thinking`, Qwen reads `enable_thinking`,
  // and each ignores the other's, so both go along
  return { thinking: { type: 'disabled' }, enable_thinking: false }
}

/** Platform + model pairs that refused the fields; sent without them for the rest of the session */
const refused = new Set<string>()

/**
 * A fetch that adds the thinking-off fields to each chat request. A model that
 * refuses them — a thinking-only model, or a platform that rejects unknown
 * fields — gets the request again without them, so the setting can slow a
 * request down once but never make it fail. `onRefused` fires on that first
 * refusal only.
 */
export function createThinkingOffFetch(
  baseURL: string,
  onRefused: (model: string) => void
): typeof fetch {
  return async (input, init) => {
    let body: unknown
    try {
      body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    } catch {
      body = undefined
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fetch(input, init)

    const model = String((body as { model?: unknown }).model ?? '')
    const key = `${baseURL.trim()}\n${model}`
    if (refused.has(key)) return fetch(input, init)

    const response = await fetch(input, {
      ...init,
      body: JSON.stringify({ ...body, ...thinkingOffFields(baseURL, model) })
    })
    if (response.status !== 400 && response.status !== 422) return response
    const detail = await response
      .clone()
      .text()
      .catch(() => '')
    if (!THINKING_FIELD_ERROR.test(detail)) return response

    refused.add(key)
    onRefused(model)
    return fetch(input, init)
  }
}
