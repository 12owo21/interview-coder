# 项目文件说明

本文档以中文介绍 Interview Coder CN 仓库中的项目文件，结构参考根目录的 AGENTS.md。说明范围包括 Git 跟踪的源码、配置、文档、测试、部署文件和资源。当前工作区额外发现的未跟踪文件也会单独标注。

不逐一列出 node_modules、dist、out、.git、各类缓存目录等依赖、构建产物或运行时生成文件；这些文件由包管理器、构建命令或程序运行产生，不属于需要维护的项目源文件。二进制模型、图标和运行库按单个文件说明用途。

## 项目概览

Interview Coder CN 是一个基于 Electron 的桌面应用，包含截图解题、语音对话提示和自动做题模式。项目由 Electron 主进程、Preload 安全桥、React 渲染进程和共享类型组成；做题模式额外使用本地 OCR、题目分析、结果校验、记忆和鼠标操作模块。

## 技术栈

| 部分 | 技术 |
|---|---|
| 桌面框架 | Electron、electron-vite、electron-builder |
| 前端 | React、TypeScript、React Router |
| 状态管理 | Zustand |
| 样式与组件 | Tailwind CSS、Radix UI、shadcn/ui 风格组件 |
| 大模型 | Vercel AI SDK、OpenAI 兼容接口 |
| 本地 OCR | PaddleOCR 模型、ONNX Runtime、ppu-paddle-ocr |
| 语音识别 | WebSocket、阿里云百炼 Fun-ASR |
| 测试与代码规范 | Node.js Test Runner、ESLint、Prettier、TypeScript |
| 虚拟机 OCR 服务 | Python、RapidOCR、FastAPI、Docker Compose |

## 目录结构

```text
src/main/          Electron 主进程、AI、截图、OCR、做题与系统输入
src/preload/       受控 IPC 安全桥和类型定义
src/renderer/      React 页面、设置、状态管理和组件
src/shared/        主进程与渲染进程共用的数据结构和纯函数
tests/             自动化测试、测试辅助程序和样例
tools/             本地诊断与手工测试脚本
docs/              设计说明、部署说明和开发参考
deploy/ocr/        可独立部署的虚拟机 OCR HTTP 服务
resources/         应用图标、本地 OCR 模型及原生运行库
build/             Windows/macOS 打包素材
scripts/           构建前的资源校验脚本
```

## 文件职责与调用关系

```text
用户快捷键 / React 页面
        ↓
src/main/shortcuts.ts、src/main/assessment.ts
        ↓
截图 → 本地 OCR → 题目提示词 → 大模型 → 结构校验/重试
        ↓
目标解析 → 坐标换算 → 鼠标执行器
        ↓
Preload IPC 将进度、结果和错误同步到渲染进程
```

- 主进程持有系统级能力，例如全局快捷键、屏幕截图、OCR 子进程、文件读写和鼠标输入。
- Preload 只暴露经过约束的 API；渲染进程不直接调用 Node.js 或 Electron 主进程能力。
- renderer/src/lib/store 保存界面状态和设置；main/settings.ts 是主进程运行配置入口。
- shared/ 中的类型需要同时供主进程和渲染进程使用，应避免 Electron、Node.js 和浏览器 DOM 依赖。
- 自动点击前的答案结构校验、题目引用校验、坐标换算和页面状态检查集中在做题相关模块。

## 仓库根目录文件

| 文件 | 作用 |
|---|---|
| .gitignore | 指定 Git 忽略的依赖、构建产物、本地配置和临时文件。 |
| .prettierignore | 指定 Prettier 不应重写的文件；提示词文本尤其需要保持原样。 |
| .prettierrc.yaml | Prettier 格式规则配置。 |
| AGENTS.md | 面向代码代理的项目结构、架构、开发约定和重要实现说明。 |
| CLAUDE.md | 提供给 Claude 类代码代理的项目说明和协作约定。 |
| LICENSE | 项目许可文本。 |
| README.md | 面向使用者的功能介绍、安装、配置、使用和限制说明。 |
| RELEASE_NOTES.md | 当前版本的功能变更、升级提醒和发布记录。 |
| components.json | shadcn/ui CLI 的组件风格、别名和路径配置。 |
| dev-app-update.yml | 开发环境的应用自动更新配置。 |
| electron-builder.yml | 安装包、平台资源、OCR 模型、原生库和发布目标的打包配置。 |
| electron.vite.config.ts | Electron 主进程、Preload、渲染进程及 OCR worker 的 Vite 构建配置。 |
| eslint.config.mjs | ESLint 扁平配置及 TypeScript、React 代码规则。 |
| package.json | 项目元数据、依赖、开发命令、类型检查和打包脚本。 |
| package-lock.json | 锁定 npm 依赖版本，保证安装结果一致。 |
| tsconfig.json | TypeScript 项目引用入口，连接主进程和渲染进程配置。 |
| tsconfig.node.json | 主进程、Preload、共享代码和构建配置的 TypeScript 检查范围。 |
| tsconfig.web.json | 渲染进程、Preload 类型和共享代码的 TypeScript 检查范围。 |

## CI 与构建文件

### .github/workflows

| 文件 | 作用 |
|---|---|
| .github/workflows/release.yml | GitHub Actions 发布工作流，构建并发布应用安装包。 |

### build

| 文件 | 作用 |
|---|---|
| build/entitlements.mac.plist | macOS 签名和运行时所需的权限声明。 |
| build/icon.icns | macOS 应用图标。 |
| build/icon.ico | Windows 安装包和应用可执行文件图标。 |
| build/icon.png | electron-builder 等构建过程使用的通用 PNG 图标。 |

## 部署与设计文档

### docs

| 文件 | 作用 |
|---|---|
| docs/assessment-mode-design.md | 自动做题模式的整体架构、数据流、状态和实施设计。 |
| docs/assessment-most-least-implementation-plan.md | “最符合/最不符合”评分模式的实现方案、组件职责和步骤。 |
| docs/assessment-mouse-controls.md | 做题模式鼠标点击、移动和随机停放功能说明。 |
| docs/assessment-ocr-integration-design.md | 本地 OCR 与做题流程的接口、坐标和集成设计。 |
| docs/assessment-ocr-usage.md | 做题模式 OCR 定位、预览和操作的用户说明。 |
| docs/assessment-session-memory-design.md | 单次测评的题目记忆结构、生命周期和匹配原则。 |
| docs/local-ocr.md | Electron 内置本地 OCR 的运行、设置、资源打包和诊断说明。 |
| docs/project-file-guide-zh.md | 本文档：逐文件介绍仓库结构和主要用途。 |

### deploy/ocr：虚拟机 HTTP OCR 服务

| 文件 | 作用 |
|---|---|
| deploy/ocr/.dockerignore | 排除不应复制进 OCR Docker 构建上下文的文件。 |
| deploy/ocr/.gitignore | 忽略虚拟机密钥、环境文件和本地运行产物。 |
| deploy/ocr/Dockerfile | 定义 Python OCR HTTP 服务的容器镜像构建方式。 |
| deploy/ocr/compose.yaml | 定义 OCR 服务容器、端口、环境变量和资源限制。 |
| deploy/ocr/app.py | 提供健康检查和图片 OCR HTTP API。 |
| deploy/ocr/requirements.txt | 声明 OCR 服务构建需要安装的 Python 依赖。 |
| deploy/ocr/installed-requirements.txt | 记录已部署环境中实际安装的 Python 依赖版本。 |
| deploy/ocr/README.md | OCR 虚拟机服务的部署、调用、鉴权、限制和运维说明。 |
| deploy/ocr/verification.json | 保存一次部署验证的接口结果、响应耗时和检查信息。 |

## 应用资源

### resources

| 文件 | 作用 |
|---|---|
| resources/icon.png | 应用运行和界面使用的图标资源。 |
| resources/ocr/det.onnx | OCR 文字检测 ONNX 模型，用于定位文字区域。 |
| resources/ocr/rec.onnx | OCR 文字识别 ONNX 模型，用于识别文字内容。 |
| resources/ocr/keys.txt | 中文 OCR 识别模型使用的字符字典。 |
| resources/ocr/manifest.json | OCR 模型资源版本、文件清单及完整性校验信息。 |
| resources/ocr/sample.png | 用于本地 OCR 功能验证的合成测试图片。 |
| resources/ocr/sample-expected.json | sample.png 对应的预期 OCR 文字及位置数据。 |
| resources/ocr/LICENSE-PaddleOCR.txt | 随包附带的 PaddleOCR 模型许可文本。 |
| resources/ocr/NOTICE.txt | OCR 资源来源和第三方版权声明。 |
| resources/ocr-runtime/win32/x64/manifest.json | Windows x64 OCR 运行库文件版本和哈希清单。 |
| resources/ocr-runtime/win32/x64/LICENSE-Microsoft-VC.rtf | 随包分发 Microsoft VC++ 运行库的许可文本。 |
| resources/ocr-runtime/win32/x64/msvcp140.dll | Windows x64 C++ 标准库运行时依赖。 |
| resources/ocr-runtime/win32/x64/msvcp140_1.dll | Windows x64 C++ 标准库附加运行时组件。 |
| resources/ocr-runtime/win32/x64/msvcp140_2.dll | Windows x64 C++ 标准库附加运行时组件。 |
| resources/ocr-runtime/win32/x64/msvcp140_atomic_wait.dll | Windows x64 C++ 原子等待相关运行时组件。 |
| resources/ocr-runtime/win32/x64/msvcp140_codecvt_ids.dll | Windows x64 C++ 字符编码转换运行时组件。 |
| resources/ocr-runtime/win32/x64/vcruntime140.dll | Windows x64 Visual C++ 基础运行时。 |
| resources/ocr-runtime/win32/x64/vcruntime140_1.dll | Windows x64 Visual C++ 附加运行时组件。 |
| resources/ocr-runtime/win32/x64/vcruntime140_threads.dll | Windows x64 Visual C++ 线程运行时组件。 |

### scripts

| 文件 | 作用 |
|---|---|
| scripts/check-ocr-assets.cjs | 打包前校验 OCR 模型和原生运行库是否齐全、哈希是否匹配。 |

## 主进程：src/main

### 应用入口与窗口

| 文件 | 作用 |
|---|---|
| src/main/index.ts | Electron 主进程入口，初始化窗口、服务和应用生命周期。 |
| src/main/index.d.ts | 扩展全局类型，声明主窗口等主进程共享对象。 |
| src/main/main-window.ts | 创建主 BrowserWindow，设置透明、置顶、尺寸和内容保护。 |
| src/main/toolbar-window.ts | 创建与主窗口状态联动的悬浮工具栏窗口。 |
| src/main/region-picker.ts | 创建跨显示器截图区域选择窗口并收集所选区域。 |
| src/main/window-resize.ts | 根据鼠标位置调整无边框主窗口和工具栏的大小。 |
| src/main/state.ts | 维护应用当前页面、鼠标穿透及窗口状态，并提供相关 IPC。 |
| src/main/settings.ts | 维护应用设置默认值、校验和设置读写 IPC。 |
| src/main/auto-updater.ts | 配置并处理桌面应用更新检查及安装流程。 |

### AI、截图与输出

| 文件 | 作用 |
|---|---|
| src/main/ai.ts | 创建 AI 模型调用，构造模式系统提示词并提供不同请求流。 |
| src/main/model-list.ts | 请求兼容服务商的模型列表，并返回模型能力信息。 |
| src/main/model-result-retry.ts | 对模型输出执行结构校验及有限次数重试。 |
| src/main/thinking.ts | 设置不同服务商的关闭思考参数，并处理不兼容时的回退。 |
| src/main/stream.ts | 消费模型流式响应，统一处理结束、取消和错误信息。 |
| src/main/shortcuts.ts | 注册全局快捷键，编排截图解题流程并转发结果事件。 |
| src/main/take-screenshot.ts | 通过 Electron 截取屏幕，处理显示器选择、区域裁剪和坐标元数据。 |
| src/main/save-screenshot.ts | 按用户设置将截图保存到本机目录。 |
| src/main/save-code.ts | 从完成的 AI 回答中提取代码块，按设置复制或保存代码。 |

### 做题模式：src/main/assessment.ts 与 src/main/assessment

| 文件 | 作用 |
|---|---|
| src/main/assessment.ts | 注册做题模式 IPC，连接渲染进程请求与做题控制器。 |
| src/main/assessment-memory.ts | 暴露普通性格测评记忆功能的主进程入口。 |
| src/main/assessment/controller.ts | 管理循环做题开始、停止、单轮执行和阶段状态。 |
| src/main/assessment/runner.ts | 执行一轮截图、OCR、模型分析、点击和结果整理。 |
| src/main/assessment/types.ts | 定义做题运行器、依赖和运行状态的内部类型。 |
| src/main/assessment/click-executor.ts | 按有序答题计划调用系统鼠标点击并加入步骤间隔。 |
| src/main/assessment/coordinate-mapper.ts | 将截图内坐标映射到显示器实际屏幕坐标。 |
| src/main/assessment/target-resolver.ts | 根据固定坐标、OCR 引用或模型坐标解析点击目标。 |
| src/main/assessment/page-guard.ts | 检查页面是否变化或是否进入需要人工处理的提交步骤。 |
| src/main/assessment/prompt-builder.ts | 构造普通做题模式的模型提示词和当前轮上下文。 |
| src/main/assessment/response-validator.ts | 验证做题模型 JSON 的字段、答案和 OCR 引用结构。 |
| src/main/assessment/retry-session.ts | 判断重复题目和页面状态，并整理补充分析请求上下文。 |
| src/main/assessment/recovery.ts | 为普通做题流程构造未完成选项的恢复点击计划。 |
| src/main/assessment/memory-service.ts | 保存并匹配普通性格测评中的题目、选项及回答记忆。 |
| src/main/assessment/memory-sessions.ts | 管理测评记忆会话的开启、切换、清理和生命周期。 |
| src/main/assessment/score-prompt.ts | 构造“最符合/最不符合”题型的选项评分提示词。 |
| src/main/assessment/score-decision.ts | 根据选项评分产生最高分和最低分的有序作答结果。 |
| src/main/assessment/score-memory-service.ts | 保存评分模式中已见选项的分数，供后续题目复用。 |
| src/main/assessment/score-recovery.ts | 恢复评分模式未完成题目，并校验需要补充的评分。 |
| src/main/assessment/ocr-filter.ts | 做题 OCR 语义过滤扩展点；当前保留所有合法 OCR 区域。 |
| src/main/assessment/ocr-regions.ts | 校验 OCR 结果、生成稳定文字框编号并准备给模型的布局。 |
| src/main/assessment/mouse-parking.ts | 在题目操作完成后按配置选择停放点；未配置自定义区域时按当前屏幕尺寸生成 70%～90% 默认区域。 |
| src/main/assessment/wait.ts | 提供可取消的等待逻辑，用于循环间隔和翻题等待。 |
| src/main/assessment/self-test.ts | 提供不调用真实题目、不执行系统点击的做题模块自检。 |

### 鼠标输入与本地 OCR

| 文件 | 作用 |
|---|---|
| src/main/click.ts | 对外提供屏幕坐标点击服务。 |
| src/main/mouse/movement.ts | 汇总鼠标移动实现并选择对应平台输入方式。 |
| src/main/mouse/linear-movement.ts | 计算线性鼠标移动轨迹和缓入缓出时间点。 |
| src/main/mouse/windows-input.ts | 使用 Windows 输入 API 执行鼠标移动和点击。 |
| src/main/ocr/index.ts | 本地 OCR 的主进程 API，管理 worker 生命周期和识别请求。 |
| src/main/ocr/worker.ts | 独立 OCR utility process 的消息入口和请求处理器。 |
| src/main/ocr/engine.ts | 初始化 PaddleOCR/ONNX Runtime 模型并识别图片文字。 |
| src/main/ocr/image.ts | 解码 PNG、验证图像限制并转换 OCR 输入图像。 |
| src/main/ocr/self-test.ts | 验证本地 OCR 模型、坐标、错误处理、取消和回收行为。 |

### 对话、资料库和语音

| 文件 | 作用 |
|---|---|
| src/main/conversation.ts | 维护对话转录与提示卡，协调自动、手动生成和中止。 |
| src/main/transcription.ts | 通过 WebSocket 连接 Fun-ASR 并处理音频、识别文本和错误。 |
| src/main/knowledge.ts | 管理用户资料库文件、资料 IPC 和各模式资料提示词。 |
| src/main/knowledge-parse.ts | 提取 PDF、DOCX、Markdown 和 TXT 文件中的文本。 |

## Preload：src/preload

| 文件 | 作用 |
|---|---|
| src/preload/index.ts | 通过 contextBridge 向 React 渲染进程暴露受控 IPC API。 |
| src/preload/index.d.ts | 声明 window.api、window.electron 和事件回调的 TypeScript 类型。 |

## 渲染进程入口：src/renderer

| 文件 | 作用 |
|---|---|
| src/renderer/index.html | Vite/React 渲染页面的 HTML 外壳。 |
| src/renderer/src/main.tsx | 创建 React 根节点，处理初始模式路由并加载样式。 |
| src/renderer/src/App.tsx | 配置路由、设置同步、快捷键初始化及全局通知。 |
| src/renderer/src/env.d.ts | 声明渲染进程环境变量和 Vite 类型。 |

### 做题页面：src/renderer/src/assessment

| 文件 | 作用 |
|---|---|
| src/renderer/src/assessment/index.tsx | 做题模式主页面，展示执行状态、配置结果和控制入口。 |
| src/renderer/src/assessment/AiInputPanel.tsx | 展示调试用的模型原始请求输入。 |
| src/renderer/src/assessment/AiOutputPanel.tsx | 展示模型原始输出或格式化 JSON 结果。 |
| src/renderer/src/assessment/OcrDebugPanel.tsx | 展示 OCR 识别框、分组信息和位置调试结果。 |
| src/renderer/src/assessment/ScoreResultPanel.tsx | 展示“最符合/最不符合”评分模式的分数与选择结果。 |
| src/renderer/src/assessment/format-json-output.ts | 将合法 JSON 格式化为适合界面查看的文本。 |

### 截图解题页面：src/renderer/src/coder

| 文件 | 作用 |
|---|---|
| src/renderer/src/coder/index.tsx | 截图模式页面布局及截图模式语音转录生命周期。 |
| src/renderer/src/coder/AppHeader.tsx | 顶部拖动标题栏、模式入口、当前模型和导航按钮。 |
| src/renderer/src/coder/AppContent.tsx | 展示截图画廊、流式解答、Markdown 内容和错误消息。 |
| src/renderer/src/coder/AppStatusBar.tsx | 展示生成状态、追问入口和快捷键提示。 |
| src/renderer/src/coder/TranscriptionBar.tsx | 在页面顶部显示正在累积的语音转录文字。 |
| src/renderer/src/coder/OverlayToolbar.tsx | 独立悬浮工具栏窗口使用的工具栏内容。 |
| src/renderer/src/coder/PrerequisitesChecker.tsx | 提示首次使用者补全 AI 模型必要配置。 |

### 对话页面：src/renderer/src/conversation

| 文件 | 作用 |
|---|---|
| src/renderer/src/conversation/index.tsx | 对话模式主布局，同步主进程中的转录和提示卡。 |
| src/renderer/src/conversation/TranscriptPanel.tsx | 显示对方说话内容并关联高亮对应提示卡。 |
| src/renderer/src/conversation/HintPanel.tsx | 显示 AI 提示卡、生成状态和空状态。 |
| src/renderer/src/conversation/ConversationStatusBar.tsx | 显示监听、提示模式和停止等操作控制。 |
| src/renderer/src/conversation/listening.ts | 封装开始/停止语音识别与提示模式切换操作。 |

### 设置页面：src/renderer/src/settings

| 文件 | 作用 |
|---|---|
| src/renderer/src/settings/index.tsx | 设置主界面导航、分组页面布局和设置页生命周期。 |
| src/renderer/src/settings/components.tsx | 提供设置卡片、字段、折叠高级项和密钥输入组件。 |
| src/renderer/src/settings/ApiHeadersField.tsx | 编辑 API 自定义请求头并提示无法解析的行。 |
| src/renderer/src/settings/ApiProfiles.tsx | 管理多组 AI 地址、密钥、模型和模式分配。 |
| src/renderer/src/settings/AssessmentMouseSettings.tsx | 配置答题后鼠标停放区域和移动选项。 |
| src/renderer/src/settings/CaptureTargetFields.tsx | 配置截图屏幕、截图目标及可选截屏区域。 |
| src/renderer/src/settings/CustomShortcuts.tsx | 录入和管理全局快捷键绑定。 |
| src/renderer/src/settings/KnowledgeField.tsx | 设置资料库内容对某个模式的启用方式。 |
| src/renderer/src/settings/LocalOcrPanel.tsx | 查看本地 OCR 状态、执行图片测试和配置边缘过滤。 |
| src/renderer/src/settings/ModeProfileSelect.tsx | 选择某个运行模式绑定的 AI 配置。 |
| src/renderer/src/settings/ModelField.tsx | 选择模型并提示模型能力与当前模式不匹配。 |
| src/renderer/src/settings/SceneEditor.tsx | 添加、修改、删除或恢复提示词场景。 |
| src/renderer/src/settings/SelectBaseURL.tsx | 选择 AI API 地址和已知平台入口。 |
| src/renderer/src/settings/SelectModel.tsx | 搜索和选择当前 API 地址提供的模型。 |
| src/renderer/src/settings/sections/AiModelsSection.tsx | AI 配置管理设置分组。 |
| src/renderer/src/settings/sections/AppearanceSection.tsx | 透明度、窗口大小和界面隐私等设置分组。 |
| src/renderer/src/settings/sections/AssessmentSection.tsx | 做题模式、OCR、性格记忆和评分相关设置分组。 |
| src/renderer/src/settings/sections/ConversationSection.tsx | 对话模式自动提示、转录显示和触发条件设置分组。 |
| src/renderer/src/settings/sections/KnowledgeSection.tsx | 资料库导入、编辑、删除和模式分配设置分组。 |
| src/renderer/src/settings/sections/ScreenshotSection.tsx | 截图模式提示词、截图目标和代码保存设置分组。 |
| src/renderer/src/settings/sections/ShortcutsSection.tsx | 快捷键设置分组。 |
| src/renderer/src/settings/sections/VoiceSection.tsx | 语音识别服务密钥与语音功能设置分组。 |

### 帮助页面：src/renderer/src/help

| 文件 | 作用 |
|---|---|
| src/renderer/src/help/index.tsx | 帮助页主体，组织使用说明和常见问题。 |
| src/renderer/src/help/FAQ.tsx | 常见使用问题及对应答案。 |
| src/renderer/src/help/OverlayToolbar.tsx | 说明悬浮工具栏按钮和用途。 |
| src/renderer/src/help/Shortcuts.tsx | 展示系统默认快捷键及平台对应显示方式。 |
| src/renderer/src/help/components/index.tsx | 提供帮助内容章节的通用容器组件。 |

### 通用组件：src/renderer/src/components

| 文件 | 作用 |
|---|---|
| src/renderer/src/components/MarkdownRenderer.tsx | 渲染 Markdown、代码高亮和 KaTeX 数学公式。 |
| src/renderer/src/components/ShortcutRenderer.tsx | 按 Windows/macOS 显示快捷键的本地化符号。 |
| src/renderer/src/components/WindowResizeHandles.tsx | 渲染无边框窗口的边缘和角落缩放拖动区域。 |

### shadcn/ui 基础组件：src/renderer/src/components/ui

| 文件 | 作用 |
|---|---|
| src/renderer/src/components/ui/button.tsx | 按钮基础组件和视觉变体。 |
| src/renderer/src/components/ui/checkbox.tsx | 复选框组件。 |
| src/renderer/src/components/ui/command.tsx | 命令面板、搜索列表和键盘选择组件。 |
| src/renderer/src/components/ui/dialog.tsx | 对话框及其标题、内容和操作区域组件。 |
| src/renderer/src/components/ui/input.tsx | 文本输入框组件。 |
| src/renderer/src/components/ui/popover.tsx | 锚定元素弹出层组件。 |
| src/renderer/src/components/ui/select.tsx | 下拉选择组件。 |
| src/renderer/src/components/ui/slider.tsx | 数值滑块组件。 |
| src/renderer/src/components/ui/switch.tsx | 开关组件。 |
| src/renderer/src/components/ui/textarea.tsx | 多行文本输入组件。 |

### 渲染进程工具与状态：src/renderer/src/lib

| 文件 | 作用 |
|---|---|
| src/renderer/src/lib/api-profiles.ts | 定义并创建前端使用的 AI 配置对象。 |
| src/renderer/src/lib/audio-capture.ts | 捕获系统音频并转换为语音识别所需的采样格式。 |
| src/renderer/src/lib/knowledge.ts | 调用资料库 API、统计文本量并管理前端资料列表。 |
| src/renderer/src/lib/model-switch.ts | 切换 API 地址时同步平台对应的模型名称。 |
| src/renderer/src/lib/platform-models.ts | 获取、缓存并维护不同服务商的模型列表。 |
| src/renderer/src/lib/providers.ts | 定义预置 AI 服务商、API 地址和模型映射。 |
| src/renderer/src/lib/theme.ts | 管理界面主题及相关 CSS 变量。 |
| src/renderer/src/lib/toolbar-actions.ts | 定义各模式工具栏操作，供界面和帮助页共用。 |
| src/renderer/src/lib/use-elapsed.ts | 计算并显示当前模型请求耗时。 |
| src/renderer/src/lib/use-mode-page.ts | 提供模式页面路径、名称和页面共用状态逻辑。 |
| src/renderer/src/lib/store/app.ts | 保存主界面状态，例如鼠标穿透和当前模式页面。 |
| src/renderer/src/lib/store/assessment.ts | 保存做题模式的当前结果、流程状态和调试展示数据。 |
| src/renderer/src/lib/store/conversation.ts | 保存渲染进程显示的对话转录和提示卡副本。 |
| src/renderer/src/lib/store/prompts/aptitude-test.md | 能力测评场景的默认系统提示词。 |
| src/renderer/src/lib/store/prompts/behavioral-interview.md | 行为面试场景的默认系统提示词。 |
| src/renderer/src/lib/store/prompts/coding.md | 编程题场景的默认系统提示词。 |
| src/renderer/src/lib/store/prompts/english-exam.md | 英语考试场景的默认系统提示词。 |
| src/renderer/src/lib/store/prompts/english-interview.md | 英文面试场景的默认系统提示词。 |
| src/renderer/src/lib/store/prompts/general-qa.md | 通用问答场景的默认系统提示词。 |
| src/renderer/src/lib/store/prompts/tech-interview.md | 技术面试场景的默认系统提示词。 |
| src/renderer/src/lib/store/settings.ts | Zustand 应用设置状态、默认值、迁移和提示词场景定义。 |
| src/renderer/src/lib/store/shortcuts.ts | 快捷键状态管理、持久化及新动作默认值合并。 |
| src/renderer/src/lib/store/solution.ts | 保存截图模式的生成状态、回答内容、图片和错误。 |
| src/renderer/src/lib/store/transcription.ts | 保存前端语音识别状态、转录文字和错误。 |
| src/renderer/src/lib/utils/duration.ts | 格式化时长供标题栏或状态栏显示。 |
| src/renderer/src/lib/utils/env.ts | 判断当前操作系统及平台快捷键修饰符。 |
| src/renderer/src/lib/utils/index.ts | Tailwind 类名合并和 IPC 状态克隆等通用工具。 |
| src/renderer/src/lib/utils/keyboard.ts | 转换和规范化快捷键字符串。 |
| src/renderer/src/assets/base.css | Tailwind 导入、基础样式和布局变量。 |
| src/renderer/src/assets/hljs-github-light.css | Markdown 代码块的 GitHub Light 高亮主题样式。 |
| src/renderer/src/assets/main.css | 应用 Tailwind、组件主题和全局视觉样式。 |
| src/renderer/src/region-picker/index.tsx | 截图区域选择窗口的 React 页面。 |

## 共享模块：src/shared

| 文件 | 作用 |
|---|---|
| src/shared/api-profile.ts | AI 配置和应用模式的共享类型。 |
| src/shared/assessment.ts | 做题结果、OCR 布局、选项和点击计划的共享类型。 |
| src/shared/assessment-scoring.ts | 评分模式共用的选项评分结构和数据类型。 |
| src/shared/capture-region.ts | 截图区域比例坐标与实际像素之间的转换。 |
| src/shared/conversation.ts | 对话转录、提示卡、提示模式及文本统计类型。 |
| src/shared/knowledge.ts | 资料库文档类型、长度限制和 token 估算函数。 |
| src/shared/mouse-parking.ts | 鼠标随机停放区域和位置配置的共享类型及约束。 |
| src/shared/ocr.ts | OCR 结果、文字区域、过滤参数和服务状态类型。 |
| src/shared/request-headers.ts | 解析自定义请求头并与 Bearer Key 合并。 |

## 测试与测试辅助：tests

| 文件 | 作用 |
|---|---|
| tests/assessment-inspection.test.mjs | 测试题目内容提取、题目变化判断和恢复检查逻辑。 |
| tests/assessment-ocr.test.mjs | 测试 OCR 区域准备、编号、坐标有效性和边缘过滤。 |
| tests/assessment-options.test.cjs | 测试多选项、固定位置和点击计划等做题规则。 |
| tests/assessment-scoring.test.mjs | 测试最符合/最不符合评分记忆和答案决策。 |
| tests/model-result-retry.test.mjs | 测试模型输出格式校验和最多三次重试逻辑。 |
| tests/mouse-movement.test.mjs | 测试鼠标轨迹、坐标边界和移动时长计算。 |
| tests/ocr-filter.test.mjs | 测试 OCR 过滤行为和过滤结果保留规则。 |
| tests/fixtures/assessment-ocr-sidebar.json | 带侧栏内容的 OCR 示例结果，用于验证过滤与题目文本区分。 |
| tests/helpers/load-ts.cjs | 为 Node 测试加载 TypeScript 模块的辅助程序。 |

## 开发工具：tools

| 文件 | 作用 |
|---|---|
| tools/ui-automation-dump.py | Windows 只读 UI Automation 诊断脚本，输出前台窗口控件文字与坐标。 |
| tools/mouse-click-demo.py | 当前工作区新增的鼠标点击实验脚本；尚未加入 Git 跟踪。 |

## 关键流程定位

| 需要修改的功能 | 建议先查看 |
|---|---|
| 截图、全局快捷键及截图解题编排 | src/main/shortcuts.ts、src/main/take-screenshot.ts |
| AI 请求构造、模式提示词和流式输出 | src/main/ai.ts、src/main/stream.ts、src/renderer/src/lib/store/settings.ts |
| 新增或调整提示词场景 | src/renderer/src/lib/store/prompts/、src/renderer/src/lib/store/settings.ts |
| 做题单轮逻辑与循环控制 | src/main/assessment/controller.ts、src/main/assessment/runner.ts |
| OCR 区域准备和过滤 | src/main/ocr/、src/main/assessment/ocr-regions.ts、src/main/assessment/ocr-filter.ts |
| 校验模型返回和失败重试 | src/main/assessment/response-validator.ts、src/main/model-result-retry.ts |
| 点击目标、坐标换算和实际输入 | src/main/assessment/target-resolver.ts、coordinate-mapper.ts、click-executor.ts、src/main/mouse/ |
| 普通测评记忆和评分记忆 | src/main/assessment/memory-service.ts、score-memory-service.ts |
| 增加设置项 | src/main/settings.ts、src/renderer/src/lib/store/settings.ts、对应 settings/sections 组件 |
| 增加 IPC API | src/main 对应服务、src/preload/index.ts、src/preload/index.d.ts |
| OCR 资源打包校验 | resources/ocr/、scripts/check-ocr-assets.cjs、electron-builder.yml |
| 虚拟机 OCR 服务 | deploy/ocr/README.md、app.py、compose.yaml |

## 开发命令

```bash
npm ci
npm run dev
npm run typecheck
npm run lint
npm run build
npm run build:win
npm run build:mac
```

提交源码前，新增的运行时代码应由主进程或共享模块承担其对应职责；React 界面通过 Preload API 调用主进程。提示词默认文件按文本维护，避免自动格式化改变其内容。模型、OCR 和系统输入相关更改应同时检查结构校验、异常路径、坐标空间与取消行为。


## 手机同步（上游 f506378 移植）

| 文件 | 作用 |
|---|---|
| src/main/mobile-sync.ts | 读取截图/对话状态，局域网服务、公网连接、节流推送与退出回收。 |
| src/main/raw.d.ts | 主进程 `?raw` 文本资源导入声明。 |
| src/shared/mobile.ts | 手机状态、只读回答/对话结构及连接状态。 |
| src/renderer/src/settings/sections/MobileSection.tsx | 手机同步开关、二维码、连接状态和部署说明。 |
| relay/relay.mjs、relay/relay.d.mts | HTTP/WebSocket 服务、主机/查看者鉴权与类型声明。 |
| relay/server.mjs | 公网中转服务启动入口。 |
| relay/public/index.html、app.js、style.css | 手机浏览器页面、状态更新、翻页及常亮功能。 |
| relay/public/vendor/marked.umd.js、highlight.min.js | 手机端 Markdown 与代码高亮依赖。 |
| relay/package.json、package-lock.json | 独立中转服务的依赖与锁文件。 |
| relay/Dockerfile、docker-compose.yml、.dockerignore、README.md | 中转部署、容器构建和 HTTPS 配置说明。 |
| tests/mobile-sync.test.mjs、tests/mobile-relay.test.mjs | 同步生命周期、模式边界及中转只读鉴权/重连测试。 |

桌面通过 `mobile:get-status` IPC 查询服务状态。默认关闭，只同步截图和对话文本；做题模式保留手机最后的截图/对话内容且不联动翻页。局域网页面在构建时内联，不依赖安装包外部的 relay 目录；公网服务需单独部署。
