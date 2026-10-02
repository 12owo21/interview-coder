import { MousePointerClick } from 'lucide-react'
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
  const { apiProfiles, assessmentProfileId, updateSetting } = useSettingsStore()
  const selected = apiProfiles.find((profile) => profile.id === assessmentProfileId)

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
    </SettingsCard>
  )
}
