"""Generate legible extension icons — bold shapes, readable at 16px."""

from PIL import Image, ImageDraw
import math
import os

SIZES = [16, 32, 48, 128]
OUT_DIR = os.path.dirname(os.path.abspath(__file__))

BG_TOP = (10, 16, 28)
BG_BOT = (18, 28, 48)
BORDER = (34, 197, 94)
CARD_TOP = (36, 72, 120)
CARD_BOT = (18, 32, 58)
FILL_GREEN = (34, 197, 94)
FILL_GREEN_DARK = (22, 163, 74)
CHIP = (251, 191, 36)
WHITE = (255, 255, 255)


def lerp(c1, c2, t):
    return tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))


def rounded_rect_fill(img, xy, radius, color):
    x0, y0, x1, y1 = xy
    w, h = x1 - x0, y1 - y0
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle((0, 0, w - 1, h - 1), radius=max(1, int(radius)), fill=color)
    img.paste(layer, (x0, y0), layer)


def rounded_gradient(img, xy, radius, c_top, c_bot):
    x0, y0, x1, y1 = xy
    w, h = x1 - x0, y1 - y0
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for y in range(h):
        t = y / max(h - 1, 1)
        d.line([(0, y), (w, y)], fill=lerp(c_top, c_bot, t) + (255,))
    mask = Image.new("L", (w, h), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle((0, 0, w - 1, h - 1), radius=max(1, int(radius)), fill=255)
    img.paste(layer, (x0, y0), mask)


def draw_check(draw, cx, cy, size, color, width):
    """Bold checkmark."""
    s = size
    pts = [
        (cx - s * 0.42, cy + s * 0.02),
        (cx - s * 0.08, cy + s * 0.38),
        (cx + s * 0.48, cy - s * 0.32),
    ]
    draw.line([pts[0], pts[1]], fill=color, width=width, joint="curve")
    draw.line([pts[1], pts[2]], fill=color, width=width, joint="curve")


def create_icon(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    s = size / 128.0

    pad = max(1, int(4 * s))
    outer_r = int(26 * s)

    # Background
    rounded_gradient(img, (0, 0, size, size), outer_r, BG_TOP, BG_BOT)

    # Thick green border — visible even at 16px
    border_w = 3 if size == 16 else max(2, int(5 * s)) if size <= 32 else max(2, int(4 * s))
    draw.rounded_rectangle(
        (pad, pad, size - pad - 1, size - pad - 1),
        radius=int(22 * s),
        outline=BORDER + (255,),
        width=border_w,
    )

    # Card — takes most of canvas
    card_pad = int(18 * s) if size >= 48 else int(12 * s) if size >= 32 else int(5 * s)
    card_top = int(28 * s) if size >= 32 else int(14 * s)
    card_bot = size - card_pad
    card_left = card_pad
    card_right = size - card_pad
    card_r = max(2, int(12 * s)) if size >= 48 else max(2, int(6 * s))

    rounded_gradient(
        img, (card_left, card_top, card_right, card_bot),
        card_r, CARD_TOP, CARD_BOT,
    )
    draw.rounded_rectangle(
        (card_left, card_top, card_right, card_bot),
        radius=card_r,
        outline=(120, 160, 200, 180),
        width=max(1, int(2 * s)),
    )

    card_w = card_right - card_left
    card_h = card_bot - card_top
    inner_l = card_left + int(card_w * 0.12)
    inner_r = card_right - int(card_w * 0.12)

    if size >= 48:
        # Chip — only on larger sizes
        chip_w = int(card_w * 0.22)
        chip_h = int(card_h * 0.22)
        chip_y = card_top + int(card_h * 0.14)
        rounded_rect_fill(
            img,
            (inner_l, chip_y, inner_l + chip_w, chip_y + chip_h),
            max(2, int(4 * s)),
            CHIP + (255,),
        )

    if size == 16:
        # 16px: только карта + жирная полоса по центру + зелёный уголок
        bar_h = 5
        bar_y = card_top + (card_h - bar_h) // 2
        draw.rounded_rectangle(
            (card_left + 2, bar_y, card_right - 2, bar_y + bar_h),
            radius=2,
            fill=FILL_GREEN + (255,),
        )
        draw.rectangle(
            (card_right - 5, card_top + 2, card_right - 2, card_top + 5),
            fill=FILL_GREEN + (255,),
        )
    else:
        # Bold green fill bar
        bar_h = max(3, int(14 * s)) if size >= 32 else max(3, int(8 * s))
        bar_y = card_top + int(card_h * 0.52)
        bar_x1 = inner_l
        bar_x2 = inner_l + int(card_w * 0.72)
        rounded_gradient(
            img,
            (bar_x1, bar_y, bar_x2, bar_y + bar_h),
            max(2, int(bar_h / 2)),
            FILL_GREEN, FILL_GREEN_DARK,
        )

        if size >= 32:
            line_h = max(2, int(6 * s))
            line_y = bar_y + bar_h + int(4 * s)
            line_x2 = inner_l + int(card_w * 0.45)
            draw.rounded_rectangle(
                (inner_l, line_y, line_x2, line_y + line_h),
                radius=max(1, int(line_h / 2)),
                fill=(255, 255, 255, 70),
            )

        # Checkmark badge
        badge_r = int(16 * s) if size >= 48 else int(12 * s) if size >= 32 else int(8 * s)
        bx = card_right - int(badge_r * 0.6)
        by = card_top + int(badge_r * 0.5)
        draw.ellipse(
            (bx - badge_r, by - badge_r, bx + badge_r, by + badge_r),
            fill=FILL_GREEN + (255,),
        )
        check_size = badge_r * 1.3
        check_w = max(2, int(4 * s)) if size >= 32 else max(2, int(3 * s))
        draw_check(draw, bx, by, check_size, WHITE + (255,), check_w)

    return img


def main():
    for size in SIZES:
        path = os.path.join(OUT_DIR, f"icon{size}.png")
        create_icon(size).save(path, "PNG", optimize=True)
        print(f"Saved {path} ({size}x{size})")


if __name__ == "__main__":
    main()