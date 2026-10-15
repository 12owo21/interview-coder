import { memo } from 'react'
import type { AssessmentRawInput } from '../../../shared/assessment'

const textClass = 'whitespace-pre-wrap break-words font-mono text-xs select-text'

export const AiInputPanel = memo(function AiInputPanel({
  input
}: {
  input: AssessmentRawInput | null
}) {
  return (
    <section className="mt-4" aria-labelledby="assessment-raw-input-label">
      <h2 id="assessment-raw-input-label" className="mb-2 text-sm font-medium">
        AI 原始输入
      </h2>
      <div
        tabIndex={0}
        className="max-h-80 min-h-24 space-y-3 overflow-auto rounded-md border border-app-border bg-black/10 p-3"
      >
        {input ? (
          <>
            {input.attempt > 1 && (
              <p className="text-xs opacity-60">本轮第 {input.attempt} 次请求（包含纠错提示）</p>
            )}
            <div>
              <h3 className="mb-1 text-xs font-medium opacity-60">system · 系统提示词</h3>
              <pre className={textClass}>{input.system}</pre>
            </div>
            {input.messages.map((message, index) => (
              <div key={index} className="space-y-2 border-t border-app-border pt-3">
                <h3 className="text-xs font-medium opacity-60">
                  {message.role} · 消息 {index + 1}
                </h3>
                {typeof message.content === 'string' ? (
                  <pre className={textClass}>{message.content}</pre>
                ) : (
                  message.content.map((part, partIndex) => {
                    if (part.type === 'text')
                      return (
                        <pre key={partIndex} className={textClass}>
                          {part.text}
                        </pre>
                      )
                    if (part.type === 'image' && typeof part.image === 'string') {
                      const src = /^(data:|https?:)/.test(part.image)
                        ? part.image
                        : `data:${part.mediaType || 'image/png'};base64,${part.image}`
                      return (
                        <details key={partIndex}>
                          <summary className="cursor-pointer text-xs">查看随请求发送的截图</summary>
                          <img
                            src={src}
                            alt={`AI 请求消息 ${index + 1} 中的截图`}
                            className="mt-2 h-auto w-full rounded"
                          />
                        </details>
                      )
                    }
                    return (
                      <pre key={partIndex} className={textClass}>
                        {JSON.stringify(part, null, 2)}
                      </pre>
                    )
                  })
                )}
              </div>
            ))}
          </>
        ) : (
          <p className="text-xs opacity-60">等待生成 AI 请求…</p>
        )}
      </div>
    </section>
  )
})
