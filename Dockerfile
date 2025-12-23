# Dockerfile (nginx static site) — fixed for PORT substitution
FROM nginx:alpine

LABEL maintainer="RedNode <ops@rednode.ai>"

WORKDIR /usr/share/nginx/html

# Copy site files (explicit for clarity)
COPY start.html                                    /usr/share/nginx/html/index.html
COPY start.html                                    /usr/share/nginx/html/start.html
COPY rednode.html                                  /usr/share/nginx/html/rednode.html
COPY secure.html                                   /usr/share/nginx/html/secure.html
COPY dashboard1.html                               /usr/share/nginx/html/dashboard1.html
COPY dashboard.html                                /usr/share/nginx/html/dashboard.html
COPY home.html                                     /usr/share/nginx/html/home.html
COPY sensor2.html                                  /usr/share/nginx/html/sensor2.html
COPY omconsole_render_single.html                  /usr/share/nginx/html/omconsole_render_single.html
COPY omconsole_render_single_games_ROUTING.html    /usr/share/nginx/html/omconsole_render_single_games_ROUTING.html

# New pages (optional)
COPY marketplace.html      /usr/share/nginx/html/marketplace.html
COPY chainmarket.html      /usr/share/nginx/html/chainmarket.html

# Dashboard folder + telematics page
RUN mkdir -p /usr/share/nginx/html/dashboard
COPY dashboard/            /usr/share/nginx/html/dashboard/

# Static directories
COPY live/                 /usr/share/nginx/html/live/
COPY static/               /usr/share/nginx/html/static/

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

# Healthcheck uses PORT env fallback to 80 (the shell expansion will work in HEALTHCHECK)
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD sh -c 'curl -fsS --connect-timeout 2 "http://127.0.0.1:${PORT:-80}/healthz" || exit 1'

# Start: set default PORT if unset, render the template and launch nginx in foreground.
# The shell sets PORT variable to ${PORT:-80} before envsubst replacement.
CMD ["sh", "-c", "PORT=${PORT:-80}; export PORT; envsubst '${PORT}' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]

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

# Healthcheck uses PORT env fallback to 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD sh -c 'curl -fsS --connect-timeout 2 "http://127.0.0.1:${PORT:-80}/healthz" || exit 1'

# Start: render the template and launch nginx in foreground.
# This substitutes the ${PORT} env var if provided by Render.
CMD ["sh", "-c", "envsubst '$$PORT' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
