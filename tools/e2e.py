"""Click tests for the dashboard, run in real Chrome against tools/mock_server.py.

Run the mock first, then:  python tools/e2e.py [screenshot-dir]
Needs the playwright package; it drives the installed Chrome, so no browser download.

Every check reports PASS or FAIL and the script exits non-zero on any failure. Assertions
are on what the app really sends to the API, so a restyle cannot silently break a feature.
"""
import json
import sys
import urllib.request
from pathlib import Path

from playwright.sync_api import TimeoutError as PlaywrightTimeout
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8099"
SHOTS = Path(sys.argv[1]) if len(sys.argv) > 1 else None
PASSWORD = "mock-password"
results = []
page_errors = []


def check(name, condition, detail=""):
    results.append((name, bool(condition)))
    print(("PASS " if condition else "FAIL ") + name + (f"  [{detail}]" if detail and not condition else ""))


def mock(path):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    return json.loads(opener.open(BASE + path, timeout=5).read())


def posts(api=None):
    items = mock("/__posts")
    return [p for p in items if api is None or p["api"] == api]


def tid(page, name):
    return page.get_by_test_id(name)


def open_view(page, view, lang="en"):
    mock("/__reset")
    # A hash change alone would not reload, and the auto-login only runs on a real load.
    page.goto("about:blank")
    page.goto(f"{BASE}/?{lang}#{view}")
    page.wait_for_load_state("networkidle")


def attempt(name, action):
    """A missing element is a failed check, not a crash that hides the remaining checks."""
    try:
        action()
    except (PlaywrightTimeout, AssertionError, IndexError, KeyError) as error:
        check(name, False, str(error).split("\n")[0][:110])


def test_login(page):
    mock("/__reset")
    page.goto(f"{BASE}/?login#home")
    tid(page, "login-password").fill("wrong")
    tid(page, "login-submit").click()
    page.wait_for_timeout(500)
    check("login: wrong password stays on login", tid(page, "login-password").is_visible())
    tid(page, "login-password").fill(PASSWORD)
    tid(page, "login-submit").click()
    tid(page, "ring").wait_for(timeout=4000)
    check("login: right password opens Home", True)


def test_theme_and_language(page):
    open_view(page, "settings")
    html = page.locator("html")
    tid(page, "theme-dark").click()
    check("theme: dark applies", html.get_attribute("data-theme") == "dark")
    tid(page, "theme-light").click()
    check("theme: light applies", html.get_attribute("data-theme") == "light")
    page.reload()
    page.wait_for_load_state("networkidle")
    check("theme: survives reload", html.get_attribute("data-theme") == "light")
    tid(page, "theme-system").click()
    check("theme: system follows the OS", html.get_attribute("data-theme") in ("dark", "light"))
    check("language: English is LTR", html.get_attribute("dir") == "ltr")
    tid(page, "lang-toggle").click()
    page.wait_for_timeout(300)
    check("language: Persian is RTL", html.get_attribute("dir") == "rtl")
    tid(page, "lang-toggle").click()
    page.wait_for_timeout(300)
    check("language: back to LTR", html.get_attribute("dir") == "ltr")


def test_home(page):
    open_view(page, "home")
    page.get_by_text("203.0.113.20").first.wait_for(timeout=4000)
    check("home: shows the exit IP", True)
    page.wait_for_timeout(7000)
    d = page.locator(".chart path, .chart-svg path, svg path[class*=dl], svg path[class*=down]").first.get_attribute("d") or ""
    check("home: speed chart draws", len(d) > 10, d[:40])
    tid(page, "ring").click()
    tid(page, "confirm-cancel").click()
    page.wait_for_timeout(300)
    check("home: cancel sends nothing", not posts("api-toggle"))
    tid(page, "ring").click()
    tid(page, "confirm-ok").click()
    page.wait_for_timeout(2500)
    sent = posts("api-toggle")
    check("home: turning off sends off", sent and sent[0]["body"] == {"action": "off"}, str(sent))
    tid(page, "ring").click()
    page.wait_for_timeout(2500)
    sent = posts("api-toggle")
    check("home: turning on needs no confirm", len(sent) == 2 and sent[1]["body"] == {"action": "on"}, str(sent))


def test_adblock(page):
    open_view(page, "home")
    pill = tid(page, "adblock-toggle")
    pill.wait_for(timeout=4000)
    page.wait_for_timeout(600)
    check("adblock: Home pill shows On as a word", "On" in pill.inner_text(), pill.inner_text())
    check("adblock: Home switch is on", pill.get_attribute("aria-checked") == "true")
    check("adblock: Home pill is at least 44px tall", pill.bounding_box()["height"] >= 44)
    pill.click()
    page.wait_for_timeout(700)
    sent = posts("api-adblock")
    check("adblock: Home pill sends off", sent and sent[0]["body"] == {"enabled": False}, str(sent))
    check("adblock: Home pill shows Off", "Off" in pill.inner_text() and pill.get_attribute("aria-checked") == "false",
          pill.inner_text())
    pill.click()
    page.wait_for_timeout(700)
    sent = posts("api-adblock")
    check("adblock: Home pill sends on", len(sent) == 2 and sent[1]["body"] == {"enabled": True}, str(sent))
    open_view(page, "settings")
    check("adblock: Settings has no switch, only a link", tid(page, "adblock-toggle").count() == 0)
    tid(page, "settings-adguard").click()
    page.wait_for_timeout(300)
    check("adblock: Settings link opens the AdGuard tab", page.url.endswith("#adguard"), page.url)


def test_adguard(page):
    open_view(page, "adguard")
    tid(page, "adguard-toggle").wait_for(timeout=4000)
    check("adguard: nav item exists", tid(page, "nav-adguard").count() == 1)
    check("adguard: charts draw when on", len(page.locator(".ag-line").get_attribute("d") or "") > 20)
    check("adguard: 24 hour bars", page.locator("rect.ag-bar").count() == 24)
    check("adguard: donut is there", page.locator(".donut-c").inner_text().strip() != "")
    check("adguard: recent list is capped at 30", 0 < page.locator("[data-testid=adguard-recent] > li").count() <= 30,
          str(page.locator("[data-testid=adguard-recent] > li").count()))
    check("adguard: hostile domain stays text", page.locator("main img").count() == 0
          and "<img src=x onerror=alert(1)>.example" in page.locator("main").inner_text())
    check("adguard: off screen is not shown while on", tid(page, "adguard-off").count() == 0)
    tid(page, "adguard-toggle").click()
    tid(page, "confirm-cancel").click()
    page.wait_for_timeout(300)
    check("adguard: cancel sends nothing", not posts("api-adblock"))
    tid(page, "adguard-toggle").click()
    tid(page, "confirm-ok").click()
    tid(page, "adguard-off").wait_for(timeout=4000)
    sent = posts("api-adblock")
    check("adguard: turning off sends off", sent and sent[0]["body"] == {"enabled": False}, str(sent))
    check("adguard: off shows exactly the fixed text", page.locator("[data-testid=adguard-off] h1").inner_text() == "AdGuard Is OFF")
    check("adguard: no charts while off", page.locator(".ag-line").count() == 0 and page.locator(".donut").count() == 0)
    tid(page, "adguard-on-button").click()
    tid(page, "adguard-toggle").wait_for(timeout=4000)
    sent = posts("api-adblock")
    check("adguard: on button sends on", len(sent) == 2 and sent[1]["body"] == {"enabled": True}, str(sent))
    check("adguard: charts return", page.locator(".ag-line").count() == 1)
    open_view(page, "adguard", "fa")
    tid(page, "adguard-toggle").wait_for(timeout=4000)
    tid(page, "adguard-toggle").click()
    tid(page, "confirm-ok").click()
    tid(page, "adguard-off").wait_for(timeout=4000)
    check("adguard: off text is English in Persian too", page.locator("[data-testid=adguard-off] h1").inner_text() == "AdGuard Is OFF")


def test_webrtc_and_install(page):
    open_view(page, "home")
    pill = tid(page, "webrtc-toggle")
    pill.wait_for(timeout=4000)
    page.wait_for_timeout(600)
    check("webrtc: Home shows it off", pill.get_attribute("aria-checked") == "false")
    pill.click()
    page.wait_for_timeout(700)
    sent = posts("api-webrtc")
    check("webrtc: button sends on", sent and sent[0]["body"] == {"enabled": True}, str(sent))
    check("webrtc: button shows on", pill.get_attribute("aria-checked") == "true")
    ring, sw, tiles = tid(page, "ring").bounding_box(), pill.bounding_box(), page.locator(".facts").bounding_box()
    other = tid(page, "adblock-toggle").bounding_box()
    check("home: switches sit between the ring and the tiles", ring["y"] + ring["height"] <= sw["y"] and sw["y"] + sw["height"] <= tiles["y"], str(sw))
    check("home: switches sit side by side", abs(sw["y"] - other["y"]) < 2 and abs(sw["x"] - other["x"]) >= other["width"])
    page.wait_for_timeout(3500)
    tid(page, "ring").click()
    tid(page, "confirm-ok").wait_for(timeout=3000)
    check("webrtc: turning the proxy off warns that foreign sites stay closed", "WebRTC" in page.locator("dialog[open]").inner_text())
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)
    page.wait_for_timeout(1500)
    registered = page.evaluate("navigator.serviceWorker.getRegistrations().then(r => r.length)")
    check("app: service worker registers", registered >= 1, str(registered))
    session = page.context.new_cdp_session(page)
    # Test browsers run incognito, where Chrome never offers an install. That says nothing of the app.
    errors = [e for e in session.send("Page.getInstallabilityErrors")["installabilityErrors"] if e["errorId"] != "in-incognito"]
    check("app: Chrome sees it as installable", not errors, str(errors))
    manifest = session.send("Page.getAppManifest")
    check("app: manifest has no errors", not manifest.get("errors"), str(manifest.get("errors")))
    api_cached = page.evaluate("caches.keys().then(k => Promise.all(k.map(n => caches.open(n).then(c => c.keys())))).then(l => l.flat().filter(r => r.url.includes('cgi-bin')).length)")
    check("app: router data is never cached", api_cached == 0, str(api_cached))
    open_view(page, "settings")
    check("app: Settings has the install row", tid(page, "install-row").is_visible())
    link = tid(page, "install-apk")
    size = len(page.request.get(BASE + "/" + link.get_attribute("href")).body())
    check("app: the Android app downloads", size > 10000, str(size))


def test_servers(page):
    open_view(page, "servers")
    rows = page.locator("[data-testid=server-row]")
    check("servers: all listed", rows.count() >= 4, str(rows.count()))
    tid(page, "server-search").fill("france")
    page.wait_for_timeout(300)
    check("servers: search filters", rows.count() == 1, str(rows.count()))
    tid(page, "server-search").fill("")
    page.wait_for_timeout(300)
    page.locator("[data-testid=server-row][data-id=n2]").click()
    page.wait_for_timeout(1000)
    sent = posts("api-switch")
    check("servers: tap sends the node id", sent and sent[0]["body"] == {"id": "n2"}, str(sent))
    tid(page, "server-auto").click()
    page.wait_for_timeout(1000)
    sent = posts("api-switch")
    check("servers: auto sends the balancer", sent and sent[-1]["body"] == {"id": "bal1"}, str(sent))
    tid(page, "test-all").click()
    page.wait_for_timeout(2500)
    text = page.locator("main").inner_text()
    check("servers: test shows a latency", "720" in text, text[:80])
    check("servers: test shows a failure", "Failed" in text)


def test_sources(page):
    open_view(page, "sources")
    tid(page, "sources-add").click()
    box = tid(page, "add-textarea")
    save = tid(page, "add-save")
    box.fill("not a link")
    page.wait_for_timeout(200)
    check("sources: junk cannot be saved", save.is_disabled())
    box.fill("https://panel.example.net/sub/abc")
    page.wait_for_timeout(200)
    check("sources: https asks for a name", tid(page, "add-name").is_visible())
    tid(page, "add-name").fill("Test sub")
    save.click()
    page.wait_for_timeout(4500)
    sent = posts("api-sub")
    check("sources: subscription is sent", sent and sent[0]["body"].get("action") == "add"
          and sent[0]["body"].get("remark") == "Test sub", str(sent))
    tid(page, "sources-add").click()
    tid(page, "add-textarea").fill("vless://a@b:1#one\nvless://c@d:2#two")
    page.wait_for_timeout(200)
    check("sources: links ask for a group", tid(page, "add-group").is_visible())
    tid(page, "add-group").fill("Mine")
    tid(page, "add-save").click()
    page.wait_for_timeout(1000)
    sent = posts("api-add-config")
    check("sources: configs are sent", sent and sent[0]["body"].get("group") == "Mine"
          and "vless://c@d:2#two" in sent[0]["body"].get("links", ""), str(sent))


def test_settings(page):
    open_view(page, "settings")
    tid(page, "killswitch-toggle").click()
    page.wait_for_timeout(500)
    sent = posts("api-killswitch")
    check("settings: kill switch sends off", sent and sent[0]["body"].get("enabled") is False, str(sent))
    tid(page, "killswitch-toggle").click()
    page.wait_for_timeout(500)
    tid(page, "killswitch-mode").select_option("strict")
    page.wait_for_timeout(500)
    sent = posts("api-killswitch")
    check("settings: mode sends strict", sent and sent[-1]["body"].get("mode") == "strict", str(sent))

    page.locator("[data-testid=wifi-row]").first.click()
    tid(page, "wifi-key").fill("short")
    tid(page, "wifi-save").click()
    page.wait_for_timeout(400)
    if tid(page, "confirm-cancel").count() and tid(page, "confirm-cancel").is_visible():
        tid(page, "confirm-cancel").click()
    check("settings: short Wi-Fi password is not sent", not posts("api-wifi"), str(posts("api-wifi")))
    tid(page, "wifi-key").fill("long-enough-password")
    tid(page, "wifi-save").click()
    tid(page, "confirm-ok").click()
    page.wait_for_timeout(800)
    sent = posts("api-wifi")
    check("settings: Wi-Fi save sends id, name and key", sent and sent[0]["body"].get("key") == "long-enough-password"
          and sent[0]["body"].get("id") == "default_radio1", str(sent))
    page.keyboard.press("Escape")

    open_view(page, "settings")
    tid(page, "password-row").click()
    tid(page, "password-current").fill(PASSWORD)
    tid(page, "password-new").fill("new-password-1")
    tid(page, "password-repeat").fill("different-one")
    tid(page, "password-save").click()
    page.wait_for_timeout(400)
    check("settings: mismatch is not sent", not posts("api-password"))
    tid(page, "password-repeat").fill("new-password-1")
    tid(page, "password-save").click()
    if tid(page, "confirm-ok").count():
        try:
            tid(page, "confirm-ok").click(timeout=800)
        except PlaywrightTimeout:
            pass
    page.wait_for_timeout(800)
    sent = posts("api-password")
    check("settings: password is sent", sent and sent[0]["body"].get("new") == "new-password-1", str(sent))
    page.keyboard.press("Escape")

    open_view(page, "settings")
    tid(page, "logout").click()
    if tid(page, "confirm-ok").count():
        try:
            tid(page, "confirm-ok").click(timeout=800)
        except PlaywrightTimeout:
            pass
    tid(page, "login-password").wait_for(timeout=3000)
    check("settings: log out returns to login", True)


def test_devices_and_safety(page):
    open_view(page, "devices")
    check("devices: lists clients", "192.168.1.102" in page.locator("main").inner_text())
    open_view(page, "servers")
    check("safety: hostile name stays text", page.locator("main img").count() == 0)


def test_layout(page):
    for width in (360, 768, 1280):
        page.set_viewport_size({"width": width, "height": 800})
        for view in ("home", "servers", "sources", "devices", "adguard", "settings"):
            open_view(page, view, "fa")
            scroll, client = page.evaluate(
                "[document.documentElement.scrollWidth, document.documentElement.clientWidth]")
            check(f"layout: no sideways scroll at {width} on {view}", scroll <= client, f"{scroll}>{client}")


def take_shots(browser):
    for theme in ("dark", "light"):
        for lang in ("fa", "en"):
            for view, size in (("home", (1280, 900)), ("servers", (1280, 900)), ("settings", (1280, 900)),
                               ("home", (390, 844)), ("sources", (390, 844))):
                context = browser.new_context(viewport={"width": size[0], "height": size[1]}, color_scheme=theme)
                page = context.new_page()
                page.goto(f"{BASE}/?{lang}#{view}")
                page.wait_for_load_state("networkidle")
                page.wait_for_timeout(30000 if view == "home" and size[0] > 500 and lang == "fa" else 3500 if view == "home" else 900)
                tag = "m" if size[0] < 500 else "d"
                page.screenshot(path=str(SHOTS / f"{theme}-{lang}-{view}-{tag}.png"))
                context.close()


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome", headless=True, args=["--no-proxy-server"])
        context = browser.new_context(viewport={"width": 1280, "height": 900}, color_scheme="dark")
        page = context.new_page()
        page.set_default_timeout(5000)
        page.on("pageerror", lambda e: page_errors.append(str(e)))
        page.on("dialog", lambda d: (page_errors.append("alert fired: " + d.message), d.dismiss()))
        for name, test in (("login", test_login), ("theme", test_theme_and_language), ("home", test_home), ("webrtc", test_webrtc_and_install), ("adblock", test_adblock),
                           ("adguard", test_adguard), ("servers", test_servers), ("sources", test_sources), ("settings", test_settings),
                           ("devices", test_devices_and_safety), ("layout", test_layout)):
            attempt(name + ": finished without getting stuck", lambda t=test: t(page))
        context.close()
        check("no JavaScript errors", not page_errors, "; ".join(page_errors)[:200])
        if SHOTS:
            SHOTS.mkdir(parents=True, exist_ok=True)
            take_shots(browser)
        browser.close()
    failed = [n for n, ok in results if not ok]
    print(f"\n{len(results) - len(failed)} of {len(results)} passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
