/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import loader from './helpers/load-ts.cjs'

const load = loader.createLoader()
const { OcrLayoutAnalyzer, optionLabel } = load('src/main/assessment/ocr-layout-analyzer.ts')
const { AssessmentResponseValidator, parseUniqueJson } = load(
  'src/main/assessment/response-validator.ts'
)
const { AssessmentMemoryService, questionKeys, stripQuestionNumber } = load(
  'src/main/assessment/memory-service.ts'
)
const { AssessmentClickExecutor } = load('src/main/assessment/click-executor.ts')
const { AssessmentRunner } = load('src/main/assessment/runner.ts')
const { AssessmentController } = load('src/main/assessment/controller.ts')
const { imageToScreen } = load('src/main/assessment/coordinate-mapper.ts')

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
    schemaVersion: 2,
    captureId: 'cap',
    status: 'ok',
    questionBlockId: 'q001',
    question: '1. 请按顺序选择',
    answers: ['B', 'A'],
    options: {
      A: { text: '第一行内容\n这是续行', regionIds: ['r002', 'r003'] },
      B: { text: '第二个选项\n这是另一个续行', regionIds: ['r004', 'r005'] }
    },
    next: { required: true, kind: 'next', regionIds: ['r006'] }
  }
  return { ocr, response }
}
function validate(response, ocr) {
  const layout = new OcrLayoutAnalyzer().analyze(ocr, ocr.imageSize)
  return new AssessmentResponseValidator().parseAndValidate(JSON.stringify(response), {
    strategy: 'ocr',
    captureId: 'cap',
    layout
  })
}

test('multiline options form separate groups at both image scales', () => {
  for (const scale of [1, 1.5]) {
    const { ocr, response } = fixture()
    ocr.imageSize = { width: 1000 * scale, height: 1000 * scale }
    for (const r of ocr.regions) for (const k of Object.keys(r.box)) r.box[k] *= scale
    const layout = new OcrLayoutAnalyzer().analyze(ocr, ocr.imageSize)
    assert.deepEqual(
      layout.candidates.filter((g) => g.labelHint).map((g) => g.regionIds),
      [
        ['r002', 'r003'],
        ['r004', 'r005']
      ]
    )
    assert.deepEqual(validate(response, ocr).answers, ['B', 'A'])
  }
})

test('detached label below text baseline attaches once and does not lose continuation', () => {
  const { ocr } = fixture()
  ocr.regions = [
    row('1. 选择', 150),
    row('第一行', 250, 250),
    row('A', 252, 200, 220),
    row('续行', 280, 250),
    row('B. 第二项', 380)
  ]
  const layout = new OcrLayoutAnalyzer().analyze(ocr, ocr.imageSize)
  const a = layout.candidates.find((g) => g.labelHint === 'A')
  assert.deepEqual(a.regionIds, ['r003', 'r002', 'r004'])
  assert.equal(layout.candidates.flatMap((g) => g.regionIds).length, 5)
  const response = {
    schemaVersion: 2,
    captureId: 'cap',
    status: 'ok',
    questionBlockId: 'q001',
    question: '选择',
    answers: ['A'],
    options: {
      A: { text: '第一行\n续行', regionIds: a.regionIds },
      B: { text: '第二项', regionIds: ['r005'] }
    },
    next: { required: false }
  }
  assert.equal(validate(response, ocr).answers[0], 'A')
})

test('SQL A.value does not create a new option; explicit option boundaries do', () => {
  assert.equal(optionLabel('A.value = B.value'), undefined)
  for (const text of ['A. 中文', 'A）中文', '(A) text', 'A、内容'])
    assert.equal(optionLabel(text), 'A')
  const { ocr } = fixture()
  ocr.regions[3].box.top = 311
  ocr.regions[3].box.bottom = 341
  const groups = new OcrLayoutAnalyzer().analyze(ocr, ocr.imageSize).candidates
  assert.equal(groups.filter((g) => g.labelHint).length, 2)
})

test('realistic glyph height and small misread radio do not split multiline SQL', () => {
  const { ocr } = fixture()
  ocr.regions = [
    row('1. 选择 SQL', 150),
    row('SELECT SUM(value) FROM', 250, 200, 800, 27),
    row('Products JOIN Sales', 298, 220, 750, 27),
    row('SELECT COUNT(value) FROM', 400, 200, 800, 27),
    row('3', 410, 185, 195, 10),
    row('Products JOIN Sales', 448, 220, 750, 27)
  ]
  const groups = new OcrLayoutAnalyzer()
    .analyze(ocr, ocr.imageSize)
    .candidates.filter((g) => g.joinedText.startsWith('SELECT'))
  assert.deepEqual(
    groups.map((g) => g.regionIds),
    [
      ['r002', 'r003'],
      ['r004', 'r006']
    ]
  )
})

test('two distinct navigation buttons cannot be combined as one next target', () => {
  const { ocr, response } = fixture()
  ocr.regions.push(row('下一步', 850, 600, 700))
  response.next.regionIds.push('r007')
  assert.throws(() => validate(response, ocr))
})

test('validated text removes option labels before personality memory matching', () => {
  const { ocr, response } = fixture()
  response.options.A.text = 'A. 第一行内容\n这是续行'
  const parsed = validate(response, ocr)
  assert.equal(parsed.options.A.text, '第一行内容\n这是续行')
})

test('question blocks do not merge and sidebar text stays outside numbered question', () => {
  const { ocr } = fixture()
  ocr.regions.push(row('2. 第二道题', 880), row('侧栏', 280, 900, 990))
  const layout = new OcrLayoutAnalyzer().analyze(ocr, ocr.imageSize)
  assert.equal(layout.blocks.length, 2)
  assert.ok(!layout.blocks[0].regionIds.includes('r007'))
  assert.ok(!layout.blocks[0].regionIds.includes('r008'))
})

for (const [name, mutate] of [
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
    'missing option',
    (r) => {
      delete r.options.B
      r.answers = ['A']
    }
  ],
  [
    'rewritten text',
    (r) => {
      r.options.A.text = '完全无关的内容'
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
      r.next.regionIds = ['r002']
    }
  ],
  [
    'submit',
    (r) => {
      r.next.kind = 'submit'
    }
  ],
  [
    'unsupported columns',
    (_r, ocr) => {
      ocr.regions[3].box = { left: 800, right: 990, top: 250, bottom: 280 }
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
    personality: '开朗',
    margins: { top: 100, bottom: 100, left: 100, right: 100 },
    captureScreen: 'cursor',
    captureRegion: null,
    fixedPositions: { A: { x: 10, y: 20 }, B: { x: 30, y: 40 } },
    nextPosition: { x: 50, y: 60 }
  }
}
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
      return ocr
    },
    memory,
    ask: async (messages, system, profile, signal, chunk) => {
      prompts.push({ messages, system, profile })
      const data = JSON.parse(messages[0].content[0].text)
      response.captureId = data.captureId
      if (options.ask) return options.ask(response, signal)
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
          if (options.failGuardAt === guards) throw new Error('page changed')
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
  assert.equal(h.prompts[0].messages[0].content[1].image, capture.data)
  assert.equal(h.prompts[0].profile.id, 'p')
  assert.ok(h.memory.snapshot().context)
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

test('unchanged next iteration does not repeat clicks', async () => {
  const h = harness()
  const { pageKey } = await h.run()
  await assert.rejects(h.run(undefined, pageKey), /页面未切换/)
  assert.equal(h.clicks.length, 3)
})

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
