import { useState } from 'react'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useSettingsStore } from '@/lib/store/settings'
import { isMouseParkingRegion, type MouseParkingRegion } from '../../../shared/mouse-parking'
import { Field } from './components'

type Coordinate = 'left' | 'top' | 'right' | 'bottom'
type DraftRegion = { id: string } & Record<Coordinate, string>

function toDraft(region: MouseParkingRegion): DraftRegion {
  return {
    id: region.id,
    left: String(region.left),
    top: String(region.top),
    right: String(region.right),
    bottom: String(region.bottom)
  }
}

export function AssessmentMouseSettings() {
  const {
    assessmentSmoothMouse,
    assessmentMouseParkingEnabled,
    assessmentMouseParkingRegions: regions,
    updateSetting
  } = useSettingsStore()
  const [busy, setBusy] = useState(false)
  const [drafts, setDrafts] = useState<DraftRegion[]>(() => regions.map(toDraft))
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')

  const edit = (next: DraftRegion[]): void => {
    setDrafts(next)
    setDirty(true)
    setError('')
  }
  const save = (): void => {
    const next: MouseParkingRegion[] = []
    for (const [index, draft] of drafts.entries()) {
      const region = {
        id: draft.id,
        left: Number(draft.left),
        top: Number(draft.top),
        right: Number(draft.right),
        bottom: Number(draft.bottom)
      }
      if (
        [draft.left, draft.top, draft.right, draft.bottom].some((value) => !value.trim()) ||
        !isMouseParkingRegion(region)
      ) {
        setError(`区域 ${index + 1}：请填入四个非负整数，右下角 X、Y 必须分别大于左上角 X、Y。`)
        return
      }
      next.push(region)
    }
    updateSetting('assessmentMouseParkingRegions', next)
    setDrafts(next.map(toDraft))
    setDirty(false)
    setError('')
    toast.success(
      next.length ? `已保存 ${next.length} 个停放区域` : '已清除自定义区域，将使用默认区域'
    )
  }
  const test = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.api.updateAppSettings({
        assessmentSmoothMouse,
        assessmentMouseParkingRegions: regions
      })
      await window.api.testMouseParking()
      toast.success('鼠标已移入随机停放区域，未执行点击')
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
        note="默认开启。开启后，每次点击前和答题后停放时，鼠标沿直线平滑移动。"
      >
        <Switch
          checked={assessmentSmoothMouse}
          disabled={busy}
          onCheckedChange={(value) => updateSetting('assessmentSmoothMouse', value)}
        />
      </Field>
      <Field
        label="答题后随机停放鼠标"
        note="默认开启。本轮点击完成后，随机停放到当前屏幕 70%～90% 区域；保存自定义区域后改用自定义区域。"
      >
        <Switch
          checked={assessmentMouseParkingEnabled}
          onCheckedChange={(value) => updateSetting('assessmentMouseParkingEnabled', value)}
        />
      </Field>
      <p className="text-xs text-muted-foreground">
        输入矩形左上角和右下角的屏幕像素坐标，与固定点击坐标一致，不是截图内坐标。所有区域应位于答题屏幕的空白处，避开文字和按钮。修改后点击“保存区域”生效。
      </p>
      {drafts.map((draft, index) => (
        <div key={draft.id} className="space-y-2 rounded-md border border-gray-400/40 p-3">
          <div className="flex items-center justify-between text-sm">
            <span>区域 {index + 1}</span>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              aria-label={`删除区域 ${index + 1}`}
              onClick={() => edit(drafts.filter((item) => item.id !== draft.id))}
            >
              <Trash2 className="size-4" />
              删除
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {(['left', 'top', 'right', 'bottom'] as const).map((key) => {
              const label = {
                left: '左上角 X',
                top: '左上角 Y',
                right: '右下角 X',
                bottom: '右下角 Y'
              }[key]
              return (
                <label key={key} className="space-y-1 text-xs">
                  <span>{label}</span>
                  <Input
                    aria-label={`区域 ${index + 1} ${label}`}
                    type="number"
                    min={0}
                    max={2147483647}
                    step={1}
                    placeholder={label}
                    disabled={busy}
                    value={draft[key]}
                    onChange={(event) =>
                      edit(
                        drafts.map((item) =>
                          item.id === draft.id ? { ...item, [key]: event.target.value } : item
                        )
                      )
                    }
                  />
                </label>
              )
            })}
          </div>
        </div>
      ))}
      {!drafts.length && (
        <p className="text-xs text-muted-foreground">
          当前使用默认区域：屏幕宽高的 70%～90%。也可以添加多个自定义区域。
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      {dirty && (
        <p className="text-xs text-amber-600">区域修改尚未保存；保存前仍使用之前的配置。</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            edit([...drafts, { id: crypto.randomUUID(), left: '', top: '', right: '', bottom: '' }])
          }
        >
          <Plus className="size-4" />
          添加区域
        </Button>
        <Button size="sm" disabled={busy || !dirty} onClick={save}>
          保存区域
        </Button>
        <Button size="sm" variant="outline" disabled={busy || dirty} onClick={() => void test()}>
          测试停放（不点击）
        </Button>
      </div>
    </div>
  )
}
