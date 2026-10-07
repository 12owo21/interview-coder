/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import loader from './helpers/load-ts.cjs'

const load = loader.createLoader()
const { AssessmentOcrPreparer } = load('src/main/assessment/ocr-regions.ts')
const { AssessmentTargetResolver } = load('src/main/assessment/target-resolver.ts')
const { filterAssessmentOcrRegions } = load('src/main/assessment/ocr-filter.ts')
const { AssessmentResponseValidator, parseUniqueJson } = load(
  'src/main/assessment/response-validator.ts'
)
const { AssessmentMemoryService, questionKeys, stripQuestionNumber } = load(
  'src/main/assessment/memory-service.ts'
)
const { AssessmentClickExecutor } = load('src/main/assessment/click-executor.ts')
const { AssessmentRunner } = load('src/main/assessment/runner.ts')
const { AssessmentPromptBuilder } = load('src/main/assessment/prompt-builder.ts')
const { AssessmentController } = load('src/main/assessment/controller.ts')
const { AssessmentPageChangedError } = load('src/main/assessment/recovery.ts')
const { AssessmentRetrySession, assessmentPageIdentity } = load(
  'src/main/assessment/retry-session.ts'
)
const { imageToScreen } = load('src/main/assessment/coordinate-mapper.ts')

test('reported sidebar and detached A sample validates and targets the model-selected OCR box', () => {
  const ocr = JSON.parse(
    readFileSync(new URL('./fixtures/assessment-ocr-sidebar.json', import.meta.url), 'utf8')
  )
  const response = {
    schemaVersion: 3,
    captureId: 'cap',
    status: 'ok',
    question: ocr.regions[4].text,
    questionRegionIds: ['r005'],
    answers: ['A'],
    options: {
      A: { text: '105', regionIds: ['r008', 'r009'], clickRegionId: 'r009' },
      B: { text: '89', regionIds: ['r015'], clickRegionId: 'r015' },
      C: { text: '95', regionIds: ['r016'], clickRegionId: 'r016' },
      D: { text: '135', regionIds: ['r020'], clickRegionId: 'r020' }
    },
    next: { required: true, kind: 'next', clickRegionId: 'r028' }
  }
  const parsed = validate(response, ocr)
  const layout = new AssessmentOcrPreparer().prepare(ocr, ocr.imageSize)
  const plan = new AssessmentTargetResolver().resolve(
    config(),
    parsed,
    {
      ...capture,
      imageWidth: 1707,
      imageHeight: 1067,
      fullWidth: 1707,
      fullHeight: 1067,
      physicalWidth: 2560,
      physicalHeight: 1600
    },
    layout
  )
  assert.equal(layout.regions.length, 30)
  assert.deepEqual(
    plan.map((s) => s.regionId),
    ['r009', 'r028']
  )
  assert.deepEqual(plan[0].imagePoint, { x: 407, y: 273.5 })
  assert.deepEqual(plan[0].screenPoint, { x: 610, y: 410 })
  assert.deepEqual(plan[1].imagePoint, { x: 834.5, y: 991.5 })
})

function row(text, top, left = 200, right = 750, height = 30) {
  return { text, score: 0.99, points: [], box: { left, top, right, bottom: top + height } }
}
function fixture() {
  const ocr = {
    requestId: 'test',
    imageSize: { width: 1000, height: 1000 },
    coordinateSpace: 'input-image',
    elapsedMs: 12,
    regions: [
      row('1. 请按顺序选择', 150),
      row('A. 第一行内容', 250),
      row('这是续行', 280),
      row('B. 第二个选项', 380),
      row('这是另一个续行', 410),
      row('下一步', 800, 600, 700)
    ]
  }
  const response = {
    schemaVersion: 3,
    captureId: 'cap',
    status: 'ok',
    questionRegionIds: ['r001'],
    question: '1. 请按顺序选择',
    answers: ['B', 'A'],
    options: {
      A: { text: '第一行内容\n这是续行', regionIds: ['r002', 'r003'], clickRegionId: 'r002' },
      B: { text: '第二个选项\n这是另一个续行', regionIds: ['r004', 'r005'], clickRegionId: 'r004' }
    },
    next: { required: true, kind: 'next', clickRegionId: 'r006' }
  }
  return { ocr, response }
}
function validate(response, ocr) {
  const layout = new AssessmentOcrPreparer().prepare(ocr, ocr.imageSize)
  return new AssessmentResponseValidator().parseAndValidate(JSON.stringify(response), {
    strategy: 'ocr',
    captureId: 'cap',
    layout
  })
}

test('OCR preparation preserves every box without question or option grouping', () => {
  const { ocr, response } = fixture()
  ocr.regions.push(row('第8题/共12题', 150, 880, 990), row('3', 410, 185, 195, 10))
  ocr.regions[1].score = 0.63
  const layout = new AssessmentOcrPreparer().prepare(ocr, ocr.imageSize)
  assert.equal(layout.regions.length, ocr.regions.length)
  assert.deepEqual(
    layout.regions.map((r) => r.box),
    ocr.regions.map((r) => r.box)
  )
  assert.equal(layout.blocks, undefined)
  assert.equal(layout.candidates, undefined)
  assert.equal(filterAssessmentOcrRegions(layout.regions), layout.regions)
  assert.deepEqual(validate(response, ocr).answers, ['B', 'A'])
})

test('OCR preparation rejects wrong image size and invalid boxes', () => {
  const { ocr } = fixture()
  const preparer = new AssessmentOcrPreparer()
  assert.throws(() => preparer.prepare(ocr, { width: 2000, height: 1000 }), /尺寸/)
  ocr.regions[0].box.left = -1
  assert.throws(() => preparer.prepare(ocr, ocr.imageSize), /无效文字框/)
})

test('model-selected multi-column options and wide line gaps do not require local grouping', () => {
  const { ocr, response } = fixture()
  ocr.regions[2].box.top = 325
  ocr.regions[2].box.bottom = 355
  ocr.regions[3].box = { left: 800, right: 990, top: 250, bottom: 280 }
  ocr.regions[4].box = { left: 800, right: 990, top: 325, bottom: 355 }
  assert.deepEqual(validate(response, ocr).answers, ['B', 'A'])
})

test('validated text removes option labels before personality memory matching', () => {
  const { ocr, response } = fixture()
  response.options.A.text = 'A. 第一行内容\n这是续行'
  const parsed = validate(response, ocr)
  assert.equal(parsed.options.A.text, '第一行内容\n这是续行')
})

test('model text differences use OCR text without rejecting valid region references', () => {
  for (const modelText of ['第一行内容；这是续行', '模型改写后的选项']) {
    const { ocr, response } = fixture()
    response.options.A.text = modelText
    const parsed = validate(response, ocr)
    assert.equal(parsed.options.A.text, '第一行内容\n这是续行')
    assert.equal(parsed.options.A.clickRegionId, 'r002')
    assert.equal(parsed.notices.length, 1)
    assert.match(parsed.notices[0], /选项 A.*OCR 原文/)
  }
})

for (const [name, mutate] of [
  [
    'missing click ID',
    (r) => {
      delete r.options.A.clickRegionId
    }
  ],
  [
    'click outside option',
    (r) => {
      r.options.A.clickRegionId = 'r004'
    }
  ],
  [
    'unknown next ID',
    (r) => {
      r.next.clickRegionId = 'missing'
    }
  ],
  [
    'missing stem',
    (r) => {
      r.questionRegionIds = []
    }
  ],
  [
    'unknown stem ID',
    (r) => {
      r.questionRegionIds = ['missing']
    }
  ],
  [
    'duplicate stem ID',
    (r) => {
      r.questionRegionIds = ['r001', 'r001']
    }
  ],
  [
    'stem option overlap',
    (r) => {
      r.questionRegionIds = ['r002']
    }
  ],
  [
    'next coordinates',
    (r) => {
      r.next.x = 123
    }
  ],
  [
    'legacy question block',
    (r) => {
      r.questionBlockId = 'q001'
    }
  ],
  [
    'wrong capture',
    (r) => {
      r.captureId = 'old'
    }
  ],
  [
    'unknown ID',
    (r) => {
      r.options.A.regionIds = ['missing']
    }
  ],
  [
    'duplicate ID',
    (r) => {
      r.options.A.regionIds.push('r002')
    }
  ],
  [
    'cross option',
    (r) => {
      r.options.B.regionIds = ['r002', 'r003']
    }
  ],
  [
    'unknown answer',
    (r) => {
      r.answers = ['C']
    }
  ],
  [
    'duplicate answer',
    (r) => {
      r.answers = ['A', 'A']
    }
  ],
  [
    'empty answers',
    (r) => {
      r.answers = []
    }
  ],
  [
    'coordinate injection',
    (r) => {
      r.options.A.x = 123
    }
  ],
  [
    'next overlap',
    (r) => {
      r.next.clickRegionId = 'r002'
    }
  ],
  [
    'submit',
    (r) => {
      r.next.kind = 'submit'
    }
  ],
  [
    'uncertain',
    (r) => {
      r.status = 'uncertain'
      r.reason = '截断了'
    }
  ]
])
  test(`reject ${name} before producing an executable answer`, () => {
    const { ocr, response } = fixture()
    mutate(response, ocr)
    assert.throws(() => validate(response, ocr))
  })

test('strict JSON rejects duplicate and escaped duplicate keys, extra prose and nesting', () => {
  for (const text of [
    '{"A":1,"A":2}',
    '{"A":1,"\\u0041":2}',
    'hello {"x":1}',
    '['.repeat(33) + '0' + ']'.repeat(33)
  ])
    assert.throws(() => parseUniqueJson(text))
  assert.deepEqual(parseUniqueJson('```json\n{"x":"quoted { not a key }"}\n```'), {
    x: 'quoted { not a key }'
  })
})

const capture = {
  data: 'mock',
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
function config() {
  return {
    profile: { apiKey: 'test', id: 'p', apiBaseURL: 'test-url', model: 'vision' },
    strategy: 'ocr',
    preview: false,
    showDebug: true,
    memoryEnabled: true,
    checkSelectedAnswers: true,
    personality: '开朗',
    margins: { top: 100, bottom: 100, left: 100, right: 100 },
    captureScreen: 'cursor',
    captureRegion: null,
    fixedPositions: { A: { x: 10, y: 20 }, B: { x: 30, y: 40 } },
    nextPosition: { x: 50, y: 60 }
  }
}
function currentPromptData(messages) {
  return JSON.parse(messages[0].content.filter((part) => part.type === 'text').at(-1).text)
}

for (const strategy of ['ocr', 'fixed', 'model']) {
  test(`${strategy} prompt keeps system and history prefix identical across recovery captures`, () => {
    const builder = new AssessmentPromptBuilder()
    const cfg = { ...config(), strategy }
    const { ocr } = fixture()
    const layout =
      strategy === 'ocr' ? new AssessmentOcrPreparer().prepare(ocr, ocr.imageSize) : undefined
    const history = '1. 题目：喜欢交流吗？\n选项：A=喜欢；B=不喜欢\n答案顺序：A'
    const recovery = {
      question: '当前题目',
      options: { A: '选项一', B: '选项二' },
      intendedAnswers: ['B'],
      executedAnswers: ['B']
    }
    const first = builder.build(cfg, capture, 'first-capture', history, layout)
    const retry = builder.build(
      cfg,
      { ...capture, data: 'new-image', imageWidth: 900 },
      'retry-capture',
      history,
      layout ? { ...layout, elapsedMs: 777 } : undefined,
      recovery
    )
    assert.equal(first.system, retry.system)
    assert.match(first.system, /仅当本轮 JSON 包含 recovery 时/)
    assert.match(first.system, /不包含 recovery 时，按首次分析处理/)
    assert.deepEqual(first.messages[0].content[0], retry.messages[0].content[0])
    assert.deepEqual(
      retry.messages[0].content.map((p) => p.type),
      ['text', 'text', 'image']
    )
    assert.equal(first.messages[0].content[0].text, `assessmentHistory:\n${history}`)
    const initialData = currentPromptData(first.messages)
    const retryData = currentPromptData(retry.messages)
    assert.equal(initialData.captureId, 'first-capture')
    assert.equal(initialData.recovery, undefined)
    assert.equal(retryData.captureId, 'retry-capture')
    assert.equal(retryData.assessmentHistory, undefined)
    assert.equal(retryData.imageSize.width, 900)
    assert.deepEqual(retryData.recovery, recovery)
    assert.equal(retry.messages[0].content.at(-1).image, 'new-image')
    if (layout) assert.equal(retryData.ocr.elapsedMs, 777)
    else assert.equal(retryData.ocr, undefined)
  })
}

test('growing personality history preserves the entire prior text prefix from an empty session', () => {
  const memory = new AssessmentMemoryService()
  const builder = new AssessmentPromptBuilder()
  const cfg = config()
  memory.configure(true, cfg.personality)
  const build = (id) => builder.build(cfg, capture, id, memory.snapshot().context)
  const empty = build('empty')
  memory.commit({
    question: '1. 喜欢交流吗？',
    options: { A: '喜欢', B: '不喜欢' },
    answers: ['A']
  })
  const first = build('first')
  memory.commit({
    question: '2. 面对挑战会怎样？',
    options: { A: '主动尝试', B: '回避' },
    answers: ['A']
  })
  const second = build('second')
  const prefix = (prompt) => `${prompt.system}\n${prompt.messages[0].content[0].text}`
  assert.ok(prefix(first).startsWith(prefix(empty)))
  assert.ok(prefix(second).startsWith(prefix(first)))
  assert.ok(prefix(second).length > prefix(first).length)
  assert.ok(!prefix(second).includes('second'))
  assert.equal(
    second.messages[0].content[0].text,
    `assessmentHistory:\n${memory.snapshot().context}`
  )
})

test('disabling personality omits even a stale history argument and new sessions start empty', () => {
  const builder = new AssessmentPromptBuilder()
  const cfg = config()
  const memory = new AssessmentMemoryService()
  memory.configure(true, cfg.personality)
  memory.commit({ question: '旧会话题目', options: { A: '旧会话选项' }, answers: ['A'] })
  const old = memory.snapshot().context
  const normal = builder.build({ ...cfg, memoryEnabled: false }, capture, 'normal', old)
  assert.deepEqual(
    normal.messages[0].content.map((p) => p.type),
    ['text', 'image']
  )
  assert.ok(!normal.system.includes(cfg.personality))
  assert.ok(!JSON.stringify(normal.messages).includes('旧会话'))
  assert.ok(!JSON.stringify(normal.messages).includes('assessmentHistory'))
  memory.configure(false)
  memory.configure(true, cfg.personality)
  const restarted = builder.build(cfg, capture, 'restarted', memory.snapshot().context)
  assert.equal(restarted.messages[0].content[0].text, 'assessmentHistory:\n')
  memory.commit({ question: '新会话题目', options: { A: '新选项' }, answers: ['A'] })
  memory.configure(true, '冷静谨慎')
  const changed = builder.build(
    { ...cfg, personality: '冷静谨慎' },
    capture,
    'changed',
    memory.snapshot().context
  )
  assert.equal(changed.messages[0].content[0].text, 'assessmentHistory:\n')
  assert.ok(changed.system.includes('冷静谨慎'))
  assert.ok(!changed.system.includes(cfg.personality))
})

function harness(options = {}) {
  const { ocr, response } = fixture()
  const cfg = { ...config(), ...options.config }
  const clicks = [],
    delays = [],
    prompts = []
  const memory = new AssessmentMemoryService()
  let guards = 0
  let last = {}
  const runner = new AssessmentRunner({
    capture: async () => ({ ...capture, capturedAt: Date.now() }),
    ocr: async () => {
      if (options.ocrThrows) throw new Error('unexpected OCR')
      return options.ocr ?? ocr
    },
    memory,
    ask: async (messages, system, profile, signal, chunk) => {
      prompts.push({ messages, system, profile })
      const data = currentPromptData(messages)
      response.captureId = data.captureId
      if (options.ask) return options.ask(response, signal, data)
      const raw = JSON.stringify(response)
      chunk(raw)
      return raw
    },
    executor: new AssessmentClickExecutor(
      async (p) => {
        clicks.push(p)
        await options.onClick?.(clicks.length)
      },
      async (ms) => {
        delays.push(ms)
      }
    ),
    guard: {
      prepare: () => ({
        check: async () => {
          guards++
          if (options.failGuardAt === guards || options.failGuards?.includes(guards))
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
    runner,
    memory,
    clicks,
    delays,
    prompts,
    get guards() {
      return guards
    },
    get last() {
      return last
    },
    run: (signal = new AbortController().signal, previous) =>
      runner.run(
        {
          id: 'run',
          config: cfg,
          signal,
          phase() {
            return undefined
          }
        },
        (patch) => {
          last = { ...last, ...patch }
        },
        previous
      )
  }
}

test('OCR pipeline clicks ordered first-line centers then next, uses one image and scoped profile', async () => {
  const h = harness()
  await h.run()
  assert.deepEqual(h.clicks, [
    { x: 950, y: 790 },
    { x: 950, y: 530 },
    { x: 1300, y: 1630 }
  ])
  assert.deepEqual(h.delays, [500, 500])
  assert.equal(h.guards, 3)
  assert.equal(h.last.result.execution, 'executed')
  assert.equal(h.prompts[0].messages[0].content.at(-1).image, capture.data)
  assert.equal(h.prompts[0].profile.id, 'p')
  const sent = currentPromptData(h.prompts[0].messages)
  assert.equal(sent.ocr.regions.length, fixture().ocr.regions.length)
  assert.equal(sent.ocr.blocks, undefined)
  assert.equal(sent.ocr.candidates, undefined)
  assert.ok(h.memory.snapshot().context)
})

test('reported B colon/semicolon difference completes once and stores OCR text', async () => {
  const { ocr } = fixture()
  const first =
    '更换上网方式：建议用手机分享WiFi热点，通过电脑连接手机WiFi上网：或者更换到WiFi信号强的地方再次尝试，不建议使用校园网'
  const continuation = '络或者公司内部网络'
  ocr.regions[3].text = first
  ocr.regions[4].text = continuation
  const h = harness({
    ocr,
    ask: async (r) => {
      r.options.B.text = first.replace('上网：', '上网；') + continuation
      r.answers = ['B']
      return JSON.stringify(r)
    }
  })
  const states = []
  const c = new AssessmentController(
    h.runner,
    () => h.cfg,
    (s) => states.push(s),
    async () => {
      throw new Error('Text mismatch must not retry or wait')
    }
  )
  assert.equal(await c.runOnce(), true, c.getSnapshot().error)
  assert.equal(h.prompts.length, 1)
  assert.deepEqual(h.clicks, [
    { x: 950, y: 790 },
    { x: 1300, y: 1630 }
  ])
  const result = c.getSnapshot().result
  assert.equal(result.optionTexts.B, first + '\n' + continuation)
  assert.ok(result.raw.includes('上网；'))
  assert.match(result.notices[0], /选项 B.*OCR 原文/)
  assert.match(c.getSnapshot().notice, /选项 B.*OCR 原文/)
  assert.ok(h.memory.snapshot().context.includes('上网：'))
  assert.ok(!h.memory.snapshot().context.includes('上网；'))
  assert.ok(states.every((s) => s.error === null && s.phase !== 'refreshing'))
})

test('model text correction does not bypass unknown or invalid click references', () => {
  const { ocr, response } = fixture()
  response.options.A.text = '改写文本'
  response.options.A.clickRegionId = 'r004'
  assert.throws(() => validate(response, ocr), /点击框不属于/)
  response.options.A.regionIds = ['does-not-exist']
  response.options.A.clickRegionId = 'does-not-exist'
  assert.throws(() => validate(response, ocr), /不存在/)
})

test('model can select a continuation line as the click target without coordinate inference', async () => {
  const h = harness({
    ask: async (r) => {
      r.answers = ['A']
      r.options.A.clickRegionId = 'r003'
      r.next = { required: false }
      return JSON.stringify(r)
    }
  })
  await h.run()
  assert.deepEqual(h.clicks, [{ x: 950, y: 590 }])
  assert.equal(h.last.result.plan[0].regionId, 'r003')
})

test('OCR failure never falls back to model coordinates or issues clicks', async () => {
  const h = harness({ ocrThrows: true })
  await assert.rejects(h.run(), /unexpected OCR/)
  assert.equal(h.clicks.length, 0)
  assert.equal(h.prompts.length, 0)
})

test('invalid final target prevents all clicks and memory writes', async () => {
  const h = harness({
    ask: async (r) => {
      r.next.clickRegionId = 'missing'
      return JSON.stringify(r)
    }
  })
  await assert.rejects(h.run(), /不存在/)
  assert.equal(h.clicks.length, 0)
  assert.equal(h.memory.snapshot().context, '')
})

test('model can select OCR next text containing recognition errors', () => {
  const { ocr, response } = fixture()
  ocr.regions[5].text = '下—题'
  assert.equal(validate(response, ocr).next.clickRegionId, 'r006')
  ocr.regions[5].text = '提交子卷'
  assert.throws(() => validate(response, ocr), /提交/)
})

test('preview never clicks or stores memory; normal mode never includes personality/history', async () => {
  const h = harness({ config: { preview: true, memoryEnabled: false } })
  assert.equal((await h.run()).preview, true)
  assert.equal(h.clicks.length, 0)
  assert.equal(h.memory.snapshot().context, '')
  assert.ok(!h.prompts[0].system.includes('开朗'))
  assert.ok(!h.prompts[0].messages[0].content[0].text.includes('assessmentHistory'))
})

test('fixed strategy bypasses OCR and validates missing next before first click', async () => {
  const h = harness({
    config: { strategy: 'fixed', nextPosition: null },
    ocrThrows: true,
    ask: async () =>
      JSON.stringify({
        question: '题',
        answers: ['A'],
        options: { A: { text: '是' } },
        next: { required: true }
      })
  })
  await assert.rejects(h.run(), /下一步/)
  assert.equal(h.clicks.length, 0)
})

test('changed page and cancellation stop remaining steps without successful memory', async () => {
  const h = harness({ failGuardAt: 2 })
  await assert.rejects(h.run(), /page changed/)
  assert.equal(h.clicks.length, 1)
  assert.equal(h.last.result.execution, 'partial')
  assert.equal(h.memory.snapshot().context, '')
  const abort = new AbortController()
  const cancelled = harness({ onClick: () => abort.abort() })
  await assert.rejects(cancelled.run(abort.signal), /停止/)
  assert.equal(cancelled.clicks.length, 1)
  assert.equal(cancelled.memory.snapshot().context, '')
})

for (const failGuardAt of [1, 2, 3]) {
  test(`single request re-captures after change at step ${failGuardAt} without repeating clicks`, async () => {
    const h = harness({
      config: { memoryEnabled: false },
      failGuardAt,
      ask: async (r, _signal, data) => {
        if (data.recovery) r.selectedAnswers = data.recovery.executedAnswers
        return JSON.stringify(r)
      }
    })
    const states = [],
      waits = []
    const c = new AssessmentController(
      h.runner,
      () => h.cfg,
      (s) => states.push(s),
      async (ms) => waits.push(ms)
    )
    assert.equal(await c.runOnce(), true, c.getSnapshot().error)
    assert.deepEqual(h.clicks, [
      { x: 950, y: 790 },
      { x: 950, y: 530 },
      { x: 1300, y: 1630 }
    ])
    assert.deepEqual(waits, [3000])
    const first = currentPromptData(h.prompts[0].messages)
    const retry = currentPromptData(h.prompts[1].messages)
    assert.notEqual(first.captureId, retry.captureId)
    assert.deepEqual(retry.recovery.executedAnswers, ['B', 'A'].slice(0, failGuardAt - 1))
    assert.equal(retry.assessmentHistory, undefined)
    assert.equal(h.memory.snapshot().context, '')
    assert.ok(states.some((s) => s.notice.includes('重新截屏') && s.busy && !s.error))
    assert.equal(c.getSnapshot().error, null)
  })
}

test('recovery of a new question does not skip its answers based on old execution', async () => {
  const h = harness({
    failGuardAt: 2,
    ask: async (r, _signal, data) => {
      if (data.recovery) {
        r.question = '2. 新题目'
        r.selectedAnswers = []
        r.answers = ['A']
      }
      return JSON.stringify(r)
    }
  })
  const c = new AssessmentController(
    h.runner,
    () => h.cfg,
    () => {},
    async () => {}
  )
  assert.equal(await c.runOnce(), true)
  assert.deepEqual(h.clicks, [
    { x: 950, y: 790 },
    { x: 950, y: 530 },
    { x: 1300, y: 1630 }
  ])
})

test('repeated recovery retains all confirmed selections and only stores completed memory', async () => {
  let calls = 0
  const recoveryContexts = []
  const h = harness({
    failGuardAt: 2,
    ask: async (r, _signal, data) => {
      calls++
      if (data.recovery) {
        recoveryContexts.push(data.recovery)
        r.selectedAnswers = data.recovery.executedAnswers
      }
      return JSON.stringify(r)
    }
  })
  const originalRun = h.runner.run.bind(h.runner)
  let attempts = 0
  const c = new AssessmentController(
    {
      run: async (...args) => {
        attempts++
        if (attempts === 2) {
          // A transient change before any new click must retain the first attempt's progress.
          throw new AssessmentPageChangedError()
        }
        return originalRun(...args)
      }
    },
    () => h.cfg,
    () => {},
    async () => {}
  )
  assert.equal(await c.runOnce(), true)
  assert.equal(calls, 2)
  assert.deepEqual(recoveryContexts[0].executedAnswers, ['B'])
  assert.equal(h.clicks.length, 3)
  assert.ok(h.memory.snapshot().context.includes('B → A'))
})

test('loop stays active during recovery and user can stop repeated changes', async () => {
  let calls = 0
  let c
  c = new AssessmentController(
    {
      run: async () => {
        calls++
        throw new AssessmentPageChangedError()
      }
    },
    config,
    () => {},
    async (ms) => {
      assert.equal(ms, 3000)
      assert.equal(c.getSnapshot().looping, true)
      assert.equal(c.getSnapshot().error, null)
      await assert.rejects(
        c.runManual(async () => {}),
        /停止/
      )
      if (calls === 4) c.stop()
    }
  )
  await c.toggleLoop()
  assert.equal(calls, 4)
  assert.equal(c.getSnapshot().busy, false)
  assert.equal(c.getSnapshot().error, null)
})

test('ordinary errors are not retried as page changes', async () => {
  let calls = 0
  const c = new AssessmentController(
    {
      run: async () => {
        calls++
        throw new Error('AI format error')
      }
    },
    config,
    () => {},
    async () => {
      throw new Error('unexpected retry')
    }
  )
  assert.equal(await c.runOnce(), false)
  assert.equal(calls, 1)
  assert.equal(c.getSnapshot().error, 'AI format error')
})

test('ordinary answers repair truncated JSON and missing fields before executing once', async () => {
  let calls = 0
  const h = harness({
    ask: async (r) => {
      calls++
      if (calls === 1) return '{"question":'
      if (calls === 2) return JSON.stringify({ ...r, answers: undefined })
      return JSON.stringify(r)
    }
  })
  await h.run()
  assert.equal(calls, 3)
  assert.equal(h.clicks.length, 3)
  assert.equal(h.memory.snapshot().context.match(/题目：/g).length, 1)
  assert.match(h.prompts[1].messages.at(-1).content, /JSON 无效或不完整/)
  assert.deepEqual(h.prompts[0].messages[0], h.prompts[2].messages[0])
})

for (const selected of [undefined, ['A'], ['B', 'B'], ['C']]) {
  test(`recovery rejects ambiguous or invalid selections ${JSON.stringify(selected)}`, async () => {
    const h = harness({
      failGuardAt: 2,
      ask: async (r, _signal, data) => {
        if (data.recovery) r.selectedAnswers = selected
        return JSON.stringify(r)
      }
    })
    const c = new AssessmentController(
      h.runner,
      () => h.cfg,
      () => {},
      async () => {}
    )
    assert.equal(await c.runOnce(), false)
    assert.equal(h.clicks.length, 1)
    assert.equal(h.memory.snapshot().context, '')
  })
}

test('coordinate conversion includes crop offsets and never guesses screen scale', () => {
  assert.deepEqual(
    imageToScreen(
      { x: 200, y: 150 },
      {
        ...capture,
        fullWidth: 1280,
        fullHeight: 800,
        physicalWidth: 2560,
        physicalHeight: 1600,
        offsetX: 100,
        offsetY: 50
      }
    ),
    { x: 600, y: 400 }
  )
  assert.throws(() => imageToScreen({ x: -1, y: 0 }, capture))
  assert.throws(() => imageToScreen({ x: 20, y: 30 }, { ...capture, originX: -2560 }))
})

test('missed next is recovered without reselecting B; a new question resets the budget', async () => {
  const { ocr } = fixture()
  let calls = 0
  let c
  const h = harness({
    ocr,
    ask: async (r, _signal, data) => {
      calls++
      r.answers = ['B']
      r.question = data.ocr.regions[0].text
      if (data.recovery) r.selectedAnswers = calls === 2 ? ['B'] : []
      r.next =
        calls === 1 ? { required: false } : { required: true, kind: 'next', clickRegionId: 'r006' }
      return JSON.stringify(r)
    },
    onClick: async (count) => {
      if (count === 2) ocr.regions[0].text = '2. 请按顺序选择'
    }
  })
  const states = []
  c = new AssessmentController(
    h.runner,
    () => h.cfg,
    (s) => states.push(s),
    async () => {
      if (calls === 3) c.stop()
    }
  )
  await c.toggleLoop()
  assert.equal(calls, 3)
  assert.deepEqual(h.clicks, [
    { x: 950, y: 790 },
    { x: 1300, y: 1630 },
    { x: 950, y: 790 },
    { x: 1300, y: 1630 }
  ])
  assert.ok(states.some((s) => s.notice.includes('重试 1/3')))
  assert.equal(c.getSnapshot().error, null)
  assert.equal((h.memory.snapshot().context.match(/题目：/g) ?? []).length, 2)
})

test('same question gets three corrective actions and a final verification without a fourth click', async () => {
  const h = harness({
    ask: async (r, _signal, data) => {
      r.answers = ['B']
      if (data.recovery) r.selectedAnswers = ['B']
      return JSON.stringify(r)
    }
  })
  const c = new AssessmentController(
    h.runner,
    () => h.cfg,
    () => {},
    async () => {}
  )
  assert.equal(await c.toggleLoop(), false)
  assert.match(c.getSnapshot().error, /已补充分析 3 次/)
  assert.equal(h.prompts.length, 5)
  assert.deepEqual(h.clicks, [
    { x: 950, y: 790 },
    ...Array.from({ length: 4 }, () => ({ x: 1300, y: 1630 }))
  ])
  assert.equal((h.memory.snapshot().context.match(/题目：/g) ?? []).length, 1)
})

test('third recovery can enter a new question before the limit terminates the loop', async () => {
  const { ocr } = fixture()
  let calls = 0,
    c
  const h = harness({
    ocr,
    ask: async (r, _signal, data) => {
      calls++
      r.answers = ['B']
      r.question = data.ocr.regions[0].text
      if (data.recovery) r.selectedAnswers = calls === 5 ? [] : ['B']
      return JSON.stringify(r)
    },
    onClick: async (count) => {
      if (count === 5) ocr.regions[0].text = '2. 请按顺序选择'
    }
  })
  c = new AssessmentController(
    h.runner,
    () => h.cfg,
    () => {},
    async () => {
      if (calls === 5) c.stop()
    }
  )
  await c.toggleLoop()
  assert.equal(calls, 5)
  assert.equal(h.clicks.length, 7)
  assert.equal(c.getSnapshot().error, null)
  assert.equal((h.memory.snapshot().context.match(/题目：/g) ?? []).length, 2)
})

test('image changes and unchanged questions consume the same three-retry budget', async () => {
  const h = harness({
    failGuards: [2, 4],
    ask: async (r, _signal, data) => {
      r.answers = ['B']
      if (data.recovery) r.selectedAnswers = ['B']
      return JSON.stringify(r)
    }
  })
  const c = new AssessmentController(
    h.runner,
    () => h.cfg,
    () => {},
    async () => {}
  )
  await c.toggleLoop()
  assert.equal(h.prompts.length, 5)
  assert.equal(h.clicks.length, 3)
  assert.match(c.getSnapshot().error, /已补充分析 3 次/)
  assert.equal((h.memory.snapshot().context.match(/题目：/g) ?? []).length, 1)
})

test('uncertain selections consume retry budget without any additional click', async () => {
  const h = harness({
    ask: async (r, _signal, data) => {
      if (data.recovery)
        return JSON.stringify({
          schemaVersion: 3,
          captureId: data.captureId,
          status: 'uncertain',
          reason: '无法确认选中状态'
        })
      return JSON.stringify(r)
    }
  })
  const c = new AssessmentController(
    h.runner,
    () => h.cfg,
    () => {},
    async () => {}
  )
  await c.toggleLoop()
  assert.equal(h.prompts.length, 5)
  assert.equal(h.clicks.length, 3)
  assert.match(c.getSnapshot().error, /已补充分析 3 次/)
})

test('page identity ignores punctuation, layout and label order, but keeps option content and progress', () => {
  const { ocr, response } = fixture()
  const a = validate(response, ocr)
  const first = assessmentPageIdentity(a)
  const b = structuredClone(a)
  b.question = '1. 请按顺序，选择！'
  b.options = { B: { text: a.options.A.text }, A: { text: a.options.B.text } }
  const session = new AssessmentRetrySession()
  assert.equal(session.observe(first), false)
  session.beginAttempt()
  assert.equal(session.observe(assessmentPageIdentity(b)), true)
  assert.equal(session.retryCount, 1)
  b.question = '2. 请按顺序选择'
  session.beginAttempt()
  assert.equal(session.observe(assessmentPageIdentity(b)), false)
  assert.equal(session.retryCount, 0)
  b.options.A.text = '不同选项'
  session.beginAttempt()
  assert.equal(session.observe(assessmentPageIdentity(b)), false)
  // OCR progress remains available even if the model omits the title from questionRegionIds.
  ocr.regions.push(row('第8题/共12题', 150, 880, 990))
  a.question = '请按顺序选择'
  a.questionRegionIds = ['r002']
  assert.equal(
    assessmentPageIdentity(a, new AssessmentOcrPreparer().prepare(ocr, ocr.imageSize)).progress,
    '8'
  )
})

test('memory uses option content across reorder and rejects stale session commits', () => {
  const m = new AssessmentMemoryService()
  m.configure(true, '开朗')
  const input = { question: '1. 喜欢什么', options: { A: '苹果', B: '香蕉' }, answers: ['A'] }
  m.commit(input)
  const reordered = { ...input, question: '2. 喜欢什么', options: { A: '香蕉', B: '苹果' } }
  assert.equal(questionKeys(input).contentQuestionKey, questionKeys(reordered).contentQuestionKey)
  assert.notEqual(questionKeys(input).exactQuestionKey, questionKeys(reordered).exactQuestionKey)
  assert.deepEqual(m.match(reordered), ['B'])
  const snapshot = m.snapshot()
  m.configure(false)
  m.configure(true, '安静')
  assert.equal(m.commit(input, snapshot), null)
  assert.equal(m.snapshot().context, '')
  assert.equal(stripQuestionNumber('3.14 是圆周率'), '3.14 是圆周率')
})

test('controller retains lock until old task settles and suppresses further rounds', async () => {
  let release
  let calls = 0
  const runner = {
    run: async () => {
      calls++
      await new Promise((r) => {
        release = r
      })
      return { preview: false, pageKey: 'page' }
    }
  }
  const c = new AssessmentController(runner, config, () => {})
  const running = c.toggleLoop()
  c.stop()
  assert.equal(c.getSnapshot().phase, 'stopping')
  await assert.rejects(c.runOnce(), /停止中/)
  await assert.rejects(
    c.runManual(async () => {}),
    /停止/
  )
  release()
  await running
  assert.equal(c.getSnapshot().busy, false)
  assert.equal(calls, 1)
})

test('preview shortcut performs one round without a loop delay', async () => {
  let calls = 0
  const c = new AssessmentController(
    {
      run: async () => {
        calls++
        return { preview: true, pageKey: 'page' }
      }
    },
    config,
    () => {},
    async () => {
      throw new Error('must not wait')
    }
  )
  assert.equal(await c.toggleLoop(), true)
  assert.equal(calls, 1)
})
