import { useEffect, useRef, useState } from 'react'
import { MousePointerClick } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AppHeader } from '@/coder/AppHeader'
import { useSettingsStore } from '@/lib/store/settings'
import { useAppStore } from '@/lib/store/app'
import { ASSESSMENT_PHASE_LABELS } from '../../../shared/assessment'
import { useAssessmentStore } from '@/lib/store/assessment'
import { OcrDebugPanel } from './OcrDebugPanel'

function parsePoint(value: string): { x: number; y: number } | null {
  const parts = value.split(/[,，\s]+/).filter(Boolean)
  if (parts.length !== 2) return null
  const x = Number(parts[0])
  const y = Number(parts[1])
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) return null
  return { x, y }
}

export default function AssessmentPage() {
  const contentRef = useRef<HTMLElement>(null)
  const opacity = useSettingsStore((state) => state.opacity)
  const syncAppState = useAppStore((state) => state.syncAppState)
  const [pointText, setPointText] = useState('')
  const [screenSize, setScreenSize] = useState<string | null>(null)
  const [message, setMessage] = useState('请输入屏幕坐标，例如：500,300')
  const [manualBusy, setBusy] = useState(false)
  const [localError, setError] = useState<string | null>(null)
  const snapshot = useAssessmentStore((state) => state.snapshot)
  const busy = manualBusy || Boolean(snapshot?.busy)
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

  useEffect(() => {
    window.api.getDisplays().then((displays) => {
      const primary = displays.find((display) => display.primary) ?? displays[0]
      if (primary) setScreenSize(`${primary.width} × ${primary.height}`)
    })
  }, [])

  const clickAnswer = async (answer: 'A' | 'B' | 'C' | 'D') => {
    const point = parsePoint(pointText)
    if (!point) {
      setMessage('坐标格式不正确，请输入两个非负整数，例如：500,300')
      return
    }
    setBusy(true)
    try {
      await window.api.clickScreenPoint(point)
      setMessage(`已点击 ${answer}（${point.x}, ${point.y}）`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

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
          <label className="mb-2 block text-sm opacity-75" htmlFor="click-point">
            点击坐标（x,y）
          </label>
          <Input
            id="click-point"
            value={pointText}
            onChange={(event) => setPointText(event.target.value)}
            placeholder="例如：500,300"
            disabled={busy}
          />
          <p className="mt-1 text-xs opacity-50">
            {screenSize ? `当前主屏：${screenSize}，请输入物理屏幕坐标` : '正在读取屏幕分辨率…'}
          </p>
          <div className="mt-4 grid grid-cols-4 gap-2">
            {(['A', 'B', 'C', 'D'] as const).map((answer) => (
              <Button key={answer} disabled={busy} onClick={() => void clickAnswer(answer)}>
                {answer}
              </Button>
            ))}
          </div>
          <p className="mt-4 text-xs opacity-60">{snapshot?.notice || message}</p>
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
          {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
          {result && (
            <pre className="mt-4 max-h-64 overflow-auto rounded-md bg-black/10 p-3 text-xs">
              {JSON.stringify(result, null, 2)}
            </pre>
          )}
          <div className="mt-4">
            <h2 id="assessment-raw-output-label" className="mb-2 text-sm font-medium">
              AI 原始输出
            </h2>
            <pre
              aria-labelledby="assessment-raw-output-label"
              tabIndex={0}
              className="max-h-64 min-h-24 overflow-auto whitespace-pre-wrap break-all rounded-md border border-app-border bg-black/10 p-3 text-xs select-text"
            >
              {rawOutput || '等待 AI 输出…'}
            </pre>
          </div>
        </section>
      </main>
    </div>
  )
}
