#!/bin/sh
# Removes the dashboard. PassWall is not touched and not restarted.

say() { printf '%s\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

# Everything runs from the last line, so a download cut short runs nothing.
main() {

[ -f /etc/openwrt_release ] || die 'this is not OpenWrt (/etc/openwrt_release is missing).'
[ "$(id -u)" = 0 ] || die 'run this as root.'

# 1. Turn the features off while the scripts still exist, so dash-rtc can restore the IPv6 options.
# The ad blocking section is called "adblock" in dash-adblock.
if [ -f /etc/config/dash ]; then
	for s in rtc ks adblock; do
		uci -q get "dash.$s" >/dev/null && uci -q set "dash.$s.enabled=0"
	done
	uci -q commit dash
fi
[ -x /usr/lib/dash/dash-rtc ] && /usr/lib/dash/dash-rtc apply

# 2. Firewall tables of the dashboard.
for t in dash_ks dash_ab dash_rtc; do
	nft delete table inet "$t" 2>/dev/null
done

# 3. Give AdGuard Home its original settings back.
if [ -e /etc/adguardhome.yaml.before-dash ]; then
	mv -f /etc/adguardhome.yaml.before-dash /etc/adguardhome.yaml
	[ -x /etc/init.d/adguardhome ] && /etc/init.d/adguardhome restart
fi

# 4. Cron.
if [ -f /etc/crontabs/root ] && grep -qE 'dash-guard|dash-sub-check' /etc/crontabs/root; then
	sed -i -e '/dash-guard/d' -e '/dash-sub-check/d' /etc/crontabs/root
	/etc/init.d/cron restart
fi

# 5. Files.
[ -x /etc/init.d/dash-ks ] && /etc/init.d/dash-ks disable
rm -f /etc/init.d/dash-ks
rm -rf /usr/lib/dash /www/dash /etc/dash
rm -f /www/cgi-bin/api-* /etc/config/dash

say 'Dashboard removed.'
say 'PassWall was not touched: its servers and subscriptions are left as they are.'
say 'Automatic subscription updates in PassWall stay at every 24 hours. Change that in LuCI if you want.'
}

main "$@"
