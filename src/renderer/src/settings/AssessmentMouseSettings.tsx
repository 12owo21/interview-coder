import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useSettingsStore } from '@/lib/store/settings'
import { Field } from './components'

export function AssessmentMouseSettings() {
  const {
    assessmentSmoothMouse,
    assessmentMouseParkingEnabled,
    assessmentMouseParkingRegion: region,
    updateSetting
  } = useSettingsStore()
  const [busy, setBusy] = useState(false)

  const pick = async (): Promise<void> => {
    setBusy(true)
    try {
      const selected = await window.api.pickMouseParkingRegion()
      if (selected) updateSetting('assessmentMouseParkingRegion', selected)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  const test = async (): Promise<void> => {
    setBusy(true)
    try {
      // Ensure a just-edited setting has reached main before the test starts.
      await window.api.updateAppSettings({
        assessmentSmoothMouse,
        assessmentMouseParkingRegion: region
      })
      await window.api.testMouseParking()
      toast.success('鼠标已移入停放区域，未执行点击')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 border-b border-gray-400/40 pb-4">
      <Field
        label="鼠标直线移动"
        note="默认关闭。开启后，每次点击前和答题后停放时，鼠标沿直线平滑移动。"
      >
        <Switch
          checked={assessmentSmoothMouse}
          disabled={busy}
          onCheckedChange={(value) => updateSetting('assessmentSmoothMouse', value)}
        />
      </Field>
      <Field
        label="答题后随机停放鼠标"
        note="本轮选项和下一步点击完成后，移到指定区域内的随机位置，不点击。预览模式不移动鼠标。"
      >
        <Switch
          checked={assessmentMouseParkingEnabled}
          disabled={busy || !region}
          onCheckedChange={(value) => updateSetting('assessmentMouseParkingEnabled', value)}
        />
      </Field>
      <div className="space-y-2 text-xs">
        <p className="text-muted-foreground">
          请框选答题屏幕上的空白处，避开文字、按钮及悬浮提示。停放区域独立于截图区域；关闭直线移动时直接跳到停放点。
        </p>
        <p>
          {region
            ? `已设置：屏幕 ${region.displayId} · 左 ${Math.round(region.x * 100)}% / 上 ${Math.round(region.y * 100)}% · 宽 ${Math.round(region.width * 100)}% × 高 ${Math.round(region.height * 100)}%`
            : '尚未设置停放区域'}
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void pick()}>
            {region ? '重新框选' : '框选停放区域'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !region}
            onClick={() => void test()}
          >
            测试停放（不点击）
          </Button>
          {region && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                updateSetting('assessmentMouseParkingEnabled', false)
                updateSetting('assessmentMouseParkingRegion', null)
              }}
            >
              清除
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
