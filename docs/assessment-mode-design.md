# 设计文档：自动完成性格测评模式（Assessment Mode）

> 状态：草案（v1）
> 基于当前源码版本：Electron 37 / electron-vite 4
> 目标：在现有「截图模式 / 对话模式」基础上，新增第三种模式。快捷键触发后自动循环「截图 → AI 作答 → 模拟点击 → 等待 3 秒 → 重复」，直到用户停止或测评结束。

---

## 1. 目标与非目标

### 目标
1. 一个快捷键启动、另一个快捷键停止的自动答题循环。
2. 严格约束 AI 只输出答案（A/B/C/D，可扩展为 JSON）。
3. 把答案还原成一次真实的鼠标点击，落在屏幕上对应选项上。
4. 单套测评的记忆持久化：用户可配置的「性格设定」+ 本套已答题目与答案，保证前后不冲突、不露馅。
5. 不破坏现有两种模式，复用已有的截图、AI、快捷键、设置基础设施。

### 非目标（v1 暂不做）
- 滑块 / 李克特量表（Likert 5~7 点）/ 二选一强迫选择等题型，先只做「四个选项 A/B/C/D」。
- 复杂的反作弊对抗（真人化鼠标轨迹模拟、随机节奏）——只做「基本拟人延迟 + 少量抖动」，留作后续。
- 多显示器下跨屏点击的复杂场景（先按截图所在屏幕处理）。

---

## 2. 状态机与总体流程

```
                    ┌──────────── 启动快捷键 ────────────┐
                    ▼                                    │
   ┌──────┐   ┌──────────┐   截图+AI作答    ┌─────────┐  │ 成功作答且点击
   │ idle │──▶│ running  │ ───────────────▶ │ 3s 等待 │──┘
   └──────┘   └────┬─────┘                 └─────────┘
                    │ 停止快捷键 / 测评结束 / 连续失败
                    ▼
              ┌──────────┐
              │ stopped  │（回到 idle）
              └──────────┘
```

单次循环（一个题目）：

```
1. takeScreenshot()                  → base64 PNG（复用现有截图，含 captureRegion）
2. 组装上下文（性格 + 本套历史 + 当前图）→ 发给 AI
3. 严格解析答案（A/B/C/D）             → 失败则重试一次，再失败则暂停并提示
4. 定位该选项在屏幕上的坐标            → 见 §6（本设计的核心难点）
5. 注入一次鼠标点击                   → 落在选项中心
6. 等待 3 秒（含少量抖动）            → 进入下一题
7. 每轮检查「是否已到结束页 / 连续无进展」→ 自动停止
```

停止语义：停止快捷键置 `stopping` 标志，**当前这一题要么点完、要么直接丢弃**（不点），然后退出循环。复用现有的 `AbortController` 思路：把循环体包进一个可中止的 context，停止时 `abort()`，AI 流式请求随之取消。

---

## 3. 新增 / 修改的模块

### 新增

| 文件 | 职责 |
|------|------|
| `src/main/assessment.ts` | 测评模式的编排器（对应 `conversation.ts` / `shortcuts.ts` 的角色）：循环、状态机、组装上下文、调用点击、记忆读写 |
| `src/main/click.ts` | 鼠标点击注入的封装：把「目标坐标」变成一次系统级点击（§6） |
| `src/main/assessment-memory.ts` | 记忆持久化层（SQLite，§5.2） |
| `src/shared/assessment.ts` | 类型：`AssessmentSession`、`AnswerRecord`、答案 JSON 的 Zod schema、`normalizeQuestion()` |
| `src/renderer/src/assessment/` | 测评模式页面 `/assessment`：显示运行状态、本套进度、性格设定入口 |

### 修改

| 文件 | 改动 |
|------|------|
| `src/shared/api-profile.ts` | `AppMode` 增加 `'assessment'`；`ApiProfile` 的 `vision` 说明扩展 |
| `src/main/settings.ts` | `getModeProfile('assessment')`；新增 `assessmentProfileId`、`personalityPrompt`、`assessmentIntervalMs` 等设置项 |
| `src/main/ai.ts` | 新增 `getAssessmentAnswer()`（严格 JSON 输出，§5.1） |
| `src/main/shortcuts.ts` | 注册 `startAssessment` / `stopAssessment` 两个快捷键，回调进 `assessment.ts`；`inModePage()` 覆盖 `/assessment` |
| `src/renderer/src/lib/store/settings.ts` | 新增测评模式的设置字段与「性格设定」编辑 |
| `src/renderer/src/App.tsx` | 路由加 `/assessment`；启动模式恢复逻辑（`lastMode`）覆盖 `assessment` |

---

## 4. 用户配置项

沿用现有「settings 存 localStorage，再同步到 main」的双向同步机制：

| 设置项 | 类型 | 说明 |
|--------|------|------|
| `personalityPrompt` | string | 用户自由写的性格设定（例如「我是一名结果导向、喜欢团队协作、情绪稳定的候选人」），每次请求拼进 system prompt |
| `assessmentProfileId` | string | 该模式使用的 AI profile（必须支持图片输入） |
| `assessmentIntervalMs` | number | 作答后的等待间隔，默认 3000 |
| `assessmentAutoClick` | boolean | 是否自动点击（关掉 = 只显示答案，手动点，便于调试/合规） |

> 性格设定为什么不进数据库？它是「用户配置」，和 model、prompt scene 同类，放 settings 最自然、也有现成编辑 UI。数据库只存「会话 + 题目 + 答案」这类结构化运行数据。

---

## 5. 关键设计点

### 5.1 AI 输出契约（严格 ABCD / JSON）

需求点：严格约束模型只返回答案。**直接约束到「字母」并不可靠**——模型会习惯性加"这题选 B，因为……"之类的解释，解析就得多写正则、还容易错。所以约定 JSON 输出，用结构化解析 + 兜底正则。

答案的 JSON 约定（Zod schema，定义在 `src/shared/assessment.ts`）：

```ts
import { z } from 'zod'

export const AssessmentAnswerSchema = z.object({
  answer: z.enum(['A', 'B', 'C', 'D'])    // 唯一字段，严格四选一
})
```

在 `ai.ts` 中用 SDK 的 `generateObject`（结构化输出）拿到强类型结果；若平台不支持，回退到 `streamText` + 手动解析：

```ts
// 伪代码：getAssessmentAnswer()
const { object } = await generateObject({
  model: openai.chat(getModel(profile)),
  system: buildAssessmentSystemPrompt(),   // 性格 + 一致性规则 + 输出格式
  messages,
  schema: AssessmentAnswerSchema,
})
```

**重试与兜底：**
1. `generateObject` 抛错或校验失败 → 用 `streamText` 重试一次，system 里追加「只输出 `{"answer":"X"}` 这一个 JSON，不要任何解释」。
2. 仍失败 → 对文本做正则 `/answer["']?\s*[:：]\s*["']?([A-D])/i`，再不行 `/^[A-D]$/m`。
3. 都失败 → 本轮不点击，暂停循环并通知用户（宁可停，不能乱点）。

**system prompt 结构（按优先级）**，复用 `getKnowledgePrompt` 的思路，但新增一块：

```
<性格设定> personalityPrompt </性格设定>
<作答规则>
  1. 你必须以被测者的上述性格为准作答，所有答案必须与该性格自洽。
  2. 前后不能矛盾：如果某题与「已答题目」内容相同或语义相同，必须给出完全一致的选项。
  3. 只输出一个 JSON 对象，格式 {"answer":"A","x":..,"y":..}，禁止输出任何其他文字。
</作答规则>
<已答题目> …本套历史… </已答题目>
```

### 5.2 记忆持久化（推荐 SQLite）

需求拆解后，其实有两种"记忆"：

| 记忆 | 生命周期 | 存哪里 |
|------|----------|--------|
| 性格设定 | 全局、跨测评 | settings（用户配置） |
| 单套测评的题目+答案 | 一次测评内，要求重启不丢 | **数据库** |
| （可选）历史题库 | 跨测评积累 | 数据库（同表，多 session） |

**推荐：SQLite，用 `better-sqlite3`。**

理由：
1. **查询是刚需**。「前面的题目和答案要喂给模型」「出现相同题目不能选冲突」——需要按题目文本做去重/近似匹配。扁平 JSON 每次都要 `filter` + 字符串比对，SQL 的 `LIKE` / 规范化哈希索引更顺手，数据量大了也不慌。
2. **结构天然是关系型**：`session → questions → answer`，三张表表达最清晰。
3. 单文件、无服务、同步 API，很配 Electron 主进程的同步/顺序调用风格（`better-sqlite3` 是同步接口，直接在循环里 `db.prepare().get()` 即可，无需 async 编排）。
4. 崩溃/重启不丢，且能靠主键 + `INSERT OR REPLACE` 保证幂等。

```sql
-- 一次测评 = 一个 session
CREATE TABLE assessment_sessions (
  id          TEXT PRIMARY KEY,      -- uuid
  started_at  INTEGER NOT NULL,
  status      TEXT NOT NULL          -- 'running' | 'stopped' | 'finished'
);

-- 每道题一条记录，规范化哈希用于去重
CREATE TABLE assessment_questions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT NOT NULL REFERENCES assessment_sessions(id),
  question_text TEXT NOT NULL,        -- 题面（OCR/模型还原的文本，可选，用于重复检测）
  question_hash TEXT NOT NULL,        -- normalizeQuestion() 的哈希
  options_json TEXT,                  -- 选项原文（可选）
  answer       TEXT NOT NULL,         -- 'A'|'B'|'C'|'D'
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_q_hash ON assessment_questions(question_hash);
CREATE INDEX idx_q_session ON assessment_questions(session_id);
```

**去重/一致性检测**（`normalizeQuestion()`）：把题面去空白、全角转半角、去标点、统一大小写后取哈希。哈希相同 → 判定同一题，直接复用上次答案（或显式告诉模型「这题你上次选了 B」）。近似但哈希不同的，v1 用 `LIKE` 前缀匹配兜底，v2 可换向量/编辑距离。

**备选方案**（如果你不想引入原生依赖）：仿照 [knowledge.ts](src/main/knowledge.ts) 的 `userData/knowledge/index.json`，在 `userData/assessment/` 下按 session 存一个 JSON 文件。v1 够用、零依赖、风格统一；代价是跨 session 的题目去重查询要自己写、数据多了会慢。**结论：想省事就 JSON，想"题库级"记忆就 SQLite。本设计按 SQLite 写。**

> 注意：`better-sqlite3` 是原生模块，要针对 Electron 的 Node ABI 重新编译（`@electron/rebuild`），和 §6 的点击库一起处理即可。

### 5.3 上下文拼接（性格 + 历史 + 当前题）

每次请求给模型的内容：

```
system:
  性格设定 + 作答规则 + 输出格式（见 5.1）

user messages（当前题）:
  [ image: 当前截图 ]
  [ text: "已答题目（本套）:\n1. <题面> → B\n2. <题面> → A\n...\n请作答当前题目。" ]
```

要点：
- **历史只给本套的**（session 内），带「题面 + 答案」，让模型做一致性判断。
- 题面来自哪里？两条路：a) 让同一个 VLM 顺带输出题面文本（放在 `reason` 之外加个字段），b) 只在需要重复检测时用。v1 可先不做题面还原，只把「答案序列 + 是否发现重复」喂给模型，减少一次解析负担。**建议 v1 只喂答案序列 + 重复提示**，题面还原留 v2。
- 历史过长时截断：最近 N 题（如 20 题）+ 一个「已选答案分布」摘要，控制 token。

### 5.4 循环与停止

- 复用现有 `StreamContext`（`AbortController` + `reason`）思路：`startAssessment` 创建 context，`stopAssessment` 置 `reason='user'` 并 `abort()`。
- 每次循环开头检查 `context.signal.aborted`，已中止就退出。
- 3 秒等待也用可中止的 `setTimeout`，停止时立刻结束，不等满 3 秒。
- **结束检测**：若连续两轮截图"几乎没有变化"（像素/文本哈希相同）且答案相同，说明要么点空了、要么到了结束页 → 停止并通知。
- 通知通道：主进程 → 渲染层 `/assessment` 页面（`assessment-status` 事件），复用现有 IPC 风格。

---

## 6. 核心难点：把答案变成一次"用户点击"

这是本需求的**关键问题**，拆成两步：

> **第一步：知道"点哪里"（定位） → 第二步：真的"点一下"（注入）**

二者缺一不可，也常被混为一谈。分开讲。

### 6.1 第一步：定位选项的屏幕坐标

AI 只返回了字母 "B"，但点击需要像素坐标 `(x, y)`。有 4 种做法：

| 方案 | 做法 | 优点 | 缺点 |
|------|------|------|------|
| **A. 独立定位请求（推荐）** | 第一次请求严格只返回答案；第二次视觉请求只返回四个选项框和目标选项框 | 答案协议简单，坐标错误不会污染答案 | 多一次请求；坐标仍需校验 |
| B. OCR 定位 | 用 OCR（tesseract TSV / 带 grounding 的 VLM）找出 "B" 标签或选项文本的 bounding box，点其中心 | 不依赖模型出坐标 | 多一次 OCR；选项标签样式不一，匹配有坑 |
| C. 固定区域配置 | 用户在设置里框出「选项区域」，按 4 等分算出坐标 | 简单 | 布局一变就错，滚动即失效，几乎不可用 |
| D. 二次定位请求 | 第一次拿字母，第二次拿该字母的坐标 | 把 A 的风险分摊到两次 | 多一次请求，慢 |

**推荐“严格答案 + 独立定位”**。AI 的对外答案契约保持只有 `A/B/C/D`，避免坐标、理由等字段混入答案协议。定位可以先用选项模板/OCR，定位失败时再调用一次只负责返回选项框坐标的视觉请求。

对 A 的**坐标校验**（防模型乱给坐标导致点错）：
- 坐标必须落在截图范围内（`0 ≤ x < width, 0 ≤ y < height`）。
- 坐标点应位于非背景区域（可选：检查该像素附近颜色是否接近选项的深色/主题色）。
- 若选项框缺失、越界或定位置信度不足 → 重试一次；仍失败则**本轮不点**，暂停并提示。

### 6.2 第二步：注入一次系统级点击

关键认知：**Electron 自己做不到"点别的应用"**。`webContents.sendInputEvent()` 只能往它自己的网页里发事件，点不了用户浏览器里的题。要模拟真实的鼠标点击，必须调用操作系统层的输入注入：

- **Windows**：`user32.dll` 的 `SetCursorPos` + `SendInput`（`INPUT_MOUSE`），或 `mouse_event`。
- **macOS**：Core Graphics 的 `CGEventCreateMouseEvent` + `CGEventPost`。

落地三条路：

| 方案 | 说明 | 备注 |
|------|------|------|
| **用现成库（推荐起步）** | `@nut-tree-fork/nut-js`（TS 友好，`mouse.setPosition`/`mouse.click`）或 `@hurdlegroup/robotjs`（`moveMouse(x,y)`/`mouseClick()`，简单） | 都是原生模块，需 `@electron/rebuild` 针对 Electron ABI 重编译。注意 `robotjs` 原版已停更，用维护 fork |
| 自研 N-API addon | 用 `node-addon-api` 包一层 `SendInput`（Windows）/ `CGEvent`（macOS），每平台约百来行 | 无第三方依赖、完全可控，但要自己维护两套原生代码 |
| `child_process` 调系统命令 | macOS 用 AppleScript/`cliclick`，Windows 无等价内置命令（不可靠） | 不推荐，跨平台不统一 |

`src/main/click.ts` 的封装接口（内部实现可替换，上层无感）：

```ts
// src/main/click.ts
export interface ClickPoint {
  x: number   // 物理像素坐标（见 6.3）
  y: number
}

/** 把光标移到目标点并点击左键，带拟人延迟与抖动 */
export async function clickAt(point: ClickPoint): Promise<void> {
  await mouseMove(point)      // 先移动，带 30~80ms 随机延迟 + ±2px 抖动
  await sleep(30 + jitter)    // 落点停一下
  await mouseDown('left')
  await sleep(40 + jitter)    // 按下到抬起之间隔
  await mouseUp('left')
}
```

### 6.3 坐标系映射（最容易翻车的坑）

点击坐标和截图坐标**不是同一个空间**。看 [take-screenshot.ts:71](src/main/take-screenshot.ts#L71)：

```ts
const { width, height } = display.size                       // DIP（逻辑）尺寸
desktopCapturer.getSources({ thumbnailSize: { width, height } }) // 按 DIP 尺寸截图
```

所以截图的像素 == **DIP（逻辑）坐标**。但注入点击用的是**物理像素**：

- **macOS**：`CGEvent` 用的是全局点（point），和 DIP 一致 → **截图像素 = 点击坐标，1:1，直接点**。
- **Windows**：`SendInput`/`SetCursorPos` 用的是物理像素 → **截图像素 × `display.scaleFactor` = 点击坐标**（125%/150% 缩放下不乘必点错）。

统一换算（放在 `click.ts` 里做，调用方只传"截图像素坐标"）：

```ts
// display.scaleFactor：Windows 为真实缩放比（如 1.5），macOS 视 retina 情况
const physicalX = Math.round(screenshotX * scaleFactor)
const physicalY = Math.round(screenshotY * scaleFactor)
// 多显示器：还要加上该屏在虚拟桌面中的偏移 origin（display.bounds.x/y）
const globalX = physicalX + display.bounds.x
const globalY = physicalY + display.bounds.y
```

**规则**：模型给的 `x`/`y` 始终定义为「当前截图中的像素坐标」；`click.ts` 内部统一转成「系统全局坐标」。当前项目的 `takeScreenshot()` 使用 `display.size` 作为 `desktopCapturer` 的缩略图请求尺寸，而 `Display.size`、`scaleFactor` 和原生输入 API 在不同系统/版本上的含义存在差异，因此不能只凭平台名称假定 1:1 或固定乘法。实现时必须在每个平台做一次校准：读取鼠标当前位置、截取带明显标记的测试画面、换算坐标并验证点击落点；校准结果再用于正式转换。上层（`assessment.ts`）只传截图坐标，不处理平台差异。

### 6.4 权限与焦点

- **macOS**：合成点击需要用户授权「辅助功能」（Accessibility）。启动模式时检测授权状态，未授权则引导用户到系统设置。这也是 native addon / nut-js 的共同前提，绕不开。
- **Windows**：`SendInput` 一般无需特批；但若目标页面在**管理员权限**的浏览器里，普通权限的注入会被 UIPI 拦下——此时需要应用也以管理员运行（v1 先记录为已知限制）。
- **焦点**：点击本身会自然地把焦点给到被测页面，这是预期行为（用户本来就在点）。但注意不要用 `moveTop()` 之类把本应用窗口顶到最前——点击目标是**屏幕上的其他应用**，不是本窗口。

### 6.5 拟人化与容错（v1 从简）

- 每次点击坐标加 ±2px 抖动、间隔加 20~80ms 随机延迟，避免"机械感"。
- **宁可停、不可乱点**：坐标非法 / 解析失败 / 连续两轮无进展 → 暂停循环并通知，绝不盲点。
- 点完 3 秒后，**先截图比对再答下一题**：若页面没变化，说明上一点没生效（选项没选中 / 已到末尾），进入"无进展"计数。

---

## 7. 风险与边界

1. **点错位置**：坐标映射（6.3）、VLM 坐标精度、页面滚动/弹窗都会导致点错。缓解：坐标校验 + 无进展检测 + 自动停止。
2. **题面还原缺失**（v1 不做）：重复题检测只靠答案序列，遇到"同题不同表述"可能漏判，导致前后矛盾。缓解：v2 增加题面字段 + 哈希/近似匹配。
3. **原生依赖成本**：`better-sqlite3` + 点击库都要 `@electron/rebuild`，且换 Electron 版本要重编。这是本功能唯一真正的工程成本。
4. **合规/授权边界**：本功能会代替用户完成应由本人作答的测评，用户应确认这在其所处的规则与场景下是允许的——这一句只作提醒，不影响技术设计。
5. **模型输出漂移**：不同模型对"只输出 JSON + 坐标"的服从度不同，`generateObject` + 兜底重试（5.1）是必要防线。

---

## 8. 分阶段实施计划

**Phase 1 — 跑通"截图 → 严格作答"（不做点击）**
- `AppMode` 加 `'assessment'`；`ai.ts` 加 `getAssessmentAnswer()`（JSON + 兜底）。
- `assessment.ts` 骨架：启动/停止快捷键、循环、只把答案打印到 `/assessment` 页面。
- 验收：按快捷键，能稳定拿到 A/B/C/D，停止正常。

**Phase 2 — 记忆持久化**
- `assessment-memory.ts`（SQLite）+ 性格设定（settings）。
- 上下文拼接带上性格 + 本套历史。
- 验收：重启后本套历史还在；重复题答案一致。

**Phase 3 — 点击注入**
- `click.ts` 封装点击库 / native addon；先做**坐标系校准和映射**并单测（Windows 125%/150%、macOS Retina、多屏负坐标都要验证）。
- 接入循环：答案 → 定位 → 点击 → 3s → 下一题。
- 验收：真实测评页面自动连点，点错即停。

**Phase 4 — 兜底与打磨**
- 坐标校验、无进展检测、结束页检测、OCR 定位兜底（可选）、`/assessment` 页面的状态展示与设置项 UI。

---

## 9. 与现有代码的复用对照

| 现有能力 | 复用点 |
|----------|--------|
| `takeScreenshot()` / `captureRegion` | 截图（含区域裁剪、多屏匹配），几乎零改动 |
| `shortcuts.ts` 的 `StreamContext` / `runAnswer` | 循环中止、AI 流式编排、时长统计，抽象复用 |
| `ai.ts` 的 `createProvider` / `getModel` / `thinking` | AI 客户端与「关闭思考」逻辑，直接复用 |
| `settings` 双向同步 + profile | 新增 `assessmentProfileId` / 性格设定，照抄现有字段模式 |
| `knowledge.ts` 的 `userData` 存储风格 | 若不选 SQLite，JSON 记忆可照此实现 |
