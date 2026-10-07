import { useState } from 'react'
import { MousePointerClick, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useSettingsStore } from '@/lib/store/settings'
import { Field, SettingsCard } from '../components'
import { LocalOcrPanel } from '../LocalOcrPanel'

export function AssessmentSection({ onEditProfile }: { onEditProfile: (id: string) => void }) {
  const {
    apiProfiles,
    assessmentProfileId,
    assessmentMemoryEnabled,
    assessmentMostLeastEnabled,
    assessmentCheckSelectedAnswers,
    assessmentPersonalityPrompt,
    assessmentFixedClick,
    assessmentFixedPositions,
    assessmentNextPosition,
    assessmentOcrEnabled,
    assessmentOcrPreviewOnly,
    assessmentShowOcrDebug,
    updateSetting
  } = useSettingsStore()
  const selected = apiProfiles.find((profile) => profile.id === assessmentProfileId)
  const [draftPositions, setDraftPositions] = useState(
    () =>
      Object.fromEntries(
        Object.keys(assessmentFixedPositions).map((letter) => {
          const point = assessmentFixedPositions[letter]
          return [letter, { x: point ? String(point.x) : '', y: point ? String(point.y) : '' }]
        })
      ) as Record<string, { x: string; y: string }>
  )
  const [draftNextPosition, setDraftNextPosition] = useState({
    x: assessmentNextPosition ? String(assessmentNextPosition.x) : '',
    y: assessmentNextPosition ? String(assessmentNextPosition.y) : ''
  })
  const letters = Object.keys(assessmentFixedPositions).sort()
  const nextLetter = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    .split('')
    .find((letter) => !letters.includes(letter))

  return (
    <SettingsCard Icon={MousePointerClick} title="做题模式 AI">
      <p className="-mt-2 mb-4 text-xs font-light">
        做题模式会把快捷键截取的屏幕截图发送给这里选择的视觉模型。API 地址、Key、模型和请求头在「AI
        模型」中编辑。
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
          label="OCR 定位选项"
          note={
            assessmentFixedClick
              ? '固定坐标优先，OCR 定位暂不使用'
              : '把 OCR 文字框直接交给 AI，由 AI 选择选项与按钮框，程序使用 OCR 坐标点击'
          }
        >
          <Switch
            checked={assessmentOcrEnabled}
            onCheckedChange={(value) => updateSetting('assessmentOcrEnabled', value)}
          />
        </Field>
        {assessmentOcrEnabled && !assessmentFixedClick && (
          <>
            <Field
              label="仅预览，不点击"
              note="默认关闭；快捷键也只预览一次。确认分组与红点正确后关闭，即可自动点击和循环"
            >
              <Switch
                checked={assessmentOcrPreviewOnly}
                onCheckedChange={(value) => updateSetting('assessmentOcrPreviewOnly', value)}
              />
            </Field>
            <Field label="显示 OCR 分组图" note="显示原截图、选项框与点击红点；预览模式始终显示">
              <Switch
                checked={assessmentShowOcrDebug}
                onCheckedChange={(value) => updateSetting('assessmentShowOcrDebug', value)}
              />
            </Field>
          </>
        )}
        <Field
          label="判断选项是否已选择"
          note="默认开启，补充分析时跳过已选项。关闭后每轮按完整答案顺序点击，评分模式按最高分、最低分点击；重复点击可能取消原选择。切换后需重新开始做题"
        >
          <Switch
            checked={assessmentCheckSelectedAnswers}
            onCheckedChange={(value) => updateSetting('assessmentCheckSelectedAnswers', value)}
          />
        </Field>
        <Field
          label="最符合／最不符合模式"
          note="按个人性格给选项打 0～10000 分，先点击最高分，再点击最低分；每次携带本次完整评分记忆。切换模式会清空记忆"
        >
          <Switch
            checked={assessmentMostLeastEnabled}
            onCheckedChange={(value) => updateSetting('assessmentMostLeastEnabled', value)}
          />
        </Field>
        <Field
          label="性格测评模式"
          note={
            assessmentMostLeastEnabled
              ? '当前使用独立的选项评分记忆，普通逐题记忆暂不使用'
              : '开启后记录本次运行中的题目、选项和答案；关闭后不读取也不保存记忆'
          }
        >
          <Switch
            className="scale-y-90"
            checked={assessmentMemoryEnabled}
            disabled={assessmentMostLeastEnabled}
            onCheckedChange={(checked) => updateSetting('assessmentMemoryEnabled', checked)}
          />
        </Field>
        {(assessmentMemoryEnabled || assessmentMostLeastEnabled) && (
          <Field
            label="个人性格配置"
            note="每次做题都会作为 AI 系统提示词的一部分，用于保持选择符合你的性格"
          >
            <Textarea
              className="min-h-24 w-full bg-white"
              value={assessmentPersonalityPrompt}
              onChange={(event) => updateSetting('assessmentPersonalityPrompt', event.target.value)}
              placeholder="描述你希望测评体现的性格"
            />
          </Field>
        )}
        {(assessmentMemoryEnabled || assessmentMostLeastEnabled) && (
          <Button variant="outline" onClick={() => void window.api.resetAssessmentMemory()}>
            开始新测评 / 清空记忆
          </Button>
        )}
        <Field label="固定选项位置" note="开启后忽略 AI 返回的坐标，只按这里配置的坐标点击">
          <Switch
            className="scale-y-90"
            checked={assessmentFixedClick}
            onCheckedChange={(checked) => updateSetting('assessmentFixedClick', checked)}
          />
        </Field>
        {assessmentFixedClick && (
          <div className="space-y-2">
            {letters.map((letter) => {
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
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`删除选项 ${letter}`}
                    onClick={() => {
                      const positions = { ...assessmentFixedPositions }
                      const drafts = { ...draftPositions }
                      delete positions[letter]
                      delete drafts[letter]
                      setDraftPositions(drafts)
                      updateSetting('assessmentFixedPositions', positions)
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              )
            })}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-auto flex"
              disabled={!nextLetter}
              onClick={() => {
                if (!nextLetter) return
                setDraftPositions({ ...draftPositions, [nextLetter]: { x: '', y: '' } })
                updateSetting('assessmentFixedPositions', {
                  ...assessmentFixedPositions,
                  [nextLetter]: null
                })
              }}
              title="增加选项位置"
            >
              <Plus className="size-4" />
              增加选项
            </Button>
            <div className="flex items-center justify-end gap-2 border-t border-gray-400/30 pt-2 text-sm">
              <span className="w-5 font-medium">下一步</span>
              <Input
                className="w-24 bg-white"
                type="number"
                min={0}
                placeholder="x"
                value={draftNextPosition.x}
                onChange={(event) => {
                  const xText = event.target.value
                  const next = { ...draftNextPosition, x: xText }
                  setDraftNextPosition(next)
                  const x = Number(next.x)
                  const y = Number(next.y)
                  updateSetting(
                    'assessmentNextPosition',
                    next.x.trim() &&
                      next.y.trim() &&
                      Number.isInteger(x) &&
                      Number.isInteger(y) &&
                      x >= 0 &&
                      y >= 0
                      ? { x, y }
                      : null
                  )
                }}
              />
              <span>,</span>
              <Input
                className="w-24 bg-white"
                type="number"
                min={0}
                placeholder="y"
                value={draftNextPosition.y}
                onChange={(event) => {
                  const yText = event.target.value
                  const next = { ...draftNextPosition, y: yText }
                  setDraftNextPosition(next)
                  const x = Number(next.x)
                  const y = Number(next.y)
                  updateSetting(
                    'assessmentNextPosition',
                    next.x.trim() &&
                      next.y.trim() &&
                      Number.isInteger(x) &&
                      Number.isInteger(y) &&
                      x >= 0 &&
                      y >= 0
                      ? { x, y }
                      : null
                  )
                }}
              />
            </div>
          </div>
        )}
      </div>
      <LocalOcrPanel />
    </SettingsCard>
  )
}
