import { z } from 'zod'
import type { OcrLayout, AssessmentRegion } from '../../shared/assessment'
import type { ParsedAssessment } from './types'
import { stripOptionLabel } from './ocr-regions'
import { AssessmentUncertainError } from './recovery'

const letter = z.string().regex(/^[A-Z]$/)
const text = z.string().trim().min(1).max(32000)
const refs = z.array(z.string().min(1)).min(1).max(64)
const answers = z.array(letter).min(1).max(26)
const ocrSchema = z.discriminatedUnion('status', [
  z
    .object({
      schemaVersion: z.literal(3),
      captureId: text,
      status: z.literal('uncertain'),
      reason: text
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(3),
      captureId: text,
      status: z.literal('ok'),
      questionRegionIds: refs,
      question: text,
      answers,
      selectedAnswers: z.array(letter).max(26).optional(),
      options: z.record(letter, z.object({ text, regionIds: refs, clickRegionId: text }).strict()),
      next: z.discriminatedUnion('required', [
        z.object({ required: z.literal(false) }).strict(),
        z
          .object({
            required: z.literal(true),
            kind: z.enum(['next', 'continue', 'submit']),
            clickRegionId: text
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
  selectedAnswers: z.array(letter).max(26).optional(),
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
      if (value.status === 'uncertain') throw new AssessmentUncertainError(value.reason)
      const layout = context.layout
      if (!layout) throw new Error('缺少本次 OCR 文字框，无法校验点击位置')
      const byId = new Map(layout.regions.map((region) => [region.id, region]))
      const used = new Set<string>()
      const claim = (ids: string[], owner: string): AssessmentRegion[] =>
        ids.map((id) => {
          const row = byId.get(id)
          if (!row) throw new Error(`${owner} 引用了不存在的 OCR 文字框：${id}`)
          if (used.has(id)) throw new Error(`${owner} 重复引用了 OCR 文字框：${id}`)
          used.add(id)
          return row
        })
      claim(value.questionRegionIds, '题干')
      const notices: string[] = []
      for (const [key, option] of Object.entries(value.options)) {
        // The model supplies reading order. Do not re-sort by geometry or enforce local groups.
        const rows = claim(option.regionIds, `选项 ${key}`)
        if (!option.regionIds.includes(option.clickRegionId))
          throw new Error(`选项 ${key} 的点击框不属于该选项`)
        const body = rows.length > 1 ? rows.filter((r) => r.text.trim() !== key) : rows
        const ocrText = stripOptionLabel(body.map((r) => r.text).join('\n')).trim()
        if (!ocrText) throw new Error(`选项 ${key} 引用的 OCR 框没有有效正文`)
        if (normalizedText(option.text) !== normalizedText(ocrText))
          notices.push(`选项 ${key} 的文字已采用 OCR 原文，继续执行`)
        // IDs determine the target; model paraphrasing must neither block nor trigger a retry.
        // Canonical OCR text also keeps display and personality memory consistent.
        option.text = ocrText
      }
      if (value.next.required) {
        if (value.next.kind === 'submit') throw new Error('检测到提交操作，请手动确认提交范围')
        const [button] = claim([value.next.clickRegionId], '下一步')
        // Recognized submit actions remain manual even if the model mislabeled their kind.
        if (/提交|交卷|结束考试/.test(button.text))
          throw new Error('检测到提交操作，请手动确认提交范围')
      }
      result = {
        question: value.question,
        questionRegionIds: value.questionRegionIds,
        answers: value.answers,
        selectedAnswers: value.selectedAnswers,
        notices,
        options: value.options,
        next: value.next.required
          ? { ...value.next, regionIds: [value.next.clickRegionId] }
          : { required: false }
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
        selectedAnswers: value.selectedAnswers,
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
      result.selectedAnswers &&
      (new Set(result.selectedAnswers).size !== result.selectedAnswers.length ||
        result.selectedAnswers.some((answer) => !result.answers.includes(answer)))
    )
      throw new Error('当前已选答案重复或不属于目标答案')
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
