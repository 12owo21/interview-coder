import { createHash, randomUUID } from 'node:crypto'

export type AnswerLetter = string
export interface AssessmentMemoryInput {
  question: string
  options: Record<string, string>
  answers: AnswerLetter[]
}
export interface AssessmentMemoryRecord extends AssessmentMemoryInput {
  index: number
  createdAt: number
  stemKey: string
  exactQuestionKey: string
  contentQuestionKey: string
  selectedOptions: Array<{ answer: AnswerLetter; text: string }>
}
interface Session {
  id: string
  startedAt: number
  records: AssessmentMemoryRecord[]
  byExactQuestionKey: Map<string, AssessmentMemoryRecord[]>
  byContentQuestionKey: Map<string, AssessmentMemoryRecord[]>
}

let enabled = false
let session: Session | null = null

function normalize(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase()
}

/** Strip an explicit question number without dropping numbers within the question. */
function stripQuestionNumber(value: string): string {
  const question = value.trim()
  const number = '[0-9０-９一二三四五六七八九十百千零〇两]+'
  const prefix = new RegExp(
    `^(?:第\\s*${number}\\s*题\\s*[.．、:：)）]?|[（(【\\[]\\s*${number}\\s*[）)】\\]]\\s*[.．、:：]?|${number}\\s*(?:[.．](?![0-9０-９])|[、:：)）]))\\s*`,
    'u'
  )
  return question.replace(prefix, '').trimStart() || question
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function createSession(): Session {
  return {
    id: randomUUID(),
    startedAt: Date.now(),
    records: [],
    byExactQuestionKey: new Map(),
    byContentQuestionKey: new Map()
  }
}

export function setAssessmentMemoryEnabled(next: boolean): void {
  if (enabled === next) return
  enabled = next
  session = next ? createSession() : null
}

export function getAssessmentMemoryContext(): string {
  if (!enabled || !session || session.records.length === 0) return ''
  return session.records
    .map(
      (record) =>
        `${record.index}. 题目：${record.question}\n选项：${Object.entries(record.options)
          .map(([letter, text]) => `${letter}=${text}`)
          .join('；')}\n答案顺序：${record.answers.join(' → ')}`
    )
    .join('\n\n')
}

export function addAssessmentMemory(input: AssessmentMemoryInput): AssessmentMemoryRecord | null {
  if (!enabled) return null
  if (!session) session = createSession()
  const question = stripQuestionNumber(input.question)
  const optionEntries = Object.entries(input.options).sort(([a], [b]) => a.localeCompare(b))
  const optionValues = optionEntries.map(([letter, text]) => `${letter}=${normalize(text)}`)
  const stemKey = hash(normalize(question))
  const exactQuestionKey = hash([stemKey, ...optionValues].join('\n'))
  const contentQuestionKey = hash([stemKey, ...optionValues.slice().sort()].join('\n'))
  const record: AssessmentMemoryRecord = {
    ...input,
    question,
    index: session.records.length + 1,
    createdAt: Date.now(),
    stemKey,
    exactQuestionKey,
    contentQuestionKey,
    selectedOptions: input.answers.map((answer) => ({ answer, text: input.options[answer] }))
  }
  session.records.push(record)
  for (const [map, mapKey] of [
    [session.byExactQuestionKey, exactQuestionKey],
    [session.byContentQuestionKey, contentQuestionKey]
  ] as const) {
    const values = map.get(mapKey) ?? []
    values.push(record)
    map.set(mapKey, values)
  }
  return record
}
