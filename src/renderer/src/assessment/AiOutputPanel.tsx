import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { formatJsonOutput } from './format-json-output'

export function AiOutputPanel({ raw }: { raw: string }) {
  const [showOriginal, setShowOriginal] = useState(false)
  const output = useMemo(() => formatJsonOutput(raw), [raw])
  return (
    <section className="mt-4" aria-labelledby="assessment-raw-output-label">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="assessment-raw-output-label" className="text-sm font-medium">
          AI 原始输出
        </h2>
        <Button
          size="sm"
          variant="ghost"
          disabled={!output.formatted}
          aria-pressed={showOriginal}
          onClick={() => setShowOriginal(!showOriginal)}
        >
          {showOriginal ? '结构化 JSON' : '查看原文'}
        </Button>
      </div>
      <pre
        aria-labelledby="assessment-raw-output-label"
        tabIndex={0}
        className="max-h-80 min-h-24 overflow-auto whitespace-pre-wrap break-words rounded-md border border-app-border bg-black/10 p-3 font-mono text-xs select-text"
      >
        {(showOriginal ? raw : output.text) || '等待 AI 输出…'}
      </pre>
    </section>
  )
}
