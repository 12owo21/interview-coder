# 内置本地 OCR

应用已经内置中文 PP-OCRv4 OCR：Electron utilityProcess 子进程 + onnxruntime-node CPU 推理 + ppu-paddle-ocr 图片处理。模型、字典、原生推理库和 Windows x64 VC++ 运行库随软件分发。客户不用安装 Python、Node.js、Docker，不用配置 OCR API Key，也不依赖虚拟机。

## 使用

启动软件，打开 **设置 → 做题模式 → 本地 OCR → 选择 PNG 测试**，选择一张 PNG 截图。结果区域显示文字、置信度和原图中的坐标。也可以使用 `resources/ocr/sample.png` 合成中文测试图。

当前完成了内置识别服务及测试入口，尚未接入 AI 答案匹配或自动点击。现有做题逻辑仍保持原来的坐标来源。

### OCR 边缘过滤

在同一面板配置上、下、左、右的忽略范围，默认各 **100 像素**，允许非负整数，0 表示不过滤该边。配置自动保存，重启后保留；旧版本设置缺少此项时自动使用默认值。输入框允许清空，离开空输入框时按 0 保存。

过滤在主进程的 `recognizeLocalPng()` 返回结果前统一执行，以每次识别开始时的配置为准。按**输入原图**的像素判断文字框中心：只保留 `left ≤ x < 图片宽度 − right` 且 `top ≤ y < 图片高度 − bottom` 的文字框。四边范围覆盖整张图片时返回空结果并在测试面板提示，不会自动恢复全图结果。

这是识别后的结果过滤，不是裁剪或缩放图片，不改变文字坐标，也不会明显减少推理耗时。`filter` 字段记录本次使用的边缘配置、原始数量、过滤数量及有效区域是否为空；面板显示过滤前后数量。配置修改从下次识别开始生效，已经显示的结果仍对应其原有配置。裁剪截图时，这些边缘指裁剪后输入图片的边缘，而不是显示器边缘。

## 启动和内存

- 应用启动时创建轻量 OCR 子进程，状态为“已启动，等待识别”。模型和原生库在首次识别时加载，避免每次打开软件都占用推理内存。
- 单进程、一次只识别一张图，不堆积请求队列；并发调用立即报忙。
- CPU 推理线程数 2，算子间线程数 1；关闭 ONNX CPU 内存池和内存模式缓存。检测最长边为 1280，识别裁剪源最长边为 2560，单批文字数 1。
- 不缓存图片或 OCR 结果，不自动保存用户截图。
- 空闲 60 秒退出子进程，释放模型、原生内存和图像处理库；下一次识别自动恢复。
- 每 20 次识别，或识别后进程 RSS 超过 450 MiB，也会回收子进程。**450 MiB 是完成请求后的回收阈值，不是硬内存上限**。
- 取消请求会终止本次推理子进程；识别超时 90 秒则报告错误并回收，之后可重试。应用退出时关闭 OCR 子进程。

检测分辨率限制会影响很小的文字，不能把少量测试图的成功率当作所有页面的保证。如果真实截图中的小字漏检，可以后续调整检测尺寸，在准确率与内存之间取舍。

## 调用接口

这是应用内部 IPC 服务，没有额外开放 HTTP 端口。主进程以后可直接调用：

```ts
import { recognizeLocalPng } from './ocr'

const result = await recognizeLocalPng(Buffer.from(capture.data, 'base64'), signal)
```

结果类型在 `src/shared/ocr.ts`，包含 `imageSize`、`coordinateSpace: 'input-image'`、`regions`、`elapsedMs`。`regions` 中的 `points` 为文字外接矩形的四角。坐标始终属于上传原图，内部缩放后会还原；自动点击仍需叠加截图裁剪偏移、屏幕缩放和显示器原点。

当前输入限定 PNG，最大 10 MiB、2000 万像素，单边最多 16384 像素。无文字图片返回空数组。耗时字段只统计识别，不包括首次加载模型。

前端通过 `window.api.getLocalOcrStatus()` 查询状态，通过 `window.api.testLocalOcrImage()` 打开文件选择器并识别。未向前端开放任意磁盘路径读取接口。

## 打包

```powershell
npm run build:win
```

当前实际验收目标是 Windows x64。开发环境和打包环境分别从 `resources/ocr` 与 `process.resourcesPath/ocr` 读取模型，均不运行时下载。`electron.vite.config.ts` 单独构建 `ocr-worker.js`。

`electron-builder.yml` 的处理：

1. `extraResources` 将模型放到软件资源目录，避免在 ASAR 中重复打包。
2. `asarUnpack` 解包 ONNX Runtime 和 Canvas 原生组件。
3. 按平台和架构过滤不需要的 ONNX 原生库。
4. Windows `extraResources` 把微软 VC++ 运行库放在 ONNX 原生库旁，采用 app-local 分发，不修改客户系统目录。来源是微软签名有效的官方 Redistributable，包含相应许可文本。
5. `beforePack` 检查模型和 Windows 运行库 SHA-256；缺少文件或哈希不符则阻止打包。

请保留并提交 `resources/ocr`、`resources/ocr-runtime` 下的二进制文件、字典、清单和许可证。不要只提交 TypeScript 文件。

macOS 的模型路径与原生库打包规则已配置，但没有在 macOS 机器上实测；Windows ARM64 尚未准备对应 CRT 分发资源。本次没有在一台全新、无开发环境的 Windows 虚拟机中验收。

## 可重复的诊断

程序提供不打开界面、不调用 AI、不点击屏幕的自检参数：

```powershell
$report = Join-Path $env:TEMP 'local-ocr-report.json'
Start-Process '.\dist\win-unpacked\截屏解题助手.exe' `
  -ArgumentList "--ocr-self-test=$report" -WindowStyle Hidden -Wait
Get-Content $report
```

自检覆盖中文文字和坐标、两种分辨率、重复请求、空白图、无效/损坏/超大图片、并发拦截、取消恢复、空闲回收和恢复。为缩短测试时间，仅自检中将空闲回收改成 2 秒，正常运行仍为 60 秒。报告的 `passed` 应为 `true`，打包产物的 `packaged` 应为 `true`。

开发环境也可用 `node_modules/electron/dist/electron.exe . --ocr-self-test=绝对报告路径` 执行同一套测试。仓库已有的做题回归测试通过 `node --test tests/assessment-options.test.cjs` 执行。

## 构建机器问题记录

本次机器的 electron-builder 缓存位于加密的 C 盘目录，复制到 D 盘时出现 EFS 错误；将公开构建工具按字节复制到项目的 `node_modules/.cache/local-ocr-builder`，并临时设置 `ELECTRON_BUILDER_CACHE` 后重试。GitHub 工具下载失败时临时使用 `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`。这些是构建机环境处理，不是客户运行依赖，也没有更改系统加密或全局网络配置。

全仓库 lint 存在已有测试文件的 CommonJS 规则错误和大量 CRLF 格式警告；本次新增 OCR 文件单独检查通过。

## 本次验证结果

- `npm run build` 通过（主进程、前端类型检查和构建）；新增 OCR 文件的 ESLint 检查通过；原有做题回归测试 24/24 通过。
- Windows x64 NSIS 安装包已生成，约 145 MiB。检查 ASAR，未包含项目源代码、`.env`、测试/部署文件或重复的 OCR 模型资源。
- 从最终安装包解出程序，在项目目录之外启动并运行完整自检，`packaged: true`、`passed: true`；这是安装包内容运行验证，未运行安装向导覆盖本机已有安装。
- 最终自检中 OCR 待命进程工作集约 76 MiB，三次 2560×1600 合成中文图识别分别为 955、871、903 ms；识别后的进程 RSS 分别约 304、294、288 MiB，不含应用其他进程，也不代表推理峰值。
- 取消、损坏图片处理、空闲回收及重新加载均通过；退出后服务状态为 `stopped`。Windows 模块检查确认将 CRT 放在 ONNX 原生库旁时，进程加载的是随包分发的 CRT 文件。
- 测试图是合成的中文题干、四个选项与下一步按钮；未把这些结果当作实际测评网站的准确率评估。
