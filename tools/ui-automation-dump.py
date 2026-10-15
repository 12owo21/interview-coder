"""Print visible Windows UI Automation elements and their screen rectangles.

Install:
    py -m pip install uiautomation pywin32

Run:
    py tools/ui-automation-dump.py

The script only reads the foreground window. It never clicks or sends input.
"""

from __future__ import annotations

import ctypes
import re
import sys
import time
from ctypes import wintypes


def enable_dpi_awareness() -> None:
    """Make UIA rectangles and screen coordinates use the same physical space."""

    user32 = ctypes.windll.user32
    # Windows 10 1703+: per-monitor-v2 awareness.
    try:
        user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
        return
    except (AttributeError, OSError):
        pass

    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
        return
    except (AttributeError, OSError):
        pass

    try:
        user32.SetProcessDPIAware()
    except (AttributeError, OSError):
        pass


def foreground_window() -> int:
    hwnd = ctypes.windll.user32.GetForegroundWindow()
    if not hwnd:
        raise RuntimeError("没有获取到前台窗口")
    return int(hwnd)


def clean(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def rect_values(rect: object) -> tuple[int, int, int, int] | None:
    try:
        left = int(round(float(rect.left)))
        top = int(round(float(rect.top)))
        right = int(round(float(rect.right)))
        bottom = int(round(float(rect.bottom)))
    except (AttributeError, TypeError, ValueError):
        return None
    if right <= left or bottom <= top:
        return None
    return left, top, right, bottom


def dump_control(control: object, depth: int, max_depth: int, rows: list[dict]) -> None:
    if depth > max_depth:
        return

    try:
        name = clean(getattr(control, "Name", ""))
        control_type = clean(getattr(control, "ControlTypeName", ""))
        rect = rect_values(getattr(control, "BoundingRectangle", None))
        if name and rect:
            left, top, right, bottom = rect
            rows.append(
                {
                    "depth": depth,
                    "type": control_type,
                    "name": name,
                    "x": round((left + right) / 2),
                    "y": round((top + bottom) / 2),
                    "width": right - left,
                    "height": bottom - top,
                }
            )

        if depth == max_depth:
            return
        for child in control.GetChildren():
            dump_control(child, depth + 1, max_depth, rows)
    except Exception:
        # Pages can change while UIA is walking the tree. Ignore that element.
        return


def main() -> int:
    if sys.platform != "win32":
        print("此脚本只支持 Windows")
        return 1

    try:
        import uiautomation as auto
    except ImportError:
        print("缺少依赖，请先执行：py -m pip install uiautomation pywin32")
        return 1

    enable_dpi_awareness()
    print("请在 5 秒内切换到目标浏览器窗口……")
    time.sleep(5)
    hwnd = foreground_window()

    try:
        root = auto.ControlFromHandle(hwnd)
    except Exception as exc:
        print(f"无法创建 UI Automation 根控件：{exc}")
        return 1

    window_name = clean(getattr(root, "Name", ""))
    print(f"目标窗口：{window_name or hwnd}")
    print("正在读取控件，请稍候……")

    rows: list[dict] = []
    dump_control(root, depth=0, max_depth=30, rows=rows)
    print(f"读取到 {len(rows)} 个带名称和有效位置的控件")
    print("坐标是屏幕物理坐标；x/y 是控件矩形中心。\n")

    for row in rows:
        indent = "  " * min(row["depth"], 8)
        print(
            f'{indent}{row["type"]:<24} '
            f'({row["x"]:>5}, {row["y"]:>5}) '
            f'{row["width"]:>4}x{row["height"]:<4} {row["name"]}'
        )

    keywords = ("下一步", "下一题", "继续", "符合", "选项", "提交", "交卷")
    matches = [row for row in rows if any(word in row["name"] for word in keywords)]
    if matches:
        print("\n可能相关的题目控件：")
        for row in matches:
            print(
                f'{row["type"]:<24} ({row["x"]}, {row["y"]}) '
                f'{row["width"]}x{row["height"]} {row["name"]}'
            )
    else:
        print("\n没有匹配到预设关键词；可以在完整输出中查找题目文字。")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
