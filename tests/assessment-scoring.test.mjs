/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import loader from './helpers/load-ts.cjs'

const load = loader.createLoader()
const { AssessmentScoreMemoryService, normalizeScoreText } = load(
  'src/main/assessment/score-memory-service.ts'
)
const { AssessmentScoreDecision } = load('src/main/assessment/score-decision.ts')
const { AssessmentMemoryService } = load('src/main/assessment/memory-service.ts')
const { configureAssessmentSessions } = load('src/main/assessment/memory-sessions.ts')
const { AssessmentRunner } = load('src/main/assessment/runner.ts')
const { AssessmentClickExecutor } = load('src/main/assessment/click-executor.ts')
const { AssessmentPromptBuilder } = load('src/main/assessment/prompt-builder.ts')
const { AssessmentController } = load('src/main/assessment/controller.ts')
const { AssessmentPageChangedError } = load('src/main/assessment/recovery.ts')
const { AssessmentRetrySession } = load('src/main/assessment/retry-session.ts')

const options = { A: { text: '不偏不倚' }, B: { text: '胸怀宽广' }, C: { text: '百折不挠' } }
const values = { A: 7200, B: 9400, C: 8800 }
function memory() {
  const m = new AssessmentScoreMemoryService()
  m.configure(true, '开朗')
  return m
}
const decide = (opts, scores, snapshot = memory().snapshot()) =>
  new AssessmentScoreDecision().decide(opts, scores, snapshot)

test('new scores select highest then lowest, reuse old scores across labels and ignore regrading', () => {
  const m = memory()
  const snapshot = m.snapshot()
  const first = decide(options, values, snapshot)
  assert.deepEqual(first.answers, ['B', 'A'])
  assert.equal(m.snapshot().scores.size, 0)
  m.commit(first.additions, snapshot)
  const reordered = { A: options.C, B: options.A, C: options.B }
  const second = decide(reordered, { C: 1 }, m.snapshot())
  assert.deepEqual(second.answers, ['C', 'B'])
  assert.equal(second.additions.size, 0)
  assert.equal(second.scoring.options.C.score, 9400)
  assert.equal(second.scoring.options.C.source, 'history')
  assert.equal(second.notices.length, 1)
})

for (const value of [-1, 10001, 1.5, '9000', NaN, Infinity, null]) {
  test(`invalid score ${String(value)} cannot modify memory`, () => {
    const m = memory()
    assert.throws(() => decide(options, { ...values, A: value }, m.snapshot()), /整数/)
    assert.equal(m.snapshot().scores.size, 0)
  })
}
test('score boundaries, missing and unknown scores, ties and identical text', () => {
  assert.deepEqual(decide(options, { A: 0, B: 10000, C: 1 }).answers, ['B', 'A'])
  assert.throws(() => decide(options, { A: 1, B: 2 }), /缺少评分/)
  assert.throws(() => decide(options, { ...values, D: 5 }), /不存在/)
  assert.throws(() => decide({ A: options.A }, { A: 1 }), /至少两个/)
  const m = memory()
  const first = decide(options, { A: 5000, B: 5000, C: 5000 }, m.snapshot())
  m.commit(first.additions, m.snapshot())
  assert.deepEqual(first.answers, ['A', 'C'])
  assert.deepEqual(decide({ A: options.C, B: options.B, C: options.A }, {}, m.snapshot()).answers, [
    'C',
    'A'
  ])
  assert.deepEqual(decide({ A: options.A, B: options.A }, { B: 5000 }).answers, ['A', 'B'])
  assert.throws(() => decide({ A: options.A, B: options.A }, { A: 1, B: 2 }), /不一致/)
})

test('session changes invalidate old requests, batches are atomic and repeated settings do not clear', () => {
  const m = memory()
  const initial = m.snapshot()
  assert.throws(
    () =>
      m.commit(
        new Map([
          ['有效', 1],
          ['非法', -1]
        ]),
        initial
      ),
    /无效/
  )
  assert.equal(m.snapshot().scores.size, 0)
  m.commit(new Map([['旧记录', 9000]]), initial)
  const full = m.snapshot()
  m.configure(true, '开朗')
  assert.equal(m.snapshot().context, full.context)
  m.configure(true, '谨慎')
  assert.equal(m.snapshot().context, '')
  assert.throws(() => m.commit(new Map([['迟到', 1]]), full), /会话已改变/)
  const beforeReset = m.snapshot()
  m.reset()
  assert.throws(() => m.commit(new Map(), beforeReset), /会话已改变/)
  const beforeDisable = m.snapshot()
  m.configure(false, '谨慎')
  assert.throws(() => m.commit(new Map(), beforeDisable), /会话已改变/)
})

test('mode transition clears both memories without reactivating ordinary memory on settings sync', () => {
  const normal = new AssessmentMemoryService()
  const scores = new AssessmentScoreMemoryService()
  const cfg = { mostLeastEnabled: false, memoryEnabled: true, personality: '开朗' }
  configureAssessmentSessions(normal, scores, cfg)
  normal.commit({ question: '旧题', options: { A: '旧项' }, answers: ['A'] })
  cfg.mostLeastEnabled = true
  configureAssessmentSessions(normal, scores, cfg)
  assert.equal(normal.snapshot().context, '')
  assert.equal(normal.snapshot().sessionId, null)
  scores.commit(new Map([['宽广', 9000]]), scores.snapshot())
  configureAssessmentSessions(normal, scores, cfg)
  assert.equal(scores.snapshot().scores.size, 1)
  cfg.mostLeastEnabled = false
  configureAssessmentSessions(normal, scores, cfg)
  assert.equal(scores.snapshot().scores.size, 0)
  assert.equal(normal.snapshot().context, '')
  assert.ok(normal.snapshot().sessionId)
})

const capture = {
  data: 'image',
  imageWidth: 1000,
  imageHeight: 1000,
  fullWidth: 1000,
  fullHeight: 1000,
  physicalWidth: 2000,
  physicalHeight: 2000,
  offsetX: 0,
  offsetY: 0,
  originX: 0,
  originY: 0,
  displayId: '1',
  capturedAt: Date.now()
}
function config(overrides = {}) {
  return {
    profile: { apiKey: 'test', id: 'p', apiBaseURL: 'test', model: 'test' },
    strategy: 'ocr',
    preview: false,
    showDebug: true,
    memoryEnabled: true,
    mostLeastEnabled: true,
    checkSelectedAnswers: true,
    personality: '开朗',
    margins: { top: 100, bottom: 100, left: 100, right: 100 },
    captureScreen: 'cursor',
    captureRegion: null,
    fixedPositions: { A: { x: 500, y: 630 }, B: { x: 500, y: 830 }, C: { x: 500, y: 1030 } },
    nextPosition: { x: 500, y: 1630 },
    ...overrides
  }
}
function harness(overrides = {}) {
  const cfg = config(overrides.config)
  const normal = new AssessmentMemoryService()
  const scores = new AssessmentScoreMemoryService()
  const prompts = [],
    clicks = [],
    delays = []
  let result,
    guards = 0
  const regions = [
    '请选择最符合和最不符合',
    ...Object.values(options).map((o) => o.text),
    '下一步'
  ].map((text, i) => ({
    text,
    score: 0.99,
    points: [],
    box: {
      left: 200,
      right: 300,
      top: [150, 300, 400, 500, 800][i],
      bottom: [180, 330, 430, 530, 830][i]
    }
  }))
  const runner = new AssessmentRunner({
    memory: normal,
    scoreMemory: scores,
    capture: async () => ({ ...capture, capturedAt: Date.now() }),
    ocr: async () => ({
      requestId: 'ocr',
      imageSize: { width: 1000, height: 1000 },
      elapsedMs: 12,
      regions
    }),
    ask: async (messages, system, _profile, signal, chunk) => {
      prompts.push({ messages, system })
      const data = JSON.parse(messages[0].content.filter((p) => p.type === 'text').at(-1).text)
      const response = {
        schemaVersion: 3,
        mode: 'most_least',
        captureId: data.captureId,
        status: 'ok',
        question: regions[0].text,
        ...(cfg.strategy === 'ocr' ? { questionRegionIds: ['r001'] } : {}),
        options: Object.fromEntries(
          ['A', 'B', 'C'].map((key, i) => [
            key,
            {
              text: regions[i + 1].text,
              ...(cfg.strategy === 'ocr'
                ? { regionIds: [`r00${i + 2}`], clickRegionId: `r00${i + 2}` }
                : cfg.strategy === 'model'
                  ? regions[i + 1].box
                  : {})
            }
          ])
        ),
        newScores: Object.fromEntries(
          Object.entries(values).filter(
            ([key]) => !scores.snapshot().scores.has(normalizeScoreText(options[key].text))
          )
        ),
        ...(data.recovery ? { selectedAnswers: [] } : {}),
        next: {
          required: true,
          kind: 'next',
          ...(cfg.strategy === 'ocr'
            ? { clickRegionId: 'r005' }
            : cfg.strategy === 'model'
              ? regions[4].box
              : {})
        }
      }
      await overrides.respond?.(response, data, { scores, normal, signal, cfg, regions })
      const raw = JSON.stringify(response)
      chunk(raw)
      return raw
    },
    executor: new AssessmentClickExecutor(
      async (p) => {
        clicks.push(p)
        await overrides.click?.(clicks.length)
      },
      async (ms) => delays.push(ms)
    ),
    guard: {
      prepare: () => ({
        check: async () => {
          if (++guards === overrides.failGuardAt)
            throw new AssessmentPageChangedError('page changed')
        }
      })
    },
    assertClickSupported() {
      return undefined
    }
  })
  return {
    cfg,
    normal,
    scores,
    prompts,
    clicks,
    delays,
    runner,
    get result() {
      return result
    },
    run: (recovery, signal = new AbortController().signal, retry = new AssessmentRetrySession()) =>
      runner.run(
        {
          id: 'test',
          config: cfg,
          signal,
          recovery,
          phase() {
            return undefined
          }
        },
        (patch) => {
          if (patch.result) result = patch.result
        },
        retry
      )
  }
}

for (const strategy of ['ocr', 'fixed', 'model']) {
  test(`${strategy} missing new scores are corrected before any click or memory write`, async () => {
    let calls = 0
    const retry = new AssessmentRetrySession()
    const h = harness({
      config: { strategy },
      respond: (r, _data, { scores }) => {
        calls++
        assert.equal(scores.snapshot().scores.size, 0)
        assert.equal(h.clicks.length, 0)
        if (calls === 1) r.newScores = {}
      }
    })
    await h.run(undefined, new AbortController().signal, retry)
    assert.equal(calls, 2)
    assert.equal(retry.retryCount, 0)
    assert.equal(h.scores.snapshot().scores.size, 3)
    assert.equal(h.clicks.length, 3)
    assert.match(h.prompts[1].messages.at(-1).content, /新选项 A 缺少评分/)
    assert.equal(h.prompts[0].system, h.prompts[1].system)
    assert.deepEqual(h.prompts[0].messages[0], h.prompts[1].messages[0])
    assert.deepEqual(JSON.parse(h.result.raw).newScores, values)
  })

  test(`${strategy} runs one request and uses existing B-A-next clicks and 500ms spacing`, async () => {
    const h = harness({ config: { strategy } })
    await h.run()
    assert.deepEqual(h.result.answers, ['B', 'A'])
    assert.deepEqual(h.clicks, [
      { x: 500, y: 830 },
      { x: 500, y: 630 },
      { x: 500, y: 1630 }
    ])
    assert.deepEqual(h.delays, [500, 500])
    assert.equal(h.prompts.length, 1)
    assert.equal(h.scores.snapshot().scores.size, 3)
    assert.equal(h.normal.snapshot().context, '')
    assert.equal(h.result.scoring.options.B.source, 'current')
    assert.ok(!JSON.parse(h.result.raw).answers)
    await h.run()
    assert.equal(h.result.scoring.options.B.source, 'history')
    assert.equal(h.scores.snapshot().scores.size, 3)
    assert.ok(h.prompts[1].messages[0].content[0].text.includes('["胸怀宽广",9400]'))
    assert.deepEqual(JSON.parse(h.result.raw).newScores, {})
  })
}

test('preview scores without writing either memory or clicking', async () => {
  const h = harness({ config: { preview: true, memoryEnabled: false } })
  await h.run()
  assert.equal(h.result.execution, 'preview')
  assert.deepEqual(h.result.answers, ['B', 'A'])
  assert.equal(h.clicks.length, 0)
  assert.equal(h.scores.snapshot().scores.size, 0)
  assert.ok(h.prompts[0].system.includes('开朗'))
})

for (const [name, mutate] of [
  [
    'missing score',
    (r) => {
      delete r.newScores.A
    }
  ],
  [
    'bad score',
    (r) => {
      r.newScores.A = '7000'
    }
  ],
  [
    'unknown option score',
    (r) => {
      r.newScores.Z = 50
    }
  ],
  [
    'model answers in scoring mode',
    (r) => {
      r.answers = ['A', 'B']
    }
  ],
  [
    'stale capture',
    (r) => {
      r.captureId = 'stale'
    }
  ],
  [
    'invalid OCR reference',
    (r) => {
      r.next.clickRegionId = 'missing'
    }
  ],
  [
    'submission',
    (r) => {
      r.next.kind = 'submit'
    }
  ]
]) {
  test(`${name} cannot partially write scores or click`, async () => {
    const h = harness({ respond: mutate })
    await assert.rejects(h.run())
    assert.equal(h.prompts.length, name === 'submission' ? 1 : 4)
    assert.equal(h.clicks.length, 0)
    assert.equal(h.scores.snapshot().scores.size, 0)
  })
}

test('reset and stop during model response prevent late scores and clicks', async () => {
  const h = harness({ respond: (_r, _d, { scores }) => scores.reset() })
  await assert.rejects(h.run(), /会话已改变/)
  assert.equal(h.clicks.length, 0)
  assert.equal(h.scores.snapshot().scores.size, 0)
  const abort = new AbortController()
  const stopped = harness({ respond: () => abort.abort() })
  await assert.rejects(stopped.run(undefined, abort.signal), /停止/)
  assert.equal(stopped.scores.snapshot().scores.size, 0)
  assert.equal(stopped.clicks.length, 0)
})

test('conflicting OCR ownership is fed back and repaired using the same capture', async () => {
  let calls = 0
  const h = harness({
    respond: (r) => {
      if (++calls === 1) r.questionRegionIds = ['r002', 'r003', 'r004']
    }
  })
  await h.run()
  assert.equal(calls, 2)
  assert.match(h.prompts[1].messages.at(-1).content, /重复引用了 OCR/)
  assert.equal(h.clicks.length, 3)
})

for (const strategy of ['ocr', 'fixed', 'model']) {
  for (const mostLeastEnabled of [false, true]) {
    for (const checkSelectedAnswers of [false, true]) {
      test(`${strategy}, scoring=${mostLeastEnabled}, selection check=${checkSelectedAnswers}: recovery executes the configured answer plan`, async () => {
        const h = harness({
          config: { strategy, mostLeastEnabled, checkSelectedAnswers, memoryEnabled: false },
          respond: (r, data) => {
            if (!mostLeastEnabled) {
              delete r.mode
              delete r.newScores
              r.answers = ['B', 'A']
            }
            if (data.recovery) r.selectedAnswers = ['B', 'A']
          }
        })
        await h.run()
        const firstClicks = [...h.clicks]
        h.clicks.length = 0
        await h.run({
          question: h.result.question,
          options: h.result.optionTexts,
          intendedAnswers: ['B', 'A'],
          executedAnswers: ['B', 'A']
        })
        assert.deepEqual(h.clicks, checkSelectedAnswers ? firstClicks.slice(-1) : firstClicks)
        assert.equal(h.prompts.length, 2)
        assert.equal(h.prompts[0].system, h.prompts[1].system)
        if (checkSelectedAnswers) {
          assert.deepEqual(h.result.confirmedSelectedAnswers, ['B', 'A'])
        } else {
          assert.equal(h.result.confirmedSelectedAnswers, undefined)
          assert.match(h.prompts[1].system, /不判断或返回 selectedAnswers/)
          assert.doesNotMatch(
            h.prompts[1].system,
            /必须额外返回 selectedAnswers|选中状态不明或需要撤销/
          )
        }
      })
    }
  }
}

for (const selectedAnswers of [undefined, ['A', 'B'], ['Z', 'Z'], 'invalid']) {
  test(`disabled selection checking ignores missing, conflicting or malformed metadata: ${JSON.stringify(selectedAnswers)}`, async () => {
    const h = harness({
      config: { checkSelectedAnswers: false },
      respond: (r) => {
        r.selectedAnswers = selectedAnswers
      }
    })
    await h.run({
      question: '请选择最符合和最不符合',
      options: Object.fromEntries(
        Object.entries(options).map(([key, option]) => [key, option.text])
      ),
      intendedAnswers: ['B', 'A'],
      executedAnswers: ['B']
    })
    assert.equal(h.prompts.length, 1)
    assert.equal(h.clicks.length, 3)
    assert.deepEqual(
      h.result.plan.map((step) => step.answer ?? step.kind),
      ['B', 'A', 'next']
    )
  })
}

test('disabled selection checking still stops after three same-page recovery attempts', async () => {
  const h = harness({
    config: { checkSelectedAnswers: false },
    respond: (r) => {
      r.selectedAnswers = ['B', 'A']
      r.next = { required: false }
    }
  })
  const controller = new AssessmentController(
    h.runner,
    () => h.cfg,
    () => {},
    async () => {}
  )
  assert.equal(await controller.toggleLoop(), false)
  assert.match(controller.getSnapshot().error, /已补充分析 3 次/)
  assert.equal(h.clicks.length, 8)
  assert.equal(h.prompts.length, 5)
})

test('partial click preserves scores; retry skips selected highest and finishes remaining clicks', async () => {
  const h = harness({
    failGuardAt: 2,
    respond: (r, data) => {
      if (data.recovery) r.selectedAnswers = ['B']
    }
  })
  let recovery
  try {
    await h.run()
  } catch (e) {
    recovery = e.recovery
  }
  assert.ok(recovery)
  assert.equal(h.scores.snapshot().scores.size, 3)
  assert.deepEqual(recovery.executedAnswers, ['B'])
  await h.run(recovery)
  assert.deepEqual(h.clicks, [
    { x: 500, y: 830 },
    { x: 500, y: 630 },
    { x: 500, y: 1630 }
  ])
  assert.equal(h.normal.snapshot().context, '')
  assert.equal(h.prompts[0].system, h.prompts[1].system)
})

test('only remaining cards cannot be treated as a new question after a partial click', async () => {
  const h = harness({
    failGuardAt: 2,
    respond: (r, data) => {
      if (data.recovery) {
        delete r.options.B
        r.selectedAnswers = []
      }
    }
  })
  let recovery
  try {
    await h.run()
  } catch (e) {
    recovery = e.recovery
  }
  await assert.rejects(h.run(recovery), /剩余卡片/)
  assert.equal(h.clicks.length, 1)
})

test('reordered current labels use content scores and current selection evidence on retry', async () => {
  const h = harness({
    respond: (r, data) => {
      if (data.recovery) {
        const a = r.options.A
        r.options.A = r.options.B
        r.options.B = a
        r.selectedAnswers = ['A']
      }
    }
  })
  await h.run()
  const recovery = {
    question: '请选择最符合和最不符合',
    options: Object.fromEntries(Object.entries(options).map(([k, v]) => [k, v.text])),
    intendedAnswers: ['B', 'A'],
    executedAnswers: ['B']
  }
  h.clicks.length = 0
  await h.run(recovery)
  assert.deepEqual(h.result.answers, ['A', 'B'])
  assert.deepEqual(h.clicks, [
    { x: 500, y: 630 },
    { x: 500, y: 1630 }
  ])
})

test('missed next retries without reselecting, using unchanged scores and ordinary retry budget', async () => {
  let calls = 0
  const h = harness({
    respond: (r, data) => {
      calls++
      if (calls === 1) r.next = { required: false }
      if (data.recovery) r.selectedAnswers = ['B', 'A']
    }
  })
  const controller = new AssessmentController(
    h.runner,
    () => h.cfg,
    () => {},
    async () => {}
  )
  assert.equal(await controller.toggleLoop(), false)
  assert.equal(calls, 5)
  assert.match(controller.getSnapshot().error, /3 次/)
  assert.deepEqual(h.clicks.slice(0, 2), [
    { x: 500, y: 830 },
    { x: 500, y: 630 }
  ])
  assert.equal(h.clicks.filter((p) => p.y === 830).length, 1)
  assert.equal(h.clicks.filter((p) => p.y === 630).length, 1)
  assert.equal(h.scores.snapshot().scores.size, 3)
})

test('500 simulated questions keep complete append-only scores and stable system across retries', () => {
  const m = memory()
  const builder = new AssessmentPromptBuilder()
  const cfg = config()
  let previous = 'assessmentScoreHistory:\n'
  let system
  for (let i = 0; i < 500; i++) {
    const prompt = builder.build(
      cfg,
      capture,
      `capture-${i}`,
      m.snapshot().context,
      undefined,
      i % 2
        ? { question: '旧题', options: {}, intendedAnswers: [], executedAnswers: [] }
        : undefined
    )
    const prefix = prompt.messages[0].content[0].text
    assert.ok(prefix.startsWith(previous))
    assert.ok(!prefix.includes(`capture-${i}`))
    if (system) assert.equal(system, prompt.system)
    system = prompt.system
    previous = prefix
    const opts = { A: { text: '共享选项' }, B: { text: `描述${i}` }, C: { text: `特点${i}` } }
    const snapshot = m.snapshot()
    const decision = decide(opts, { ...(i ? {} : { A: 5000 }), B: 8000, C: 2000 }, snapshot)
    assert.deepEqual(decision.answers, ['B', 'C'])
    m.commit(decision.additions, snapshot)
  }
  assert.equal(m.snapshot().scores.size, 1001)
  assert.equal(m.snapshot().scores.get('共享选项'), 5000)
})
