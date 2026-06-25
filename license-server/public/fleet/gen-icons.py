#!/usr/bin/env python3
from PIL import Image, ImageDraw

def draw_icon(size):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = size / 512.0

    pad = int(24 * s)
    bg = (11, 18, 32, 255)
    d.rounded_rectangle([pad, pad, size - pad, size - pad], radius=int(96 * s), fill=bg)

    fb = (24, 119, 242, 255)
    cx, cy = int(360 * s), int(148 * s)
    r = int(58 * s)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fb)
    d.rounded_rectangle([int(334 * s), int(112 * s), int(346 * s), int(184 * s)], radius=int(4 * s), fill=(255, 255, 255, 255))
    d.rounded_rectangle([int(334 * s), int(112 * s), int(372 * s), int(124 * s)], radius=int(4 * s), fill=(255, 255, 255, 255))
    d.rounded_rectangle([int(334 * s), int(142 * s), int(362 * s), int(154 * s)], radius=int(4 * s), fill=(255, 255, 255, 255))

    accent = (94, 194, 140, 255)
    horn = [
        (int(118 * s), int(268 * s)),
        (int(198 * s), int(220 * s)),
        (int(318 * s), int(198 * s)),
        (int(338 * s), int(248 * s)),
        (int(318 * s), int(298 * s)),
        (int(198 * s), int(320 * s)),
        (int(138 * s), int(300 * s)),
    ]
    d.polygon(horn, fill=accent)
    d.ellipse([int(96 * s), int(248 * s), int(152 * s), int(304 * s)], fill=(52, 211, 153, 255))
    d.rectangle([int(318 * s), int(236 * s), int(372 * s), int(260 * s)], fill=(251, 191, 36, 255))

    wave = (96, 165, 250, 180)
    for rx, ry, rw, rh in [(88, 168, 72, 72), (56, 136, 136, 136), (24, 104, 200, 200)]:
        d.arc(
            [int(rx * s), int(ry * s), int((rx + rw) * s), int((ry + rh) * s)],
            start=300,
            end=60,
            fill=wave,
            width=max(2, int(8 * s)),
        )

    nodes = [(392, 300), (420, 360), (352, 380), (300, 340)]
    for nx, ny in nodes:
        nr = int(14 * s)
        d.ellipse(
            [int((nx - nr) * s), int((ny - nr) * s), int((nx + nr) * s), int((ny + nr) * s)],
            fill=(30, 58, 95, 255),
            outline=accent,
            width=max(2, int(3 * s)),
        )

    return img


if __name__ == '__main__':
    import os
    base = os.path.dirname(os.path.abspath(__file__))
    for sz, name in [(192, 'icon-192.png'), (512, 'icon-512.png')]:
        path = os.path.join(base, name)
        draw_icon(sz).save(path, 'PNG')
        print('wrote', path)
