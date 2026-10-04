/* eslint-disable @typescript-eslint/explicit-function-return-type -- This test runs as JavaScript in Node. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/shared/ocr.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
})
const { filterOcrResult, normalizeOcrFilterMargins } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
)

function region(text, x, y) {
  return {
    text,
    score: 0.99,
    points: [[x, y]],
    box: { left: x - 10, top: y - 10, right: x + 10, bottom: y + 10 }
  }
}

function result(regions, width = 2560, height = 1600) {
  return {
    requestId: 'test',
    imageSize: { width, height },
    coordinateSpace: 'input-image',
    regions,
    elapsedMs: 42
  }
}

test('default margins remove all four edges without changing retained geometry or source', () => {
  const option = region('A', 500, 800)
  const input = result([
    region('header', 500, 50),
    region('footer', 500, 1550),
    region('left', 50, 800),
    region('right', 2500, 800),
    option
  ])
  const filtered = filterOcrResult(input)
  assert.deepEqual(filtered.regions, [option])
  assert.equal(filtered.regions[0], option)
  assert.equal(filtered.imageSize, input.imageSize)
  assert.equal(filtered.coordinateSpace, 'input-image')
  assert.equal(input.regions.length, 5)
  assert.equal(filtered.filter.removedCount, 4)
})

test('independent margins use centers and half-open boundaries', () => {
  const input = result([
    region('top boundary', 100, 200),
    region('above', 100, 199),
    region('bottom boundary', 100, 1500),
    region('left boundary', 0, 400),
    region('right boundary', 2510, 400)
  ])
  assert.deepEqual(
    filterOcrResult(input, { top: 200, bottom: 100, left: 0, right: 50 }).regions.map(
      (item) => item.text
    ),
    ['top boundary', 'left boundary']
  )
})

test('zero disables filtering, while margins covering the whole image yield no regions', () => {
  const input = result([region('small image', 50, 50)], 100, 100)
  assert.deepEqual(
    filterOcrResult(input, { top: 0, bottom: 0, left: 0, right: 0 }).regions,
    input.regions
  )
  const filtered = filterOcrResult(input)
  assert.deepEqual(filtered.regions, [])
  assert.equal(filtered.filter.emptyArea, true)
  assert.equal(filterOcrResult(result([])).filter.removedCount, 0)
})

test('legacy, partial and invalid persisted settings are normalized per edge', () => {
  const defaults = { top: 100, bottom: 100, left: 100, right: 100 }
  assert.deepEqual(normalizeOcrFilterMargins(undefined), defaults)
  assert.deepEqual(normalizeOcrFilterMargins(null), defaults)
  assert.deepEqual(normalizeOcrFilterMargins({ top: 0 }), { ...defaults, top: 0 })
  assert.deepEqual(
    normalizeOcrFilterMargins({ top: -1, bottom: 1.5, left: '100', right: Infinity }),
    defaults
  )
})
