import { useCallback, useEffect, useState } from 'react'
import { Crop } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { CAPTURE_SCREEN_CURSOR, useSettingsStore } from '@/lib/store/settings'
import { regionToPixels } from '../../../shared/capture-region'

type DisplayOption = Awaited<ReturnType<Window['api']['getDisplays']>>[number]

/** e.g. `屏幕 1 · 主屏 · 2560×1440 · DELL U2720Q` */
function describeDisplay(display: DisplayOption, index: number): string {
  return [
    `屏幕 ${index + 1}`,
    display.primary && '主屏',
    `${display.width}×${display.height}`,
    display.label
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * Where screenshots come from: which screen, and optionally just one area of
 * it. Both only matter to main at capture time; a screen that is gone is
 * passed over there, and the choice is kept for when it is plugged back in.
 */
export function CaptureTargetFields() {
  const { captureScreen, captureRegion, updateSetting } = useSettingsStore()
  const [displays, setDisplays] = useState<DisplayOption[]>([])
  const [picking, setPicking] = useState(false)

  // Also re-read on every open, so a monitor plugged in while this page is up shows up
  const refreshDisplays = useCallback(() => {
    void window.api.getDisplays().then(setDisplays)
  }, [])
  useEffect(refreshDisplays, [refreshDisplays])

  // Before the list arrives, no screen is known to be gone
  const isGone = (id: string) => displays.length > 0 && !displays.some((d) => d.id === id)

  const followsCursor = captureScreen === CAPTURE_SCREEN_CURSOR
  const screenGone = !followsCursor && isGone(captureScreen)

  const regionIndex = captureRegion
    ? displays.findIndex((d) => d.id === captureRegion.displayId)
    : -1
  const regionGone = captureRegion !== null && isGone(captureRegion.displayId)
  // A region pins the capture to its own screen, overriding the screen choice
  const regionActive = captureRegion !== null && !regionGone
  const regionSize =
    captureRegion && regionIndex >= 0 && regionToPixels(captureRegion, displays[regionIndex])

  // The result reaches the store through App's `onCaptureRegionPicked`, the
  // same way as a pick started from the toolbar or the shortcut
  const pickRegion = async () => {
    setPicking(true)
    try {
      await window.api.pickCaptureRegion()
    } finally {
      setPicking(false)
    }
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">
          截图屏幕
          <span className="ml-2 text-xs font-light">
            {regionActive
              ? '已框选截图区域，固定截取区域所在的屏幕'
              : followsCursor
                ? '多显示器时截取鼠标所在的屏幕；用悬浮工具条截图时鼠标在工具条上，可改为固定屏幕'
                : screenGone
                  ? '所选屏幕当前未连接，暂时截取鼠标所在的屏幕，接回后自动恢复'
                  : '无论鼠标在哪块屏幕，都截取这块屏幕；屏幕按从左到右编号'}
          </span>
        </label>
        <Select
          value={captureScreen}
          disabled={regionActive}
          onValueChange={(val) => updateSetting('captureScreen', val)}
          onOpenChange={(open) => open && refreshDisplays()}
        >
          <SelectTrigger className="w-60 bg-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={CAPTURE_SCREEN_CURSOR}>跟随鼠标（默认）</SelectItem>
            {displays.map((display, index) => (
              <SelectItem key={display.id} value={display.id}>
                {describeDisplay(display, index)}
              </SelectItem>
            ))}
            {screenGone && <SelectItem value={captureScreen}>未连接的屏幕</SelectItem>}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">
          截图区域
          <span className="ml-2 text-xs font-light">
            {!captureRegion
              ? '默认截取整个屏幕；框选后只截这块区域，AI 看得更准，响应也更快'
              : regionGone
                ? '区域所在的屏幕当前未连接，暂时截取整个屏幕，接回后自动恢复'
                : regionSize
                  ? `只截取屏幕 ${regionIndex + 1} 上 ${regionSize.width}×${regionSize.height} 的区域；题目位置变了记得重新框选`
                  : '只截取框选的区域'}
          </span>
        </label>
        <div className="flex w-60 gap-2">
          <Button
            variant="outline"
            className="flex-1 bg-white"
            disabled={picking}
            onClick={() => void pickRegion()}
          >
            <Crop />
            {picking ? '框选中…' : captureRegion ? '重新框选' : '框选区域'}
          </Button>
          {captureRegion && (
            <Button
              variant="outline"
              className="flex-1 bg-white"
              onClick={() => updateSetting('captureRegion', null)}
            >
              恢复整屏
            </Button>
          )}
        </div>
      </div>
    </>
  )
}
