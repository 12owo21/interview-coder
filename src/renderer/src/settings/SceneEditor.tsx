import { useState } from 'react'
import { Plus, RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  useSettingsStore,
  scenesOf,
  hasRemovedPresets,
  PRESET_SCENE_PROMPTS,
  type AppMode
} from '@/lib/store/settings'

const PLACEHOLDERS: Record<AppMode, { name: string; prompt: string }> = {
  screenshot: {
    name: '场景名称，如：数学考试',
    prompt:
      '请输入该场景的系统提示词, 示例: 你是一个解题助手, 请根据「截图」和「语音转录内容」给出相关回答。'
  },
  conversation: {
    name: '场景名称，如：产品经理面试',
    prompt:
      '请输入该场景的系统提示词, 示例: 你是求职者的实时提词助手, 根据面试官刚说的话给出简短的回答要点。'
  }
}

/**
 * One mode's prompt scenes: pick, edit, add and delete. Each mode keeps its own
 * list and its own active scene, and the shortcut cycles only through these.
 */
export function SceneEditor({ mode }: { mode: AppMode }) {
  const {
    scenes: allScenes,
    activeSceneId,
    conversationSceneId,
    removedPresetSceneIds,
    setActiveScene,
    updateScenePrompt,
    addScene,
    removeScene,
    restorePresetScenes
  } = useSettingsStore()
  const [addSceneOpen, setAddSceneOpen] = useState(false)
  const [newSceneName, setNewSceneName] = useState('')
  const [sceneToDelete, setSceneToDelete] = useState<string | null>(null)

  const scenes = scenesOf(allScenes, mode)
  const activeId = mode === 'screenshot' ? activeSceneId : conversationSceneId
  const activeScene = scenes.find((s) => s.id === activeId)
  const deletingScene = scenes.find((s) => s.id === sceneToDelete)
  // Restoring brings back only this mode's deleted presets
  const canRestore = hasRemovedPresets(removedPresetSceneIds, mode)

  const handleAddScene = () => {
    const name = newSceneName.trim()
    if (!name) return
    addScene(name, mode)
    setNewSceneName('')
    setAddSceneOpen(false)
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium">
          提示词场景
          <span className="ml-2 text-xs font-light">
            选择场景后可编辑对应的系统提示词，修改会自动保存；可新增场景，用不到的也可以删掉，快捷键切换时只在剩下的场景间循环
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-2 mt-2">
          {scenes.map((scene) => (
            <div
              key={scene.id}
              className={cn(
                'group flex items-center rounded-full border text-sm transition-colors cursor-pointer select-none',
                scene.id === activeId
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white border-gray-300 hover:border-blue-400'
              )}
              onClick={() => setActiveScene(scene.id)}
            >
              <span className={cn('py-1 pl-3', scenes.length > 1 ? 'pr-1' : 'pr-3')}>
                {scene.name}
              </span>
              {/* The last scene stays: there must be a prompt to use */}
              {scenes.length > 1 && (
                <button
                  className="mr-1.5 p-0.5 rounded-full opacity-60 hover:opacity-100 hover:bg-black/10"
                  title="删除该场景"
                  onClick={(e) => {
                    e.stopPropagation()
                    setSceneToDelete(scene.id)
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
          <button
            className="flex items-center gap-1 rounded-full border border-dashed border-gray-400 bg-transparent px-3 py-1 text-sm text-gray-600 hover:border-blue-500 hover:text-blue-600 transition-colors"
            onClick={() => setAddSceneOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            新增场景
          </button>
          {canRestore && (
            <button
              className="flex items-center gap-1 rounded-full border border-dashed border-gray-400 bg-transparent px-3 py-1 text-sm text-gray-600 hover:border-blue-500 hover:text-blue-600 transition-colors"
              onClick={() => restorePresetScenes(mode)}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              恢复预设场景
            </button>
          )}
        </div>
      </div>

      {activeScene && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium">
              系统提示词
              <span className="ml-2 text-xs font-light">「{activeScene.name}」场景</span>
            </label>
            {activeScene.isPreset && (
              <button
                className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 transition-colors"
                title="恢复该场景的默认提示词"
                onClick={() =>
                  updateScenePrompt(activeScene.id, PRESET_SCENE_PROMPTS[activeScene.id] ?? '')
                }
              >
                <RotateCcw className="h-3 w-3" />
                恢复默认
              </button>
            )}
          </div>
          <Textarea
            value={activeScene.prompt}
            onChange={(e) => updateScenePrompt(activeScene.id, e.target.value)}
            placeholder={PLACEHOLDERS[mode].prompt}
            className="w-full min-h-24 max-h-100 bg-white"
            rows={6}
          />
        </div>
      )}

      <Dialog open={addSceneOpen} onOpenChange={setAddSceneOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>新增场景</DialogTitle>
            <DialogDescription>创建后可为该场景编写专属的系统提示词</DialogDescription>
          </DialogHeader>
          <Input
            value={newSceneName}
            onChange={(e) => setNewSceneName(e.target.value)}
            placeholder={PLACEHOLDERS[mode].name}
            maxLength={20}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddScene()
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddSceneOpen(false)}>
              取消
            </Button>
            <Button onClick={handleAddScene} disabled={!newSceneName.trim()}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!sceneToDelete} onOpenChange={(open) => !open && setSceneToDelete(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>删除场景</DialogTitle>
            <DialogDescription>
              {deletingScene?.isPreset
                ? `确定删除预设场景「${deletingScene.name}」吗？之后可点「恢复预设场景」找回，提示词会恢复为默认内容。`
                : `确定删除场景「${deletingScene?.name}」吗？其提示词内容将一并删除，且无法恢复。`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSceneToDelete(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (sceneToDelete) removeScene(sceneToDelete)
                setSceneToDelete(null)
              }}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
