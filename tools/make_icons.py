"""Draws the app icons: the glass status ring on a dark violet field.

Run:  python tools/make_icons.py   (needs pillow)
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "www" / "dash"
SCALE = 4


def draw(size, ring_share, rounded):
    s = size * SCALE
    icon = Image.new("RGBA", (s, s), (0, 0, 0, 0))

    field = Image.new("RGBA", (s, s), (7, 6, 12, 255))
    glow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((-s * 0.2, -s * 0.2, s * 0.75, s * 0.75), fill=(120, 60, 230, 170))
    field.alpha_composite(glow.filter(ImageFilter.GaussianBlur(s * 0.14)))

    r = s * ring_share / 2
    c = s / 2
    halo = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(halo).ellipse((c - r, c - r, c + r, c + r), outline=(52, 211, 153, 200), width=int(s * 0.07))
    field.alpha_composite(halo.filter(ImageFilter.GaussianBlur(s * 0.03)))

    d = ImageDraw.Draw(field)
    d.ellipse((c - r, c - r, c + r, c + r), outline=(52, 211, 153, 255), width=int(s * 0.035))
    inner = r * 0.62
    d.ellipse((c - inner, c - inner, c + inner, c + inner), fill=(255, 255, 255, 34), outline=(255, 255, 255, 120), width=int(s * 0.008))

    # Power glyph.
    g = inner * 0.5
    w = int(s * 0.03)
    d.arc((c - g, c - g, c + g, c + g), start=-55, end=235, fill=(52, 211, 153, 255), width=w)
    d.line((c, c - g * 1.25, c, c - g * 0.1), fill=(52, 211, 153, 255), width=w)

    if rounded:
        mask = Image.new("L", (s, s), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, s - 1, s - 1), radius=int(s * 0.22), fill=255)
        icon.paste(field, (0, 0), mask)
    else:
        icon = field
    return icon.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    draw(192, 0.72, True).save(OUT / "icon-192.png", optimize=True)
    draw(512, 0.72, True).save(OUT / "icon-512.png", optimize=True)
    # Android crops maskable icons to a circle, so the ring keeps to the safe zone.
    draw(512, 0.52, False).save(OUT / "icon-maskable.png", optimize=True)
    print("icons written")
