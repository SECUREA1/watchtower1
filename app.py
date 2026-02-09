# app.py - GitHub-only RedNode API (complete) — updated UI serving logic
import base64
import hashlib
import json
import logging
import os
import random
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional
from uuid import uuid4

import requests
import cv2
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

# -------------------------------------------------------------------------
# Paths & Environment
# -------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parent

DATA_DIR = Path(os.getenv("DATA_DIR", "/opt/rednode/data")).resolve()
FACES_DIR = DATA_DIR / "faces"
IMAGES_DIR = FACES_DIR / "images"
META_DIR = FACES_DIR / "meta"
INDEX_PATH = FACES_DIR / "index.json"
LOGS_DIR = DATA_DIR / "logs"
PENDING_DIR = DATA_DIR / "pending_commits"

# Prefer an explicit STATIC_DIR, then the repo's bundled site/, and finally
# the container-friendly /app/site location. This avoids "UI not found" when
# running locally without a mounted site directory.
STATIC_DIR_ENV = os.getenv("STATIC_DIR")
STATIC_DIR = (Path(STATIC_DIR_ENV) if STATIC_DIR_ENV else REPO_ROOT / "site").resolve()
if not STATIC_DIR.exists():
    alt_static = Path("/app/site").resolve()
    if alt_static.exists():
        STATIC_DIR = alt_static

# Build list of serve roots in order of preference.
SERVE_ROOTS: List[Path] = []
if STATIC_DIR.exists():
    SERVE_ROOTS.append(STATIC_DIR)
# Always include the repo root so newly added HTML pages in the repository root are served.
SERVE_ROOTS.append(REPO_ROOT)
# Normalize
SERVE_ROOTS = [root.resolve() for root in SERVE_ROOTS]

MAX_UPLOAD_BYTES = int(
    os.getenv("MAX_UPLOAD_BYTES", os.getenv("MAX_IMAGE_SIZE_BYTES", str(2 * 1024 * 1024)))
)
ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp"}

ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")
ALLOW_PUBLIC_INGEST = os.getenv("ALLOW_PUBLIC_INGEST", "1").lower() in {"1", "true", "yes"}

GITHUB_ENABLED = os.getenv("GITHUB_ENABLED", "0").lower() in {"1", "true", "yes"}
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")
GITHUB_OWNER = os.getenv("GITHUB_OWNER", "")
GITHUB_REPO = os.getenv("GITHUB_REPO", "")
GITHUB_BRANCH = os.getenv("GITHUB_BRANCH", "main")
GITHUB_PR_FLOW = os.getenv("GITHUB_PR_FLOW", "0").lower() in {"1", "true", "yes"}

INDEX_LOCK = threading.Lock()

AUTH_COOKIE_NAME = "watchtower_access"
UI_ACCESS_PASSWORD = os.getenv("WATCHTOWER_ACCESS_PASSWORD", "boots")
UI_ACCESS_CODE = os.getenv("WATCHTOWER_ACCESS_CODE", "")
UI_ALLOWED_CONTRACTS = {
    "ethereum": {
        "0x9fC58b9F6f2dE0d35Ebd0A51Dca9d61B3f79a7C1".lower(),
        "0x6A7D512Ea381Ba2F8b01f0b473f8BDF26d5D3A7D".lower(),
    },
    "solana": {
        "9xQeWvG816bUx9EPfQ8N6e7h22JfX5nM2X8fE6GxwQJQ".lower(),
        "4Nd1m8qQhN9Qw5oNFDXL9uBeb5GsyhQ2E31x4n4t4WR4".lower(),
    },
    "cardano": {
        "addr1qxpz7k8r3n2m0u6g6f4w0v3j5t8l8y8w7a9shm0k9n7m9h3l4kz4k8".lower(),
        "addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5n4z9t3gn7j4s2hr6jhn2".lower(),
    },
}

# -------------------------------------------------------------------------
# Logging & FastAPI app
# -------------------------------------------------------------------------
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=getattr(logging, LOG_LEVEL, logging.INFO), format="[%(levelname)s] %(message)s")
logger = logging.getLogger("rednode")

app = FastAPI(title="RedNode Storage API")

# -------------------------------------------------------------------------
# Camera streaming (Jetson multi-camera)
# -------------------------------------------------------------------------
CAMERA_CONFIG_PATH = Path(os.getenv("CAMERA_CONFIG", REPO_ROOT / "config" / "cameras.yaml"))
camera_manager = None
try:
    from camera.manager import CameraManager

    camera_manager = CameraManager.from_config_path(CAMERA_CONFIG_PATH)
except Exception as exc:
    logger.warning("Camera manager disabled: %s", exc)


def _frame_stream(camera_id: str):
    boundary = b"frame"
    while True:
        if not camera_manager:
            time.sleep(0.2)
            continue
        frame = camera_manager.latest_frame(camera_id)
        if frame is None:
            time.sleep(0.02)
            continue
        ret, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
        if not ret:
            time.sleep(0.01)
            continue
        yield (
            b"--" + boundary + b"\r\n"
            b"Content-Type: image/jpeg\r\n\r\n" + buf.tobytes() + b"\r\n"
        )

# CORS
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "")
if ALLOWED_ORIGINS:
    allow_origins_list = [o.strip() for o in ALLOWED_ORIGINS.split(",") if o.strip()]
else:
    allow_origins_list = ["http://localhost:8000"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "img-src 'self' data: blob:; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline'; "
        "connect-src 'self'; "
        "frame-ancestors 'none'; "
    )
    return response


@app.on_event("startup")
def start_camera_manager() -> None:
    if camera_manager:
        camera_manager.start()


@app.on_event("shutdown")
def stop_camera_manager() -> None:
    if camera_manager:
        camera_manager.stop()

# -------------------------------------------------------------------------
# Models
# -------------------------------------------------------------------------
class FaceAddResponse(BaseModel):
    ok: bool
    face_id: str
    image_path: str
    image_url: str
    committed_to_github: bool
    github_commit_sha: Optional[str] = None
    pr_url: Optional[str] = None
    message: Optional[str] = None


class FaceSyncResult(BaseModel):
    face_id: str
    status: str
    image_url: Optional[str] = None
    committed_to_github: Optional[bool] = None
    github_commit_sha: Optional[str] = None
    pr_url: Optional[str] = None
    message: Optional[str] = None


class LogsPayload(BaseModel):
    logs: List[dict] = Field(default_factory=list)
    source_device_id: Optional[str] = None
    captured_at: Optional[str] = None


class UnlockPayload(BaseModel):
    chain: Optional[str] = None
    contract: Optional[str] = None
    wallet: Optional[str] = None
    passphrase: Optional[str] = None
    access_code: Optional[str] = None

# -------------------------------------------------------------------------
# Filesystem helpers
# -------------------------------------------------------------------------
def ensure_dirs() -> None:
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    META_DIR.mkdir(parents=True, exist_ok=True)
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    PENDING_DIR.mkdir(parents=True, exist_ok=True)
    try:
        IMAGES_DIR.chmod(0o700)
        META_DIR.chmod(0o700)
        LOGS_DIR.chmod(0o700)
        PENDING_DIR.chmod(0o700)
    except PermissionError:
        pass


# Ensure filesystem structure exists at startup
ensure_dirs()


def load_index() -> List[dict]:
    if not INDEX_PATH.exists():
        return []
    try:
        return json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        logger.exception("Index JSON corrupted; returning empty index")
        return []


def save_index(index: List[dict]) -> None:
    INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = INDEX_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(index, indent=2, ensure_ascii=False), encoding="utf-8")
    try:
        tmp.replace(INDEX_PATH)
    except Exception:
        INDEX_PATH.write_text(json.dumps(index, indent=2, ensure_ascii=False), encoding="utf-8")
    try:
        INDEX_PATH.chmod(0o600)
    except PermissionError:
        pass

# -------------------------------------------------------------------------
# Encoding helpers
# -------------------------------------------------------------------------
def b64_encode_bytes(data: bytes) -> str:
    return base64.b64encode(data).decode("utf-8")


def b64_decode_bytes(data: str) -> bytes:
    return base64.b64decode(data.encode("utf-8"))

# -------------------------------------------------------------------------
# Auth & validation helpers
# -------------------------------------------------------------------------
def parse_token(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth.split(" ", 1)[1]
    if auth.startswith("Token "):
        return auth.split(" ", 1)[1]
    return auth


def require_admin(request: Request) -> None:
    if ALLOW_PUBLIC_INGEST:
        return
    if not ADMIN_TOKEN:
        return
    token = parse_token(request)
    if token != ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized.")


def require_consent(metadata: dict) -> None:
    if ALLOW_PUBLIC_INGEST:
        return
    consent = metadata.get("consent") is True
    if isinstance(metadata.get("metadata"), dict):
        consent = consent or metadata["metadata"].get("consent") is True
    if not consent:
        raise HTTPException(status_code=400, detail="Consent is required for uploads.")


def validate_upload(content_type: str, data: bytes) -> None:
    if content_type not in ALLOWED_MIME:
        raise HTTPException(status_code=415, detail="Unsupported image type.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Upload exceeds size limit.")


def is_ui_authenticated(request: Request) -> bool:
    token_cookie = request.cookies.get(AUTH_COOKIE_NAME, "")
    if token_cookie == "ok":
        return True
    return False


def _hash_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _is_valid_ui_secret(payload: UnlockPayload) -> bool:
    passphrase = (payload.passphrase or "").strip()
    access_code = (payload.access_code or "").strip()
    if UI_ACCESS_PASSWORD:
        if passphrase == UI_ACCESS_PASSWORD:
            return True
        if passphrase and _hash_text(passphrase) == UI_ACCESS_PASSWORD:
            return True
    if UI_ACCESS_CODE:
        if access_code == UI_ACCESS_CODE:
            return True
        if access_code and _hash_text(access_code) == UI_ACCESS_CODE:
            return True
    return False


def _validate_unlock_payload(payload: UnlockPayload) -> bool:
    chain = (payload.chain or "").strip().lower()
    contract = (payload.contract or "").strip().lower()
    wallet = (payload.wallet or "").strip()
    if not chain or chain not in UI_ALLOWED_CONTRACTS:
        return False
    if not contract or contract not in UI_ALLOWED_CONTRACTS[chain]:
        return False
    if len(wallet) < 10:
        return False
    return _is_valid_ui_secret(payload)


# -------------------------------------------------------------------------
# Static asset helpers (serve repo-root and site/ HTML files)
# -------------------------------------------------------------------------
# Friendly route aliases for long filenames (request paths with or without trailing slash)
HTML_ALIASES = {
    "/slots": "RedNode Slots.html",
    "/blackjack": "RedNode Blackjack — Secure Login.html",
    "/chess": "RedNode Chess — Secure Login.html",
    "/eye-pro": "RedNode — Eye Pro (Fleet XR Console).html",
    "/node-eye": "RedNode — Node Eye Console.html",
    "/abyss": "RedNode.ai — Abyss Pilot (Submarine Viewport HUD).html",
    "/redar": "RedAR + IonEye — Multi-Cam + Face_Object + Sentinel + WebXR.html",
    "/drone-dig": "DRONE DIG + SCOOP — DUAL HAND ISO CONTROLS.html",
    "/gesture-sim": "Rednode Excavation — Gesture Controlled Sim.html",
    "/sentinel-side": "Rednode Sentinel — Drone Dig + Pile + Boom Side View.html",
    "/sentinel-side-full": "Rednode Sentinel — Drone Dig + Pile + Boom Side View (Hands Full Control).html",
    "/excavator-job": "Excavator Job Site — Gesture Driven.html",
    "/excavator-trainer": "Excavator — Terrain Map + Hand-Training Startup Calibration + Micro-Movement Tuner.html",
    "/locked-views": "RedNode — Locked Views Excavator (2-Hand ISO Controls + Sensitivity Tuners).html",
    "/indoor-ops": "RedNode Dashboard — Indoor Ops · Sentinel · Demo.html",
    "/excavator dash": "dadda - Copy - Copy.html",
    "/market": "market.html",
    "/rednode-dashboard-demo": "RedNode Dashboard — Full Demo.html",
    "/ar-dashboard": "RedNode Dashboard — Full Demo.html",
    "/ar-dashboard.html": "RedNode Dashboard — Full Demo.html",
    "/rednode-dashboard": "RedNode Dashboard — Full Demo.html",
    "/rednode-dashboard.html": "RedNode Dashboard — Full Demo.html",
    "/multi-camera": "site/multi_camera.html",
    "/multi-camera.html": "site/multi_camera.html",
    "/omconsole": "site/omconsole_render_single.html",
    "/omconsole.html": "site/omconsole_render_single.html",
    "/omconsole-routing": "site/omconsole_render_single_games_ROUTING.html",
    "/omconsole-routing.html": "site/omconsole_render_single_games_ROUTING.html",
    "/games": "site/games.html",
    "/games.html": "site/games.html",
}

HOME_PATHS = {"/home", "/home.html"}
SECURE_PATHS = {"/secure", "/secure/", "/secure.html"}
REDNODE_PATHS = {"/rednode", "/rednode.html"}
DASHBOARD_PATHS = {"/dashboard", "/dashboard.html", "/dashboard1", "/dashboard1.html"}
CHAINES_PATHS = {
    "/CHAINES.IO-CHAT-codex-fix-footer-not-staying-active-on-scroll",
    "/CHAINES.IO-CHAT-codex-fix-footer-not-staying-active-on-scroll/",
    "/CHAINES.IO-CHAT-codex-fix-footer-not-staying-active-on-scroll/index.html",
}
LIVE_PATHS = {"/live", "/live/", "/live/index.html"}


def _resolve_path(relative: str) -> Optional[Path]:
    """Return a safe, existing path from any configured serve root."""
    clean = relative.lstrip("/\\")
    for base in SERVE_ROOTS:
        candidate = (base / clean).resolve()
        try:
            candidate.relative_to(base)
        except ValueError:
            continue
        if candidate.is_file():
            return candidate
    return None


def serve_file(relative: str) -> Optional[FileResponse]:
    path = _resolve_path(relative)
    if path:
        return FileResponse(str(path))
    return None


def alias_response(url_path: str) -> Optional[FileResponse]:
    alias_key = url_path[:-1] if url_path.endswith("/") and url_path != "/" else url_path
    target = HTML_ALIASES.get(alias_key)
    if not target:
        return None
    return serve_file(target)


@app.get("/api/cameras")
def list_cameras() -> JSONResponse:
    if not camera_manager:
        return JSONResponse({"ok": False, "error": "camera manager not available"}, status_code=503)
    return JSONResponse({"ok": True, "cameras": camera_manager.status()})


@app.get("/api/cameras/{camera_id}/mjpeg")
def stream_camera(camera_id: str) -> StreamingResponse:
    if not camera_manager:
        raise HTTPException(status_code=503, detail="camera manager not available")
    return StreamingResponse(
        _frame_stream(camera_id),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


def build_image_path(face_id: str, content_type: str) -> Path:
    ext = "jpg"
    if content_type == "image/png":
        ext = "png"
    elif content_type == "image/webp":
        ext = "webp"
    return IMAGES_DIR / f"{face_id}.{ext}"

# -------------------------------------------------------------------------
# GitHub helpers (requests only)
# -------------------------------------------------------------------------
def github_headers() -> Dict[str, str]:
    if not GITHUB_TOKEN:
        logger.error("GITHUB_TOKEN is not set")
    return {"Authorization": f"token {GITHUB_TOKEN}", "Accept": "application/vnd.github+json"}


def github_api(path: str) -> str:
    return f"https://api.github.com{path}"


def create_blob(content: bytes) -> str:
    response = requests.post(
        github_api(f"/repos/{GITHUB_OWNER}/{GITHUB_REPO}/git/blobs"),
        headers=github_headers(),
        json={"content": base64.b64encode(content).decode("utf-8"), "encoding": "base64"},
        timeout=20,
    )
    if response.status_code >= 300:
        raise HTTPException(status_code=response.status_code, detail=f"GitHub blob error: {response.text}")
    return response.json()["sha"]


def get_ref_sha(branch: str) -> str:
    response = requests.get(github_api(f"/repos/{GITHUB_OWNER}/{GITHUB_REPO}/git/ref/heads/{branch}"),
                            headers=github_headers(), timeout=20)
    if response.status_code >= 300:
        raise HTTPException(status_code=response.status_code, detail=f"GitHub ref error: {response.text}")
    return response.json()["object"]["sha"]


def get_commit_tree(sha: str) -> str:
    response = requests.get(github_api(f"/repos/{GITHUB_OWNER}/{GITHUB_REPO}/git/commits/{sha}"),
                            headers=github_headers(), timeout=20)
    if response.status_code >= 300:
        raise HTTPException(status_code=response.status_code, detail=f"GitHub commit error: {response.text}")
    return response.json()["tree"]["sha"]


def create_tree(base_tree: str, items: List[dict]) -> str:
    response = requests.post(github_api(f"/repos/{GITHUB_OWNER}/{GITHUB_REPO}/git/trees"),
                             headers=github_headers(), json={"base_tree": base_tree, "tree": items}, timeout=20)
    if response.status_code >= 300:
        raise HTTPException(status_code=response.status_code, detail=f"GitHub tree error: {response.text}")
    return response.json()["sha"]


def create_commit(message: str, tree_sha: str, parents: List[str]) -> str:
    response = requests.post(github_api(f"/repos/{GITHUB_OWNER}/{GITHUB_REPO}/git/commits"),
                             headers=github_headers(), json={"message": message, "tree": tree_sha, "parents": parents},
                             timeout=20)
    if response.status_code >= 300:
        raise HTTPException(status_code=502, detail=f"GitHub commit error: {response.text}")
    return response.json()["sha"]


def update_ref(branch: str, sha: str) -> None:
    response = requests.patch(github_api(f"/repos/{GITHUB_OWNER}/{GITHUB_REPO}/git/refs/heads/{branch}"),
                              headers=github_headers(), json={"sha": sha, "force": False}, timeout=20)
    if response.status_code >= 300:
        raise HTTPException(status_code=502, detail=f"GitHub update ref error: {response.text}")


def create_branch(branch_name: str, base_sha: str) -> None:
    response = requests.post(github_api(f"/repos/{GITHUB_OWNER}/{GITHUB_REPO}/git/refs"),
                             headers=github_headers(), json={"ref": f"refs/heads/{branch_name}", "sha": base_sha},
                             timeout=20)
    if response.status_code == 422 and "Reference already exists" in response.text:
        logger.warning("Branch %s already exists; continuing.", branch_name)
        return
    if response.status_code >= 300:
        raise HTTPException(status_code=502, detail=f"GitHub create branch error: {response.text}")


def open_pull_request(branch_name: str, title: str, body: str) -> str:
    response = requests.post(github_api(f"/repos/{GITHUB_OWNER}/{GITHUB_REPO}/pulls"),
                             headers=github_headers(), json={"title": title, "head": branch_name, "base": GITHUB_BRANCH, "body": body},
                             timeout=20)
    if response.status_code >= 300:
        raise HTTPException(status_code=502, detail=f"GitHub PR error: {response.text}")
    return response.json()["html_url"]


def commit_files_to_github(files: Dict[str, bytes], message: str, branch: Optional[str] = None) -> str:
    if not GITHUB_ENABLED:
        raise HTTPException(status_code=400, detail="GitHub integration disabled.")
    if not (GITHUB_TOKEN and GITHUB_OWNER and GITHUB_REPO):
        raise HTTPException(status_code=503, detail="GitHub configuration missing.")
    branch = branch or GITHUB_BRANCH
    last_exc: Optional[HTTPException] = None
    for attempt in range(1, 5):
        try:
            base_sha = get_ref_sha(branch)
            base_tree = get_commit_tree(base_sha)
            tree_items = []
            for path, content in files.items():
                blob_sha = create_blob(content)
                tree_items.append({"path": path, "mode": "100644", "type": "blob", "sha": blob_sha})
            new_tree = create_tree(base_tree, tree_items)
            commit_sha = create_commit(message, new_tree, [base_sha])
            update_ref(branch, commit_sha)
            if attempt > 1:
                logger.info("GitHub commit succeeded after retry (attempt %s)", attempt)
            return commit_sha
        except HTTPException as exc:
            last_exc = exc
            status = exc.status_code or 500
            transient = status == 429 or status >= 500 or status in (409, 422)
            if not transient or attempt == 4:
                logger.error("Commit attempt %s failed with status %s: %s", attempt, status, exc.detail)
                raise exc
            sleep_time = min(2 ** attempt, 8) + random.uniform(0, 0.5)
            logger.warning("Commit attempt %s failed with status %s (%s); retrying after %.2fs", attempt, status, exc.detail, sleep_time)
            time.sleep(sleep_time)
            continue
    if last_exc:
        raise last_exc
    raise HTTPException(status_code=500, detail="Unknown commit failure.")


def raw_github_url(path: str, branch: Optional[str] = None) -> str:
    branch = branch or GITHUB_BRANCH
    return f"https://raw.githubusercontent.com/{GITHUB_OWNER}/{GITHUB_REPO}/{branch}/{path}"


def process_pending_commits_loop() -> None:
    backoff = 5.0
    while True:
        try:
            if not GITHUB_ENABLED:
                time.sleep(20)
                continue
            pending_files = list(PENDING_DIR.glob("pending-*.json"))
            if not pending_files:
                time.sleep(random.uniform(10, 30))
                continue
            pending_entries = []
            for pending_path in pending_files:
                data = None
                try:
                    data = json.loads(pending_path.read_text(encoding="utf-8"))
                except Exception as exc:
                    logger.error("Failed to read pending commit file %s: %s", pending_path, exc)
                if data is None:
                    continue
                created_at = data.get("created_at")
                try:
                    created_at_dt = datetime.fromisoformat(created_at) if created_at else None
                except Exception:
                    created_at_dt = None
                pending_entries.append((created_at_dt or datetime.utcnow(), pending_path, data))
            for _, pending_path, data in sorted(pending_entries, key=lambda item: item[0]):
                pending_id = data.get("id") or pending_path.stem
                files_payload = data.get("files") or {}
                files_bytes = {path: b64_decode_bytes(content) for path, content in files_payload.items()}
                message = data.get("message") or "Pending commit"
                branch = data.get("branch") or GITHUB_BRANCH
                face_ids = data.get("face_ids") or []
                try:
                    commit_sha = commit_files_to_github(files_bytes, message, branch=branch)
                    pr_url = None
                    if branch != GITHUB_BRANCH and (GITHUB_PR_FLOW or branch != GITHUB_BRANCH):
                        try:
                            pr_url = open_pull_request(branch, title=message, body="Automated face ingestion from RedNode pending queue.")
                        except HTTPException as pr_exc:
                            logger.warning("Pending commit %s: PR creation failed (%s)", pending_id, pr_exc.detail)
                    for face_id in face_ids:
                        image_path = next((p for p in files_payload.keys() if p.startswith("data/faces/images/") and Path(p).stem == face_id), None)
                        github_url = raw_github_url(image_path, branch=branch) if image_path else None
                        update_index_commit_info(face_id, True, commit_sha, github_url, pr_url)
                    pending_path.unlink(missing_ok=True)
                    logger.info("Processed pending commit %s (faces: %s)", pending_id, face_ids)
                    backoff = 5.0
                except HTTPException as exc:
                    status = exc.status_code or 500
                    if status == 429 or status >= 500 or status in (409, 422):
                        logger.warning("Pending commit %s transient failure (%s); will retry later", pending_id, status)
                        time.sleep(min(30, backoff))
                        backoff = min(60.0, backoff * 1.5)
                        continue
                    logger.error("Pending commit %s failed irrecoverably: %s", pending_id, exc.detail)
        except Exception as loop_exc:
            logger.error("Pending commit loop error: %s", loop_exc)
            time.sleep(5)


# Start background worker at import time
threading.Thread(target=process_pending_commits_loop, daemon=True).start()

# -------------------------------------------------------------------------
# Index helpers & ingestion
# -------------------------------------------------------------------------
def prepare_index_record(metadata: dict, image_path: Path, committed: bool, github_sha: Optional[str], github_url: Optional[str], pr_url: Optional[str]) -> dict:
    storage_value = (metadata.get("storage") or "server").lower()
    return {
        "id": metadata.get("id"),
        "name": metadata.get("name"),
        "created_at": metadata.get("created_at"),
        "metadata": metadata.get("metadata", {}),
        "consent": metadata.get("consent"),
        "consent_timestamp": metadata.get("consent_timestamp"),
        "storage": storage_value,
        "local_path": str(image_path.relative_to(DATA_DIR)),
        "server_url": metadata.get("image_url") or f"/api/faces/image/{metadata.get('id')}",
        "committed_to_github": committed,
        "github_commit_sha": github_sha,
        "github_url": github_url,
        "pr_url": pr_url,
        "device_id": metadata.get("device_id"),
        "source": metadata.get("source"),
    }


def ingest_file(content: bytes, content_type: str, metadata: dict) -> dict:
    validate_upload(content_type, content)
    # consent will be enforced by caller when needed
    face_id = metadata.get("id") or str(uuid4())
    metadata["id"] = face_id
    metadata.setdefault("created_at", datetime.utcnow().isoformat())
    image_path = build_image_path(face_id, content_type)
    meta_path = META_DIR / f"{face_id}.json"
    image_path.write_bytes(content)
    meta_path.write_text(json.dumps(metadata, indent=2, ensure_ascii=False), encoding="utf-8")
    try:
        image_path.chmod(0o600)
        meta_path.chmod(0o600)
    except PermissionError:
        pass
    return {"face_id": face_id, "image_path": image_path, "meta_path": meta_path, "metadata": metadata}


def update_index_with_record(record: dict, committed: bool, github_sha: Optional[str], github_url: Optional[str], pr_url: Optional[str]) -> dict:
    index_record = prepare_index_record(record["metadata"], record["image_path"], committed, github_sha, github_url, pr_url)
    with INDEX_LOCK:
        index = load_index()
        existing = next((item for item in index if item.get("id") == record["face_id"]), None)
        if existing:
            return existing
        index.append(index_record)
        save_index(index)
    return index_record


def update_index_commit_info(face_id: str, committed: bool, github_sha: Optional[str], github_url: Optional[str], pr_url: Optional[str]) -> None:
    with INDEX_LOCK:
        index = load_index()
        for item in index:
            if item.get("id") == face_id:
                item["committed_to_github"] = committed
                item["github_commit_sha"] = github_sha
                item["github_url"] = github_url
                item["pr_url"] = pr_url
                save_index(index)
                break


def face_exists(face_id: str) -> Optional[dict]:
    with INDEX_LOCK:
        index = load_index()
    return next((item for item in index if item.get("id") == face_id), None)


def enqueue_pending_commit(files: Dict[str, bytes], message: str, branch: Optional[str], face_ids: List[str]) -> None:
    ensure_dirs()
    pending_id = str(uuid4())
    created_at = datetime.utcnow().isoformat()
    payload = {
        "id": pending_id,
        "created_at": created_at,
        "message": message,
        "branch": branch,
        "face_ids": face_ids,
        "files": {path: b64_encode_bytes(content) for path, content in files.items()},
    }
    filename = f"pending-{int(time.time())}-{pending_id}.json"
    pending_path = PENDING_DIR / filename
    pending_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    try:
        pending_path.chmod(0o600)
    except PermissionError:
        pass
    logger.info("Enqueued pending commit %s for faces: %s", pending_id, face_ids)


def commit_to_github(files: Dict[str, bytes], face_id: str, prefer_pr: bool = False, face_ids: Optional[List[str]] = None, branch: Optional[str] = None) -> Dict[str, Optional[str]]:
    if not GITHUB_ENABLED:
        return {"committed": False, "sha": None, "pr_url": None, "branch": branch or GITHUB_BRANCH, "message": "GitHub disabled"}
    face_ids_list = face_ids if face_ids is not None else [face_id]
    use_pr = GITHUB_PR_FLOW or prefer_pr
    message = f"Add face {face_ids_list[0]}"
    branch_name = branch or (f"add-face-{face_ids_list[0]}-{int(datetime.utcnow().timestamp())}" if use_pr else GITHUB_BRANCH)
    if not (GITHUB_TOKEN and GITHUB_OWNER and GITHUB_REPO):
        logger.warning("GitHub not configured; enqueued commit for later delivery.")
        enqueue_pending_commit(files, message, branch_name, face_ids_list)
        return {"committed": False, "sha": None, "pr_url": None, "branch": branch_name, "message": "Stored locally; commit queued"}
    try:
        if use_pr:
            base_sha = get_ref_sha(GITHUB_BRANCH)
            create_branch(branch_name, base_sha)
            commit_sha = commit_files_to_github(files, message, branch=branch_name)
            pr_url = open_pull_request(branch_name, title=f"Add face {face_ids_list[0]}", body="Automated face ingestion from RedNode sync.")
            return {"committed": True, "sha": commit_sha, "pr_url": pr_url, "branch": branch_name, "message": None}
        commit_sha = commit_files_to_github(files, message, branch=branch_name)
        return {"committed": True, "sha": commit_sha, "pr_url": None, "branch": branch_name, "message": None}
    except HTTPException as exc:
        logger.error("GitHub commit failed: %s", exc.detail)
        enqueue_pending_commit(files, message, branch_name, face_ids_list)
        return {"committed": False, "sha": None, "pr_url": None, "branch": branch_name, "message": "Commit queued"}

# -------------------------------------------------------------------------
# Routes (API)
# -------------------------------------------------------------------------
@app.post("/api/faces/add", response_model=FaceAddResponse)
async def add_face(request: Request, image: UploadFile = File(...), metadata: str = Form(...)):
    ensure_dirs()
    if not ALLOW_PUBLIC_INGEST:
        require_admin(request)
    content = await image.read()
    try:
        metadata_obj = json.loads(metadata)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid metadata JSON.")
    # per-upload storage: local | server | server_review
    upload_storage = (metadata_obj.get("storage") or "server").lower()
    # require consent only for server/cloud uploads
    if upload_storage in ("server", "server_review"):
        require_consent(metadata_obj)
    # ingest (saves local copy)
    record = ingest_file(content, image.content_type or "image/jpeg", metadata_obj)
    index_record = update_index_with_record(record, False, None, None, None)
    logger.info("Stored face %s from device %s", record["face_id"], metadata_obj.get("device_id"))
    # ensure metadata has server_url
    metadata_obj["image_url"] = f"/api/faces/image/{record['face_id']}"
    # prepare commit files (images + meta + index)
    files_to_commit = {
        f"data/faces/images/{record['image_path'].name}": record["image_path"].read_bytes(),
        f"data/faces/meta/{record['meta_path'].name}": record["meta_path"].read_bytes(),
        "data/faces/index.json": INDEX_PATH.read_bytes(),
    }
    committed_to_github = False
    github_commit_sha = None
    pr_url = None
    github_url = None
    response_message = "Face stored successfully."
    prefer_pr = (upload_storage == "server_review")
    if GITHUB_ENABLED:
        commit_info = commit_to_github(files_to_commit, record["face_id"], prefer_pr=prefer_pr)
        committed_to_github = commit_info["committed"]
        github_commit_sha = commit_info["sha"]
        pr_url = commit_info["pr_url"]
        response_message = commit_info.get("message") or response_message
        if committed_to_github:
            github_url = raw_github_url(f"data/faces/images/{record['image_path'].name}", branch=commit_info["branch"] or GITHUB_BRANCH)
            update_index_commit_info(record["face_id"], committed_to_github, github_commit_sha, github_url, pr_url)
            logger.info("Committed face %s to GitHub", record["face_id"])
        else:
            logger.info("Face %s stored locally; commit queued.", record["face_id"])
    image_url = github_url or index_record.get("server_url")
    return FaceAddResponse(ok=True, face_id=record["face_id"], image_path=str(record["image_path"].relative_to(DATA_DIR)), image_url=image_url, committed_to_github=committed_to_github, github_commit_sha=github_commit_sha, pr_url=pr_url, message=response_message)

@app.post("/api/faces/sync")
async def sync_faces(request: Request, images: Optional[List[UploadFile]] = File(None), metadata: Optional[str] = Form(None)):
    ensure_dirs()
    if not ALLOW_PUBLIC_INGEST:
        require_admin(request)
    results: List[FaceSyncResult] = []
    files_to_commit: Dict[str, bytes] = {}
    created_face_ids: List[str] = []
    image_name_map: Dict[str, str] = {}
    content_type = request.headers.get("content-type", "")
    if content_type.startswith("application/json"):
        payload = await request.json()
        if not isinstance(payload, list):
            raise HTTPException(status_code=400, detail="Expected JSON array payload.")
        for item in payload:
            upload_storage = (item.get("storage") or "server").lower()
            if upload_storage in ("server", "server_review"):
                require_consent(item)
            face_id = item.get("id") or str(uuid4())
            existing = face_exists(face_id)
            if existing:
                results.append(FaceSyncResult(face_id=face_id, status="exists", image_url=existing.get("server_url")))
                continue
            item["id"] = face_id
            image_bytes = base64.b64decode(item.get("image_base64", "").split(",")[-1])
            validate_upload("image/jpeg", image_bytes)
            record = ingest_file(image_bytes, "image/jpeg", item)
            update_index_with_record(record, False, None, None, None)
            results.append(FaceSyncResult(face_id=record["face_id"], status="created"))
            files_to_commit[f"data/faces/images/{record['image_path'].name}"] = image_bytes
            files_to_commit[f"data/faces/meta/{record['meta_path'].name}"] = record["meta_path"].read_bytes()
            created_face_ids.append(record["face_id"])
            image_name_map[record["face_id"]] = record["image_path"].name
    else:
        if not images or not metadata:
            raise HTTPException(status_code=400, detail="Missing multipart images or metadata.")
        try:
            metadata_list = json.loads(metadata)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid metadata JSON.")
        if not isinstance(metadata_list, list):
            raise HTTPException(status_code=400, detail="Metadata must be a list.")
        for idx, upload in enumerate(images):
            content = await upload.read()
            meta = metadata_list[min(idx, len(metadata_list) - 1)]
            upload_storage = (meta.get("storage") or "server").lower()
            if upload_storage in ("server", "server_review"):
                require_consent(meta)
            face_id = meta.get("id") or str(uuid4())
            existing = face_exists(face_id)
            if existing:
                results.append(FaceSyncResult(face_id=face_id, status="exists", image_url=existing.get("server_url")))
                continue
            meta["id"] = face_id
            validate_upload(upload.content_type, content)
            record = ingest_file(content, upload.content_type, meta)
            update_index_with_record(record, False, None, None, None)
            results.append(FaceSyncResult(face_id=record["face_id"], status="created"))
            files_to_commit[f"data/faces/images/{record['image_path'].name}"] = content
            files_to_commit[f"data/faces/meta/{record['meta_path'].name}"] = record["meta_path"].read_bytes()
            created_face_ids.append(record["face_id"])
            image_name_map[record["face_id"]] = record["image_path"].name
    if files_to_commit and GITHUB_ENABLED:
        files_to_commit["data/faces/index.json"] = INDEX_PATH.read_bytes()
        # prefer PR if global PR flow or if metadata requested review
        prefer_pr = GITHUB_PR_FLOW
        commit_info = commit_to_github(files_to_commit, created_face_ids[0], prefer_pr=prefer_pr, face_ids=created_face_ids)
        for face_id in created_face_ids:
            image_key = image_name_map.get(face_id, f"{face_id}.jpg")
            if commit_info["committed"]:
                github_url = raw_github_url(f"data/faces/images/{image_key}", branch=commit_info["branch"] or GITHUB_BRANCH)
                update_index_commit_info(face_id, commit_info["committed"], commit_info["sha"], github_url, commit_info["pr_url"])
        for result in results:
            result.committed_to_github = commit_info["committed"]
            result.github_commit_sha = commit_info["sha"]
            result.pr_url = commit_info["pr_url"]
            if not commit_info["committed"]:
                result.message = commit_info.get("message") or "Commit queued"
    return {"ok": True, "synced": [result.dict() for result in results]}

@app.get("/api/faces/list")
async def list_faces(request: Request):
    with INDEX_LOCK:
        index = load_index()
    return {"ok": True, "faces": index}

@app.get("/api/faces/image/{face_id}")
async def get_face_image(face_id: str):
    with INDEX_LOCK:
        index = load_index()
    record = next((item for item in index if item.get("id") == face_id), None)
    for ext in ("jpg", "png", "webp"):
        path = IMAGES_DIR / f"{face_id}.{ext}"
        if path.exists():
            return FileResponse(path)
    if record and record.get("github_url"):
        return RedirectResponse(record["github_url"])
    raise HTTPException(status_code=404, detail="Face image not found.")

@app.post("/api/logs/add")
async def add_logs(payload: LogsPayload, request: Request):
    if not ALLOW_PUBLIC_INGEST:
        require_admin(request)
    if not payload.logs:
        raise HTTPException(status_code=400, detail="No logs provided.")
    ensure_dirs()
    date_key = datetime.utcnow().strftime("%Y-%m-%d")
    log_path = LOGS_DIR / f"{date_key}.jsonl"
    with log_path.open("a", encoding="utf-8") as handle:
        for entry in payload.logs:
            entry["source_device_id"] = payload.source_device_id
            entry["captured_at"] = payload.captured_at or datetime.utcnow().isoformat()
            handle.write(json.dumps(entry) + "\n")
    return {"ok": True, "count": len(payload.logs), "path": str(log_path.relative_to(DATA_DIR))}

@app.get("/healthz")
async def healthz():
    return {"ok": True}

@app.get("/health")
async def health():
    return {"ok": True}


@app.get("/api/session/status")
async def session_status(request: Request):
    return {"ok": True, "authenticated": is_ui_authenticated(request)}


@app.post("/api/session/unlock")
async def session_unlock(payload: UnlockPayload):
    if not _validate_unlock_payload(payload):
        raise HTTPException(status_code=401, detail="Invalid unlock credentials.")
    response = JSONResponse({"ok": True, "authenticated": True})
    response.set_cookie(
        AUTH_COOKIE_NAME,
        "ok",
        httponly=True,
        samesite="lax",
        secure=False,
    )
    return response


@app.post("/api/session/logout")
async def session_logout():
    response = JSONResponse({"ok": True})
    response.delete_cookie(AUTH_COOKIE_NAME)
    return response

# -------------------------------------------------------------------------
# Optional static mount for site/static (improves performance for common assets)
# If your build places assets at site/static/ then this mount will serve them.
# We still keep the dynamic fallback route below so repo-root HTMLs and other
# special aliases are resolved correctly.
# -------------------------------------------------------------------------
if STATIC_DIR.exists():
    static_assets_dir = STATIC_DIR / "static"
    if static_assets_dir.exists():
        app.mount("/static", StaticFiles(directory=str(static_assets_dir)), name="static_assets")


def _fallback_ui() -> Optional[FileResponse]:
    """Return a usable UI when the requested path is missing."""
    for candidate in ("start.html", "index.html", "rednode.html"):
        response = serve_file(candidate)
        if response:
            return response
    return None


@app.get("/{full_path:path}", response_class=HTMLResponse)
async def serve_frontend(full_path: str, request: Request):
    url_path = request.url.path
    if request.method not in {"GET", "HEAD"}:
        raise HTTPException(status_code=404, detail="Not found")

    if url_path not in {"/", "/index.html", "/start", "/start.html"} and not is_ui_authenticated(request):
        return RedirectResponse(url="/start.html", status_code=302)

    # Prefer a modern landing page
    if url_path in {"/", "/index.html"}:
        if serve_file("start.html"):
            return RedirectResponse(url="/start.html", status_code=302)

    if url_path in {"/start", "/start.html"}:
        response = serve_file("start.html")
        if response:
            return response

    # Short-hand, friendly routes
    if url_path in HOME_PATHS:
        response = serve_file("home.html")
        if response:
            return response

    if url_path in SECURE_PATHS:
        response = serve_file("secure.html")
        if response:
            return response

    if url_path in REDNODE_PATHS:
        response = serve_file("rednode.html")
        if response:
            return response

    if url_path in DASHBOARD_PATHS:
        response = serve_file("dashboard1.html")
        if response:
            return response

    if url_path in CHAINES_PATHS:
        response = serve_file("CHAINES.IO-CHAT-codex-fix-footer-not-staying-active-on-scroll/index.html")
        if response:
            return response

    if url_path in LIVE_PATHS:
        response = serve_file("live/index.html")
        if response:
            return response

    # Alias handling for friendly extensionless routes (e.g. /ar-dashboard)
    alias_resp = alias_response(url_path)
    if alias_resp:
        return alias_resp

    # Serve repo-root and site files directly when possible.
    if full_path:
        direct_response = serve_file(full_path)
        if direct_response:
            return direct_response
        # Allow extensionless routes to resolve to .html files
        if not Path(full_path).suffix:
            html_response = serve_file(f"{full_path}.html")
            if html_response:
                return html_response

    # If nothing matched, fall back to a usable UI if available (spa/index/rednode)
    fallback = _fallback_ui()
    if fallback:
        return fallback

    raise HTTPException(status_code=404, detail="Not found")


@app.exception_handler(404)
async def spa_fallback_handler(request: Request, exc: HTTPException):
    path = request.url.path
    if path.startswith("/api") or path in {"/healthz", "/health"}:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

    if not is_ui_authenticated(request):
        return RedirectResponse(url="/start.html", status_code=302)

    fallback = _fallback_ui()
    if fallback:
        return fallback
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
