"""Local mock of the router API, for checking the dashboard without touching the router.

Run:  python tools/mock_server.py [port] [state]
State is running, stopped or disabled. All data here is made up.

Keeps enough state for click tests: POSTs are recorded and served at /__posts, and
/__reset clears them. index.html logs in automatically unless the URL has ?login, and
?en selects English, so a test browser can open any view directly. Those two hooks exist
only in this mock.
"""
import json
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

WEB_ROOT = Path(__file__).resolve().parent.parent / "www" / "dash"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8099
STATE = sys.argv[2] if len(sys.argv) > 2 else "running"
TOKEN = "a" * 32
PASSWORD = "mock-password"
AUTO_LOGIN = (
    "<script>"
    "if(location.search.indexOf('login')<0)"
    f"sessionStorage.setItem('dash_token','{TOKEN}');"
    "if(location.search.indexOf('en')>=0)localStorage.setItem('dash_lang','en')"
    "</script>"
)


def server(node_id, name, group="Demo", in_pool=True, manual=False):
    return {"id": node_id, "name": name, "kind": "server", "type": "Xray", "protocol": "vless",
            "group": group, "address": "example.net", "port": "443", "in_pool": in_pool, "manual": manual}


NODES = [
    {"id": "bal1", "name": "Auto", "kind": "auto", "type": "Xray", "protocol": "_balancing",
     "group": "Demo", "address": "", "port": "", "in_pool": False, "manual": False},
    server("n1", "\U0001F1E9\U0001F1EA Germany آلمان"),
    server("n2", "\U0001F1EB\U0001F1F7 France"),
    server("n3", "\U0001F1F3\U0001F1F1 Netherlands", in_pool=False),
    server("n4", "<img src=x onerror=alert(1)> injected name", "Manual", False, True),
    {"id": "s1", "name": "Iran direct", "kind": "shunt", "type": "Xray", "protocol": "_shunt", "group": "",
     "address": "", "port": "", "in_pool": False, "manual": False},
]

world = {"state": STATE, "active": "bal1", "ks": True, "mode": "smart", "ab": True, "rx": 5000000000, "tx": 900000000}
posts = []


def status():
    world["rx"] += 4000000
    world["tx"] += 600000
    node = next(n for n in NODES if n["id"] == world["active"])
    return {
        "ok": True, "time": 1793876830,
        "passwall": {"enabled": world["state"] != "disabled", "running": world["state"] == "running",
                     "state": world["state"], "last_apply": "ok"},
        "node": {"id": node["id"], "name": node["name"], "protocol": node["protocol"], "type": "Xray"},
        "adguard": {"running": True, "dns_listening": True},
        "webrtc": {"enabled": world.get("rtc", False)},
        "killswitch": {"armed": world.get("rtc", False) or (world["ks"] and world["state"] != "disabled"), "mode": world["mode"]},
        "wan": {"rx_bytes": str(world["rx"]), "tx_bytes": str(world["tx"])},
        "system": {"hostname": "OpenWrt", "uptime_s": 86400, "mem_total_kb": 500000,
                   "mem_available_kb": 350000, "load1": "0.51"},
    }


HOSTILE_DOMAIN = "<img src=x onerror=alert(1)>.example"


def adguard():
    """Fake api-adguard payload following the agreed contract. Off means enabled false and no stats."""
    if not world["ab"]:
        return {"ok": True, "enabled": False, "active": False, "running": False,
                "stats": {"available": False, "queries": 0, "blocked": 0, "blocked_pct": 0, "avg_ms": 0,
                          "hourly": {"queries": [], "blocked": []},
                          "top_blocked": [], "top_queried": [], "top_clients": []},
                "recent": []}
    queries = [120, 90, 60, 40, 30, 25, 50, 140, 300, 520, 610, 700, 650, 580, 540, 600, 720, 810, 900, 760, 640, 480, 330, 210]
    blocked = [22, 15, 10, 8, 4, 5, 12, 30, 61, 104, 120, 133, 118, 96, 90, 111, 140, 160, 171, 150, 122, 90, 60, 41]
    recent = [
        {"time": 1793912050 - 37 * i,
         "domain": HOSTILE_DOMAIN if i == 1 else ("ads%d.tracker.example" % i if i % 2 else "example%d.com" % i),
         "client": "192.168.1.102" if i % 3 else "192.168.1.140", "blocked": bool(i % 2)}
        for i in range(34)
    ]
    return {
        "ok": True, "enabled": True, "active": True, "running": True,
        "stats": {
            "available": True, "queries": sum(queries), "blocked": sum(blocked),
            "blocked_pct": round(sum(blocked) * 100 / sum(queries), 1), "avg_ms": 23,
            "hourly": {"queries": queries, "blocked": blocked},
            "top_blocked": [{"name": "doubleclick.net", "count": 120}, {"name": HOSTILE_DOMAIN, "count": 80},
                            {"name": "very-long-subdomain.telemetry.analytics.example.org", "count": 33}],
            "top_queried": [{"name": "example.com", "count": 90}, {"name": "cdn.example.net", "count": 61}],
            "top_clients": [{"name": "192.168.1.102", "count": 800}, {"name": "192.168.1.140", "count": 210}],
        },
        "recent": recent,
    }


def get_route(name, query):
    if name == "api-status":
        return status()
    if name == "api-nodes":
        return {"ok": True, "active": world["active"], "nodes": NODES}
    if name == "api-ping":
        if "mode=real" in query:
            ms = {"n1": 720, "n2": 1300, "n3": None}.get(query.split("id=")[1].split("&")[0], 900)
            return {"ok": True, "id": "x", "mode": "real", **({"ms": ms} if ms else {})}
        return {"ok": True, "mode": "tcp", "results": []}
    if name == "api-webrtc":
        return {"ok": True, "enabled": world.get("rtc", False), "active": world.get("rtc", False)}
    if name == "api-adblock":
        return {"ok": True, "enabled": world["ab"], "active": world["ab"], "running": True}
    if name == "api-adguard":
        return adguard()
    if name == "api-exit":
        running = world["state"] == "running"
        return {"ok": True, "reachable": running, "ip": "203.0.113.20" if running else "",
                "country": "DE" if running else ""}
    if name == "api-auto":
        return {"ok": True, "id": "bal1", "name": "Auto", "strategy": "leastPing", "interval": "5m", "pool": ["n1", "n2"]}
    if name == "api-sub":
        return {"ok": True, "updating": False, "subscriptions": [
            {"id": "cfg1", "remark": "Demo", "host": "panel.example.net", "auto_update": True,
             "interval_hours": "1", "nodes": 18}]}
    if name == "api-sub-info":
        return {"ok": True, "subscriptions": [
            {"id": "cfg1", "reachable": True, "used_bytes": "70000000000", "total_bytes": "536870912000",
             "expire": "1898000000", "expired": False}]}
    if name == "api-sub-update":
        return {"ok": True, "running": False, "last": "ok"}
    if name == "api-killswitch":
        return {"ok": True, "enabled": world["ks"], "mode": world["mode"],
                "armed": world["ks"] and world["state"] != "disabled", "blocked_packets": "0"}
    if name == "api-wifi":
        return {"ok": True, "networks": [
            {"id": "default_radio1", "ssid": "OpenWrt 5G", "band": "5g", "network": "lan", "enabled": True},
            {"id": "default_radio0", "ssid": "OpenWrt 2G", "band": "2g", "network": "lan", "enabled": True},
            {"id": "wifinet2", "ssid": "OpenWrt Guest", "band": "5g", "network": "guest", "enabled": True}]}
    if name == "api-devices":
        return {"ok": True, "devices": [
            {"mac": "aa:bb:cc:00:11:22", "ip": "192.168.1.102", "name": "laptop", "online": True, "lease_expires": 0},
            {"mac": "aa:bb:cc:00:11:33", "ip": "192.168.1.140", "name": "", "online": False, "lease_expires": 0}]}
    return {"ok": True}


def post_route(name, body):
    if name == "api-toggle":
        world["state"] = "running" if body.get("action") == "on" else "disabled"
    elif name == "api-switch":
        world["active"] = body["id"]
        return {"ok": True, "active": body["id"], "restarting": False}
    elif name == "api-logout":
        return {"ok": True}
    elif name == "api-webrtc":
        world["rtc"] = body["enabled"]
        return get_route(name, "")
    elif name == "api-adblock":
        world["ab"] = body["enabled"]
        return get_route(name, "")
    elif name == "api-killswitch":
        world["ks"], world["mode"] = body["enabled"], body["mode"]
        return get_route(name, "")
    elif name == "api-password":
        if body.get("current") != PASSWORD:
            return {"ok": False, "error": "wrong_password"}
    elif name == "api-add-config":
        return {"ok": True, "submitted": 1, "added": 1, "id": "new1"}
    elif name in ("api-sub", "api-auto", "api-wifi"):
        return {**get_route(name, ""), "updating": name == "api-sub"}
    return {"ok": True}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_ROOT), **kwargs)

    def log_message(self, *args):
        pass

    def send_json(self, payload, code=200):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authorized(self, name):
        return name == "api-status" or self.headers.get("Authorization") == f"Bearer {TOKEN}"

    def do_GET(self):
        # The router serves the app under /dash/.
        if self.path.startswith("/dash/"):
            self.path = self.path[5:]
        path, _, query = self.path.partition("?")
        if path == "/__posts":
            return self.send_json(posts)
        if path == "/__reset":
            posts.clear()
            world.update(state=STATE, active="bal1", ks=True, mode="smart", ab=True, rtc=False)
            return self.send_json({"ok": True})
        if path.startswith("/cgi-bin/"):
            name = path.rsplit("/", 1)[-1]
            if not self.authorized(name):
                return self.send_json({"ok": False, "error": "unauthorized"}, 401)
            return self.send_json(get_route(name, query))
        if path in ("/", "/index.html"):
            html = (WEB_ROOT / "index.html").read_text(encoding="utf8")
            body = html.replace("<head>", "<head>" + AUTO_LOGIN, 1).encode("utf8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return None
        return super().do_GET()

    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        body = json.loads(raw or b"{}")
        if self.path.startswith("/ubus"):
            password = body["params"][3].get("password")
            if password == PASSWORD:
                return self.send_json({"result": [0, {"ubus_rpc_session": TOKEN}]})
            return self.send_json({"result": [6]})
        name = self.path.split("?")[0].rsplit("/", 1)[-1]
        if not self.authorized(name):
            return self.send_json({"ok": False, "error": "unauthorized"}, 401)
        posts.append({"api": name, "body": body})
        return self.send_json(post_route(name, body))


if __name__ == "__main__":
    print(f"mock on http://127.0.0.1:{PORT}/ state={STATE}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
