# Dockerfile - legacy nginx static site for Watchtower UI
FROM nginx:alpine

WORKDIR /usr/share/nginx/html
RUN rm -rf ./*

# Core UI bundle
COPY site ./site

# Repo-root HTML entrypoints and assets
COPY *.html ./
COPY *.glb ./

# Optional packaged experiences
COPY CHAINES.IO-CHAT-codex-fix-footer-not-staying-active-on-scroll ./CHAINES.IO-CHAT-codex-fix-footer-not-staying-active-on-scroll
COPY omconsole ./omconsole
COPY securemobile ./securemobile
