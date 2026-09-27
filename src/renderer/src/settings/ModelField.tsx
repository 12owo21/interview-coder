import { TriangleAlert } from 'lucide-react'
import { useSettingsStore } from '@/lib/store/settings'
import { usePlatformModels } from '@/lib/platform-models'
import { cjkSpacing, diagnoseModel, findProvider } from '@/lib/providers'
import { SelectModel } from './SelectModel'

/** The Model setting: a picker that follows the API Base URL, plus a warning when they don't match */
export function ModelField() {
  const { apiBaseURL, apiKey, apiHeaders, model, setModel } = useSettingsStore()
  const platformModels = usePlatformModels(apiBaseURL, apiKey, apiHeaders)
  const provider = findProvider(apiBaseURL)
  const diagnosis = diagnoseModel(
    model,
    apiBaseURL,
    platformModels.status === 'ready' ? platformModels.models : undefined
  )

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
      {diagnosis && (
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
      )}
    </div>
  )
}
