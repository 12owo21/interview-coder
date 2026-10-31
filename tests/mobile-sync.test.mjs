/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import loader from './helpers/load-ts.cjs'

function setup() {
  const handlers = {},
    lifecycle = {}
  const settings = { mobileLanEnabled: false, mobileLanKey: '', mobileRelayEnabled: false }
  const state = { inCoderPage: false, inConversationPage: false, inAssessmentPage: false }
  const published = []
  let changed,
    closed = 0,
    started = 0,
    listening
  const relay = {
    maxViewers: 10,
    publish: (data) => published.push(data),
    close: () => closed++,
    server: {
      on: () => {},
      listen: (_port, _host, callback) => {
        listening = callback
      }
    }
  }
  const mocks = {
    electron: {
      ipcMain: {
        handle: (name, fn) => {
          handlers[name] = fn
        }
      },
      app: {
        on: (event, fn) => {
          lifecycle[event] = fn
        }
      }
    },
    './settings': {
      settings,
      onSettingsChanged: (fn) => {
        changed = fn
      }
    },
    './state': { state },
    '../../relay/relay.mjs': {
      createRelay: () => {
        started++
        return relay
      },
      deriveViewerToken: () => 'test-token',
      MAX_PAYLOAD: 1024 * 1024
    }
  }
  for (const path of [
    'index.html',
    'app.js',
    'style.css',
    'vendor/marked.umd.js',
    'vendor/highlight.min.js'
  ])
    mocks['../../relay/public/' + path + '?raw'] = ''
  const api = loader.createLoader(mocks)('src/main/mobile-sync.ts')
  return {
    api,
    settings,
    state,
    published,
    changed: () => changed(),
    quit: () => lifecycle['before-quit'](),
    status: () => handlers['mobile:get-status'](),
    ready: () => listening(),
    closed: () => closed,
    started: () => started
  }
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('sync stays off by default, preserves last supported mode, publishes only registered state, stops on quit', async (t) => {
  const env = setup()
  t.after(env.quit)
  env.changed()
  await wait(650)
  assert.equal(env.started(), 0)
  env.state.inConversationPage = true
  env.api.markMobileDirty()
  env.state.inConversationPage = false
  env.state.inAssessmentPage = true
  env.api.markMobileDirty()
  env.api.registerMobileSource('screenshot', () => ({
    id: 1,
    status: 'done',
    text: 'hello',
    screenshots: 1
  }))
  env.settings.mobileLanEnabled = true
  env.settings.mobileLanKey = 'test-only-key'
  env.changed()
  await wait(650)
  env.ready()
  assert.equal(env.published.at(-1).mode, 'conversation')
  assert.equal(env.published.at(-1).screenshot.text, 'hello')
  assert.equal('assessment' in env.published.at(-1), false)
  env.api.markMobileDirty()
  env.quit()
  const count = env.published.length
  await wait(250)
  assert.equal(env.published.length, count)
  assert.equal(env.closed(), 1)
  assert.equal(env.status().lan.state, 'off')
  env.changed()
  await wait(650)
  assert.equal(env.started(), 1)
})
