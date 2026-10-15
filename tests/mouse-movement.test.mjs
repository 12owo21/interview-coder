import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawn } from 'node:child_process'
import loader from './helpers/load-ts.cjs'

const load = loader.createLoader()
const { LinearMouseMovement } = load('src/main/mouse/linear-movement.ts')
const { randomParkingPoint } = load('src/main/assessment/mouse-parking.ts')

test('linear path stays on the segment, progresses in time and reaches exact endpoint', () => {
  const algorithm = new LinearMouseMovement()
  for (const target of [
    { x: 900, y: 500 },
    { x: 10, y: 5 },
    { x: 300, y: 200 }
  ]) {
    const start = { x: 300, y: 200 }
    const path = algorithm.createPath(start, target)
    assert.deepEqual(path.at(-1), { ...target, atMs: path.at(-1).atMs })
    assert.ok(path.at(-1).atMs <= 600)
    let time = -1
    for (const frame of path) {
      assert.ok(frame.atMs > time)
      time = frame.atMs
      assert.ok(frame.x >= Math.min(start.x, target.x) && frame.x <= Math.max(start.x, target.x))
      assert.ok(frame.y >= Math.min(start.y, target.y) && frame.y <= Math.max(start.y, target.y))
      const cross =
        (frame.x - start.x) * (target.y - start.y) - (frame.y - start.y) * (target.x - start.x)
      assert.ok(
        Math.abs(cross) <= (Math.abs(target.x - start.x) + Math.abs(target.y - start.y)) / 2
      )
    }
  }
})

test('parking keeps absolute physical coordinates unchanged by display scale or image crop', () => {
  const capture = {
    displayId: '2',
    physicalWidth: 2560,
    physicalHeight: 1440,
    originX: 1920,
    originY: 0,
    offsetX: 400,
    offsetY: 500
  }
  const region = { id: 'one', left: 3968, top: 144, right: 4223, bottom: 431 }
  const first = randomParkingPoint([region], capture, () => 0)
  const last = randomParkingPoint([region], capture, () => 0.999999)
  assert.ok(first.x >= 1920 + 2048 && last.x < 1920 + 2304)
  assert.ok(first.y >= 144 && last.y < 432)
  assert.notDeepEqual(first, last)
})

test('parking chooses regions uniformly rather than weighting them by area', () => {
  const capture = { physicalWidth: 2000, physicalHeight: 1200, originX: 0, originY: 0 }
  const small = { id: 'small', left: 0, top: 0, right: 2, bottom: 2 }
  const large = { id: 'large', left: 100, top: 100, right: 1900, bottom: 1100 }
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const sample = (choice) => {
    const random = [choice, 0.5, 0.5]
    return randomParkingPoint([small, large], capture, () => random.shift())
  }
  assert.deepEqual(sample(0), { x: 1, y: 1 })
  assert.deepEqual(sample(0.4999), { x: 1, y: 1 })
  assert.deepEqual(sample(0.5), { x: 1000, y: 600 })
  assert.deepEqual(sample(0.9999), { x: 1000, y: 600 })
  assert.deepEqual(
    randomParkingPoint([small], capture, () => 0.9999),
    { x: 2, y: 2 }
  )
})

test('parking rejects empty lists, inverted corners, fractions and any out-of-screen region', () => {
  const capture = { physicalWidth: 1920, physicalHeight: 1080, originX: 0, originY: 0 }
  const valid = { id: 'one', left: 1800, top: 1000, right: 1919, bottom: 1079 }
  for (const regions of [
    [],
    null,
    [null],
    [{ ...valid, left: -1 }],
    [{ ...valid, right: 1800 }],
    [{ ...valid, bottom: 1000 }],
    [{ ...valid, left: 1800.5 }],
    [valid, { ...valid, id: 'two', right: 1920 }],
    [valid, { ...valid, id: 'two', bottom: 1080 }]
  ])
    assert.throws(() => randomParkingPoint(regions, capture), /停放区域/)
  assert.doesNotThrow(() => randomParkingPoint([valid], capture))
})

// Execute the actual PowerShell protocol with an in-memory C# cursor. No real
// user32 API is invoked, and no desktop mouse is moved or clicked.
test(
  'Windows helper executes smooth and instant paths, movement-only and click protocol',
  { skip: process.platform !== 'win32' },
  async () => {
    const observations = []
    let cancelOnFrame
    let releases = 0
    const mockedLoad = loader.createLoader({
      'node:child_process': {
        execFile: (_file, _args, _options, callback) => {
          releases++
          callback(null, '', '')
        },
        spawn: (file, args, options) => {
          const mockType = `
public static class MouseInput {
  public struct Point { public int X; public int Y; }
  static int x = 10, y = 20;
  public static bool SetProcessDPIAware() { return true; }
  public static bool GetCursorPos(out Point p) { p = new Point { X=x, Y=y }; return true; }
  public static bool SetCursorPos(int X, int Y) { x=X; y=Y; System.Console.Error.WriteLine("frame:"+X+","+Y); return true; }
  public static void mouse_event(uint f,uint a,uint b,uint c,System.UIntPtr e) { System.Console.Error.WriteLine("button:"+f); }
}`
          const patched = [...args]
          patched[patched.length - 1] = patched
            .at(-1)
            .replace(/public static class MouseInput \{[\s\S]*?\n\}/, mockType)
          const child = spawn(file, patched, options)
          const observation = { stderr: '', command: undefined }
          observations.push(observation)
          child.stderr.on('data', (data) => {
            observation.stderr += data.toString()
            if (data.toString().includes('frame:')) cancelOnFrame?.abort()
          })
          const end = child.stdin.end.bind(child.stdin)
          child.stdin.end = (data) => {
            observation.command = JSON.parse(data)
            return end(data)
          }
          return child
        }
      }
    })
    const { WindowsMouseInput } = mockedLoad('src/main/mouse/windows-input.ts')
    const mouse = new WindowsMouseInput()
    await mouse.execute({ x: 500, y: 300 }, false, { smooth: true })
    assert.ok(observations[0].command.frames.length > 1)
    assert.equal(observations[0].stderr.match(/button:/g), null)
    assert.ok(observations[0].stderr.includes('frame:500,300'))
    await mouse.execute({ x: 40, y: 60 }, true)
    assert.equal(observations[1].command.frames.length, 1)
    assert.deepEqual(observations[1].stderr.match(/button:\d+/g), ['button:2', 'button:4'])
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(mouse.execute({ x: 40, y: 60 }, false, { signal: controller.signal }))
    assert.equal(observations.length, 2)
    cancelOnFrame = new AbortController()
    await assert.rejects(
      mouse.execute({ x: 1500, y: 1200 }, true, { smooth: true, signal: cancelOnFrame.signal }),
      /停止/
    )
    assert.equal(observations[2].stderr.match(/button:/g), null)
    assert.equal(releases, 1)
    assert.ok(
      observations[2].stderr.match(/frame:/g).length < observations[2].command.frames.length
    )
  }
)
