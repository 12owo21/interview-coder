import { app, BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { AssessmentRunner } from './runner'
import { AssessmentController } from './controller'
import { AssessmentClickExecutor } from './click-executor'
import { AssessmentPageGuard } from './page-guard'
import { AssessmentMemoryService } from './memory-service'
import { stripOptionLabel } from './ocr-layout-analyzer'
import { recognizeLocalPng, stopLocalOcrService } from '../ocr'
import type { AssessmentConfig } from './types'
import type { OcrLayout } from '../../shared/assessment'

/** Opt-in integration diagnostic: real OCR + Chromium input, no external AI or OS input. */
export async function runAssessmentSelfTest(reportPath: string): Promise<void> {
  const report: Record<string, unknown> = {
    passed: false,
    packaged: app.isPackaged,
    input: 'Chromium sendInputEvent; no OS mouse input',
    checks: []
  }
  const window = new BrowserWindow({
    show: false,
    width: 1000,
    height: 900,
    frame: false,
    webPreferences: { offscreen: true, backgroundThrottling: false, sandbox: true }
  })
  try {
    await window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><meta charset="utf-8">
      <style>body{margin:0;background:white;font:26px 'Microsoft YaHei',sans-serif;color:black}
      main{position:absolute;left:140px;top:140px;width:720px}button{display:block;text-align:left;width:720px;height:100px;margin-top:35px;padding:15px 25px;border:1px solid #bbb;background:#fff;color:#000;font:24px 'Microsoft YaHei',sans-serif;line-height:32px}#next{width:160px;margin-left:480px}</style>
      <main><p id="stem">1. 请选择符合你的选项</p>
      <button id="A">A. 喜欢与朋友一起交流，<br>愿意主动参与团队活动。</button>
      <button id="B">B. 喜欢安静地独立思考，<br>认真规划接下来的任务。</button>
      <button id="next">下一步</button></main>
      <script>window.hits=[];for(const id of ['A','B','next'])document.getElementById(id).onclick=()=>window.hits.push(id);</script>`)}`
    )
    await new Promise((resolve) => setTimeout(resolve, 300))
    const capture = async () => {
      const image = await window.webContents.capturePage()
      const size = image.getSize()
      const [width, height] = window.getContentSize()
      return {
        data: image.toPNG().toString('base64'),
        imageWidth: size.width,
        imageHeight: size.height,
        fullWidth: size.width,
        fullHeight: size.height,
        physicalWidth: width,
        physicalHeight: height,
        originX: 0,
        originY: 0,
        offsetX: 0,
        offsetY: 0,
        displayId: 'diagnostic',
        capturedAt: Date.now()
      }
    }
    const memory = new AssessmentMemoryService()
    const config: AssessmentConfig = {
      profile: {
        id: 'test',
        name: '本地测试',
        apiBaseURL: '',
        apiKey: 'local-test-only',
        model: 'stub',
        apiHeaders: '',
        disableThinking: false
      },
      strategy: 'ocr',
      preview: true,
      showDebug: true,
      margins: { top: 100, bottom: 100, left: 100, right: 100 },
      memoryEnabled: true,
      personality: '开朗',
      fixedPositions: {},
      nextPosition: null,
      captureScreen: 'cursor',
      captureRegion: null
    }
    let changePage = false
    const clickTimes: number[] = []
    const runner = new AssessmentRunner({
      capture,
      ocr: recognizeLocalPng,
      memory,
      guard: new AssessmentPageGuard(capture),
      assertClickSupported: () => undefined,
      executor: new AssessmentClickExecutor(async (point) => {
        clickTimes.push(Date.now())
        window.webContents.sendInputEvent({
          type: 'mouseDown',
          button: 'left',
          clickCount: 1,
          ...point
        })
        window.webContents.sendInputEvent({
          type: 'mouseUp',
          button: 'left',
          clickCount: 1,
          ...point
        })
        await window.webContents.executeJavaScript('Promise.resolve()')
      }),
      ask: async (messages, _system, _profile, _signal, chunk) => {
        const part = messages[0].content
        assert.ok(Array.isArray(part) && part[0].type === 'text')
        const data = JSON.parse(part[0].text) as { captureId: string; ocr: OcrLayout }
        report.layout = data.ocr
        const options: Record<string, { text: string; regionIds: string[] }> = {}
        for (const label of ['A', 'B']) {
          const group = data.ocr.candidates.find((g) => g.labelHint === label)
          assert.ok(group, `OCR did not group ${label}: ${JSON.stringify(data.ocr.candidates)}`)
          options[label] = { regionIds: group.regionIds, text: stripOptionLabel(group.joinedText) }
          assert.ok(
            group.regionIds.length >= 2,
            `Expected a multiline option: ${JSON.stringify(group)}`
          )
        }
        const next = data.ocr.regions.find((r) => r.text.replace(/\s/g, '') === '下一步')
        assert.ok(next, 'OCR did not find next')
        const raw = JSON.stringify({
          schemaVersion: 2,
          captureId: data.captureId,
          status: 'ok',
          questionBlockId: data.ocr.blocks[0].id,
          question: '1. 请选择符合你的选项',
          answers: ['B', 'A'],
          options,
          next: { required: true, kind: 'next', regionIds: [next.id] }
        })
        chunk(raw)
        if (changePage)
          await window.webContents.executeJavaScript(
            "document.getElementById('stem').textContent='2. 页面已经切换，请不要再点旧位置'"
          )
        return raw
      }
    })
    const controller = new AssessmentController(
      runner,
      () => config,
      () => undefined
    )
    assert.equal(await controller.toggleLoop(), true, controller.getSnapshot().error ?? '')
    assert.deepEqual(await window.webContents.executeJavaScript('window.hits'), [])
    assert.equal(memory.snapshot().context, '')
    report.preview = controller.getSnapshot().result
    config.preview = false
    assert.equal(await controller.runOnce(), true, controller.getSnapshot().error ?? '')
    assert.deepEqual(await window.webContents.executeJavaScript('window.hits'), ['B', 'A', 'next'])
    assert.ok(clickTimes[1] - clickTimes[0] >= 500 && clickTimes[2] - clickTimes[1] >= 500)
    assert.ok(memory.snapshot().context.includes('B → A'))
    report.executed = controller.getSnapshot().result
    changePage = true
    assert.equal(await controller.runOnce(), false)
    assert.match(controller.getSnapshot().error ?? '', /发生变化/)
    assert.deepEqual(await window.webContents.executeJavaScript('window.hits'), ['B', 'A', 'next'])
    report.checks = [
      'real-local-OCR',
      'multiline-grouping',
      'preview-zero-clicks',
      'preview-zero-memory',
      'ordered-DOM-clicks-B-A-next',
      '500ms-spacing',
      'page-change-zero-extra-clicks',
      'session-memory'
    ]
    report.passed = true
  } catch (error) {
    report.error = error instanceof Error ? error.stack : String(error)
  } finally {
    window.destroy()
    stopLocalOcrService()
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')
    app.exit(report.passed ? 0 : 1)
  }
}
