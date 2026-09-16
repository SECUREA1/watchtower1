# Dockerfile (nginx static site) — fixed for PORT substitution and streaming helpers
FROM nginx:alpine

LABEL maintainer="RedNode <ops@rednode.ai>"

# Ensure a default runtime PORT is available if the platform doesn't set one.
# Render/others will typically inject a PORT env; if not, 80 will be used.
ENV PORT=80

WORKDIR /usr/share/nginx/html

# Copy full repo into a temporary build area so we can safely pick files/folders.
# This avoids COPY wildcard failures when some files may be absent.
COPY . /tmp/build_context/

# Create web root and populate it from known locations.
# Use shell guards to avoid build failures when files/folders are missing.
RUN mkdir -p /usr/share/nginx/html \
 && sh -c 'if [ -d /tmp/build_context/site ]; then cp -a /tmp/build_context/site/. /usr/share/nginx/html/; fi' \
 && sh -c 'cp /tmp/build_context/*.html /usr/share/nginx/html/ 2>/dev/null || true' \
 && sh -c 'if [ -d "/tmp/build_context/CHAINES.IO-CHAT-codex-fix-footer-not-staying-active-on-scroll" ]; then cp -a "/tmp/build_context/CHAINES.IO-CHAT-codex-fix-footer-not-staying-active-on-scroll" /usr/share/nginx/html/; fi' \
 && rm -rf /tmp/build_context

# Duplicate start page for the root index route if start.html exists
RUN if [ -f /usr/share/nginx/html/start.html ]; then cp /usr/share/nginx/html/start.html /usr/share/nginx/html/index.html; fi

# Ensure ownership/permissions (nginx runs as nginx user)
RUN chown -R nginx:nginx /usr/share/nginx/html \
 && find /usr/share/nginx/html -type d -exec chmod 755 {} \; \
 && find /usr/share/nginx/html -type f -exec chmod 644 {} \;

# Create nginx config template at build-time. Template uses ${PORT} so it can be replaced at container start.
# Includes a WebSocket proxy block (for signaling server) and HLS handling for .m3u8/.ts assets.
RUN cat > /etc/nginx/conf.d/default.conf.template <<'EOF_CONF'
server {
    listen ${PORT};
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    # Health endpoint (returns JSON)
    location = /healthz {
        default_type application/json;
        return 200 '{"ok": true}';
    }

    # The static deployment has no camera capture process. Return a valid empty
    # inventory instead of letting the SPA fallback serve index.html to fetch().
    # Hardware/API deployments override this route with the FastAPI service.
    location = /api/cameras {
        default_type application/json;
        add_header Cache-Control "no-store";
        return 200 '{"ok":true,"cameras":[],"mode":"static"}';
    }

    # Proxy websocket (signaling) - assumes a local backend (adjust as needed)
    # If you run your signaling server on another hostname/port, change proxy_pass accordingly.
    # Example: proxy_pass http://127.0.0.1:3000;
    location /ws/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;
    }

    # Dashboard files directly (avoid SPA fallback)
    location ^~ /dashboard/ {
        try_files $uri $uri/ $uri.html =404;
    }

    # Live folder - try files first then fallback to index (useful for HLS manifests)
    location ^~ /live/ {
        try_files $uri $uri/ $uri.html /index.html;
    }

    # HLS (.m3u8/.ts) handling: correct MIME types and allow CORS for playback
    location ~* \.(m3u8|ts)$ {
        add_header Access-Control-Allow-Origin *;
        add_header Cache-Control "no-cache";
        types {
            application/vnd.apple.mpegurl m3u8;
            video/mp2t ts;
        }
        # Serve directly
        try_files $uri =404;
    }

    # SPA fallback for other routes
    location / {
        try_files $uri $uri/ $uri.html /index.html;
    }

    # Static assets caching
    location ~* \.(?:css|js|png|jpg|jpeg|gif|ico|svg|woff2?|ttf|eot)$ {
        expires 7d;
        add_header Cache-Control "public";
    }

    # Optional: deny access to dotfiles
    location ~ /\. {
        deny all;
    }
}
EOF_CONF

# Install curl so HEALTHCHECK can probe /healthz and gettext for envsubst.
# Also install ffmpeg (useful for HLS/transcoding). Note: ffmpeg on alpine may not include proprietary codecs.
RUN apk add --no-cache curl gettext ffmpeg

# Informal port hint. We expose the default HTTP port (container env PORT may vary at runtime).
EXPOSE 80

# Healthcheck uses PORT env fallback to 80 (shell expression allowed here)
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD sh -c 'curl -fsS --connect-timeout 2 "http://127.0.0.1:${PORT:-80}/healthz" || exit 1'

# Start: render template with the runtime PORT and launch nginx in foreground.
# We set a default PORT value (from ENV), export it so envsubst can use it,
# and then envsubst will replace ${PORT} in the template.
CMD ["sh", "-c", "PORT=${PORT:-80}; export PORT; envsubst '${PORT}' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
