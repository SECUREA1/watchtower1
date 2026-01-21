# RedNode Face Storage (Local | Cloud) + Jetson Multi-Camera

This repo provides a single-file **RedNode dashboard** (`rednode.html`) and a **FastAPI** backend (`app.py`) that stores face images locally and optionally commits them to GitHub. The client uses **IndexedDB (Dexie)** for local storage and can automatically upload to the server when **Cloud** mode is selected.

## Highlights

- **Local + Cloud** storage mode selector in the dashboard settings.
- Automatic, throttled uploads with retry/backoff when Cloud mode is enabled.
- **Opt-in consent** captured automatically when Cloud is selected; sent with every upload.
- Server-side GitHub commits (no client GitHub tokens).
- Optional PR-based ingestion (`GITHUB_PR_FLOW=1`).
- Jetson-friendly multi-camera capture + MJPEG streaming (`/multi-camera`).

---

## Architecture (current)

- **Entry point:** `app.py` (FastAPI server, static UI, ingestion APIs, MJPEG streams).【F:app.py†L1-L371】
- **Camera subsystem:** `camera/` (`discovery.py`, `pipeline.py`, `capture_worker.py`, `manager.py`) builds GStreamer pipelines and runs per-camera capture threads.【F:camera/discovery.py†L1-L95】【F:camera/pipeline.py†L1-L33】【F:camera/capture_worker.py†L1-L112】【F:camera/manager.py†L1-L84】
- **Inference module:** `inference/engine.py` (TensorRT stub + placeholder for CUDA inference integration).【F:inference/engine.py†L1-L40】
- **UI module:** `site/` static HTML, including the multi-camera monitor (`site/multi_camera.html`).【F:site/multi_camera.html†L1-L59】

---

## Server Setup

### Jetson (recommended)

```bash
sudo apt-get update
sudo apt-get install -y \
  python3-venv python3-pip python3-opencv \
  v4l-utils gstreamer1.0-tools gstreamer1.0-plugins-good \
  gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly \
  gstreamer1.0-libav
```

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
| `ADMIN_TOKEN` | Optional API auth token (skipped when `ALLOW_PUBLIC_INGEST=1`) | unset |
| `ALLOW_PUBLIC_INGEST` | Allow unauthenticated uploads (consent assumed on ingest) | `1` |
| `GITHUB_ENABLED` | Enable GitHub ingestion | `0` |
| `GITHUB_TOKEN` | GitHub token (server-only secret) | unset |
| `GITHUB_OWNER` | GitHub org/user | unset |
| `GITHUB_REPO` | GitHub repo | unset |
| `GITHUB_BRANCH` | Target branch | `main` |
| `GITHUB_PR_FLOW` | `1` to open PRs instead of direct commit | `0` |
| `CAMERA_CONFIG` | Path to camera config file | `./config/cameras.yaml` |

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
uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

Check health:

```bash
curl http://localhost:8000/healthz
```

> To expose the UI remotely, bind to `0.0.0.0` and enable authentication (`ADMIN_TOKEN`, `ALLOW_PUBLIC_INGEST=0`). Default is localhost-only.

### Static UI bundle

All frontend assets now live in the repo-level `site/` directory and are served by the FastAPI app via `StaticFiles`. Set `STATIC_DIR` if you need to point to an alternate location inside a container or host.

### Multi-camera UI

Open `http://127.0.0.1:8000/multi-camera` to see all configured camera streams and status.

### Legacy nginx image

The root-level `Dockerfile` builds the former nginx-only static site. Deployment now relies on the combined FastAPI container (see `Dockerfile.api`), but the nginx Dockerfile is retained for reference or bespoke builds.

---

## Camera configuration

Camera pipelines are configured via `config/cameras.yaml` (or set `CAMERA_CONFIG=/path/to/file.yaml`). Example:

```yaml
cameras:
  - id: csi-0
    type: csi
    sensor_id: 0
    width: 1280
    height: 720
    fps: 30
    flip: 0
  - id: csi-1
    type: csi
    sensor_id: 1
    width: 1280
    height: 720
    fps: 30
    flip: 0
  - id: usb-front
    type: usb
    device: /dev/v4l/by-id/usb-Generic_USB_Camera-video-index0
    width: 1280
    height: 720
    fps: 30
    flip: 0
```

---

## Camera enumeration + smoke tests

Enumerate all cameras (CSI + USB/V4L2):

```bash
python scripts/enumerate_cameras.py
```

Run the multi-camera smoke test (30s, prints FPS per camera):

```bash
python scripts/multi_camera_smoke_test.py --config config/cameras.yaml --duration 30
```

---

## Camera troubleshooting (Jetson)

List V4L2 devices:

```bash
v4l2-ctl --list-devices
```

Verify CSI camera (sensor-id 0):

```bash
gst-launch-1.0 nvarguscamerasrc sensor-id=0 ! video/x-raw(memory:NVMM),width=1280,height=720,framerate=30/1 ! nvvidconv ! fakesink -v
```

Verify USB camera (device path):

```bash
gst-launch-1.0 v4l2src device=/dev/video0 ! video/x-raw,width=1280,height=720,framerate=30/1 ! videoconvert ! fakesink -v
```

Performance hints:

```bash
tegrastats
```

If one camera fails, the others continue to stream; check `/api/cameras` for errors.

### GPU acceleration notes

- CSI capture uses `nvarguscamerasrc` + `NVMM` buffers + `nvvidconv`.
- USB capture uses `v4l2src` and `nvvidconv` for GPU-backed conversion.
- Verify GPU usage with `tegrastats` while running `/multi-camera`.

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

> **Important:** The API now defaults to `ALLOW_PUBLIC_INGEST=1` for frictionless demos. Set `ALLOW_PUBLIC_INGEST=0` and configure `ADMIN_TOKEN` in any production deployment.

See [SECURITY_NOTES.md](SECURITY_NOTES.md) for detailed recommendations.
