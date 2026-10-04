import {
  desktopCapturer,
  ipcMain,
  screen,
  type DesktopCapturerSource,
  type Display
} from 'electron'
import { regionToPixels, type RegionRect } from '../shared/capture-region'
import { settings } from './settings'

/** A connected screen, as offered by the capture-screen picker in settings */
export interface DisplayOption {
  /** `Display.id` as a string, the value stored in `settings.captureScreen` */
  id: string
  /** Name the OS gives the monitor, e.g. `DELL U2720Q`; may be blank */
  label: string
  primary: boolean
  /** The resolution the OS display settings show, so the user can tell screens apart */
  width: number
  height: number
}

/**
 * Windows settings show physical pixels, macOS the "looks like" size, which is
 * the DIP size: a 4K panel at 2x is listed as 2560×1440, not 5120×2880.
 */
export function settingsResolution(display: Display): Electron.Size {
  const scale = process.platform === 'darwin' ? 1 : display.scaleFactor
  return {
    width: Math.round(display.size.width * scale),
    height: Math.round(display.size.height * scale)
  }
}

/**
 * The capture source of a screen. Sources come in no particular order, so
 * `sources[0]` is not the primary screen; `display_id` matches `Display.id`
 * on macOS and Windows.
 */
export function findScreenSource(
  sources: DesktopCapturerSource[],
  display: Display
): DesktopCapturerSource | undefined {
  return sources.find((s) => s.display_id === String(display.id))
}

/**
 * What to capture. A region pins the capture to its own screen; otherwise it
 * is the screen fixed in settings, or the one under the cursor. A chosen
 * screen that is no longer connected is passed over, keeping the choice for
 * when it is plugged back in.
 */
function getCaptureTarget(target = settings): { display: Display; region: RegionRect | null } {
  const displays = screen.getAllDisplays()
  const byId = (id: string): Display | undefined => displays.find((d) => String(d.id) === id)

  const region = target.captureRegion
  const regionDisplay = region && byId(region.displayId)
  if (regionDisplay) return { display: regionDisplay, region }

  const display =
    byId(target.captureScreen) ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  return { display, region: null }
}

export function takeScreenshot(): Promise<string | void> {
  return takeScreenshotWithMetadata().then((result) => result?.data)
}

export interface ScreenshotCapture {
  displayId: string
  capturedAt: number
  data: string
  /** Size of the image sent to the model, in PNG pixels. */
  imageWidth: number
  imageHeight: number
  fullWidth: number
  fullHeight: number
  /** Physical screen size used by OS-level mouse input. */
  physicalWidth: number
  physicalHeight: number
  /** Physical origin of this display in the virtual desktop. */
  originX: number
  originY: number
  /** Crop origin inside the full captured display image, in PNG pixels. */
  offsetX: number
  offsetY: number
}

/** Capture the same image as takeScreenshot(), while retaining coordinate metadata. */
export function takeScreenshotWithMetadata(target?: { captureScreen: string; captureRegion: typeof settings.captureRegion }): Promise<ScreenshotCapture | undefined> {
  const mainWindow = global.mainWindow
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve(undefined)

  if (target && target.captureScreen !== 'cursor' && !screen.getAllDisplays().some((display) => String(display.id) === target.captureScreen)) return Promise.resolve(undefined)
  const { display, region } = getCaptureTarget(target ? { ...settings, ...target } : settings)
  const { width, height } = display.size

  return desktopCapturer
    .getSources({ types: ['screen'], thumbnailSize: { width, height } })
    .then((sources) => {
      if (sources.length === 0) return undefined
      const source = findScreenSource(sources, display)
      if (!source) return undefined
      const { thumbnail } = source
      const crop = region ? regionToPixels(region, thumbnail.getSize()) : null
      const image = crop ? thumbnail.crop(crop) : thumbnail
      const size = image.getSize()
      const fullSize = thumbnail.getSize()
      const physicalSize = settingsResolution(display)
      const scale = process.platform === 'darwin' ? 1 : display.scaleFactor
      return {
        displayId: String(display.id),
        capturedAt: Date.now(),
        data: image.toPNG().toString('base64'),
        imageWidth: size.width,
        imageHeight: size.height,
        fullWidth: fullSize.width,
        fullHeight: fullSize.height,
        physicalWidth: physicalSize.width,
        physicalHeight: physicalSize.height,
        originX: Math.round(display.bounds.x * scale),
        originY: Math.round(display.bounds.y * scale),
        offsetX: crop?.x ?? 0,
        offsetY: crop?.y ?? 0
      }
    })
    .catch((error) => {
      console.error('Error taking screenshot:', error)
      return undefined
    })
}

/** Connected screens, numbered left to right so the list matches the desk */
function listDisplays(): DisplayOption[] {
  const primaryId = screen.getPrimaryDisplay().id
  return screen
    .getAllDisplays()
    .sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y)
    .map((d) => ({
      id: String(d.id),
      label: d.label,
      primary: d.id === primaryId,
      ...settingsResolution(d)
    }))
}

ipcMain.handle('getDisplays', () => listDisplays())
