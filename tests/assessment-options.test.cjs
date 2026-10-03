const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { test } = require('node:test')
const { runInNewContext } = require('node:vm')
const ts = require('typescript')

// Exercise the real single-question flow without calling a model or moving the mouse.
function loadSource(file, dependencies, globals = {}) {
  const filename = resolve(__dirname, '..', 'src/main', file)
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const exports = {}
  runInNewContext(
    code,
    {
      exports,
      require: (id) => {
        if (Object.hasOwn(dependencies, id)) return dependencies[id]
        throw new Error(`Unexpected dependency: ${id}`)
      },
      AbortController,
      setTimeout,
      clearTimeout,
      ...globals
    },
    { filename }
  )
  return exports
}

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
  const memory = loadSource('assessment-memory.ts', { 'node:crypto': require('node:crypto') })
  const stream = loadSource('stream.ts', {})
  const assessment = loadSource(
    'assessment.ts',
    {
      electron: { ipcMain: { handle() {} } },
      './settings': {
        DEFAULT_ASSESSMENT_PERSONALITY_PROMPT: '开朗',
        getAssessmentProfile: () => ({ apiKey: 'test-key' }),
        settings: {
          assessmentMemoryEnabled: memoryEnabled,
          assessmentPersonalityPrompt: '开朗',
          assessmentFixedClick: fixed,
          assessmentFixedPositions: Object.fromEntries(
            letters.map((letter) => [letter, { x: 100, y: 200 }])
          )
        }
      },
      './take-screenshot': {
        takeScreenshotWithMetadata: async () => ({
          data: 'mock-image',
          imageWidth: 800,
          imageHeight: 1200,
          fullWidth: 800,
          fullHeight: 1200,
          physicalWidth: 800,
          physicalHeight: 1200,
          offsetX: 0,
          offsetY: 0,
          originX: 0,
          originY: 0
        })
      },
      './ai': {
        getAssessmentStream: async function* () {
          yield JSON.stringify(response)
        }
      },
      './stream': stream,
      './click': { clickScreenPoint: async (point) => clicks.push({ ...point }) },
      './assessment-memory': memory
    },
    {
      global: {
        mainWindow: {
          isDestroyed: () => false,
          webContents: { send: (channel, value) => events.push({ channel, value }) }
        }
      }
    }
  )
  return {
    completed: await assessment.analyzeAssessmentScreenshot(),
    events,
    clicks,
    letters,
    memory: memory.getAssessmentMemoryContext()
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
