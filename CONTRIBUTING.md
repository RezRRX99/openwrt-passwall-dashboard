# Contributing

## Run the mock and tests

The mock server fakes the router API so the page can be developed on a PC.

```sh
python tools/mock_server.py      # http://127.0.0.1:8099/
python tools/e2e.py              # needs the playwright package and installed Chrome
```

`tools/mock_server.py` accepts an optional port and a state name as arguments. `tools/e2e.py` optionally takes a folder to save screenshots in.

## Rules

- Files must keep LF line endings.
- Scripts under `cgi-bin/` and `router-lib/` are POSIX `sh` only and must run on BusyBox ash. No bashisms.
- CGI output must be valid JSON.
- No Node or Python on the router. Python is only for the PC tools in `tools/`.
- The frontend is vanilla JS with no build step, and every UI string must exist in both Persian and English in `www/dash/i18n.js`.
- Never commit real subscription links, passwords, public IPs or other personal data. Use placeholders and the example address 192.168.1.1.
- A change must never restart PassWall unless the user asked for it.
