// Screenshots are PNG; validate dimensions before any native decoder allocates pixels.
export const MAX_OCR_BYTES = 10 * 1024 * 1024
export const MAX_OCR_PIXELS = 20_000_000

export function inspectOcrPng(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.byteLength > MAX_OCR_BYTES) throw new Error('OCR 图片不能超过 10 MiB')
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (
    data.length < 33 ||
    !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    data.readUInt32BE(8) !== 13 ||
    data.toString('ascii', 12, 16) !== 'IHDR'
  )
    throw new Error('请选择有效的 PNG 图片')
  const width = data.readUInt32BE(16)
  const height = data.readUInt32BE(20)
  if (!width || !height || width * height > MAX_OCR_PIXELS || width > 16384 || height > 16384) {
    throw new Error('OCR 图片尺寸超限：最多 2000 万像素，单边不超过 16384 像素')
  }
  return { width, height }
}
