# -*- coding: utf-8 -*-
"""生成截止线应用图标 PNG（复现 main.js 中 iconDataUrl 的 SVG 设计）。"""
import os
from PIL import Image, ImageDraw

OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'assets')


def bezier(p0, p1, p2, p3, n=48):
    pts = []
    for i in range(n + 1):
        t = i / n
        x = (1 - t) ** 3 * p0[0] + 3 * (1 - t) ** 2 * t * p1[0] + 3 * (1 - t) * t ** 2 * p2[0] + t ** 3 * p3[0]
        y = (1 - t) ** 3 * p0[1] + 3 * (1 - t) ** 2 * t * p1[1] + 3 * (1 - t) * t ** 2 * p2[1] + t ** 3 * p3[1]
        pts.append((x, y))
    return pts


def hex_to_rgba(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (255,)


def make_icon(size, color_hex):
    s = size / 64.0
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # 圆角矩形背景
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=max(1, int(12 * s)), fill=hex_to_rgba(color_hex))
    # 组装路径点（对应 SVG path: M19 51V14 m0 2 c13-10 21 10 34 0 v23 c-13 10 -21 -10 -34 0）
    pts = [(19 * s, 51 * s), (19 * s, 14 * s)]
    pts += bezier((19 * s, 16 * s), (32 * s, 6 * s), (40 * s, 26 * s), (53 * s, 16 * s))
    pts += [(53 * s, 16 * s), (53 * s, 39 * s)]
    pts += bezier((53 * s, 39 * s), (40 * s, 49 * s), (32 * s, 29 * s), (19 * s, 39 * s))
    width = max(2, int(round(5 * s)))
    d.line(pts, fill=(255, 255, 255, 255), width=width, joint='curve')
    return img


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    # 主图标 256（窗口 + 安装包），托盘用深一档的色
    make_icon(256, '#147d70').save(os.path.join(OUT_DIR, 'icon.png'))
    # 托盘图标 32（Windows 托盘标准尺寸），并额外存一份 64 用于高 DPI
    make_icon(64, '#1f776c').save(os.path.join(OUT_DIR, 'tray.png'))
    make_icon(256, '#1f776c').resize((32, 32), Image.LANCZOS).save(os.path.join(OUT_DIR, 'tray-32.png'))
    print('icons generated in', OUT_DIR)
    for f in os.listdir(OUT_DIR):
        print(' -', f)


if __name__ == '__main__':
    main()
