# RedNode Storage & Sync Server (FastAPI)

This server powers RedNode's **local/server storage** flow for face images and recognition logs. It supports:

- Local server-side storage under `DATA_DIR`.
- Optional GitHub commit or PR-based ingestion.
- Auth via a dev `ADMIN_TOKEN` (easy to replace with JWT/session auth).
- Batch log ingestion for recognition events.

## Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Configuration

Set these environment variables as needed:

| Variable | Purpose | Default |
| --- | --- | --- |
| `DATA_DIR` | Root folder for stored files/logs | `./data` |
| `MAX_UPLOAD_BYTES` | Upload size cap (bytes) | `2097152` |
| `ADMIN_TOKEN` | Dev auth token for API access | unset (auth disabled) |
| `GITHUB_ENABLED` | Enable GitHub ingestion | `0` |
| `GITHUB_TOKEN` | GitHub token (server-only secret) | unset |
| `GITHUB_OWNER` | GitHub org/user | unset |
| `GITHUB_REPO` | GitHub repo | unset |
| `GITHUB_BRANCH` | Target branch | `main` |
| `GITHUB_PR_FLOW` | `1` to open PRs instead of direct commit | `0` |

### Example

```bash
export ADMIN_TOKEN=dev-token
export GITHUB_ENABLED=1
export GITHUB_TOKEN=ghp_***
export GITHUB_OWNER=your-org
export GITHUB_REPO=rednode-data
export GITHUB_BRANCH=main
export GITHUB_PR_FLOW=1
```

## Run

```bash
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

## API Overview

- `POST /api/faces/add` — store a face image + metadata (multipart form)
- `GET /api/faces/list` — list faces index
- `GET /api/faces/image/{face_id}` — serve or redirect to stored image
- `POST /api/faces/sync` — batch ingest base64 faces
- `POST /api/logs/add` — append logs to daily JSONL files

## Client Integration

Open `secure.html` in a browser. The new **Storage & Sync** panel lets you:

- Choose global default storage (Local vs Server).
- Select per-upload storage.
- Provide consent for server uploads.
- Save faces/logs and sync local records to the server.

The client only uses `ADMIN_TOKEN` or a JWT **you provide**. The GitHub token is **never** exposed in the browser.

## Data Layout

```
DATA_DIR/
  faces/
    images/
    meta/
    index.json
  logs/
    2024-04-23.jsonl
```

See `EXAMPLE_RESPONSES.md` for example payloads.
