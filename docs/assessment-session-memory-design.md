# 做题模式会话记录存储设计

> 状态：设计讨论稿
> 范围：只讨论单次软件运行期间的内存记录，不实现代码和持久化。

## 1. 需求边界

做题模式需要记录每道题的大模型识别结果，后续用于：

- 展示原题目、答案和点击顺序；
- 判断当前题目是否与本次测评中之前出现过的题目相同；
- 为后续的性格一致性和重复题处理提供上下文；
- 支持单选、多选以及有顺序要求的答案。

本项目是 Electron 单体、单用户应用，一次测评大约 200 道题，极端情况下约 500 道。软件重启后不保留记录；本阶段也不写磁盘、不接 Redis 服务。

## 2. 存储方案比较

### Redis

不推荐。Redis 需要额外服务、连接管理和生命周期处理。当前数据量很小，而且记录只在本次应用运行期间使用，引入 Redis 会增加部署和故障点。

### Caffeine

Caffeine 是 Java 生态的本地缓存库，不能直接作为 TypeScript/Electron 依赖使用。它的核心思想可以借鉴，但没有必要为 200～500 条记录寻找同等复杂度的实现。

### 单个数组

```ts
const records: AssessmentRecord[] = []
```

优点是简单、顺序天然保留。缺点是按题目查找需要遍历数组。500 条记录的遍历成本很小，但重复题匹配会让调用方不断重复规范化和遍历逻辑。

### `Map` 加有序数组

推荐方案。数组负责展示和按答题顺序遍历，`Map` 负责通过规范化题目键快速查找。

```text
records: AssessmentRecord[]
byExactQuestionKey: Map<string, AssessmentRecord[]>
byContentQuestionKey: Map<string, AssessmentRecord[]>
```

同一道题可能因为 OCR、空格或标点差异产生相同的规范化键，因此 Map 的 value 使用数组，而不是只保存一条记录。这样不会因为哈希碰撞或题目重复而覆盖历史记录。

## 3. 推荐的数据结构

### 单道题记录

```ts
type AnswerLetter = 'A' | 'B' | 'C' | 'D'

interface AssessmentRecord {
  /** 本次测评内的递增序号 */
  index: number
  /** 记录创建时间，仅用于调试和展示 */
  createdAt: number
  /** 大模型从截图中还原的原题目，保留原始文本 */
  question: string
  /** 题干规范化键，不单独决定是否为同一道题 */
  stemKey: string
  /** 题干 + 按当前页面顺序排列的选项键 */
  exactQuestionKey: string
  /** 题干 + 排序后的选项键，用于识别“选项顺序变化” */
  contentQuestionKey: string
  /** 按实际点击顺序保存；单选也使用长度为 1 的数组 */
  answers: AnswerLetter[]
  /** 当前题目的选项文本，可选；用于提高重复题判断准确率 */
  options?: Record<AnswerLetter, string>
  /** 答案对应的选项文本，避免选项重排后只依赖 A/B/C/D */
  selectedOptions?: Array<{ answer: AnswerLetter; text: string }>
  /** 最终使用的屏幕坐标，可选；记录当时实际点击位置 */
  clickedPoints?: Array<{ answer: AnswerLetter; x: number; y: number }>
}
```

`answers` 始终是数组，不再区分单选和多选：

```ts
['B']       // 单选
['A', 'C']  // 多选
['B', 'D']  // 先选 B，再选 D
```

不建议把截图 Base64 长期放进记录。截图本身很大，后续如果需要审计，可以另设一个短期截图缓存或只保存截图哈希。

### 会话容器

```ts
interface AssessmentSession {
  id: string
  startedAt: number
  records: AssessmentRecord[]
  /** 完全相同的题干和选项顺序 */
  byExactQuestionKey: Map<string, AssessmentRecord[]>
  /** 题干相同、选项内容相同但顺序可能不同 */
  byContentQuestionKey: Map<string, AssessmentRecord[]>
}
```

建议在主进程中维护单例：

```ts
let currentSession: AssessmentSession | null = null
```

主进程是事实来源，渲染进程只接收快照和事件。这样页面切换不会丢记录，也不会出现主窗口和工具栏各自保存一份不一致的数据。

## 4. 生命周期

### 软件启动

创建空的 `currentSession`，不读取磁盘、不连接 Redis。

### 开始一套新的测评

创建新的 session，清空上一套测评的内存记录：

```text
start new assessment
    ↓
currentSession = createEmptySession()
```

### 每道题完成 AI 分析和点击

只有答案通过服务端校验、点击流程完成后，才把记录加入会话。这样不会把解析失败或点击失败的半成品误当成已完成题目。

如果后续希望记录失败题，也可以增加：

```ts
status: 'answered' | 'parse-error' | 'click-error'
```

本阶段建议先只保存成功完成的记录。

### 软件退出或重启

内存自动释放，下一次启动得到空会话，符合“重启后不保留”的要求。

## 5. 题目身份、选项变化和重复查询

原题目必须保留原文，但查重不能只使用题干。建议将题目拆成“题干 + 四个选项”，分别规范化。

相同题干下可能出现三种情况：

| 情况 | 判断 | 处理 |
|---|---|---|
| 题干和选项内容、顺序都相同 | 完全相同 | 直接复用之前答案 |
| 题干和选项内容相同，但 A/B/C/D 顺序变化 | 同一题的重排版本 | 根据选项文本把旧答案映射到当前字母 |
| 题干相同，但选项内容发生变化 | 不同题目版本 | 不能复用旧答案，重新让模型判断 |

### 5.1 规范化

`normalizeText()` 建议做以下处理：

1. Unicode 统一；
2. 全角字符转半角；
3. 换行、连续空格合并；
4. 统一大小写；
5. 去除不影响语义的题号和首尾标点；
6. 题目和选项一起参与规范化键计算。

### 5.2 两种题目键

完全匹配键保留选项顺序：

```text
exactQuestionKey = hash(
  normalize(stem) + "\\n" +
  normalize(optionA) + "\\n" +
  normalize(optionB) + "\\n" +
  normalize(optionC) + "\\n" +
  normalize(optionD)
)
```

顺序无关键对选项规范化后排序：

```text
contentQuestionKey = hash(
  normalize(stem) + "\\n" +
  sort([optionA, optionB, optionC, optionD]).join("\\n")
)
```

如果需要固定长度键，可以使用 SHA-256；500 条记录规模下直接使用规范化字符串作为 Map key 也足够。

查询结果：

```ts
const exact = session.byExactQuestionKey.get(exactQuestionKey) ?? []
const reordered = session.byContentQuestionKey.get(contentQuestionKey) ?? []
```

- `exact` 有结果：题干和选项顺序完全一致，可以直接复用答案；
- `exact` 没有结果但 `reordered` 有结果：选项发生重排，需要根据选项文本重新计算字母；
- 两者都没有结果：新题；
- 题干相同但选项内容不同：不能复用旧答案，即使 `stemKey` 相同也必须视为新版本。

### 5.3 选项重排时如何映射

不能只保存 `answers: ['B']`，还要保存答案对应的选项文本：

```ts
selectedOptions: [
  { answer: 'B', text: '喜欢独立完成任务' },
  { answer: 'D', text: '愿意承担团队责任' }
]
```

如果下一次同一题的选项顺序变成：

```text
A: 愿意承担团队责任
B: 其他内容
C: 喜欢独立完成任务
D: 其他内容
```

系统通过选项文本匹配，将旧答案重新映射为 `['C', 'A']`，保留原来的选择顺序。文本匹配必须使用规范化后的选项文本；匹配不到或出现重复文本时，不应自动复用，应交给模型重新判断。

对于 OCR 造成的轻微差异，第一版先使用规范化字符串；不要一开始就引入向量数据库。后续确实出现大量“同题不同 OCR”的情况，再增加编辑距离或向量召回，但向量相似只能作为候选，不能直接覆盖选项内容校验。

## 6. 内存上限和缓存策略

500 条记录的文本数据通常只有几十 KB 到几百 KB，`Map + Array` 不需要 Caffeine 式淘汰。

建议设置一个保护上限，例如 1,000 条：

```text
超过上限时删除最早记录，并从 `byExactQuestionKey` 和 `byContentQuestionKey` 中同步删除。
```

这不是业务需求，而是防止异常循环或模型失控导致内存无限增长。不要设置很短的 TTL，因为一套测评可能持续较长时间，题目历史不能因为等待而消失。

## 7. AI 返回格式建议

下一步让模型在现有答案和坐标格式上增加原题目：

```json
{
  "question": "以下哪项属于……？",
  "answers": ["B", "D"],
  "options": {
    "A": { "left": 300, "top": 480, "right": 400, "bottom": 560 },
    "B": { "left": 300, "top": 560, "right": 400, "bottom": 640 },
    "C": { "left": 300, "top": 640, "right": 400, "bottom": 720 },
    "D": { "left": 300, "top": 720, "right": 400, "bottom": 800 }
  }
}
```

服务端需要校验：

- `question` 是非空字符串；
- `answers` 是合法且有序的答案数组；
- `options` 在非固定坐标模式下必须完整；
- 记录使用坐标转换后的最终点击坐标，而不是模型原始坐标。

## 8. 最终建议

当前阶段采用：

```text
主进程单例 AssessmentSession
    ├── records: AssessmentRecord[]
    ├── byExactQuestionKey: Map<string, AssessmentRecord[]>
    └── byContentQuestionKey: Map<string, AssessmentRecord[]>
```

不引入 Redis，不引入 Caffeine 等价物，不写磁盘。这个方案满足 200～500 道题的规模，查询路径清晰，顺序信息完整，后续增加重复题复用、性格一致性校验和页面记录展示时也不需要更换底层存储。
