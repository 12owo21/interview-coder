import { useEffect, useState } from 'react'
import { MousePointerClick } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AppHeader } from '@/coder/AppHeader'
import { useSettingsStore } from '@/lib/store/settings'
import { useAppStore } from '@/lib/store/app'

function parsePoint(value: string): { x: number; y: number } | null {
  const parts = value.split(/[,，\s]+/).filter(Boolean)
  if (parts.length !== 2) return null
  const x = Number(parts[0])
  const y = Number(parts[1])
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) return null
  return { x, y }
}

export default function AssessmentPage() {
  const opacity = useSettingsStore((state) => state.opacity)
  const syncAppState = useAppStore((state) => state.syncAppState)
  const [pointText, setPointText] = useState('')
  const [screenSize, setScreenSize] = useState<string | null>(null)
  const [message, setMessage] = useState('请输入屏幕坐标，例如：500,300')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    document.body.style.opacity = opacity.toString()
    return () => {
      document.body.style.opacity = ''
    }
  }, [opacity])

  useEffect(() => {
    window.api.updateAppState({ inCoderPage: true })
    window.api.onSyncAppState((state) => syncAppState(state))
    return () => {
      window.api.updateAppState({ inCoderPage: false })
      window.api.removeSyncAppStateListener()
    }
  }, [syncAppState])

  useEffect(() => {
    window.api.onAdjustOpacity((delta) => {
      useSettingsStore.getState().adjustOpacity(delta)
    })
    return () => window.api.removeAdjustOpacityListener()
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
    <div className="flex h-screen flex-col">
      <AppHeader mode="assessment" />
      <main className="flex flex-1 items-center justify-center p-6">
        <section className="w-full max-w-md rounded-xl border border-app-border bg-app-card p-6 shadow-sm">
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
          <p className="mt-4 text-xs opacity-60">{message}</p>
        </section>
      </main>
    </div>
  )
}
