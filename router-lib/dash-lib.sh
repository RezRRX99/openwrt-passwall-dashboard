# dash-lib.sh: shared helpers for the dashboard CGI scripts.
# Installed to /usr/lib/dash/ so it cannot be requested over HTTP.

. /usr/share/libubox/jshn.sh
. /lib/functions.sh

DASH_MAX_BODY=65536
DASH_APPLY=/usr/lib/dash/dash-apply
DASH_ANON_SESSION=00000000000000000000000000000000

dash_send() {
	printf 'Status: %s\r\nContent-Type: application/json\r\nCache-Control: no-store\r\n\r\n' "${1:-200 OK}"
	json_dump
}

# Replaces any JSON built so far with an error and ends the request.
dash_fail() {
	json_init
	json_add_boolean ok 0
	json_add_string error "$1"
	dash_send "${2:-400 Bad Request}"
	exit 0
}

# Stops DNS rebinding: a website that points its own name at this router must not read the API.
# Real visits use an IP address, a plain host name or a local name. Scripts have no HTTP_HOST.
dash_host=${HTTP_HOST%:*}
case "$dash_host" in
	\[*|*.lan|*.local|*.home.arpa) ;;
	*.*)
		case "$dash_host" in
			*[!0-9.]*) dash_fail forbidden_host '403 Forbidden' ;;
		esac
		;;
esac

# Bearer tokens are the CSRF defence as well: another website cannot attach this header.
dash_require_session() {
	dash_token=${HTTP_AUTHORIZATION#Bearer }
	case "$dash_token" in
		''|*[!0-9a-f]*|"$DASH_ANON_SESSION") dash_fail unauthorized '401 Unauthorized' ;;
	esac
	[ "${#dash_token}" -eq 32 ] || dash_fail unauthorized '401 Unauthorized'
	dash_user=$(ubus call session get "{\"ubus_rpc_session\":\"$dash_token\"}" 2>/dev/null |
		jsonfilter -e '@.values.username' 2>/dev/null)
	[ "$dash_user" = root ] || dash_fail unauthorized '401 Unauthorized'
}

dash_read_body() {
	[ "$REQUEST_METHOD" = POST ] || dash_fail method_not_allowed '405 Method Not Allowed'
	case "${CONTENT_LENGTH:-}" in
		''|*[!0-9]*) dash_fail bad_length ;;
	esac
	[ "$CONTENT_LENGTH" -le "$DASH_MAX_BODY" ] || dash_fail too_large '413 Payload Too Large'
	DASH_BODY=$(head -c "$CONTENT_LENGTH")
}

dash_field() {
	printf '%s' "$DASH_BODY" | jsonfilter -e "@.$1" 2>/dev/null
}

dash_query() {
	printf '%s' "$QUERY_STRING" | tr '&' '\n' | sed -n "s/^$1=//p" | head -n 1
}

# uci show prints newlines inside a value as they are, so a hostile server name could forge a
# whole line. Anything read from uci show goes through this before it is used.
dash_real_nodes() {
	while read -r dash_id; do
		dash_valid_id "$dash_id" && [ "$(uci -q get "passwall2.$dash_id")" = nodes ] && echo "$dash_id"
	done
}

# UCI section names only. Everything else is rejected before it reaches a uci command.
dash_valid_id() {
	case "$1" in
		''|*[!A-Za-z0-9_]*) return 1 ;;
	esac
	return 0
}

# True for nodes a user may select: typed nodes, excluding interface pseudo-nodes.
dash_selectable_node() {
	dash_valid_id "$1" || return 1
	[ "$(uci -q get "passwall2.$1")" = nodes ] || return 1
	[ -n "$(uci -q get "passwall2.$1.type")" ] || return 1
	[ "$(uci -q get "passwall2.$1.protocol")" != _iface ]
}

# Stricter than LuCI's check, which also matches PassWall's dnsmasq and so reports a dead
# core as running. Matching "run -c" selects the proxy core itself.
dash_core_running() {
	pgrep -f 'passwall2/bin/[^ ]* run -c .*default/global' >/dev/null 2>&1
}

# "list tables" stays fast; listing the table itself would print the whole Iran set.
dash_ks_armed() {
	nft list tables 2>/dev/null | grep -q dash_ks
}

dash_adblock_active() {
	nft list tables 2>/dev/null | grep -q dash_ab
}

dash_passwall_enabled() {
	[ "$(uci -q get passwall2.@global[0].enabled)" = 1 ]
}

dash_node_ids() {
	uci show passwall2 | sed -nE 's/^passwall2\.([^.=]+)=nodes$/\1/p' | dash_real_nodes
}

# Real servers only: no balancer, shunt, interface or empty sections. One uci call, because
# the guard runs this every minute.
dash_server_ids() {
	uci show passwall2 | sed -n "s/^passwall2\.\([^.]*\)\.protocol='[^_'][^']*'$/\1/p" | dash_real_nodes
}

# True when every server is already in the balancer, so the owner wants "all of them".
dash_pool_has_all() {
	dash_pool=" $(uci -q get "passwall2.$1.balancing_node") "
	for dash_id in $(dash_server_ids); do
		case "$dash_pool" in
			*" $dash_id "*) ;;
			*) return 1 ;;
		esac
	done
	return 0
}

# Adds any server the balancer does not have yet.
dash_pool_add_all() {
	dash_pool=" $(uci -q get "passwall2.$1.balancing_node") "
	for dash_id in $(dash_server_ids); do
		case "$dash_pool" in
			*" $dash_id "*) ;;
			*) uci add_list "passwall2.$1.balancing_node=$dash_id" ;;
		esac
	done
	uci commit passwall2
}

# Prints the balancer's section name, if there is one.
dash_balancer_id() {
	uci show passwall2 | sed -n "s/^passwall2\.\([^.]*\)\.protocol='_balancing'$/\1/p" | dash_real_nodes | head -n 1
}

# Auto mode uses every server unless the owner saved a smaller list in the dashboard.
dash_pool_wants_all() {
	[ "$(uci -q get dash.auto.all)" != 0 ]
}

dash_sub_updating() {
	pgrep -f 'dash-sub-update' >/dev/null 2>&1 || pgrep -f 'subscribe.lua start' >/dev/null 2>&1
}

# $1 is a subscribe_list section, or "all". Updates can outlast uhttpd's 60 second limit.
dash_start_sub_update() {
	/usr/lib/dash/dash-sub-update "$1" </dev/null >/dev/null 2>&1 &
}

# A second restart queued behind the first means minutes of outage, and rollback would
# return to a server that was itself still being tried. So changes wait their turn in the
# UI instead. Checks the process, not the state file, which a crash could leave stale.
dash_apply_running() {
	pgrep -f 'dash/dash-apply' >/dev/null 2>&1
}

# Runs the restart detached, so the CGI answers now and uhttpd's timeout cannot kill it.
dash_apply_async() {
	# Written before answering, so a client polling right away cannot read a stale "ok".
	echo working > /tmp/dash-apply.state
	"$DASH_APPLY" "$@" </dev/null >/dev/null 2>&1 &
}
