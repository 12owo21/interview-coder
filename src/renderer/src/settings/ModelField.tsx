import { useEffect } from 'react'
import { Info, TriangleAlert } from 'lucide-react'
import { useSettingsStore } from '@/lib/store/settings'
import { usePlatformModels } from '@/lib/platform-models'
import { cjkSpacing, diagnoseModel, findProvider } from '@/lib/providers'
import { SelectModel } from './SelectModel'

/** The Model setting: a picker that follows the API Base URL, plus a warning when they don't match */
export function ModelField() {
  const { apiBaseURL, apiKey, apiHeaders, model, setModel, activeProfileId, updateProfile } =
    useSettingsStore()
  const vision = useSettingsStore(
    (s) => s.apiProfiles.find((p) => p.id === activeProfileId)?.vision
  )
  // Only 截图模式 sends images, so a text-only model is a problem only there
  const usedForScreenshots = useSettingsStore((s) => s.screenshotProfileId === activeProfileId)
  const platformModels = usePlatformModels(apiBaseURL, apiKey, apiHeaders)
  const provider = findProvider(apiBaseURL)
  const listed = platformModels.status === 'ready' ? platformModels.models : undefined
  const diagnosis = diagnoseModel(model, apiBaseURL, listed, usedForScreenshots)

  // The platform's list is the best word on image input; keep the profile in
  // step so 截图模式's picker can tell text-only profiles apart without fetching
  const listedVision = listed?.find((m) => m.id === model)?.vision
  useEffect(() => {
    if (listedVision !== undefined && listedVision !== vision) {
      updateProfile(activeProfileId, { vision: listedVision })
    }
  }, [listedVision, vision, activeProfileId, updateProfile])

  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">
          Model
          <span className="ml-2 text-xs font-light">
            {provider
              ? cjkSpacing(`已按${provider.name}的写法列出，切换 API Base URL 时会自动换成对应写法`)
              : '未识别的平台，列表中给出了各家的写法供参考'}
          </span>
        </label>
        <SelectModel
          value={model}
          onChange={setModel}
          baseURL={apiBaseURL}
          platformModels={platformModels}
        />
      </div>
      {diagnosis ? (
        <p className="mt-1.5 flex items-start justify-end gap-1 text-right text-xs text-amber-800">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            {diagnosis.message}
            {diagnosis.fix && (
              <button
                className="ml-2 cursor-pointer text-blue-700 hover:underline"
                onClick={() => setModel(diagnosis.fix!.model)}
              >
                {diagnosis.fix.label}
              </button>
            )}
          </span>
        </p>
      ) : vision === false && usedForScreenshots ? (
        // Learned from a refused screenshot, so the diagnosis above knows nothing of it
        <p className="mt-1.5 flex items-start justify-end gap-1 text-right text-xs text-amber-800">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>截图模式正在使用这个配置，但该模型不支持图片输入，无法识别截图</span>
        </p>
      ) : (
        vision === false && (
          <p className="mt-1.5 flex items-start justify-end gap-1 text-right text-xs text-gray-700">
            <Info className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>仅文本模型：可用于对话模式，不能用于截图模式</span>
          </p>
        )
      )}
    </div>
  )
}
