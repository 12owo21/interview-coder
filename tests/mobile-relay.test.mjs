/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { test } from 'node:test'
import WebSocket from 'ws'
import { createRelay, deriveViewerToken } from '../relay/relay.mjs'

async function setup(t, options = {}) {
  const relay = createRelay({
    files: { '/': { body: '<html>test</html>', type: 'text/html' } },
    viewerToken: deriveViewerToken('test-only-secret-key'),
    ...options
  })
  await new Promise((resolve) => relay.server.listen(0, '127.0.0.1', resolve))
  t.after(() => relay.close())
  const base = `http://127.0.0.1:${relay.server.address().port}`
  async function connect(path, headers) {
    const ws = new WebSocket(base.replace('http:', 'ws:') + path, { headers })
    const messages = []
    ws.on('message', (raw) => messages.push(JSON.parse(raw.toString())))
    await once(ws, 'open')
    t.after(() => ws.terminate())
    return { ws, messages }
  }
  return { relay, base, connect, token: deriveViewerToken('test-only-secret-key') }
}

test('relay requires viewer token, serves CSP, and disables LAN host uploads', async (t) => {
  const { base, token } = await setup(t)
  assert.equal((await fetch(base + '/check')).status, 401)
  assert.equal((await fetch(base + '/check?t=' + token)).status, 204)
  assert.match((await fetch(base)).headers.get('content-security-policy'), /default-src 'none'/)
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/host')
  const [error] = await once(ws, 'error')
  assert.match(error.message, /404/)
})

test('late/reconnecting viewers get latest state, viewer cannot publish, capacity recovers', async (t) => {
  const { relay, base, connect, token } = await setup(t, { maxViewers: 1 })
  relay.publish({ text: 'latest' })
  const first = await connect('/view?t=' + token)
  while (!first.messages.some((m) => m.type === 'state'))
    await once(first.ws, 'message', { signal: AbortSignal.timeout(2000) })
  assert.deepEqual(first.messages.find((m) => m.type === 'state')?.data, { text: 'latest' })
  assert.equal((await fetch(base + '/check?t=' + token)).status, 503)
  first.ws.send(JSON.stringify({ type: 'state', data: { text: 'forged' } }))
  first.ws.close()
  await once(first.ws, 'close')
  const second = await connect('/view?t=' + token)
  while (!second.messages.some((m) => m.type === 'state'))
    await once(second.ws, 'message', { signal: AbortSignal.timeout(2000) })
  assert.deepEqual(second.messages.find((m) => m.type === 'state')?.data, { text: 'latest' })
})

test('public relay rejects viewer token as host key and replaces authenticated host', async (t) => {
  const { base, connect, token } = await setup(t, { hostKey: 'test-only-secret-key' })
  const bad = new WebSocket(base.replace('http:', 'ws:') + '/host', {
    headers: { Authorization: 'Bearer ' + token }
  })
  assert.match((await once(bad, 'error'))[0].message, /401/)
  const first = await connect('/host', { Authorization: 'Bearer test-only-secret-key' })
  const replaced = once(first.ws, 'close')
  await connect('/host', { Authorization: 'Bearer test-only-secret-key' })
  assert.equal((await replaced)[0], 4000)
})
