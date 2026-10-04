import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSettingsStore } from '@/lib/store/settings'
import type { LocalOcrStatus, OcrFilterMargins, OcrResult } from '../../../shared/ocr'

const FILTER_EDGES = [
  ['top', '上'],
  ['bottom', '下'],
  ['left', '左'],
  ['right', '右']
] as const

function MarginInput({ edge, label }: { edge: keyof OcrFilterMargins; label: string }) {
  const value = useSettingsStore((state) => state.ocrFilterMargins[edge])
  const [draft, setDraft] = useState(String(value))

  function save(pixels: number): void {
    const store = useSettingsStore.getState()
    store.updateSetting('ocrFilterMargins', { ...store.ocrFilterMargins, [edge]: pixels })
  }

  return (
    <label className="flex items-center gap-2 text-xs">
      <span>{label}</span>
      <Input
        className="w-24 bg-white"
        aria-label={`OCR ${label}边过滤像素`}
        inputMode="numeric"
        value={draft}
        onChange={(event) => {
          const text = event.target.value
          if (!/^\d*$/.test(text) || (text !== '' && !Number.isSafeInteger(Number(text)))) return
          setDraft(text)
          if (text !== '') save(Number(text))
        }}
        onBlur={() => {
          const pixels = draft === '' ? 0 : Number(draft)
          setDraft(String(pixels))
          save(pixels)
        }}
      />
      <span>像素</span>
    </label>
  )
}

const STATE_LABELS: Record<LocalOcrStatus['state'], string> = {
  starting: '正在启动',
  standby: '已启动，等待识别',
  loading: '首次加载模型',
  recognizing: '正在识别',
  ready: '就绪',
  sleeping: '待命，内存已释放',
  error: '服务异常',
  stopped: '已停止'
}

export function LocalOcrPanel() {
  const [status, setStatus] = useState<LocalOcrStatus | null>(null)
  const [result, setResult] = useState<OcrResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true
    const refresh = (): void => {
      window.api
        .getLocalOcrStatus()
        .then((value) => {
          if (mounted) setStatus(value)
        })
        .catch(() => {
          if (mounted) setError('无法读取本地 OCR 状态')
        })
    }
    refresh()
    const timer = setInterval(refresh, 1500)
    return () => {
      mounted = false
      clearInterval(timer)
    }
  }, [])

  async function testImage(): Promise<void> {
    setBusy(true)
    setError('')
    setResult(null)
    try {
      // Flush the last field edit before invoking OCR, including blur-to-zero.
      await window.api.updateAppSettings({
        ocrFilterMargins: useSettingsStore.getState().ocrFilterMargins
      })
      setResult(await window.api.testLocalOcrImage())
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-5 space-y-3 border-t border-gray-400/40 pt-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">本地 OCR</p>
          <p className="mt-1 text-xs">{status ? STATE_LABELS[status.state] : '读取状态中…'}</p>
        </div>
        <Button variant="outline" disabled={busy} onClick={() => void testImage()}>
          {busy ? '识别中…' : '选择 PNG 测试'}
        </Button>
      </div>
      <p className="text-xs font-light">
        随软件启动，离线识别中文和英文。首次使用时加载模型，空闲 60 秒后释放内存。
        可在上方开启“OCR 定位选项”接入做题；这里可单独选择图片测试。
      </p>
      <div className="space-y-2">
        <p className="text-sm font-medium">OCR 边缘过滤</p>
        <p className="text-xs font-light">
          按输入原图的像素过滤，默认四边各 100 像素；设为 0 表示不过滤该边。
          文字框中心落在边缘范围内时忽略，保留文字的坐标不变。修改自动保存，下次识别生效。
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {FILTER_EDGES.map(([edge, label]) => (
            <MarginInput key={edge} edge={edge} label={label} />
          ))}
        </div>
      </div>
      {status?.memoryMiB !== undefined && (
        <p className="text-xs">最近识别后 OCR 进程内存约 {status.memoryMiB} MiB</p>
      )}
      {(error || status?.error) && (
        <p className="break-all text-xs text-red-700">{error || status?.error}</p>
      )}
      {result && (
        <div className="space-y-2">
          <p className="text-xs">
            {result.imageSize.width} × {result.imageSize.height}，识别到{' '}
            {result.filter?.originalCount ?? result.regions.length} 个文字区域，过滤掉{' '}
            {result.filter?.removedCount ?? 0} 个，保留 {result.regions.length} 个，耗时{' '}
            {result.elapsedMs} ms（不含首次模型加载）。坐标相对于原图。
          </p>
          {result.filter?.emptyArea && (
            <p className="text-xs text-amber-700">
              过滤范围覆盖了整张图片，请减小上下或左右的过滤像素后重新识别。
            </p>
          )}
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-white/60 p-3 text-xs select-text">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}
