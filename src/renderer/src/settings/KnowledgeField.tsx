import { cn } from '@/lib/utils'
import type { AppMode } from '@/lib/store/settings'
import { formatChars, knowledgeUsage, useKnowledgeDocs } from '@/lib/knowledge'
import { Field } from './components'

/** A mode's share of the 资料库, with the way to it; the material itself is managed there */
export function KnowledgeField({ mode, onOpen }: { mode: AppMode; onOpen: () => void }) {
  const [docs] = useKnowledgeDocs()
  const usage = docs && knowledgeUsage(docs, mode)

  return (
    <Field
      label="参考资料"
      note="资料库里用于这个模式的简历、问答等资料，会随每次请求发给 AI，作答时优先参考"
    >
      <button
        className={cn(
          'max-w-60 shrink-0 truncate text-xs transition-colors cursor-pointer hover:underline',
          usage?.over ? 'text-amber-800' : 'text-blue-700'
        )}
        onClick={onOpen}
      >
        {!usage
          ? ''
          : usage.count > 0
            ? `${usage.count} 份 · ${formatChars(usage.chars)}${usage.over ? '（超过建议上限）' : ''}`
            : '未使用，去资料库添加'}
      </button>
    </Field>
  )
}
