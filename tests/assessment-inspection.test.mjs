import assert from 'node:assert/strict'
import { test } from 'node:test'
import loader from './helpers/load-ts.cjs'

const load = loader.createLoader()
const { formatJsonOutput } = load('src/renderer/src/assessment/format-json-output.ts')
const { useAssessmentStore } = load('src/renderer/src/lib/store/assessment.ts')

test('complete nested JSON is indented; fenced JSON is supported without changing raw content', () => {
  const raw = '{"question":"题目","answers":["B","A"],"options":{"A":{"text":"第一行\\n第二行"}}}'
  const expected = JSON.stringify(JSON.parse(raw), null, 2)
  assert.deepEqual(formatJsonOutput(raw), { text: expected, formatted: true })
  assert.deepEqual(formatJsonOutput('```json\n' + raw + '\n```'), {
    text: expected,
    formatted: true
  })
  assert.deepEqual(JSON.parse(formatJsonOutput(raw).text).answers, ['B', 'A'])
})

test('partial streams, invalid JSON and surrounding prose remain exactly as received', () => {
  for (const raw of ['', '{"answers":[', ' \nnot JSON  ', '说明：{"answers":["A"]}']) {
    assert.deepEqual(formatJsonOutput(raw), { text: raw, formatted: false })
  }
})

test('stream snapshots retain request input, replace it on retry and clear it for a new round', () => {
  useAssessmentStore.setState({ snapshot: null })
  const sync = useAssessmentStore.getState().sync
  const first = { requestId: 'request1', attempt: 1, system: 'full system', messages: [] }
  sync({ revision: 1, runId: 'round1', rawInput: first, raw: '', debug: null })
  sync({ revision: 2, runId: 'round1', raw: '{', debug: null })
  assert.equal(useAssessmentStore.getState().snapshot.rawInput, first)
  const retry = { ...first, requestId: 'request2', attempt: 2 }
  sync({ revision: 3, runId: 'round1', rawInput: retry, raw: '', debug: null })
  assert.equal(useAssessmentStore.getState().snapshot.rawInput, retry)
  sync({ revision: 2, runId: 'round1', rawInput: first, raw: '{}', debug: null })
  assert.equal(useAssessmentStore.getState().snapshot.rawInput, retry)
  sync({ revision: 4, runId: 'round2', rawInput: null, raw: '', debug: null })
  assert.equal(useAssessmentStore.getState().snapshot.rawInput, null)
  sync({ revision: 5, runId: 'round2', rawInput: first, raw: '', debug: null })
  sync({ revision: 6, runId: 'round3', raw: '', debug: null })
  assert.equal(useAssessmentStore.getState().snapshot.rawInput, null)
})

test('initial snapshot can backfill input after a newer stream event without reverting output', () => {
  useAssessmentStore.setState({ snapshot: null })
  const sync = useAssessmentStore.getState().sync
  const input = { requestId: 'current', attempt: 2, system: 'system', messages: [] }
  sync({ revision: 10, runId: 'round', rawInputId: 'current', raw: '{"new":', debug: null })
  sync({
    revision: 8,
    runId: 'round',
    rawInputId: 'old',
    rawInput: { ...input, requestId: 'old' },
    raw: 'old',
    debug: null
  })
  assert.equal(useAssessmentStore.getState().snapshot.rawInput, null)
  sync({
    revision: 9,
    runId: 'round',
    rawInputId: 'current',
    rawInput: input,
    raw: '',
    debug: null
  })
  assert.equal(useAssessmentStore.getState().snapshot.rawInput, input)
  assert.equal(useAssessmentStore.getState().snapshot.raw, '{"new":')
  assert.equal(useAssessmentStore.getState().snapshot.revision, 10)
})
