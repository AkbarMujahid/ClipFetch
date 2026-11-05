#!/bin/sh
# Starts a free Cloudflare WARP tunnel and exposes it as a local SOCKS5 proxy,
# so yt-dlp can reach YouTube from a WARP address instead of the server's own.
#
#   wgcf      - registers a free WARP account and writes a WireGuard profile
#   wireproxy - runs that WireGuard tunnel in userspace (no root or VPN device needed)

WARP_DIR=/tmp/warp
PORT="${WARP_PORT:-40000}"
SAVED_ACCOUNT="${WARP_ACCOUNT_FILE:-/etc/secrets/wgcf-account.toml}"

mkdir -p "$WARP_DIR" && cd "$WARP_DIR" || exit 1

if [ -f "$SAVED_ACCOUNT" ]; then
  echo "[warp] using saved account from $SAVED_ACCOUNT"
  cp "$SAVED_ACCOUNT" wgcf-account.toml
else
  echo "[warp] registering a new free WARP account"
  tries=0
  until wgcf register --accept-tos >/dev/null 2>&1; do
    rm -f wgcf-account.toml
    tries=$((tries + 1))
    if [ "$tries" -ge 3 ]; then
      echo "[warp] registration failed, continuing without WARP"
      exit 1
    fi
    sleep 5
  done
fi

if ! wgcf generate --keepalive >/dev/null 2>&1; then
  echo "[warp] could not generate the WireGuard profile, continuing without WARP"
  exit 1
fi

cat > wireproxy.conf <<EOF
WGConfig = $WARP_DIR/wgcf-profile.conf

[Socks5]
BindAddress = 127.0.0.1:$PORT
EOF

echo "[warp] starting proxy on 127.0.0.1:$PORT"
while true; do
  wireproxy -s -c wireproxy.conf
  echo "[warp] proxy stopped, restarting in 5s"
  sleep 5
done
