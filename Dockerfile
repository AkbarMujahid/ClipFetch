FROM node:22-bookworm-slim

# Python (for yt-dlp) and ffmpeg (for merging video + audio and MP3 conversion)
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-venv ffmpeg ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# yt-dlp in a virtualenv owned by the app user, so it can update itself at startup
RUN python3 -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir -U "yt-dlp[default]" && \
    chown -R node:node /opt/venv

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHON_BIN=python3 \
    NODE_ENV=production

WORKDIR /app

# Install node deps first for better layer caching
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

USER node

EXPOSE 3000

# YouTube changes often, so grab the newest yt-dlp on every start (non-fatal)
CMD ["sh", "-c", "if [ \"$AUTO_UPDATE_YTDLP\" != \"false\" ]; then pip install --no-cache-dir -q -U 'yt-dlp[default]' || true; fi; exec node server.js"]
