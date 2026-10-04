import { createHash, randomUUID } from 'node:crypto'

export interface AssessmentMemoryInput {
  question: string
  options: Record<string, string>
  answers: string[]
}
export interface AssessmentMemoryRecord extends AssessmentMemoryInput {
  index: number
  createdAt: number
  stemKey: string
  exactQuestionKey: string
  contentQuestionKey: string
  selectedOptions: Array<{ answer: string; text: string }>
  execution: 'executed'
}
export interface MemorySnapshot {
  revision: number
  sessionId: string | null
  context: string
}

export function stripQuestionNumber(value: string): string {
  const question = value.trim()
  const number = '[0-9０-９一二三四五六七八九十百千零〇两]+'
  const prefix = new RegExp(
    `^(?:第\\s*${number}\\s*题\\s*[.．、:：)）]?|[（(【\\[]\\s*${number}\\s*[）)】\\]]\\s*[.．、:：]?|${number}\\s*(?:[.．](?![0-9０-９])|[、:：)）]))\\s*`,
    'u'
  )
  return question.replace(prefix, '').trimStart() || question
}

function normalize(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, ' ').trim()
}
function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function questionKeys(input: AssessmentMemoryInput): {
  stemKey: string
  exactQuestionKey: string
  contentQuestionKey: string
} {
  const stemKey = hash(normalize(stripQuestionNumber(input.question)))
  const entries = Object.entries(input.options).sort(([a], [b]) => a.localeCompare(b))
  return {
    stemKey,
    exactQuestionKey: hash([stemKey, entries.map(([key, text]) => [key, normalize(text)])]),
    contentQuestionKey: hash([stemKey, entries.map(([, text]) => normalize(text)).sort()])
  }
}

export class AssessmentMemoryService {
  private enabled = false
  private personality = ''
  private revision = 0
  private sessionId: string | null = null
  private records: AssessmentMemoryRecord[] = []
  private byExact = new Map<string, AssessmentMemoryRecord[]>()
  private byContent = new Map<string, AssessmentMemoryRecord[]>()

  configure(enabled: boolean, personality = this.personality): void {
    if (this.enabled === enabled && (!enabled || this.personality === personality)) return
    this.enabled = enabled
    this.personality = personality
    this.reset()
  }

  reset(): void {
    this.revision++
    this.sessionId = this.enabled ? randomUUID() : null
    this.records = []
    this.byExact.clear()
    this.byContent.clear()
  }

  snapshot(): MemorySnapshot {
    const context = this.enabled
      ? this.records
          .map(
            (record) =>
              `${record.index}. 题目：${record.question}\n选项：${Object.entries(record.options)
                .map(([key, text]) => `${key}=${text}`)
                .join('；')}\n答案顺序：${record.answers.join(' → ')}`
          )
          .join('\n\n')
      : ''
    return { revision: this.revision, sessionId: this.sessionId, context }
  }

  assertCapacity(): void {
    if (this.enabled && this.records.length >= 500)
      throw new Error('本次测评已记录 500 题，请开始新测评')
    if (this.snapshot().context.length > 120000)
      throw new Error('测评历史超过 12 万字符，请开始新测评；未自动截断历史')
  }

  match(input: AssessmentMemoryInput): string[] | undefined {
    if (!this.enabled) return undefined
    const previous = this.byContent.get(questionKeys(input).contentQuestionKey)?.at(-1)
    if (!previous) return undefined
    const answers: string[] = []
    for (const selected of previous.selectedOptions) {
      const matches = Object.entries(input.options).filter(
        ([, text]) => normalize(text) === normalize(selected.text)
      )
      if (matches.length !== 1) return undefined
      answers.push(matches[0][0])
    }
    return answers
  }

  commit(input: AssessmentMemoryInput, snapshot = this.snapshot()): AssessmentMemoryRecord | null {
    if (
      !this.enabled ||
      snapshot.sessionId !== this.sessionId ||
      snapshot.revision !== this.revision
    )
      return null
    this.assertCapacity()
    const record: AssessmentMemoryRecord = {
      question: stripQuestionNumber(input.question),
      options: { ...input.options },
      answers: [...input.answers],
      ...questionKeys(input),
      index: this.records.length + 1,
      createdAt: Date.now(),
      execution: 'executed',
      selectedOptions: input.answers.map((answer) => ({ answer, text: input.options[answer] }))
    }
    this.records.push(record)
    for (const [map, key] of [
      [this.byExact, record.exactQuestionKey],
      [this.byContent, record.contentQuestionKey]
    ] as const) {
      map.set(key, [...(map.get(key) ?? []), record])
    }
    return record
  }
}
