# Render streaming environment checklist

This checklist documents the environment variables needed for Watchtower streaming on Render, and confirms the runtime paths used by each service.

## Services in `render.yaml`

- `watchtower-ws`: Node WebSocket relay (`ws-server/server.js`)
- `watchtower-api`: FastAPI app + MJPEG camera endpoints (`app.py`)

## Required variables for baseline streaming

### `watchtower-ws`

| Variable | Required | Why it matters |
| --- | --- | --- |
| `PORT` | Yes (Render injects automatically) | HTTP + WebSocket listener bind port (`process.env.PORT`). |
| `DB_PATH` | Yes | SQLite persistence path for chat/history loaded at startup. |

### `watchtower-api`

| Variable | Required | Why it matters |
| --- | --- | --- |
| `PORT` | Yes (Render injects automatically) | Uvicorn bind port in container command. |
| `DATA_DIR` | Yes | Base directory for face data, logs, and pending commits. |
| `STATIC_DIR` | Yes | Ensures UI assets are served from repo root in Render image. |
| `CAMERA_CONFIG` | Recommended for deterministic streaming | Explicit camera config for `/multi-camera` and `/stream/{camera_id}` endpoints. |

## Required variables for cloud/GitHub ingest (if enabled)

If `GITHUB_ENABLED=1`, all three must be set:

- `GITHUB_TOKEN`
- `GITHUB_OWNER`
- `GITHUB_REPO`

`GITHUB_BRANCH` and `GITHUB_PR_FLOW` are optional controls (both have defaults).

## Optional but commonly needed runtime variables

- `ALLOWED_ORIGINS`: Set this to your Render domains to allow browser cross-origin requests safely.
- `ADMIN_TOKEN` and/or `ALLOW_PUBLIC_INGEST`: Choose one auth posture for ingest APIs.
- `WATCHTOWER_ACCESS_PASSWORD`, `WATCHTOWER_ACCESS_CODE`: UI unlock controls.
- `LOG_LEVEL`: Runtime logging verbosity.

## Path validation summary

Render blueprint paths are consistent after this review:

- `watchtower-ws` Dockerfile exists at `./ws-server/Dockerfile`.
- `watchtower-api` Dockerfile exists at `./Dockerfile.api`.
- `DB_PATH` points to `/opt/watchtower/data/app.db` and ws image now prepares `/opt/watchtower/data`.
- `DATA_DIR` points to `/opt/watchtower/data` for API persistence.
- `STATIC_DIR` points to `/app` (repo copied into image), so root HTML pages and `site/*` are both available.
- `CAMERA_CONFIG` points to `/app/config/cameras.yaml`.
