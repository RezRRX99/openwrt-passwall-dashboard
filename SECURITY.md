# Security

## Reporting a vulnerability

Please report problems privately through GitHub's private vulnerability reporting: open the repository's Security tab and choose "Report a vulnerability". Do not open a public issue for a security problem. Do not include real subscription links, passwords or public IP addresses in a report.

## Security model

- The dashboard is for the LAN only. Never expose it on the WAN port or forward a port to it from the internet.
- It is served over plain HTTP on the LAN by default. The root password therefore crosses the LAN unencrypted, the same as logging in to default LuCI over HTTP. Use it only on a LAN you trust.
- API scripts answer only to an IP address, a plain host name, or a name ending in `.lan`, `.local` or `.home.arpa`, which stops DNS rebinding.
- Logging out ends the session on the router, and changing the root password ends all sessions.
- `api-status` answers from a two-second cache, and server ids read from `uci show` are checked before use, because a server name is untrusted text.
- Login is the router's root account. The browser gets an rpcd session from the router, and every API script except `api-status` checks that the session belongs to `root`. The session is sent as a bearer token in the `Authorization` header, which also stops other websites from making requests on the user's behalf.
- `api-status` is public on the LAN by design, so the page can show state before login. It returns no URLs, UUIDs or passwords. It does return state such as the active server's id, display name, protocol and type, the router hostname, the state of each protection, and uptime, load, traffic and memory counters. A server's display name can contain text from its provider.
- Wi-Fi passwords are write-only. `api-wifi` returns the network id, name, band, network and enabled state, never the key, and an empty key on save keeps the current one.
- Subscription URLs are write-only. `api-sub` returns only the host name of each URL, without any user, path or query, because those can hold an access token.
- Changing the root password through `api-password` asks for the current password again. This password also unlocks SSH and LuCI.
- Shared helpers live in `/usr/lib/dash/`, which uhttpd does not serve, and input such as section ids is validated before it reaches `uci`.

Server share links pasted into the dashboard are stored in the PassWall2 configuration on the router, as PassWall2 normally does.
