import { useEffect, useState } from 'react'
import { Mic } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useSettingsStore } from '@/lib/store/settings'
import { Advanced, Field, SecretInput, SettingsCard } from '../components'

/** Speech recognition, shared by both modes: 截图模式 attaches it, 对话模式 is built on it */
export function VoiceSection() {
  const { dashscopeApiKey, audioInputDeviceId, audioOutputDeviceId, updateSetting } =
    useSettingsStore()
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([])

  useEffect(() => {
    const loadDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        const needsPermission = devices.every((d) => !d.label)
        if (needsPermission) {
          await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        }
        const refreshed = await navigator.mediaDevices.enumerateDevices()
        setAudioDevices(refreshed)
      } catch (err) {
        console.error('Failed to enumerate audio devices:', err)
      }
    }
    loadDevices()
  }, [])

  return (
    <SettingsCard Icon={Mic} title="语音">
      <div className="space-y-4">
        <Field
          label="百炼平台 API Key"
          note={
            <>
              从阿里云
              <a
                href="https://bailian.console.aliyun.com/cn-beijing?tab=model#/api-key"
                target="_blank"
                rel="noopener noreferrer"
                className="px-0.5 text-blue-700 hover:underline"
              >
                百炼平台
              </a>
              获取；对话模式必填，截图模式不用语音转录可跳过
            </>
          }
        >
          <SecretInput
            value={dashscopeApiKey}
            onChange={(value) => updateSetting('dashscopeApiKey', value)}
            placeholder="输入百炼平台 API Key"
          />
        </Field>

        <Field
          label="音频输入设备"
          note="默认捕获系统音频，即会议里对方的声音；对话模式请保持系统音频，否则自己说话也会触发提示"
        >
          <Select
            value={audioInputDeviceId || 'system'}
            onValueChange={(val) =>
              updateSetting('audioInputDeviceId', val === 'system' ? '' : val)
            }
          >
            <SelectTrigger className="w-60 shrink-0 bg-white">
              <SelectValue placeholder="系统音频（默认）" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">系统音频（默认）</SelectItem>
              {audioDevices
                .filter((d) => d.kind === 'audioinput')
                .map((d) => (
                  <SelectItem key={d.deviceId} value={d.deviceId}>
                    {d.label || d.deviceId}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </Field>

        <Advanced defaultOpen={!!audioOutputDeviceId}>
          <Field label="音频输出设备" note="用于转录时的监听输出">
            <Select
              value={audioOutputDeviceId || 'default'}
              onValueChange={(val) =>
                updateSetting('audioOutputDeviceId', val === 'default' ? '' : val)
              }
            >
              <SelectTrigger className="w-60 shrink-0 bg-white">
                <SelectValue placeholder="默认设备" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">默认设备</SelectItem>
                {audioDevices
                  .filter((d) => d.kind === 'audiooutput')
                  .map((d) => (
                    <SelectItem key={d.deviceId} value={d.deviceId}>
                      {d.label || d.deviceId}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
        </Advanced>
      </div>
    </SettingsCard>
  )
}
