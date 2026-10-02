import { useState } from 'react'
import { MousePointerClick } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useSettingsStore } from '@/lib/store/settings'
import { Field, SettingsCard } from '../components'

export function AssessmentSection({ onEditProfile }: { onEditProfile: (id: string) => void }) {
  const {
    apiProfiles,
    assessmentProfileId,
    assessmentFixedClick,
    assessmentFixedPositions,
    updateSetting
  } = useSettingsStore()
  const selected = apiProfiles.find((profile) => profile.id === assessmentProfileId)
  const [draftPositions, setDraftPositions] = useState(() =>
    Object.fromEntries(
      (['A', 'B', 'C', 'D'] as const).map((letter) => {
        const point = assessmentFixedPositions[letter]
        return [letter, { x: point ? String(point.x) : '', y: point ? String(point.y) : '' }]
      })
    ) as Record<'A' | 'B' | 'C' | 'D', { x: string; y: string }>
  )

  return (
    <SettingsCard Icon={MousePointerClick} title="做题模式 AI">
      <p className="-mt-2 mb-4 text-xs font-light">
        做题模式会把快捷键截取的屏幕截图发送给这里选择的视觉模型。API 地址、Key、模型和请求头在「AI 模型」中编辑。
      </p>
      <Field
        label="使用的 AI 配置"
        note={
          selected ? (
            <button
              className="ml-1 cursor-pointer text-blue-700 hover:underline"
              onClick={() => onEditProfile(selected.id)}
            >
              编辑
            </button>
          ) : undefined
        }
      >
        <Select
          value={assessmentProfileId || undefined}
          onValueChange={(id) => updateSetting('assessmentProfileId', id)}
        >
          <SelectTrigger className="w-60 shrink-0 bg-white">
            <SelectValue placeholder="选择配置" />
          </SelectTrigger>
          <SelectContent>
            {apiProfiles.map((profile) => (
              <SelectItem key={profile.id} value={profile.id} disabled={profile.vision === false}>
                {profile.name || '未命名配置'}（{profile.model || '未设置模型'}）
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <div className="mt-5 space-y-3 border-t border-gray-400/40 pt-4">
        <Field
          label="固定选项位置"
          note="开启后忽略 AI 返回的坐标，只按这里配置的坐标点击"
        >
          <Switch
            className="scale-y-90"
            checked={assessmentFixedClick}
            onCheckedChange={(checked) => updateSetting('assessmentFixedClick', checked)}
          />
        </Field>
        {assessmentFixedClick && (
          <div className="space-y-2">
            {(['A', 'B', 'C', 'D'] as const).map((letter) => {
              const draft = draftPositions[letter]
              const updatePoint = (axis: 'x' | 'y', value: string) => {
                const nextDraft = { ...draftPositions[letter], [axis]: value }
                setDraftPositions({ ...draftPositions, [letter]: nextDraft })
                const x = Number(nextDraft.x)
                const y = Number(nextDraft.y)
                const complete =
                  nextDraft.x.trim() !== '' &&
                  nextDraft.y.trim() !== '' &&
                  Number.isInteger(x) &&
                  Number.isInteger(y) &&
                  x >= 0 &&
                  y >= 0
                updateSetting('assessmentFixedPositions', {
                  ...assessmentFixedPositions,
                  [letter]: complete ? { x, y } : null
                })
              }
              return (
                <div key={letter} className="flex items-center justify-end gap-2 text-sm">
                  <span className="w-5 font-medium">{letter}</span>
                  <Input
                    className="w-24 bg-white"
                    type="number"
                    min={0}
                    placeholder="x"
                    value={draft.x}
                    onChange={(event) => updatePoint('x', event.target.value)}
                  />
                  <span>,</span>
                  <Input
                    className="w-24 bg-white"
                    type="number"
                    min={0}
                    placeholder="y"
                    value={draft.y}
                    onChange={(event) => updatePoint('y', event.target.value)}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </SettingsCard>
  )
}
