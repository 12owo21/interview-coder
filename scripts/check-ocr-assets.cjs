/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
// electron-builder loads this hook with CommonJS before creating a distributable.
const { readFileSync } = require('node:fs')
const { resolve, join } = require('node:path')
const { createHash } = require('node:crypto')

function checkOcrAssets(context) {
  const directory = resolve(__dirname, '../resources/ocr')
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'))
  for (const name of ['det.onnx', 'rec.onnx', 'keys.txt']) {
    const record = manifest.files.find((item) => item.file === name)
    const bytes = readFileSync(join(directory, name))
    if (
      !record ||
      bytes.length !== record.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== record.sha256
    ) {
      throw new Error(`OCR 模型文件缺失或校验失败：${name}，停止打包`)
    }
  }
  if ((context?.electronPlatformName ?? process.platform) === 'win32') {
    const arch = context ? require('builder-util').Arch[context.arch] : process.arch
    const runtimeDirectory = resolve(__dirname, `../resources/ocr-runtime/win32/${arch}`)
    const runtime = JSON.parse(readFileSync(join(runtimeDirectory, 'manifest.json'), 'utf8'))
    for (const record of runtime.files) {
      const bytes = readFileSync(join(runtimeDirectory, record.file))
      if (createHash('sha256').update(bytes).digest('hex') !== record.sha256) {
        throw new Error(`OCR Windows 运行库校验失败：${record.file}`)
      }
    }
  }
  console.log('OCR 本地模型完整性校验通过')
}

module.exports = checkOcrAssets
if (require.main === module) checkOcrAssets()
