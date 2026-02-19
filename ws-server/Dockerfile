# ws-server/Dockerfile
FROM node:18-bullseye-slim

LABEL maintainer="RedNode <ops@rednode.ai>"

WORKDIR /usr/src/app

ENV NODE_ENV=production
ENV PORT=10000

# Install build deps so better-sqlite3 builds and runtime libs are present.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    python3-dev \
    pkg-config \
    libsqlite3-dev \
    ca-certificates \
    curl \
 && rm -rf /var/lib/apt/lists/*

# Copy package files to leverage Docker cache
COPY package.json package-lock.json ./
COPY ws-server/package.json ws-server/package.json

# Install dependencies (workspaces) at repo root
RUN npm ci --no-audit --no-fund

# Copy source
COPY . .

# Ensure data dir exists and is writable by the non-root user
RUN mkdir -p /opt/rednode/data && chown -R node:node /opt/rednode

# Run as non-root user
USER node

EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -fsS --connect-timeout 2 "http://127.0.0.1:${PORT:-10000}/healthz" || exit 1

# Default command (Render startCommand will override if set)
CMD ["sh", "-c", "cd ws-server && PORT=${PORT:-10000} node server.js"]
