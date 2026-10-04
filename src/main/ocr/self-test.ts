import { app, nativeImage } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import {
  getLocalOcrStatus,
  getOcrModelDirectory,
  recognizeLocalPng,
  startLocalOcrService,
  stopLocalOcrService
} from './index'
import type { OcrResult } from '../../shared/ocr'

// An opt-in diagnostic that also runs from the installed executable without Node/Python.
export async function runLocalOcrSelfTest(reportPath: string): Promise<void> {
  const report: Record<string, unknown> = {
    packaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    passed: false
  }
  const samples: unknown[] = []
  try {
    await startLocalOcrService({ idleReleaseMs: 2000 })
    assert.equal(getLocalOcrStatus().modelLoaded, false)
    const workerPid = getLocalOcrStatus().pid
    report.startup = {
      ...getLocalOcrStatus(),
      memory: app.getAppMetrics().find((item) => item.pid === workerPid)?.memory
    }
    report.modelDirectory = getOcrModelDirectory()
    const png = await readFile(join(getOcrModelDirectory(), 'sample.png'))
    const expected: Record<string, number[]> = JSON.parse(
      await readFile(join(getOcrModelDirectory(), 'sample-expected.json'), 'utf8')
    )
    const validate = (result: OcrResult, width: number, height: number): void => {
      assert.deepEqual(result.imageSize, { width, height })
      assert.equal(result.coordinateSpace, 'input-image')
      for (const [text, rect] of Object.entries(expected)) {
        const needle = text.replace(/^[A-Z0-9]+\.\s*/, '').replace(/\s/g, '')
        const region = result.regions.find((item) => item.text.replace(/\s/g, '').includes(needle))
        assert.ok(
          region,
          `Missing text: ${text}; got ${result.regions.map((item) => item.text).join('|')}`
        )
        const x = (region.box.left + region.box.right) / 2
        const y = (region.box.top + region.box.bottom) / 2
        assert.ok(
          x >= (rect[0] * width) / 2560 - 5 && x <= (rect[2] * width) / 2560 + 5,
          `Wrong X: ${text}`
        )
        assert.ok(
          y >= (rect[1] * height) / 1600 - 5 && y <= (rect[3] * height) / 1600 + 5,
          `Wrong Y: ${text}`
        )
      }
    }
    for (let i = 0; i < 3; i++) {
      const result = await recognizeLocalPng(png)
      validate(result, 2560, 1600)
      samples.push({ result, status: getLocalOcrStatus() })
    }
    const small = nativeImage.createFromBuffer(png).resize({ width: 1707, height: 1067 }).toPNG()
    validate(await recognizeLocalPng(small), 1707, 1067)
    const blank = nativeImage
      .createFromBitmap(Buffer.alloc(128 * 128 * 4, 255), { width: 128, height: 128 })
      .toPNG()
    assert.equal((await recognizeLocalPng(blank)).regions.length, 0)
    await assert.rejects(recognizeLocalPng(Buffer.from('invalid')), /PNG/)
    await assert.rejects(recognizeLocalPng(png.subarray(0, 33)))
    await assert.rejects(recognizeLocalPng(Buffer.alloc(10 * 1024 * 1024 + 1)), /10 MiB/)
    const inFlight = recognizeLocalPng(png)
    await assert.rejects(recognizeLocalPng(png), /正在识别/)
    await inFlight
    const controller = new AbortController()
    const cancelled = recognizeLocalPng(png, controller.signal)
    setTimeout(() => controller.abort(), 30)
    await assert.rejects(cancelled, /取消/)
    validate(await recognizeLocalPng(png), 2560, 1600)
    const deadline = Date.now() + 5000
    while (getLocalOcrStatus().state !== 'sleeping' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.equal(getLocalOcrStatus().state, 'sleeping')
    report.afterIdle = getLocalOcrStatus()
    validate(await recognizeLocalPng(png), 2560, 1600)
    report.passed = true
    report.checks = [
      'startup-without-models',
      'Chinese-text-and-original-coordinates',
      'repeat',
      'resized-image',
      'blank',
      'invalid',
      'oversize',
      'busy',
      'cancel-and-recover',
      'idle-release-and-recover'
    ]
  } catch (error) {
    report.error = error instanceof Error ? error.stack : String(error)
    process.exitCode = 1
  } finally {
    report.samples = samples
    stopLocalOcrService()
    report.afterStop = getLocalOcrStatus()
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')
    app.exit(report.passed ? 0 : 1)
  }
}
