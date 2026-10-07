/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import loader from './helpers/load-ts.cjs'

const load = loader.createLoader()
const { ValidatedModelRequest, ModelResultValidationError } = load('src/main/model-result-retry.ts')

function setup(request, overrides = {}) {
  const messages = [{ role: 'user', content: '固定历史和本轮数据' }]
  const abort = new AbortController()
  const notices = []
  return {
    messages,
    abort,
    notices,
    run: () =>
      new ValidatedModelRequest().run({
        messages,
        signal: abort.signal,
        request,
        validate: (output) => {
          if (output !== 'valid') throw new ModelResultValidationError('缺少评分 A')
          return { valid: true }
        },
        onRetry: (attempt, message) => notices.push({ attempt, message }),
        ...overrides
      })
  }
}

test('three additional attempts can correct output; feedback replaces itself and leaves prefix intact', async () => {
  const requests = []
  const h = setup(async (messages) => {
    requests.push(messages)
    return requests.length === 4 ? 'valid' : 'invalid'
  })
  const result = await h.run()
  assert.deepEqual(result, { output: 'valid', value: { valid: true } })
  assert.equal(requests.length, 4)
  assert.deepEqual(
    h.notices.map((n) => n.attempt),
    [1, 2, 3]
  )
  assert.equal(h.messages.length, 1)
  for (const messages of requests.slice(1)) {
    assert.equal(messages.length, 2)
    assert.deepEqual(messages[0], h.messages[0])
    assert.match(messages[1].content, /缺少评分 A/)
    assert.match(messages[1].content, /完整 JSON/)
  }
})

test('always invalid output stops at four total requests without a fifth confirmation request', async () => {
  let calls = 0
  const h = setup(async () => {
    calls++
    return 'invalid'
  })
  await assert.rejects(h.run(), /已重试 3 次.*缺少评分 A/)
  assert.equal(calls, 4)
})

test('API failures and non-validation errors do not trigger correction requests', async () => {
  let calls = 0
  const h = setup(async () => {
    calls++
    throw new Error('401 invalid key')
  })
  await assert.rejects(h.run(), /401/)
  assert.equal(calls, 1)
  const rejected = setup(async () => 'valid', {
    validate: () => {
      throw new Error('提交需要手动确认')
    }
  })
  await assert.rejects(rejected.run(), /提交/)
  assert.equal(rejected.notices.length, 0)
})

test('cancellation before request, between retries and during response stops further work', async () => {
  let calls = 0
  const h = setup(async () => {
    calls++
    return 'invalid'
  })
  h.abort.abort()
  await assert.rejects(h.run(), /停止/)
  assert.equal(calls, 0)
  const between = setup(
    async () => {
      calls++
      return 'invalid'
    },
    { onRetry: () => between.abort.abort() }
  )
  await assert.rejects(between.run(), /停止/)
  assert.equal(calls, 1)
  let validated = false
  const during = setup(
    async () => {
      during.abort.abort()
      return 'valid'
    },
    {
      validate: () => {
        validated = true
      }
    }
  )
  await assert.rejects(during.run(), /停止/)
  assert.equal(validated, false)
})

test('a new validation request starts with a fresh independent correction budget', async () => {
  let calls = 0
  const h = setup(async () => {
    calls++
    return calls % 4 === 0 ? 'valid' : 'invalid'
  })
  await h.run()
  await h.run()
  assert.equal(calls, 8)
})
