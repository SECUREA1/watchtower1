# Use nginx
FROM nginx:alpine

WORKDIR /usr/share/nginx/html

# Copy site files
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

# New pages: make sure these files exist in your build context
COPY marketplace.html      /usr/share/nginx/html/marketplace.html
COPY chainmarket.html      /usr/share/nginx/html/chainmarket.html

# Dashboard folder + new telematics page
RUN mkdir -p /usr/share/nginx/html/dashboard

# Copy the dashboard directory (includes rednodetelmatics.html)
COPY dashboard/            /usr/share/nginx/html/dashboard/

# Static directories
COPY live/                 /usr/share/nginx/html/live/
COPY static/               /usr/share/nginx/html/static/

# If you have additional assets for marketplace/chainmarket, copy them too:
# (optional — uncomment if you have a marketplace/ or chainmarket/ asset folder)
# COPY marketplace/        /usr/share/nginx/html/marketplace/
# COPY chainmarket/        /usr/share/nginx/html/chainmarket/

# Create nginx config template at build-time
RUN cat > /etc/nginx/conf.d/default.conf.template <<'EOF_CONF'
server {
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    # Serve dashboard files directly (avoid SPA fallback)
    # This ensures requests like /dashboard/rednodetelmatics.html
    # return the actual file instead of falling back to index.html.
    location ^~ /dashboard/ {
        # root is already set globally; try the file, directory, or the .html variant, otherwise 404
        try_files $uri $uri/ $uri.html =404;
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

    location /live/ {
        try_files $uri $uri/ $uri.html /index.html;
    }
}
EOF_CONF

# Expose documentation only; Render provides actual PORT via env
EXPOSE 80

# Provide a safe default if PORT isn't set (uses 80)
CMD ["sh", "-c", "sed -e \"s/listen 80;/listen ${PORT:-80};/g\" /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
