#!/bin/sh
# Installs or updates the dashboard. Safe to run again: running it again is the update command.
#
#   sh install.sh                      from a checkout of the repository
#   curl -fsSL URL/install.sh | sh     see the README for the command that uses PassWall
#
# It never starts, stops or restarts PassWall, the network, the firewall or Wi-Fi.

REPO="RezRRX99/openwrt-passwall-dashboard"
BRANCH=main

say() { printf '%s\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

# Everything runs from the last line, so a download cut short runs nothing.
main() {

[ -f /etc/openwrt_release ] || die 'this is not OpenWrt (/etc/openwrt_release is missing).'
[ "$(id -u)" = 0 ] || die 'run this as root.'

# ---- Dependencies: nothing is changed until all of them are present. ----

missing=

need_cmd() {
	command -v "$1" >/dev/null 2>&1 && return 0
	missing="$missing$2
"
	return 1
}

need_file() {
	[ -e "$1" ] && return 0
	missing="$missing$2
"
	return 1
}

need_cmd uci uci
need_cmd nft 'nftables (needs OpenWrt 22.03 or newer)'
need_cmd ubus ubus
need_cmd jsonfilter jsonfilter
need_cmd curl curl
need_cmd flock flock
need_file /usr/share/libubox/jshn.sh libubox
need_file /etc/init.d/uhttpd uhttpd
need_file /etc/init.d/rpcd rpcd
need_file /etc/init.d/passwall2 luci-app-passwall2

if command -v uci >/dev/null 2>&1 && [ -z "$(uci -q get uhttpd.main.ubus_prefix)" ]; then
	missing="${missing}uhttpd-mod-ubus (uhttpd.main.ubus_prefix is not set)
"
fi

if [ -n "$missing" ]; then
	say 'Missing requirements. Nothing was changed. Install these with opkg:'
	printf '%s' "$missing" | while IFS= read -r line; do
		say "  opkg install $line"
	done
	exit 1
fi

[ -x /etc/init.d/adguardhome ] || say 'Note: AdGuard Home is not installed, so the AdGuard features stay unavailable until it is.'

# ---- Source: beside the script, or downloaded. ----

TMP=
cleanup() { [ -n "$TMP" ] && rm -rf "$TMP"; }
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

SRC=
if [ -f "$0" ]; then
	here=$(cd "$(dirname "$0")" 2>/dev/null && pwd)
	if [ -n "$here" ] && [ -d "$here/cgi-bin" ] && [ -d "$here/router-lib" ] && [ -d "$here/www/dash" ]; then
		SRC=$here
	fi
fi

if [ -z "$SRC" ]; then
	TMP=$(mktemp -d /tmp/dash-install.XXXXXX) || die 'cannot create a temporary folder.'
	say "Downloading $REPO ($BRANCH)..."
	# Many lines cannot reach GitHub directly, so the download goes through PassWall when it is up.
	port=$(uci -q get 'passwall2.@global[0].node_socks_port')
	proxy=socks5h://127.0.0.1:${port:-1070}
	curl -s -m 15 -o /dev/null -x "$proxy" https://github.com/ || proxy=
	curl -fsSL --connect-timeout 20 -m 300 ${proxy:+-x "$proxy"} "https://github.com/$REPO/archive/refs/heads/$BRANCH.tar.gz" -o "$TMP/src.tar.gz" ||
		die 'download failed.'
	mkdir "$TMP/x" || die 'cannot create a temporary folder.'
	tar -xzf "$TMP/src.tar.gz" -C "$TMP/x" || die 'cannot extract the download.'
	for d in "$TMP"/x/*; do
		[ -d "$d" ] && SRC=$d && break
	done
	[ -n "$SRC" ] || die 'the download is empty.'
fi

[ -d "$SRC/cgi-bin" ] && [ -d "$SRC/router-lib" ] && [ -d "$SRC/www/dash" ] ||
	die 'the source is missing cgi-bin, router-lib or www/dash.'

# ---- Copy. ----

install_dir() {
	# install_dir SOURCE_DIR DEST_DIR MODE
	mkdir -p "$2" || die "cannot create $2."
	for f in "$1"/*; do
		[ -f "$f" ] || continue
		cp -f "$f" "$2/" || die "cannot copy $f."
		chmod "$3" "$2/$(basename "$f")"
	done
}

install_dir "$SRC/cgi-bin" /www/cgi-bin 755
install_dir "$SRC/router-lib" /usr/lib/dash 755
chmod 644 /usr/lib/dash/dash-lib.sh
install_dir "$SRC/www/dash" /www/dash 644

cp -f /usr/lib/dash/dash-ks.init /etc/init.d/dash-ks || die 'cannot install /etc/init.d/dash-ks.'
chmod 755 /etc/init.d/dash-ks
/etc/init.d/dash-ks enable

# ---- Cron ----

touch /etc/crontabs/root
if ! grep -q dash-guard /etc/crontabs/root; then
	echo '* * * * * /usr/lib/dash/dash-guard' >> /etc/crontabs/root
	/etc/init.d/cron restart
fi

# ---- Settings file: empty, so every protection stays off until the user turns it on. ----

[ -f /etc/config/dash ] || touch /etc/config/dash

# ---- Done ----

ip=$(uci -q get network.lan.ipaddr)
ip=${ip%%/*}
[ -n "$ip" ] || ip='<router-address>'

say ''
say 'Dashboard installed.'
say "Open: http://$ip/dash/"
say "Login: the router's root password."
say 'The Android app is in the dashboard Settings.'
say 'A new install keeps the kill switch, ad blocking and WebRTC protection off until you turn them on there. An update keeps your settings.'
}

main "$@"
