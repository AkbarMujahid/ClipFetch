#!/bin/sh
# Container entrypoint: refresh yt-dlp, optionally start the WARP proxy, then run the app.

# YouTube changes often, so grab the newest yt-dlp on every start (non-fatal)
if [ "${AUTO_UPDATE_YTDLP:-true}" != "false" ]; then
  pip install --no-cache-dir -q -U "yt-dlp[default]" || true
fi

# Runs in the background so the server starts right away; the app only
# uses WARP once it has confirmed the tunnel works
if [ "${USE_WARP:-false}" = "true" ]; then
  /app/scripts/warp.sh &
fi

exec node server.js
