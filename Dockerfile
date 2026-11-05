FROM node:22-bookworm-slim

# Python (for yt-dlp), ffmpeg (for merging video + audio and MP3 conversion),
# curl (for downloading the WARP tools and checking the tunnel)
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-venv ffmpeg ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

# Optional Cloudflare WARP proxy tools (only used when USE_WARP=true), checksum-verified
ARG TARGETARCH=amd64
ARG WGCF_VERSION=2.3.1
ARG WIREPROXY_VERSION=1.1.3
RUN set -e; \
    case "$TARGETARCH" in \
      amd64) WGCF_SHA=4fb7a136aa470ece11d17949c7db07b040ec9c604742dc8680bcf1889f85d0c8; \
             WIREPROXY_SHA=e88c1d090740373fc606c1bafd81d9a5eadc642cce5667616e20e9d7a444f51c ;; \
      arm64) WGCF_SHA=710ab2d8ac145d81a4cf0c11bdb0e05914f77ae2a45f67b87e718d84b4cb7301; \
             WIREPROXY_SHA=370e00bd2167960d1ecd1c3c1439715bbaa94a0a110a2040468670c9af6021b6 ;; \
      *) echo "Unsupported architecture: $TARGETARCH"; exit 1 ;; \
    esac; \
    curl -fsSL -o /usr/local/bin/wgcf \
      "https://github.com/ViRb3/wgcf/releases/download/v${WGCF_VERSION}/wgcf_${WGCF_VERSION}_linux_${TARGETARCH}"; \
    echo "$WGCF_SHA  /usr/local/bin/wgcf" | sha256sum -c -; \
    curl -fsSL -o /tmp/wireproxy.tar.gz \
      "https://github.com/pufferffish/wireproxy/releases/download/v${WIREPROXY_VERSION}/wireproxy_linux_${TARGETARCH}.tar.gz"; \
    echo "$WIREPROXY_SHA  /tmp/wireproxy.tar.gz" | sha256sum -c -; \
    tar -xzf /tmp/wireproxy.tar.gz -C /usr/local/bin wireproxy; \
    rm /tmp/wireproxy.tar.gz; \
    chmod +x /usr/local/bin/wgcf /usr/local/bin/wireproxy

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
RUN chmod +x scripts/*.sh

USER node

EXPOSE 3000

CMD ["/app/scripts/start.sh"]
