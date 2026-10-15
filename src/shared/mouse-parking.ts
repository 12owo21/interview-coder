/** Absolute physical desktop pixels, matching fixed-click coordinates. Bounds are inclusive. */
export interface MouseParkingRegion {
  id: string
  left: number
  top: number
  right: number
  bottom: number
}

export function isMouseParkingRegion(value: unknown): value is MouseParkingRegion {
  if (!value || typeof value !== 'object') return false
  const region = value as MouseParkingRegion
  return (
    typeof region.id === 'string' &&
    region.id.length > 0 &&
    [region.left, region.top, region.right, region.bottom].every(
      (n) => Number.isInteger(n) && n >= 0 && n <= 2147483647
    ) &&
    region.right > region.left &&
    region.bottom > region.top
  )
}
