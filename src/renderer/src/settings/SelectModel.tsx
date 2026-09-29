import { useState, useMemo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ChevronsUpDown, Check, Plus, X, LoaderCircle, RotateCw } from 'lucide-react'
import { useSettingsStore } from '@/lib/store/settings'
import {
  PROVIDERS,
  cjkSpacing,
  findProvider,
  getProviderModels,
  normalizeBaseURL,
  type PlatformModel
} from '@/lib/providers'
import type { PlatformModelsState } from '@/lib/platform-models'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'

interface ModelOption {
  id: string
  isCustom?: boolean
  /** Muted tag after the ID, e.g. why the entry may not work */
  note?: string
}

/**
 * Model picker whose list follows the API Base URL: the recommended models in
 * that platform's own spelling, the user's custom models for it, and the full
 * list the platform reports. For an unrecognised platform every known
 * spelling is listed for reference.
 */
export function SelectModel({
  value,
  onChange,
  baseURL,
  platformModels,
  disabled,
  className
}: {
  value?: string
  onChange?: (value: string) => void
  baseURL: string
  platformModels: PlatformModelsState & { reload: () => void }
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const { customModels, customModelsByBaseURL, addCustomModel, removeCustomModel } =
    useSettingsStore()

  const provider = findProvider(baseURL)
  const platform = platformModels.status === 'ready' ? platformModels.models : undefined

  const groups = useMemo(() => {
    const listed = platform && new Set(platform.map((m) => m.id))
    const presetGroups = (provider ? [provider] : PROVIDERS).map((p) => ({
      heading: cjkSpacing(provider ? `${p.name}推荐` : `${p.name}写法`),
      options: getProviderModels(p).map(
        (id): ModelOption => ({
          id,
          // Only meaningful against the platform the URL actually points at
          note: provider && listed && !listed.has(id) ? '平台未列出' : undefined
        })
      )
    }))
    const presetIds = new Set(presetGroups.flatMap((g) => g.options.map((o) => o.id)))

    const ownCustom = customModelsByBaseURL[normalizeBaseURL(baseURL)] ?? []
    const custom = [...new Set([...ownCustom, ...customModels])]
      .filter((id) => !presetIds.has(id))
      .map((id): ModelOption => ({ id, isCustom: true }))
    const customGroup = { heading: '自定义', options: custom }

    const platformGroup = platform && buildPlatformGroup(platform, presetIds, custom)
    return provider
      ? [customGroup, ...presetGroups, ...(platformGroup ? [platformGroup] : [])]
      : [customGroup, ...(platformGroup ? [platformGroup] : []), ...presetGroups]
  }, [provider, platform, baseURL, customModels, customModelsByBaseURL])

  const allOptions = groups.flatMap((g) => g.options)
  const search = searchValue.trim().toLowerCase()
  const matches = (o: ModelOption) => o.id.toLowerCase().includes(search)
  const showCreate = !!search && !allOptions.some((o) => o.id.toLowerCase() === search)

  const select = (id: string) => {
    onChange?.(id === value ? '' : id)
    setSearchValue('')
    setOpen(false)
  }

  const createCustomModel = (newModel: string) => {
    const newValue = newModel.trim()
    if (!newValue) return
    addCustomModel(baseURL, newValue)
    onChange?.(newValue)
    setSearchValue('')
    setOpen(false)
  }

  const deleteCustomModel = (id: string) => {
    removeCustomModel(baseURL, id)
    if (value === id) {
      onChange?.('')
    }
  }

  // A search left over from last time would silently hide most of the list
  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) setSearchValue('')
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('w-60 justify-between overflow-hidden', className)}
        >
          <span className="truncate">{value || '选择模型...'}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto min-w-60 max-w-[26rem] p-0">
        {/* Filtering is done here so groups keep their order instead of cmdk's ranking */}
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="输入以搜索或创建..."
            className="h-9"
            value={searchValue}
            onValueChange={setSearchValue}
          />
          <CommandList>
            <CommandEmpty>未找到结果</CommandEmpty>
            {groups.map((group) => {
              const options = group.options.filter(matches)
              if (options.length === 0) return null
              return (
                <CommandGroup key={group.heading} heading={group.heading}>
                  {options.map((o) => (
                    <div key={o.id} className="group flex">
                      <CommandItem
                        value={o.id}
                        onSelect={() => select(o.id)}
                        className="flex-1 overflow-hidden"
                      >
                        <span className="truncate">{o.id}</span>
                        {o.note && (
                          <span className="shrink-0 text-xs text-muted-foreground">{o.note}</span>
                        )}
                        <Check
                          className={cn('ml-auto', value === o.id ? 'opacity-100' : 'opacity-0')}
                        />
                      </CommandItem>
                      {o.isCustom && (
                        <div className="hidden group-hover:flex">
                          <button
                            className="text-gray-400 hover:text-red-500 cursor-pointer"
                            onClick={() => deleteCustomModel(o.id)}
                          >
                            <X className="h-6 w-6" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </CommandGroup>
              )
            })}
            {!search && (
              <PlatformStatus state={platformModels} needsKey={!provider?.publicModelList} />
            )}
            {showCreate && (
              <CommandGroup>
                <CommandItem
                  value={`create-${searchValue}`}
                  onSelect={() => createCustomModel(searchValue)}
                  className="!text-blue-600"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  创建 “{searchValue.trim()}”
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/**
 * The platform's own models not already listed above. All of them: a text-only
 * model is fine for 对话模式, so those are only tagged, for 截图模式's sake
 */
function buildPlatformGroup(
  platform: PlatformModel[],
  presetIds: Set<string>,
  custom: ModelOption[]
) {
  const shown = new Set([...presetIds, ...custom.map((o) => o.id)])
  const options = platform
    .filter((m) => !shown.has(m.id))
    .map((m): ModelOption => ({ id: m.id, note: m.vision === false ? '仅文本' : undefined }))
    .sort((a, b) => a.id.localeCompare(b.id))
  return {
    heading: `平台上的全部模型（${options.length}）`,
    options
  }
}

/** Where the platform's model list is at, while it isn't ready to be shown as a group */
function PlatformStatus({
  state,
  needsKey
}: {
  state: PlatformModelsState & { reload: () => void }
  needsKey: boolean
}) {
  let item: ReactNode = null
  if (state.status === 'idle' && needsKey) {
    item = (
      <CommandItem disabled value="platform-idle" className="text-xs">
        填写 API Key 后可加载平台的完整模型列表
      </CommandItem>
    )
  } else if (state.status === 'loading') {
    item = (
      <CommandItem disabled value="platform-loading" className="text-xs">
        <LoaderCircle className="h-4 w-4 animate-spin" />
        正在获取平台的模型列表…
      </CommandItem>
    )
  } else if (state.status === 'error') {
    item = (
      <CommandItem value="platform-retry" onSelect={state.reload} className="text-xs">
        <RotateCw className="h-4 w-4" />
        获取失败：{state.error}，点击重试
      </CommandItem>
    )
  }
  return item && <CommandGroup heading="平台上的全部模型">{item}</CommandGroup>
}
