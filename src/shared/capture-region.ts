/** An area of a screen, as fractions (0–1) of its size, so it survives resolution and scaling changes */
export interface RegionRect {
  x: number
  y: number
  width: number
  height: number
}

/** The part of one screen that screenshots are cropped to */
export interface CaptureRegion extends RegionRect {
  /** `Display.id` of the screen the area is on */
  displayId: string
}

interface Size {
  width: number
  height: number
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

/** The area in whole pixels of something `size` big, kept inside it and at least 1px */
export function regionToPixels(region: RegionRect, size: Size): RegionRect {
  const x = clamp(Math.round(region.x * size.width), 0, size.width - 1)
  const y = clamp(Math.round(region.y * size.height), 0, size.height - 1)
  return {
    x,
    y,
    width: clamp(Math.round(region.width * size.width), 1, size.width - x),
    height: clamp(Math.round(region.height * size.height), 1, size.height - y)
  }
}
