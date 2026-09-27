import { TriangleAlert } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { useSettingsStore } from '@/lib/store/settings'
import { parseRequestHeaders } from '../../../shared/request-headers'

/** Extra request headers, for platforms and gateways that need more than the API Key */
export function ApiHeadersField() {
  const { apiHeaders, updateCredential } = useSettingsStore()
  const { invalidLines } = parseRequestHeaders(apiHeaders)

  return (
    <div>
      <div className="flex items-start justify-between">
        <label className="text-sm font-medium">
          自定义请求头
          <span className="ml-2 text-xs font-light">
            选填，部分平台或网关需要，每行一个「名称: 值」
          </span>
        </label>
        <Textarea
          value={apiHeaders}
          onChange={(e) => updateCredential({ apiHeaders: e.target.value })}
          placeholder={'HTTP-Referer: https://example.com\nX-Title: Interview Coder'}
          className="w-60 min-h-9 max-h-40 bg-white font-mono text-xs md:text-xs"
          spellCheck={false}
        />
      </div>
      {invalidLines.length > 0 && (
        <p className="mt-1.5 flex items-start justify-end gap-1 text-right text-xs text-amber-800">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>第 {invalidLines.join('、')} 行会被忽略：应为「名称: 值」，且只能使用英文字符</span>
        </p>
      )}
    </div>
  )
}
