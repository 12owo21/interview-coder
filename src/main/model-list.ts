import { ipcMain } from 'electron'
import { buildRequestHeaders } from '../shared/request-headers'

export interface PlatformModel {
  id: string
  /**
   * Accepts image input; only known when the platform reports modalities
   * (OpenRouter does) or a vision catalog covers the model
   */
  vision?: boolean
}

export type ModelListResult = { models: PlatformModel[] } | { error: string }

/** Extra sources that tell which models take images, for platforms whose `/models` doesn't */
export type VisionCatalog = 'siliconflow'

export interface ListModelsOptions {
  /** Query string for `/models` */
  query?: string
  visionCatalog?: VisionCatalog
  /** The profile's custom request headers, as typed in settings */
  headers?: string
}

/** What @ai-sdk/openai calls when no base URL is set */
const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

/**
 * Ask an OpenAI-compatible platform which models it serves. Runs in main
 * rather than the renderer to avoid CORS, and uses the same global `fetch` as
 * the AI SDK so the result reflects what a real request would hit.
 */
async function listModels(
  baseURL: string,
  apiKey: string,
  { query, visionCatalog, headers }: ListModelsOptions = {}
): Promise<ModelListResult> {
  // Started up front so it downloads alongside the model list
  const visionFlags = visionCatalog ? VISION_CATALOGS[visionCatalog]() : undefined

  const base = (baseURL.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const url = `${base}/models${query ? `?${query}` : ''}`
  let res: Response
  try {
    res = await fetch(url, {
      headers: buildRequestHeaders(apiKey, headers),
      signal: AbortSignal.timeout(10_000)
    })
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError'
    return { error: timedOut ? '请求超时' : '无法连接到该地址' }
  }

  if (res.status === 401 || res.status === 403) return { error: 'API Key 无效或没有权限' }
  if (res.status === 404) return { error: '该地址没有模型列表接口' }
  if (!res.ok) return { error: `接口返回 HTTP ${res.status}` }

  let models: PlatformModel[]
  try {
    const body = await res.json()
    const data: unknown[] = Array.isArray(body?.data) ? body.data : []
    models = data.flatMap((m) => {
      const item = m as { id?: unknown; architecture?: { input_modalities?: unknown } }
      if (typeof item?.id !== 'string') return []
      const modalities = item.architecture?.input_modalities
      return [
        {
          id: item.id,
          vision: Array.isArray(modalities) ? modalities.includes('image') : undefined
        }
      ]
    })
  } catch {
    return { error: '接口返回的不是模型列表' }
  }
  if (models.length === 0) return { error: '接口没有返回任何模型' }

  const flags = await visionFlags
  if (flags) {
    models = models.map((m) => ({ ...m, vision: m.vision ?? flags.get(m.id) }))
  }
  return { models }
}

/**
 * SiliconFlow's `/models` doesn't say which models take images. The console's
 * `tags=VLM` filter runs on a `vlm` flag that, without logging in, only the
 * public model square carries — embedded in its server-rendered page, with no
 * JSON API behind it. That is undocumented, so any failure (fetch, layout
 * change) just leaves vision unknown and the list unfiltered.
 */
const SILICONFLOW_MODEL_SQUARE = 'https://siliconflow.cn/models'
let siliconflowVision: Promise<Map<string, boolean> | undefined> | undefined

function fetchSiliconflowVision(): Promise<Map<string, boolean> | undefined> {
  if (!siliconflowVision) {
    siliconflowVision = fetch(SILICONFLOW_MODEL_SQUARE, { signal: AbortSignal.timeout(10_000) })
      .then(async (res) => {
        if (!res.ok) return undefined
        const flags = parseSiliconflowVision(await res.text())
        return flags.size > 0 ? flags : undefined
      })
      .catch(() => undefined)
    // Keep a success for the session; let the next call retry a failure
    siliconflowVision.then((flags) => {
      if (!flags) siliconflowVision = undefined
    })
  }
  return siliconflowVision
}

/** `modelName` → `vlm` from the Next.js flight data (`self.__next_f.push([1,"…"])`) */
function parseSiliconflowVision(html: string): Map<string, boolean> {
  const payload = [...html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)]
    .map((m) => {
      try {
        return JSON.parse(m[1]) as string
      } catch {
        return ''
      }
    })
    .join('')
  const flags = new Map<string, boolean>()
  for (const entry of payload.split('{"modelId":"').slice(1)) {
    const name = /"modelName":"([^"]+)"/.exec(entry)?.[1]
    const vlm = /"vlm":(true|false)/.exec(entry)?.[1]
    if (name && vlm) flags.set(name, vlm === 'true')
  }
  return flags
}

const VISION_CATALOGS: Record<VisionCatalog, () => Promise<Map<string, boolean> | undefined>> = {
  siliconflow: fetchSiliconflowVision
}

ipcMain.handle(
  'listModels',
  (_event, baseURL: string, apiKey: string, options?: ListModelsOptions) =>
    listModels(baseURL, apiKey, options)
)
