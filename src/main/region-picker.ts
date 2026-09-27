import { join } from 'node:path'
import { BrowserWindow, desktopCapturer, ipcMain, screen, type Display } from 'electron'
import { is } from '@electron-toolkit/utils'
import type { CaptureRegion, RegionRect } from '../shared/capture-region'
import { findScreenSource, settingsResolution } from './take-screenshot'

/** What a picker window draws on: its screen, frozen, and the region already set there */
export interface RegionPickerData {
  /** JPEG data URL of the screen as it was when picking started */
  image: string
  /** The saved region, when it is on this screen */
  region: RegionRect | null
  /** The screen's resolution as its display settings show it, for the size readout */
  width: number
  height: number
}

interface Picker {
  window: BrowserWindow
  display: Display
  image: string
}

/** Above the main window (100) and the toolbar (101) at the same `screen-saver` level */
const PICKER_RELATIVE_LEVEL = 200
/** Last resort against a picker that never answers: it covers every screen */
const PICKER_TIMEOUT = 5 * 60 * 1000

let pickers: Picker[] = []
let savedRegion: CaptureRegion | null = null
let settle: ((region: CaptureRegion | null) => void) | null = null
let timeout: NodeJS.Timeout | null = null

/**
 * Let the user drag out the area screenshots are cropped to. Every screen gets
 * a full-screen window showing a frozen capture of itself, so the user picks
 * from exactly what a screenshot will see (the app's own windows are left out
 * by content protection). Resolves with the new region, or null if cancelled.
 */
export async function pickCaptureRegion(
  current: CaptureRegion | null
): Promise<CaptureRegion | null> {
  if (settle) return null

  const displays = screen.getAllDisplays()
  // Sized for the densest screen, so no background is blurrier than the screen under it
  const thumbnailSize = {
    width: Math.max(...displays.map((d) => Math.round(d.size.width * d.scaleFactor))),
    height: Math.max(...displays.map((d) => Math.round(d.size.height * d.scaleFactor)))
  }
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize })

  return new Promise((resolve) => {
    settle = resolve
    savedRegion = current
    pickers = displays.flatMap((display) => {
      const source = findScreenSource(sources, display)
      if (!source) return []
      const image = `data:image/jpeg;base64,${source.thumbnail.toJPEG(90).toString('base64')}`
      return [{ display, image, window: createPickerWindow(display) }]
    })
    if (pickers.length === 0) {
      finish(null)
      return
    }
    timeout = setTimeout(() => finish(null), PICKER_TIMEOUT)
  })
}

function createPickerWindow(display: Display): BrowserWindow {
  const window = new BrowserWindow({
    ...display.bounds,
    title: '',
    frame: false,
    show: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // Cover the menu bar on macOS instead of being pushed below it
    enableLargerThanScreen: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hiddenInMissionControl: true,
    hasShadow: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  window.setAlwaysOnTop(true, 'screen-saver', PICKER_RELATIVE_LEVEL)
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  window.setContentProtection(true)
  // Mixed-DPI setups on Windows can size a window created with bounds slightly off
  window.setBounds(display.bounds)
  // Untitled, like the main window, so it stays out of screen-share window lists
  window.on('page-title-updated', (event) => event.preventDefault())

  // Closing any one picker, or one that failed, cancels the whole pick: they
  // cover every screen, so none may be left behind
  window.on('closed', () => finish(null))
  window.webContents.on('render-process-gone', () => finish(null))
  window.webContents.on('did-fail-load', () => finish(null))
  window.on('unresponsive', () => finish(null))

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/region-picker`)
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'region-picker' })
  }
  return window
}

function finish(region: CaptureRegion | null): void {
  const resolve = settle
  if (!resolve) return
  settle = null
  if (timeout) clearTimeout(timeout)
  timeout = null

  const closing = pickers
  pickers = []
  for (const picker of closing) {
    if (!picker.window.isDestroyed()) picker.window.destroy()
  }
  resolve(region)
}

function pickerOf(sender: Electron.WebContents): Picker | undefined {
  return pickers.find((p) => !p.window.isDestroyed() && p.window.webContents === sender)
}

ipcMain.handle('getRegionPickerData', (event): RegionPickerData | null => {
  const picker = pickerOf(event.sender)
  if (!picker) return null
  const displayId = String(picker.display.id)
  return {
    image: picker.image,
    region: savedRegion?.displayId === displayId ? savedRegion : null,
    ...settingsResolution(picker.display)
  }
})

// Shown only once its frozen screen is painted, so the user never sees it flash black
ipcMain.on('region-picker-ready', (event) => {
  const picker = pickerOf(event.sender)
  if (!picker) return
  picker.window.show()
  // Keyboard goes to the screen the user is on, for Enter / Esc
  const cursor = screen.getCursorScreenPoint()
  if (screen.getDisplayNearestPoint(cursor).id === picker.display.id) picker.window.focus()
})

/** A usable area: inside the screen and not empty */
function isRegionRect(rect: RegionRect | null): rect is RegionRect {
  if (!rect) return false
  const { x, y, width, height } = rect
  return (
    [x, y, width, height].every(Number.isFinite) &&
    x >= 0 &&
    y >= 0 &&
    width > 0 &&
    height > 0 &&
    x + width <= 1 &&
    y + height <= 1
  )
}

ipcMain.on('finish-region-picker', (event, rect: RegionRect | null) => {
  const picker = pickerOf(event.sender)
  if (!picker) return
  if (!isRegionRect(rect)) return finish(null)
  const { x, y, width, height } = rect
  finish({ displayId: String(picker.display.id), x, y, width, height })
})
