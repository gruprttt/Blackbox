# syntax=docker/dockerfile:1
# Build context is the parent folder (see docker-compose.yml) so both the
# saved lessons (learn/) and this generator (learn-ui/) are available.

# ── site: generate static pages ─────────────────────────────────────────────
FROM python:3.12-alpine AS build
WORKDIR /src
COPY learn-ui/build.py learn-ui/build.py
COPY learn-ui/assets learn-ui/assets
COPY learn learn
RUN python3 learn-ui/build.py learn /site

# ── api: progress sync (stdlib only, runs as non-root) ───────────────────────
FROM python:3.12-alpine AS api
RUN adduser -D -H -u 10001 blackbox && mkdir /data && chown blackbox /data
COPY learn-ui/server/server.py /app/server.py
USER blackbox
VOLUME /data
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:8000/api/health >/dev/null || exit 1
CMD ["python3", "-u", "/app/server.py", "--port", "8000", "--data", "/data"]

# ── web: nginx serves the site and proxies /api to the api service ───────────
FROM nginx:1.27-alpine AS web
COPY learn-ui/deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /site /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
