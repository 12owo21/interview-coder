import { useCallback, useEffect, useState } from 'react'
import { findProvider, normalizeBaseURL, type PlatformModel } from './providers'

export type PlatformModelsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; models: PlatformModel[] }
  | { status: 'error'; error: string }

type ModelListResult = { models: PlatformModel[] } | { error: string }

/** Session cache keyed by URL + key + headers; failures are dropped so a retry refetches */
const cache = new Map<string, Promise<ModelListResult>>()

/** Wait for typing in the URL / API Key fields to settle before hitting the network */
const FETCH_DELAY_MS = 600

/**
 * The model list the platform behind `baseURL` reports, fetched once per
 * URL + key + headers for the session. Stays `idle` while an API key is required but missing.
 */
export function usePlatformModels(baseURL: string, apiKey: string, headers: string) {
  const [state, setState] = useState<PlatformModelsState>({ status: 'idle' })
  const [attempt, setAttempt] = useState(0)

  const url = normalizeBaseURL(baseURL)
  const key = apiKey.trim()
  const cacheKey = `${url}\n${key}\n${headers}`
  const provider = findProvider(url)
  const canFetch = !!key || !!provider?.publicModelList
  const query = provider?.modelListQuery
  const visionCatalog = provider?.visionCatalog

  useEffect(() => {
    if (!canFetch) {
      setState({ status: 'idle' })
      return
    }
    let cancelled = false
    setState({ status: 'loading' })
    const run = () => {
      let request = cache.get(cacheKey)
      if (!request) {
        request = window.api
          .listModels(url, key, { query, visionCatalog, headers })
          .catch((): ModelListResult => ({ error: '获取模型列表失败' }))
        cache.set(cacheKey, request)
      }
      request.then((result) => {
        if ('error' in result) cache.delete(cacheKey)
        if (cancelled) return
        setState(
          'error' in result
            ? { status: 'error', error: result.error }
            : { status: 'ready', models: result.models }
        )
      })
    }
    if (cache.has(cacheKey)) {
      run()
      return () => {
        cancelled = true
      }
    }
    const timer = setTimeout(run, FETCH_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [cacheKey, canFetch, url, key, headers, query, visionCatalog, attempt])

  const reload = useCallback(() => {
    cache.delete(cacheKey)
    setAttempt((n) => n + 1)
  }, [cacheKey])

  return { ...state, reload }
}
