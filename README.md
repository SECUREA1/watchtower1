# RedNode Face Storage (Local | Cloud)

This repo provides a single-file **RedNode dashboard** (`rednode.html`) and a **FastAPI** backend (`app.py`) that stores face images locally and optionally commits them to GitHub. The client uses **IndexedDB (Dexie)** for local storage and can automatically upload to the server when **Cloud** mode is selected.

## Highlights

- **Local + Cloud** storage mode selector in the dashboard settings.
- Automatic, throttled uploads with retry/backoff when Cloud mode is enabled.
- **Opt-in consent** captured automatically when Cloud is selected; sent with every upload.
- Server-side GitHub commits (no client GitHub tokens).
- Optional PR-based ingestion (`GITHUB_PR_FLOW=1`).

---

## Server Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Environment Variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `DATA_DIR` | Root folder for stored files/logs | `./data` |
| `MAX_UPLOAD_BYTES` | Upload size cap (bytes) | `2097152` |
| `ADMIN_TOKEN` | API auth token (required unless public ingest) | unset |
| `ALLOW_PUBLIC_INGEST` | Allow unauthenticated uploads (still requires consent) | `0` |
| `GITHUB_ENABLED` | Enable GitHub ingestion | `0` |
| `GITHUB_TOKEN` | GitHub token (server-only secret) | unset |
| `GITHUB_OWNER` | GitHub org/user | unset |
| `GITHUB_REPO` | GitHub repo | unset |
| `GITHUB_BRANCH` | Target branch | `main` |
| `GITHUB_PR_FLOW` | `1` to open PRs instead of direct commit | `0` |

### Example (direct commit)

```bash
export ADMIN_TOKEN=dev-token
export GITHUB_ENABLED=1
export GITHUB_TOKEN=ghp_***
export GITHUB_OWNER=your-org
export GITHUB_REPO=rednode-data
export GITHUB_BRANCH=main
export GITHUB_PR_FLOW=0
```

### Example (public ingest for testing)

```bash
export ALLOW_PUBLIC_INGEST=1
```

> **Security warning:** Do not use `ALLOW_PUBLIC_INGEST=1` in public production environments.

---

## Run the Server

```bash
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

Check health:

```bash
curl http://localhost:8000/healthz
```

---

## Client Usage

Open `rednode.html` in a browser. In **Settings → Face Storage (Local | Cloud)**:

1. Choose **Cloud** for Storage Mode.
2. Enable **Auto-upload**.
3. Click **Capture & Upload Now** to capture a camera frame, or let auto-upload sync pending local records.
4. Use **Sync Local → Cloud** to retry any pending items.

The client keeps a local IndexedDB copy regardless of upload status.

---

## GitHub Commit Flow

When `GITHUB_ENABLED=1`, the server commits image + metadata + `index.json` in a **single Git tree commit**. When `GITHUB_PR_FLOW=1`, the server:

1. Creates a branch `add-face-<uuid>-<timestamp>`
2. Commits the files to that branch
3. Opens a PR and returns its URL

---

## Data Layout

```
DATA_DIR/
  faces/
    images/
    meta/
    index.json
  logs/
    YYYY-MM-DD.jsonl
```

---

## Security Guidance

- Keep `GITHUB_TOKEN` server-side only.
- Set `ALLOW_PUBLIC_INGEST=0` for production.
- Use proper authentication (JWT/session) for uploads.
- Consider object storage (S3/GCS) for images.

See [SECURITY_NOTES.md](SECURITY_NOTES.md) for detailed recommendations.
