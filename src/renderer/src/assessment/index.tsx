import { useEffect, useRef, useState } from 'react'
import { MousePointerClick } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AppHeader } from '@/coder/AppHeader'
import { useSettingsStore } from '@/lib/store/settings'
import { useAppStore } from '@/lib/store/app'
import { ASSESSMENT_PHASE_LABELS } from '../../../shared/assessment'
import { useAssessmentStore } from '@/lib/store/assessment'
import { OcrDebugPanel } from './OcrDebugPanel'
import { ScoreResultPanel } from './ScoreResultPanel'
import { AiInputPanel } from './AiInputPanel'
import { AiOutputPanel } from './AiOutputPanel'

export default function AssessmentPage() {
  const contentRef = useRef<HTMLElement>(null)
  const opacity = useSettingsStore((state) => state.opacity)
  const syncAppState = useAppStore((state) => state.syncAppState)
  const [localError, setError] = useState<string | null>(null)
  const snapshot = useAssessmentStore((state) => state.snapshot)
  const busy = Boolean(snapshot?.busy)
  const result = snapshot?.result
  const rawOutput = snapshot?.raw ?? ''
  const error = localError || snapshot?.error

  useEffect(() => {
    document.body.style.opacity = opacity.toString()
    return () => {
      document.body.style.opacity = ''
    }
  }, [opacity])

  useEffect(() => {
    useSettingsStore.getState().updateSetting('lastMode', 'assessment')
    window.api.updateAppState({ inAssessmentPage: true })
    window.api.onSyncAppState((state) => syncAppState(state))
    return () => {
      window.api.updateAppState({ inAssessmentPage: false })
      window.api.removeSyncAppStateListener()
    }
  }, [syncAppState])

  useEffect(() => {
    const scroll = (direction: number) => {
      const content = contentRef.current
      content?.scrollBy({ top: direction * content.clientHeight * 0.8, behavior: 'smooth' })
    }
    window.api.onScrollPageUp(() => scroll(-1))
    window.api.onScrollPageDown(() => scroll(1))
    return () => {
      window.api.removeScrollPageUpListener()
      window.api.removeScrollPageDownListener()
    }
  }, [])

  useEffect(() => {
    window.api.onAdjustOpacity((delta) => {
      useSettingsStore.getState().adjustOpacity(delta)
    })
    return () => window.api.removeAdjustOpacityListener()
  }, [])

  useEffect(() => {
    const sync = useAssessmentStore.getState().sync
    const remove = window.api.onAssessmentSnapshot(sync)
    let mounted = true
    window.api
      .getAssessmentSnapshot()
      .then((value) => {
        if (mounted) sync(value)
      })
      .catch((error) => {
        if (mounted) setError(String(error))
      })
    return () => {
      mounted = false
      remove()
    }
  }, [])

  return (
    <div className="assessment-page flex h-screen flex-col overflow-hidden">
      <div className="shrink-0">
        <AppHeader mode="assessment" />
      </div>
      <main ref={contentRef} className="panel-scroll min-h-0 flex-1 overflow-y-auto p-6">
        <section className="mx-auto w-full max-w-md rounded-xl border border-app-border bg-app-card p-6 shadow-sm">
          <div className="mb-5 flex items-center gap-2">
            <MousePointerClick className="size-5" />
            <h1 className="text-base font-medium">做题</h1>
          </div>
          <p className="mt-2 text-xs">
            {snapshot ? ASSESSMENT_PHASE_LABELS[snapshot.phase] : '读取任务状态中…'}
            {snapshot?.looping ? ' · 循环运行' : ''}
          </p>
          <Button
            className="mt-4 w-full"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setError(null)
              void window.api.analyzeAssessment().catch((error) => setError(String(error)))
            }}
          >
            {busy ? '任务进行中…' : '截图并分析一次'}
          </Button>
          {busy && (
            <Button
              className="mt-2 w-full"
              variant="outline"
              onClick={() => void window.api.stopAssessment()}
            >
              停止做题
            </Button>
          )}
          <p className="mt-2 text-xs opacity-60">
            做题快捷键切换循环开始/停止；OCR 预览模式只分析一次。
          </p>
          {snapshot?.debug && <OcrDebugPanel debug={snapshot.debug} />}
          <AiInputPanel input={snapshot?.rawInput ?? null} />
          <AiOutputPanel raw={rawOutput} />
          {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
          {result?.scoring && <ScoreResultPanel scoring={result.scoring} />}
          {result && (
            <pre className="mt-4 max-h-64 overflow-auto rounded-md bg-black/10 p-3 text-xs">
              {JSON.stringify(result, null, 2)}
            </pre>
          )}
        </section>
      </main>
    </div>
  )
}
