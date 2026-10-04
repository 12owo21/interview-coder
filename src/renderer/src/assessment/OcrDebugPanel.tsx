import { useEffect, useRef } from 'react'
import type { AssessmentDebug } from '../../../shared/assessment'

const COLORS = ['#16a34a', '#2563eb', '#d97706', '#9333ea', '#0891b2']

export function OcrDebugPanel({ debug }: { debug: AssessmentDebug }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!debug.image) return
    let active = true
    const image = new Image()
    image.onload = () => {
      if (!active || !canvas.current) return
      const context = canvas.current.getContext('2d')
      if (!context) return
      const width = Math.min(1280, debug.imageSize.width)
      const scale = width / debug.imageSize.width
      canvas.current.width = width
      canvas.current.height = Math.round(debug.imageSize.height * scale)
      context.drawImage(image, 0, 0, canvas.current.width, canvas.current.height)
      context.lineWidth = 2
      context.font = '12px sans-serif'
      const groups = debug.optionRegions
        ? Object.entries(debug.optionRegions)
        : debug.layout.candidates.map((g) => [g.id, g.regionIds] as const)
      groups.forEach(([label, ids], index) => {
        context.strokeStyle = COLORS[index % COLORS.length]
        context.fillStyle = context.strokeStyle
        for (const region of debug.layout.regions.filter((r) => ids.includes(r.id))) {
          const { left, top, right, bottom } = region.box
          context.strokeRect(
            left * scale,
            top * scale,
            (right - left) * scale,
            (bottom - top) * scale
          )
          context.fillText(`${label} · ${region.id}`, left * scale, Math.max(12, top * scale - 3))
        }
      })
      context.fillStyle = '#ef4444'
      for (const { label, point } of debug.points ?? []) {
        context.beginPath()
        context.arc(point.x * scale, point.y * scale, 5, 0, Math.PI * 2)
        context.fill()
        context.fillText(label, point.x * scale + 8, point.y * scale)
      }
    }
    image.src = `data:image/png;base64,${debug.image}`
    return () => {
      active = false
      image.onload = null
      image.src = ''
    }
  }, [debug])

  return (
    <div className="mt-4 space-y-2 text-xs">
      <h2 className="text-sm font-medium">OCR 分组与点击位置</h2>
      <p>
        原始 {debug.layout.filter?.originalCount ?? debug.layout.regions.length} 个文字框，过滤{' '}
        {debug.layout.filter?.removedCount ?? 0} 个，保留 {debug.layout.regions.length}{' '}
        个。红点为候选点击位置。
      </p>
      {debug.image ? (
        <canvas
          ref={canvas}
          className="w-full rounded border border-app-border"
          aria-label="OCR 文字分组与点击位置预览"
        />
      ) : (
        <p>开启“显示 OCR 分组图”后，下一次分析会显示截图。</p>
      )}
      <details>
        <summary className="cursor-pointer">查看分组数据</summary>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap select-text">
          {JSON.stringify({ ...debug, image: undefined }, null, 2)}
        </pre>
      </details>
    </div>
  )
}
