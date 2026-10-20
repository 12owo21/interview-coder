"""Windows mouse demo using the same Win32 APIs as the Electron application.

No third-party dependencies. Run from a terminal:
    py tools/mouse-click-demo.py --position
    py tools/mouse-click-demo.py 500 300
    py tools/mouse-click-demo.py 500 300 --smooth --move-only
    py tools/mouse-click-demo.py 500 300 --smooth --delay 5
"""

from __future__ import annotations

import argparse
import ctypes
import math
import sys
import time
from ctypes import wintypes


def linear_path(start: tuple[int, int], target: tuple[int, int]):
    """Match LinearMouseMovement: smoothstep, 180-600 ms, about 16 ms/frame."""
    distance = math.hypot(target[0] - start[0], target[1] - start[1])
    if distance == 0:
        return [(target[0], target[1], 0)]
    duration = math.floor(min(600, max(180, distance * 0.5)) + 0.5)
    steps = math.ceil(duration / 16)
    frames = []
    for index in range(1, steps + 1):
        t = index / steps
        progress = t * t * (3 - 2 * t)
        x = math.floor(start[0] + (target[0] - start[0]) * progress + 0.5)
        y = math.floor(start[1] + (target[1] - start[1]) * progress + 0.5)
        frames.append((x, y, math.floor(t * duration + 0.5)))
    return frames


class WindowsMouse:
    def __init__(self):
        self.api = ctypes.WinDLL("user32", use_last_error=True)
        self.api.SetProcessDPIAware.argtypes = []
        self.api.SetProcessDPIAware.restype = wintypes.BOOL
        self.api.GetCursorPos.argtypes = [ctypes.POINTER(wintypes.POINT)]
        self.api.GetCursorPos.restype = wintypes.BOOL
        self.api.SetCursorPos.argtypes = [ctypes.c_int, ctypes.c_int]
        self.api.SetCursorPos.restype = wintypes.BOOL
        self.api.mouse_event.argtypes = [
            wintypes.DWORD, wintypes.DWORD, wintypes.DWORD,
            wintypes.DWORD, ctypes.c_size_t,
        ]
        self.api.mouse_event.restype = None
        # Same DPI setup as the application's PowerShell helper.
        if not self.api.SetProcessDPIAware():
            raise RuntimeError("无法设置 DPI 感知，请使用终端启动独立 Python 进程")

    def position(self) -> tuple[int, int]:
        point = wintypes.POINT()
        if not self.api.GetCursorPos(ctypes.byref(point)):
            raise ctypes.WinError(ctypes.get_last_error())
        return point.x, point.y

    def move(self, target: tuple[int, int], smooth: bool):
        frames = linear_path(self.position(), target) if smooth else [(*target, 0)]
        started = time.perf_counter()
        for x, y, at_ms in frames:
            remaining = at_ms / 1000 - (time.perf_counter() - started)
            if remaining > 0:
                time.sleep(remaining)
            if not self.api.SetCursorPos(x, y):
                raise ctypes.WinError(ctypes.get_last_error())
        if self.position() != target:
            raise RuntimeError("鼠标未到达目标坐标，可能超出屏幕范围；未执行点击")

    def click(self):
        try:
            self.api.mouse_event(0x0002, 0, 0, 0, 0)  # Left button down.
            time.sleep(0.035)
        finally:
            self.api.mouse_event(0x0004, 0, 0, 0, 0)  # Always release.


def main() -> int:
    parser = argparse.ArgumentParser(description="Windows 鼠标移动与单次左键点击测试")
    parser.add_argument("x", type=int, nargs="?", help="目标屏幕 X 坐标（物理像素）")
    parser.add_argument("y", type=int, nargs="?", help="目标屏幕 Y 坐标（物理像素）")
    parser.add_argument("--position", action="store_true", help="等待后仅读取鼠标坐标")
    parser.add_argument("--smooth", action="store_true", help="使用项目相同的直线缓动算法")
    parser.add_argument("--move-only", action="store_true", help="只移动，不点击")
    parser.add_argument("--delay", type=float, default=3, help="执行前等待秒数，默认 3 秒")
    args = parser.parse_args()

    if sys.platform != "win32":
        parser.error("此脚本仅支持 Windows")
    if not math.isfinite(args.delay) or args.delay < 0:
        parser.error("--delay 必须是有限的非负数")
    if args.position:
        if args.x is not None or args.y is not None or args.smooth or args.move_only:
            parser.error("--position 仅用于读取坐标，不与移动或点击参数同时使用")
    elif args.x is None or args.y is None:
        parser.error("请同时填写 X、Y 坐标，或使用 --position 读取当前坐标")
    elif not all(0 <= value <= 2147483647 for value in (args.x, args.y)):
        parser.error("与项目保持一致，目标坐标必须是非负的 32 位整数")

    try:
        mouse = WindowsMouse()
        if args.position:
            print(f"{args.delay:g} 秒后读取坐标，请把鼠标放到目标位置。", flush=True)
        else:
            action = "只移动" if args.move_only else "移动并单击左键一次"
            print(f"{args.delay:g} 秒后{action}：({args.x}, {args.y})。", flush=True)
        print("可在此终端按 Ctrl+C 取消。", flush=True)
        time.sleep(args.delay)
        if args.position:
            x, y = mouse.position()
            print(f"当前鼠标坐标：X={x}, Y={y}")
        else:
            mouse.move((args.x, args.y), args.smooth)
            if not args.move_only:
                mouse.click()
            print("已完成鼠标操作。" if args.move_only else "已发送单次左键点击。")
        return 0
    except KeyboardInterrupt:
        print("\n已取消。")
        return 130
    except (OSError, RuntimeError) as error:
        print(f"操作失败：{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
