/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createLoader } = require('./helpers/load-ts.cjs')
const load = createLoader()
const { AssessmentRunner } = load('src/main/assessment/runner.ts')
const { AssessmentController } = load('src/main/assessment/controller.ts')
const { AssessmentMemoryService } = load('src/main/assessment/memory-service.ts')
const { AssessmentClickExecutor } = load('src/main/assessment/click-executor.ts')

// Keep the original 24 behavioral cases while testing the extracted production flow.
async function runQuestion(count, fixed, memoryEnabled, change = () => {}) {
  const events = []
  const clicks = []
  const letters = Array.from({ length: count }, (_, index) => String.fromCharCode(65 + index))
  const response = {
    question: '1. 请做出选择',
    answers: [letters.at(-1)],
    options: Object.fromEntries(
      letters.map((letter, index) => [
        letter,
        {
          text: count === 2 ? ['正确', '错误'][index] : `选项${letter}`,
          ...(!fixed ? { left: 10, top: 20 + index * 40, right: 30, bottom: 40 + index * 40 } : {})
        }
      ])
    ),
    next: { required: false }
  }
  change(response)
  const memory = new AssessmentMemoryService()
  const config = {
    profile: { apiKey: 'test-key' },
    strategy: fixed ? 'fixed' : 'model',
    preview: false,
    showDebug: false,
    fixedPositions: Object.fromEntries(letters.map((key) => [key, { x: 100, y: 200 }])),
    nextPosition: null,
    memoryEnabled,
    personality: '开朗',
    margins: { top: 100, bottom: 100, left: 100, right: 100 },
    captureScreen: 'cursor',
    captureRegion: null
  }
  const runner = new AssessmentRunner({
    capture: async () => ({
      data: 'mock',
      imageWidth: 800,
      imageHeight: 1200,
      fullWidth: 800,
      fullHeight: 1200,
      physicalWidth: 800,
      physicalHeight: 1200,
      originX: 0,
      originY: 0,
      offsetX: 0,
      offsetY: 0,
      displayId: '1',
      capturedAt: Date.now()
    }),
    ocr: async () => {
      throw new Error('Legacy and fixed modes must not call OCR')
    },
    ask: async () => JSON.stringify(response),
    memory,
    executor: new AssessmentClickExecutor(
      async (point) => clicks.push({ ...point }),
      async () => {}
    ),
    guard: { prepare: () => ({ check: async () => {} }) },
    assertClickSupported() {
      return undefined
    }
  })
  const controller = new AssessmentController(
    runner,
    () => config,
    (state) => {
      if (state.result) events.push({ channel: 'assessment-result', value: state.result })
      if (state.error) events.push({ channel: 'assessment-error', value: state.error })
    }
  )
  return {
    completed: await controller.runOnce(),
    events,
    clicks,
    letters,
    memory: memory.snapshot().context
  }
}

for (const count of [2, 3, 4, 5]) {
  for (const fixed of [false, true]) {
    for (const memoryEnabled of [false, true]) {
      test(`${count} options, fixed=${fixed}, memory=${memoryEnabled}`, async () => {
        const run = await runQuestion(count, fixed, memoryEnabled)
        assert.equal(run.completed, true, JSON.stringify(run.events))
        assert.equal(
          run.events.some(({ channel }) => channel === 'assessment-error'),
          false
        )
        const result = run.events.find(({ channel }) => channel === 'assessment-result').value
        assert.deepEqual(Object.keys(result.optionTexts), run.letters)
        assert.equal(result.answers[0], run.letters.at(-1))
        assert.deepEqual(run.clicks, [
          fixed ? { x: 100, y: 200 } : { x: 20, y: 30 + (count - 1) * 40 }
        ])
        assert.equal(Boolean(run.memory), memoryEnabled)
        if (memoryEnabled)
          assert.ok(
            run.memory.includes(`${run.letters.at(-1)}=${result.optionTexts[run.letters.at(-1)]}`)
          )
      })
    }
  }
}

for (const fixed of [false, true]) {
  for (const [name, change] of [
    [
      'nonexistent answer',
      (value) => {
        value.answers = ['C']
      }
    ],
    [
      'missing options',
      (value) => {
        delete value.options
      }
    ],
    [
      'missing option text',
      (value) => {
        delete value.options.B.text
      }
    ],
    [
      'duplicate answers',
      (value) => {
        value.answers = ['A', 'A']
      }
    ]
  ]) {
    test(`reject ${name}, fixed=${fixed}, without clicks`, async () => {
      const run = await runQuestion(2, fixed, true, change)
      assert.equal(run.completed, false)
      assert.equal(run.clicks.length, 0)
      assert.equal(run.memory, '')
      assert.ok(run.events.some(({ channel }) => channel === 'assessment-error'))
    })
  }
}
