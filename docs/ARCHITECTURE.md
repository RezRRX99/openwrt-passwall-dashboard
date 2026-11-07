# Architecture

## Overview

- Browser: a single-page app in vanilla JS (`www/dash/`), served as static files by uhttpd under `/dash/`. It can be installed as a web app, and there is a small Android wrapper in `android/`.
- Server side: POSIX shell CGI scripts in `cgi-bin/`, run by uhttpd. They return JSON built with `jshn`.
- Helpers and background scripts: `router-lib/`, installed to `/usr/lib/dash/`, a folder uhttpd does not serve.

## Login and sessions

The browser logs in with the router's root account through rpcd and gets a session id. It sends it as `Authorization: Bearer <id>`. `dash_require_session` in `dash-lib.sh` asks `ubus` for the session and accepts only user `root`. Only `api-status` needs no session.

## Firewall tables

The dashboard adds its own nftables tables and never edits PassWall's rules. Each hooks in with a priority ahead of PassWall's, so they hold while the proxy is off or restarting.

- `inet dash_ks` (`dash-ks`): the kill switch. A forward rule for traffic from `br-lan` does nothing while PassWall's TPROXY takes the traffic, and catches it when PassWall's rules are gone. Smart mode lets Iranian destinations through using an IP set built from PassWall's `geoip.dat`; strict mode blocks all. Private ranges and ICMP are allowed. It also redirects client DNS to the router. `dash-ks.init` restores it at boot, before the network comes up.
- `inet dash_ab` (`dash-adblock`): one redirect rule that sends client DNS on port 53 to AdGuard Home on 5353. AdGuard's upstream is dnsmasq. If AdGuard stops answering, the rule is removed.
- `inet dash_rtc` (`dash-rtc`): the WebRTC switch. Drops STUN by content, blocks IPv6 forwarding from the LAN, and stops handing out IPv6 addresses. It keeps the kill switch armed while on.

## Background jobs

- `dash-guard`: run by cron every minute. If PassWall is meant to be on but its core is down for two checks in a row, it restarts it. It also keeps `dash-adblock` in step and adds missing servers to the auto-mode balancer.
- `dash-sub-check`: hourly from cron. Downloads each auto-updated subscription through PassWall, fingerprints its servers without order, names or Reality sid, and runs `dash-sub-update` only when that fingerprint changes. Nightly at 04:45 it runs a full update. PassWall's own schedule for those subscriptions is set to 24 hours.
- `dash-apply`: runs PassWall restarts and stops in the background, one at a time, and writes the result (working, ok, reverted or failed) to `/tmp/dash-apply.state`. After a restart it proves real traffic through the node; if that fails it rolls back to the previous node. Turning PassWall on passes no previous node on purpose, so it never falls back to a direct line.
- `dash-sub-update`: runs PassWall's subscription update with a time limit and records running, ok or timeout in `/tmp/dash-sub.state`.

## File map

- `www/dash/`: `index.html`, `app.js`, `i18n.js` (fa and en strings), `style.css`, `sw.js`, `manifest.json`, icons, the Vazirmatn font and `OFL.txt`.
- `cgi-bin/`: `api-status`, `api-toggle`, `api-nodes`, `api-node`, `api-switch`, `api-ping`, `api-exit`, `api-auto`, `api-sub`, `api-sub-info`, `api-sub-update`, `api-add-config`, `api-killswitch`, `api-adblock`, `api-adguard`, `api-webrtc`, `api-devices`, `api-wifi`, `api-password`.
- `router-lib/`: `dash-lib.sh`, `dash-apply`, `dash-guard`, `dash-ks`, `dash-ks.init`, `dash-adblock`, `dash-rtc`, `dash-sub-update`.
- `android/`: source and build script for the Android app.
- `tools/`: `mock_server.py`, `e2e.py`, `contrast.py`, `make_icons.py` (PC only).
