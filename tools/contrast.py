"""Measures real text contrast on glass, in every theme and language, against the mock.

Run the mock first, then:  python tools/contrast.py
Needs playwright and pillow.

Glass makes the colour behind text vary across a panel, so token values prove nothing.
This hides the text, screenshots what is really behind it, and scores each text element
against the darkest-case 5% of the pixels behind it, so one thin backdrop line does not count
as the background. Limits are WCAG AA: 4.5, or 3 for large text.
"""
import io
import sys

from PIL import Image
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8099"
VIEWS = ("home", "servers", "sources", "devices", "adguard", "settings")

COLLECT = """() => {
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.textContent.trim()) continue;
    const parent = node.parentElement;
    const style = getComputedStyle(parent);
    if (style.visibility === 'hidden' || style.display === 'none' || parent.closest('option,script,style,[hidden]')) continue;
    const fold = parent.closest('details:not([open])');
    if (fold && !parent.closest('summary')) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.top > innerHeight || r.bottom < 0) continue;
    // Text scrolled under the fixed tab bar is not visible, so it has no contrast to measure.
    const visible = (x, y) => {
      const hit = document.elementFromPoint(x, y);
      return hit && (parent.contains(hit) || hit.contains(parent));
    };
    const mid = r.left + r.width / 2;
    if (!visible(mid, r.top + 1) || !visible(mid, r.bottom - 1)) continue;
    out.push({text: node.textContent.trim().slice(0, 28), color: style.color, size: parseFloat(style.fontSize),
              weight: parseInt(style.fontWeight), x: r.left, y: r.top, w: r.width, h: r.height});
  }
  return out;
}"""


def luminance(rgb):
    channels = []
    for value in rgb[:3]:
        c = value / 255
        channels.append(c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]


def ratio(a, b):
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)


def parse_colour(text):
    parts = text[text.index("(") + 1:text.index(")")].replace(",", " ").replace("/", " ").split()
    return tuple(float(p) for p in parts[:3])


def score(image, item):
    text_lum = luminance(parse_colour(item["color"]))
    left, top = max(int(item["x"]), 0), max(int(item["y"]), 0)
    right = min(int(item["x"] + item["w"]), image.width - 1)
    bottom = min(int(item["y"] + item["h"]), image.height - 1)
    values = sorted(ratio(text_lum, luminance(image.getpixel((x, y))))
                    for x in range(left, right + 1, 2) for y in range(top, bottom + 1, 2))
    return values[len(values) // 20] if values else 99.0


def main():
    sys.stdout.reconfigure(encoding="utf8", errors="replace")
    failures = 0
    checked = 0
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome", headless=True, args=["--no-proxy-server"])
        for theme in ("dark", "light"):
            for lang in ("fa", "en"):
                for width, height in ((1280, 900), (390, 844)):
                    context = browser.new_context(viewport={"width": width, "height": height}, color_scheme=theme)
                    page = context.new_page()
                    for view in VIEWS:
                        page.goto("about:blank")
                        page.goto(f"{BASE}/?{lang}#{view}")
                        page.wait_for_timeout(1800)
                        items = page.evaluate(COLLECT)
                        tag = page.add_style_tag(content="*{color:transparent!important;-webkit-text-fill-color:transparent!important;caret-color:transparent!important}"
                                                         "*{animation:none!important;transition:none!important}")
                        page.wait_for_timeout(120)
                        image = Image.open(io.BytesIO(page.screenshot())).convert("RGB")
                        tag.evaluate("t => t.remove()")
                        for item in items:
                            checked += 1
                            large = item["size"] >= 24 or (item["size"] >= 18.66 and item["weight"] >= 700)
                            needed = 3.0 if large else 4.5
                            value = score(image, item)
                            if value < needed:
                                failures += 1
                                print(f"{value:4.1f} < {needed}  {theme}/{lang}/{view}/{width}  {item['size']:.0f}px  {item['text']}")
                    context.close()
        browser.close()
    print(f"\n{checked - failures} of {checked} text elements pass")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
