# app.py - GitHub-only RedNode API (complete)
import base64
import json
import logging
import os
import threading
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional
from uuid import uuid4

import requests
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, JSONResponse
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

# Prefer an explicit STATIC_DIR, then the repo's bundled site/, and finally
# the container-friendly /app/site location. This avoids "UI not found" when
# running locally without a mounted site directory.
STATIC_DIR_ENV = os.getenv("STATIC_DIR")
STATIC_DIR = (Path(STATIC_DIR_ENV) if STATIC_DIR_ENV else REPO_ROOT / "site").resolve()
if not STATIC_DIR.exists():
    alt_static = Path("/app/site").resolve()
    if alt_static.exists():
        STATIC_DIR = alt_static

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

# -------------------------------------------------------------------------
# Logging & FastAPI app
# -------------------------------------------------------------------------
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=getattr(logging, LOG_LEVEL, logging.INFO), format="[%(levelname)s] %(message)s")
logger = logging.getLogger("rednode")

app = FastAPI(title="RedNode Storage API")

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


class LogsPayload(BaseModel):
    logs: List[dict] = Field(default_factory=list)
    source_device_id: Optional[str] = None
    captured_at: Optional[str] = None

# -------------------------------------------------------------------------
# Filesystem helpers
# -------------------------------------------------------------------------
def ensure_dirs() -> None:
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    META_DIR.mkdir(parents=True, exist_ok=True)
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    try:
        IMAGES_DIR.chmod(0o700)
        META_DIR.chmod(0o700)
        LOGS_DIR.chmod(0o700)
    except PermissionError:
        pass


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
        raise HTTPException(status_code=502, detail=f"GitHub blob error: {response.text}")
    return response.json()["sha"]


def get_ref_sha(branch: str) -> str:
    response = requests.get(github_api(f"/repos/{GITHUB_OWNER}/{GITHUB_REPO}/git/ref/heads/{branch}"),
                            headers=github_headers(), timeout=20)
    if response.status_code >= 300:
        raise HTTPException(status_code=502, detail=f"GitHub ref error: {response.text}")
    return response.json()["object"]["sha"]


def get_commit_tree(sha: str) -> str:
    response = requests.get(github_api(f"/repos/{GITHUB_OWNER}/{GITHUB_REPO}/git/commits/{sha}"),
                            headers=github_headers(), timeout=20)
    if response.status_code >= 300:
        raise HTTPException(status_code=502, detail=f"GitHub commit error: {response.text}")
    return response.json()["tree"]["sha"]


def create_tree(base_tree: str, items: List[dict]) -> str:
    response = requests.post(github_api(f"/repos/{GITHUB_OWNER}/{GITHUB_REPO}/git/trees"),
                             headers=github_headers(), json={"base_tree": base_tree, "tree": items}, timeout=20)
    if response.status_code >= 300:
        raise HTTPException(status_code=502, detail=f"GitHub tree error: {response.text}")
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
        raise HTTPException(status_code=500, detail="GitHub configuration missing.")
    branch = branch or GITHUB_BRANCH
    base_sha = get_ref_sha(branch)
    base_tree = get_commit_tree(base_sha)
    tree_items = []
    for path, content in files.items():
        blob_sha = create_blob(content)
        tree_items.append({"path": path, "mode": "100644", "type": "blob", "sha": blob_sha})
    new_tree = create_tree(base_tree, tree_items)
    commit_sha = create_commit(message, new_tree, [base_sha])
    update_ref(branch, commit_sha)
    return commit_sha


def raw_github_url(path: str, branch: Optional[str] = None) -> str:
    branch = branch or GITHUB_BRANCH
    return f"https://raw.githubusercontent.com/{GITHUB_OWNER}/{GITHUB_REPO}/{branch}/{path}"

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


def commit_to_github(files: Dict[str, bytes], face_id: str, prefer_pr: bool = False) -> Dict[str, Optional[str]]:
    if not GITHUB_ENABLED:
        return {"committed": False, "sha": None, "pr_url": None, "branch": None}
    use_pr = GITHUB_PR_FLOW or prefer_pr
    message = f"Add face {face_id}"
    if use_pr:
        branch_name = f"add-face-{face_id}-{int(datetime.utcnow().timestamp())}"
        base_sha = get_ref_sha(GITHUB_BRANCH)
        create_branch(branch_name, base_sha)
        commit_sha = commit_files_to_github(files, message, branch=branch_name)
        pr_url = open_pull_request(branch_name, title=f"Add face {face_id}", body="Automated face ingestion from RedNode sync.")
        return {"committed": True, "sha": commit_sha, "pr_url": pr_url, "branch": branch_name}
    commit_sha = commit_files_to_github(files, message)
    return {"committed": True, "sha": commit_sha, "pr_url": None, "branch": GITHUB_BRANCH}

# -------------------------------------------------------------------------
# Routes
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
    prefer_pr = (upload_storage == "server_review")
    if GITHUB_ENABLED:
        try:
            commit_info = commit_to_github(files_to_commit, record["face_id"], prefer_pr=prefer_pr)
            committed_to_github = commit_info["committed"]
            github_commit_sha = commit_info["sha"]
            pr_url = commit_info["pr_url"]
            github_url = raw_github_url(f"data/faces/images/{record['image_path'].name}", branch=commit_info["branch"] or GITHUB_BRANCH)
            update_index_commit_info(record["face_id"], committed_to_github, github_commit_sha, github_url, pr_url)
            logger.info("Committed face %s to GitHub", record["face_id"])
        except HTTPException as exc:
            logger.error("GitHub commit failed: %s", exc.detail)
            raise
    image_url = github_url or index_record.get("server_url")
    return FaceAddResponse(ok=True, face_id=record["face_id"], image_path=str(record["image_path"].relative_to(DATA_DIR)), image_url=image_url, committed_to_github=committed_to_github, github_commit_sha=github_commit_sha, pr_url=pr_url, message="Face stored successfully.")

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
        try:
            # prefer PR if global PR flow or if metadata requested review
            prefer_pr = GITHUB_PR_FLOW
            commit_info = commit_to_github(files_to_commit, created_face_ids[0], prefer_pr=prefer_pr)
            for face_id in created_face_ids:
                github_url = raw_github_url(f"data/faces/images/{image_name_map.get(face_id, f'{face_id}.jpg')}", branch=commit_info["branch"] or GITHUB_BRANCH)
                update_index_commit_info(face_id, commit_info["committed"], commit_info["sha"], github_url, commit_info["pr_url"])
            for result in results:
                result.committed_to_github = commit_info["committed"]
                result.github_commit_sha = commit_info["sha"]
                result.pr_url = commit_info["pr_url"]
        except HTTPException as exc:
            logger.error("GitHub commit failed during sync: %s", exc.detail)
            raise
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

if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
else:

    @app.get("/", response_class=HTMLResponse)
    def index_missing():
        return "<html><body><h1>RedNode UI not found</h1></body></html>"


@app.get("/{full_path:path}", response_class=HTMLResponse)
async def spa_fallback(full_path: str):
    fallback = STATIC_DIR / "rednode.html"
    if fallback.exists():
        return FileResponse(str(fallback))
    fallback2 = STATIC_DIR / "index.html"
    if fallback2.exists():
        return FileResponse(str(fallback2))
    raise HTTPException(status_code=404, detail="Not found")


@app.exception_handler(404)
async def spa_fallback_handler(request: Request, exc: HTTPException):
    path = request.url.path
    if path.startswith("/api") or path in {"/healthz", "/health"}:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    try:
        return await spa_fallback(path.lstrip("/"))
    except HTTPException as inner_exc:
        return JSONResponse(status_code=inner_exc.status_code, content={"detail": inner_exc.detail})
