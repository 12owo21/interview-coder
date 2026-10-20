/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import loader from './helpers/load-ts.cjs'

const { APP_MODES, nextModePath } = loader.createLoader()('src/shared/app-modes.ts')

function settingsStore(saved) {
  const data = new Map(
    saved ? [['interview-coder-settings', JSON.stringify({ state: saved, version: 8 })]] : []
  )
  const previous = globalThis.localStorage
  globalThis.localStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key)
  }
  const prompts = [
    'coding',
    'english-exam',
    'aptitude-test',
    'general-qa',
    'tech-interview',
    'behavioral-interview',
    'english-interview'
  ]
  try {
    return loader.createLoader(
      Object.fromEntries(prompts.map((name) => [`./prompts/${name}.md?raw`, 'test prompt']))
    )('src/renderer/src/lib/store/settings.ts').useSettingsStore
  } finally {
    if (previous === undefined) delete globalThis.localStorage
    else globalThis.localStorage = previous
  }
}

const profile = (id, vision) => ({
  id,
  name: id,
  apiBaseURL: '',
  apiKey: 'test',
  apiHeaders: '',
  model: 'test-model',
  disableThinking: false,
  vision
})
const saved = () => ({
  apiProfiles: [profile('vision', true), profile('text', false), profile('unknown')],
  activeProfileId: 'vision',
  assessmentProfileId: 'vision',
  screenshotProfileId: 'vision',
  conversationProfileId: 'text',
  lastMode: 'assessment'
})

test('mode shortcut wraps in tab order and ignores auxiliary pages', () => {
  let path = '/assessment'
  const visited = []
  for (let i = 0; i < 6; i++) {
    path = nextModePath(path)
    visited.push(path)
  }
  assert.deepEqual(visited, [
    '/',
    '/conversation',
    '/assessment',
    '/',
    '/conversation',
    '/assessment'
  ])
  for (const path of ['/settings', '/help', '/toolbar', '/unknown'])
    assert.equal(nextModePath(path), null)
})

test('each mode assignment changes only its own binding; capabilities are enforced', () => {
  for (const mode of APP_MODES) {
    const store = settingsStore(saved())
    store.getState().setModeProfile(mode.id, 'unknown')
    for (const other of APP_MODES) {
      assert.equal(
        store.getState()[other.profileKey],
        other.id === mode.id ? 'unknown' : saved()[other.profileKey]
      )
    }
    store.getState().setModeProfile(mode.id, 'missing')
    assert.equal(store.getState()[mode.profileKey], 'unknown')
    store.getState().setModeProfile(mode.id, 'text')
    assert.equal(store.getState()[mode.profileKey], mode.requiresVision ? 'unknown' : 'text')
    assert.equal(store.getState().activeProfileId, 'vision')
  }
})

test('deletion repairs all affected bindings, preferring an image-compatible fallback', () => {
  const input = saved()
  input.conversationProfileId = 'vision'
  const store = settingsStore(input)
  assert.equal(store.getState().removeProfile('vision'), true)
  assert.equal(store.getState().assessmentProfileId, 'unknown')
  assert.equal(store.getState().screenshotProfileId, 'unknown')
  assert.equal(store.getState().conversationProfileId, 'text')
  assert.equal(store.getState().activeProfileId, 'text')
  store.getState().removeProfile('unknown')
  assert.equal(store.getState().assessmentProfileId, 'text')
  assert.equal(store.getState().removeProfile('text'), false)
})

test('rehydration preserves saved choices and lastMode, filling absent legacy bindings', () => {
  const input = saved()
  input.assessmentProfileId = 'unknown'
  const restored = settingsStore(input).getState()
  for (const mode of APP_MODES) assert.equal(restored[mode.profileKey], input[mode.profileKey])
  assert.equal(restored.lastMode, 'assessment')
  delete input.assessmentProfileId
  assert.equal(settingsStore(input).getState().assessmentProfileId, 'vision')
  const fresh = settingsStore().getState()
  for (const mode of APP_MODES)
    assert.ok(fresh.apiProfiles.some((p) => p.id === fresh[mode.profileKey]))
})

test('profile cycling skips text-only models for both screenshot and assessment', () => {
  for (const mode of ['assessment', 'screenshot']) {
    const store = settingsStore(saved())
    assert.equal(store.getState().cycleProfile(mode).id, 'unknown')
    assert.equal(store.getState().cycleProfile(mode).id, 'vision')
    assert.equal(store.getState().cycleProfile(mode, -1).id, 'unknown')
  }
})
