# 做题模式鼠标控制

在「设置 → 做题模式」框选答题屏幕上的空白区域，再开启「答题后随机停放鼠标」。本轮选项及下一步的点击全部完成后，鼠标移入区域内随机位置，不执行点击。停放区域单独保存，不修改截图区域。

「鼠标直线移动」默认关闭。关闭时点击和停放直接定位；开启后，每次点击和停放都从当前鼠标位置沿直线缓入缓出移动，移动本身约 180～600ms，另有 Windows 辅助进程启动开销。「测试停放（不点击）」可独立验证区域和移动效果，不必开启自动答题或停放开关。

## 扩展移动算法

- `src/main/mouse/movement.ts`：`MouseMovementAlgorithm.createPath(start, target)` 接口，返回物理屏幕坐标及相对时间 `atMs`。
- `src/main/mouse/linear-movement.ts`：`LinearMouseMovement`，纯路径规划类，不访问系统鼠标。
- `src/main/mouse/windows-input.ts`：注入算法的 Windows 执行类。辅助进程启动后读取实际鼠标位置，Node 规划路径，通过 stdin JSON 一次传入全部帧；到达终点后按需点击。
- `src/main/click.ts`：`moveScreenPoint`（只移动）和 `clickScreenPoint`（移动后点击）。未来替换算法只需更换 `WindowsMouseInput` 的算法实例。
- `src/main/assessment/mouse-parking.ts`：使用本轮截图对应的完整屏幕尺寸及原点，将比例区域转换为随机物理坐标，内缩少量边距。

## 执行边界

- 两个开关独立，均默认关闭；区域未设置时不能开启停放。
- 同一轮的所有点击完成后才停放一次。OCR 预览、失败、取消以及没有点击步骤的轮次不执行停放。
- 点击前验证停放区域。区域无效或与截图屏幕不一致时停止，不点击。该限制避免鼠标跨屏改变下一轮「跟随鼠标」截图的目标。
- 取消会终止并等待鼠标辅助进程退出；点击异常保留鼠标释放兜底。停放失败保留已完成的点击及记忆，并停止任务，不重新执行答案。
- 沿用当前点击功能的 Windows、非负屏幕坐标限制。尚未扩展主屏左侧或上方显示器的负坐标支持。
- 现有页面检查仍在每个点击操作之前执行。运动途中页面变化及多屏混合缩放需要实际页面回归；不能把完成鼠标点击等同于网页接受答案。

## 自动验证

`node --test tests/assessment-ocr.test.mjs tests/assessment-scoring.test.mjs tests/assessment-options.test.cjs tests/mouse-movement.test.mjs`

覆盖路径终点和边界、停放坐标转换、执行顺序、默认关闭、预览、取消和停放失败。Windows 测试运行真实 PowerShell 协议，但以模拟 C# 鼠标替换 user32，不操作桌面。
