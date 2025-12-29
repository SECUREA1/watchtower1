# Dockerfile (nginx static site) — fixed for PORT substitution
FROM nginx:alpine

LABEL maintainer="RedNode <ops@rednode.ai>"

WORKDIR /usr/share/nginx/html

# Copy all site assets (HTML, JS, SVG, and folders) to the web root
COPY site/ /usr/share/nginx/html/
# Include root-level HTML dashboards (e.g., /ar-dashboard) that live outside site/
COPY *.html /usr/share/nginx/html/
# Include supporting experience folders that aren't nested under site/
COPY CHAINES.IO-CHAT-codex-fix-footer-not-staying-active-on-scroll/ /usr/share/nginx/html/CHAINES.IO-CHAT-codex-fix-footer-not-staying-active-on-scroll/

# Duplicate start page for the root index route
RUN cp /usr/share/nginx/html/start.html /usr/share/nginx/html/index.html

# Ensure correct ownership/permissions (nginx runs as nginx user)
RUN chown -R nginx:nginx /usr/share/nginx/html \
 && find /usr/share/nginx/html -type d -exec chmod 755 {} \; \
 && find /usr/share/nginx/html -type f -exec chmod 644 {} \;

# Create nginx config template at build-time
# NOTE: template uses ${PORT} only (no default operator).
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

    # Serve dashboard files directly (avoid SPA fallback)
    location ^~ /dashboard/ {
        try_files $uri $uri/ $uri.html =404;
    }

    # Live folder - try files first then fallback to index
    location ^~ /live/ {
        try_files $uri $uri/ $uri.html /index.html;
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

# Install curl so HEALTHCHECK can probe /healthz
RUN apk add --no-cache curl

EXPOSE 80

# Healthcheck uses PORT env fallback to 80 (shell expression allowed here)
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD sh -c 'curl -fsS --connect-timeout 2 "http://127.0.0.1:${PORT:-80}/healthz" || exit 1'

# Start: set default PORT if unset, render the template and launch nginx in foreground.
# The shell sets PORT variable to ${PORT:-80} before envsubst replacement.
CMD ["sh", "-c", "PORT=${PORT:-80}; export PORT; envsubst '${PORT}' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
