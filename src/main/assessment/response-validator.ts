import { z } from 'zod'
import type { OcrLayout, AssessmentRegion } from '../../shared/assessment'
import type { ParsedAssessment } from './types'
import {
  isContinuation,
  NEXT_TEXT,
  NAV_TEXT,
  optionLabel,
  stripOptionLabel
} from './ocr-layout-analyzer'

const letter = z.string().regex(/^[A-Z]$/)
const text = z.string().trim().min(1).max(32000)
const refs = z.array(z.string().min(1)).min(1).max(64)
const answers = z.array(letter).min(1).max(26)
const ocrSchema = z.discriminatedUnion('status', [
  z
    .object({
      schemaVersion: z.literal(2),
      captureId: text,
      status: z.literal('uncertain'),
      reason: text
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(2),
      captureId: text,
      status: z.literal('ok'),
      questionBlockId: text,
      question: text,
      answers,
      options: z.record(letter, z.object({ text, regionIds: refs }).strict()),
      next: z.discriminatedUnion('required', [
        z.object({ required: z.literal(false) }).strict(),
        z
          .object({
            required: z.literal(true),
            kind: z.enum(['next', 'continue', 'submit']),
            regionIds: refs
          })
          .strict()
      ])
    })
    .strict()
])

const legacyOption = z.object({
  text,
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  left: z.number().int().optional(),
  top: z.number().int().optional(),
  right: z.number().int().optional(),
  bottom: z.number().int().optional()
})
const legacySchema = z.object({
  question: text,
  answer: letter.optional(),
  answers: answers.optional(),
  options: z.record(letter, legacyOption),
  next: z
    .object({
      required: z.boolean(),
      kind: z.string().optional(),
      left: z.number().int().optional(),
      top: z.number().int().optional(),
      right: z.number().int().optional(),
      bottom: z.number().int().optional()
    })
    .optional()
})

/** JSON.parse validates syntax; the second scan rejects silently overwritten keys. */
export function parseUniqueJson(raw: string): unknown {
  if (raw.length > 131072) throw new Error('AI 输出超过 128K 字符限制')
  const source = raw.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1')
  const value: unknown = JSON.parse(source)
  const stack: Array<Set<string> | null> = []
  const tokens = /"(?:\\.|[^"\\])*"|[{}[\]]/g
  for (const match of source.matchAll(tokens)) {
    const token = match[0]
    if (token === '{' || token === '[') {
      stack.push(token === '{' ? new Set() : null)
      if (stack.length > 32) throw new Error('AI JSON 嵌套过深')
    } else if (token === '}' || token === ']') stack.pop()
    else if (/^\s*:/.test(source.slice(match.index! + token.length))) {
      const key = JSON.parse(token) as string
      const keys = stack.at(-1)
      if (keys?.has(key)) throw new Error(`AI JSON 包含重复字段：${key}`)
      keys?.add(key)
    }
  }
  return value
}

function rectPoint(value: { left?: number; top?: number; right?: number; bottom?: number }): {
  x: number
  y: number
} {
  const { left, top, right, bottom } = value
  if (
    left === undefined ||
    top === undefined ||
    right === undefined ||
    bottom === undefined ||
    right <= left ||
    bottom <= top
  ) {
    throw new Error('AI 返回的点击矩形无效')
  }
  return { x: (left + right) / 2, y: (top + bottom) / 2 }
}

function normalizedText(value: string): string {
  return stripOptionLabel(value.normalize('NFKC')).replace(/\s+/g, '')
}

export class AssessmentResponseValidator {
  parseAndValidate(
    raw: string,
    context: { strategy: string; captureId: string; layout?: OcrLayout }
  ): ParsedAssessment {
    const json = parseUniqueJson(raw)
    let result: ParsedAssessment
    if (context.strategy === 'ocr') {
      const parsed = ocrSchema.safeParse(json)
      if (!parsed.success) throw new Error(`OCR 答案格式错误：${parsed.error.issues[0]?.message}`)
      const value = parsed.data
      if (value.captureId !== context.captureId) throw new Error('AI 引用了另一张截图，已停止')
      if (value.status === 'uncertain') throw new Error(`AI 无法确认：${value.reason}`)
      const layout = context.layout!
      const block = layout.blocks.find((item) => item.id === value.questionBlockId)
      if (!block || block !== layout.blocks[0])
        throw new Error('当前只支持处理第一道完整题目，请调整截图范围')
      const byId = new Map(layout.regions.map((region) => [region.id, region]))
      const used = new Set<string>()
      const optionRows: AssessmentRegion[][] = []
      for (const [key, option] of Object.entries(value.options)) {
        const rows = option.regionIds
          .map((id) => {
            const row = byId.get(id)
            if (!row || !block.regionIds.includes(id) || used.has(id))
              throw new Error(`选项 ${key} 的文字框不存在、重复或跨题目`)
            if (NEXT_TEXT.test(row.text.trim()) || NAV_TEXT.test(row.text.trim()))
              throw new Error('选项引用了导航按钮')
            used.add(id)
            return row
          })
          .sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left)
        const markers = rows.map((r) => optionLabel(r.text)).filter(Boolean)
        if (markers.some((marker) => marker !== key))
          throw new Error(`选项 ${key} 与 OCR 字母不一致`)
        let previous = rows[0]
        for (const row of rows.slice(1)) {
          const group = layout.candidates.find(
            (g) => g.regionIds.includes(previous.id) && g.regionIds.includes(row.id)
          )
          if (!group && !isContinuation(previous, row))
            throw new Error(`选项 ${key} 的多行文字不相邻，无法可靠定位`)
          previous = row
        }
        const withoutStandalone = rows.filter((r) => !/^[A-Z]$/.test(r.text.trim()))
        if (!withoutStandalone.length) throw new Error(`选项 ${key} 只有字母，没有正文`)
        if (
          normalizedText(option.text) !==
          normalizedText(withoutStandalone.map((r) => r.text).join('\n'))
        ) {
          throw new Error(`选项 ${key} 文本与 OCR 引用不一致，请保留引用文字原文`)
        }
        optionRows.push(withoutStandalone)
      }
      // Explicit option markers must not disappear from the model's answer.
      for (const candidate of layout.candidates.filter(
        (g) => g.questionBlockId === block.id && g.labelHint
      )) {
        if (!value.options[candidate.labelHint!])
          throw new Error(`AI 遗漏了选项 ${candidate.labelHint}`)
      }
      const ordered = optionRows.sort((a, b) => a[0].box.top - b[0].box.top)
      for (let i = 1; i < ordered.length; i++) {
        const prev = ordered[i - 1]
        const next = ordered[i][0]
        const h = next.box.bottom - next.box.top
        if (
          next.box.top < Math.max(...prev.map((r) => r.box.bottom)) - h * 0.3 ||
          Math.abs(next.box.left - prev[0].box.left) > h * 3
        ) {
          throw new Error('选项存在多列、交叉或异常缩进，当前只支持单列文字选项')
        }
      }
      if (value.next.required) {
        if (value.next.kind === 'submit') throw new Error('检测到提交操作，请手动确认提交范围')
        const rows = value.next.regionIds.map((id) => {
          const row = byId.get(id)
          if (!row || used.has(id)) throw new Error('下一步文字框无效或与选项重叠')
          used.add(id)
          return row
        })
        if (rows.length !== 1 || !NEXT_TEXT.test(rows[0].text.replace(/\s+/g, '')))
          throw new Error('无法确认下一步按钮文字')
      }
      result = {
        question: value.question,
        questionBlockId: block.id,
        answers: value.answers,
        options: value.options,
        next: value.next
      }
    } else {
      const parsed = legacySchema.safeParse(json)
      if (!parsed.success) throw new Error(`答案格式错误：${parsed.error.issues[0]?.message}`)
      const value = parsed.data
      if (value.next?.required && value.next.kind === 'submit')
        throw new Error('检测到提交操作，请手动确认')
      result = {
        question: value.question,
        answers: value.answers ?? (value.answer ? [value.answer] : []),
        options: Object.fromEntries(
          Object.entries(value.options).map(([key, option]) => [
            key,
            {
              text: option.text,
              ...(context.strategy === 'fixed'
                ? {}
                : {
                    point:
                      option.left !== undefined
                        ? rectPoint(option)
                        : option.x !== undefined && option.y !== undefined
                          ? { x: option.x, y: option.y }
                          : rectPoint({})
                  })
            }
          ])
        ),
        next: value.next?.required
          ? {
              required: true,
              ...(context.strategy === 'fixed' ? {} : { point: rectPoint(value.next) })
            }
          : { required: false }
      }
    }
    // Store semantic option text separately from its current A/B label. Otherwise
    // an OCR result retaining "A." would break content matching after reordering.
    for (const option of Object.values(result.options)) {
      option.text = stripOptionLabel(option.text).trim()
      if (!option.text) throw new Error('选项只有标签，没有有效文本')
    }
    const keys = Object.keys(result.options)
    if (
      !keys.length ||
      keys.length > 26 ||
      !result.answers.length ||
      new Set(result.answers).size !== result.answers.length ||
      result.answers.some((answer) => !Object.hasOwn(result.options, answer))
    )
      throw new Error('答案重复、为空或不属于实际选项')
    return result
  }
}
