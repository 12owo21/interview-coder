import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/lib/store/settings'

/** Shown for a profile whose name was cleared, until the field loses focus */
const UNNAMED = '未命名配置'

/**
 * The saved AI endpoints as a row of chips, the same pattern as 使用场景: click
 * one to make it active, and the panel below (`children`: URL, key, headers,
 * model) edits that one. Each entry holds its own set, so switching does not
 * disturb the others.
 */
export function ApiProfiles({ children }: { children: ReactNode }) {
  const { apiProfiles, activeProfileId, setActiveProfile, addProfile, removeProfile } =
    useSettingsStore()
  const [addOpen, setAddOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [copyActive, setCopyActive] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const active = apiProfiles.find((p) => p.id === activeProfileId)
  const activeName = active?.name.trim() || UNNAMED

  const handleAdd = () => {
    const trimmed = newName.trim()
    addProfile(trimmed || `配置${apiProfiles.length + 1}`, copyActive)
    setNewName('')
    setCopyActive(false)
    setAddOpen(false)
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {apiProfiles.map((profile) => (
          <button
            key={profile.id}
            className={cn(
              'max-w-48 truncate rounded-full border px-3 py-1 text-sm transition-colors cursor-pointer select-none',
              profile.id === activeProfileId
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'bg-white border-gray-300 hover:border-blue-400'
            )}
            onClick={() => setActiveProfile(profile.id)}
          >
            {profile.name.trim() || UNNAMED}
          </button>
        ))}
        <button
          className="flex items-center gap-1 rounded-full border border-dashed border-gray-400 bg-transparent px-3 py-1 text-sm text-gray-600 hover:border-blue-500 hover:text-blue-600 transition-colors"
          onClick={() => setAddOpen(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          新增配置
        </button>
      </div>

      <div className="mt-3 space-y-4 rounded-md border border-gray-400/60 bg-white/25 p-4">
        <ProfileNameField />

        {children}

        {apiProfiles.length > 1 && (
          <div className="flex justify-end">
            <button
              className="flex items-center gap-1 text-xs text-gray-600 hover:text-red-600 transition-colors"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="h-3 w-3" />
              删除此配置
            </button>
          </div>
        )}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>新增配置</DialogTitle>
            <DialogDescription>
              每个配置单独保存 API 地址、密钥、请求头和模型，之后可点选或用快捷键切换
            </DialogDescription>
          </DialogHeader>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="如「DeepSeek 主力」，留空则自动命名"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleAdd()
              }
            }}
          />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={copyActive}
              onCheckedChange={(checked) => setCopyActive(checked === true)}
            />
            <span className="min-w-0 truncate">复制「{activeName}」的设置</span>
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              取消
            </Button>
            <Button onClick={handleAdd}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>删除配置</DialogTitle>
            <DialogDescription>
              确定删除配置「{activeName}」吗？其中的 API Key 等设置将一并删除，且无法恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                removeProfile(activeProfileId)
                setDeleteOpen(false)
              }}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** The active profile's name, edited in place like the fields below it */
function ProfileNameField() {
  const { apiProfiles, activeProfileId, renameProfile } = useSettingsStore()
  const index = apiProfiles.findIndex((p) => p.id === activeProfileId)
  const profile = apiProfiles[index]
  if (!profile) return null

  return (
    <div className="flex items-center justify-between">
      <label className="text-sm font-medium">
        配置名称
        <span className="ml-2 text-xs font-light">用快捷键切换配置时会提示这个名称</span>
      </label>
      <input
        value={profile.name}
        onChange={(e) => renameProfile(profile.id, e.target.value)}
        // Spaces are kept while typing, so tidy up once the user moves on
        onBlur={() => {
          const trimmed = profile.name.trim()
          if (trimmed !== profile.name || !trimmed) {
            renameProfile(profile.id, trimmed || `配置${index + 1}`)
          }
        }}
        className="w-60 px-3 py-2 border border-gray-300 rounded-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        placeholder="如「DeepSeek 主力」"
        maxLength={30}
      />
    </div>
  )
}

/**
 * Edits are saved the moment they are typed, so there is no button to press.
 * This reports that back instead: while a field is changing it reads 「保存中」,
 * and once typing stops it confirms 「已保存」 for a moment. Without it the
 * silence is indistinguishable from a failed save.
 *
 * It sits in the section title so appearing never pushes the fields around.
 */
export function ApiSaveStatus() {
  const activeProfileId = useSettingsStore((s) => s.activeProfileId)
  // Switching, adding or removing a profile only loads other values; starting
  // afresh keeps that from reading as a save
  return <SaveStatus key={activeProfileId} />
}

function SaveStatus() {
  const profile = useSettingsStore((s) => s.apiProfiles.find((p) => p.id === s.activeProfileId))
  const snapshot = JSON.stringify([
    profile?.name,
    profile?.apiBaseURL,
    profile?.apiKey,
    profile?.apiHeaders,
    profile?.model
  ])
  const lastSnapshot = useRef(snapshot)
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle')

  useEffect(() => {
    // Only an edit counts: mounting (and StrictMode's re-run) sees the same values
    if (snapshot === lastSnapshot.current) return
    lastSnapshot.current = snapshot
    setState('saving')
    const saving = setTimeout(() => setState('saved'), 400)
    // The confirmation is a reaction to an edit, not a permanent label
    const done = setTimeout(() => setState('idle'), 2400)
    return () => {
      clearTimeout(saving)
      clearTimeout(done)
    }
  }, [snapshot])

  if (state === 'idle') return null

  return (
    <span className="ml-auto flex items-center gap-1 text-xs font-normal">
      {state === 'saving' ? (
        <span className="text-gray-500">保存中…</span>
      ) : (
        <span className="flex items-center gap-1 text-green-700">
          <Check className="h-3.5 w-3.5" />
          已保存
        </span>
      )}
    </span>
  )
}
