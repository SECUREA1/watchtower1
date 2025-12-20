import base64
import json
import os
import threading
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional
from uuid import uuid4

import requests
from fastapi import Body, Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel, Field

DATA_DIR = Path(os.getenv('DATA_DIR', './data')).resolve()
FACES_DIR = DATA_DIR / 'faces'
IMAGES_DIR = FACES_DIR / 'images'
META_DIR = FACES_DIR / 'meta'
INDEX_PATH = FACES_DIR / 'index.json'
LOGS_DIR = DATA_DIR / 'logs'

MAX_UPLOAD_BYTES = int(os.getenv('MAX_UPLOAD_BYTES', str(2 * 1024 * 1024)))
ALLOWED_MIME = {'image/jpeg', 'image/png', 'image/webp'}

ADMIN_TOKEN = os.getenv('ADMIN_TOKEN', '')

GITHUB_ENABLED = os.getenv('GITHUB_ENABLED', '0').lower() in {'1', 'true', 'yes'}
GITHUB_TOKEN = os.getenv('GITHUB_TOKEN', '')
GITHUB_OWNER = os.getenv('GITHUB_OWNER', '')
GITHUB_REPO = os.getenv('GITHUB_REPO', '')
GITHUB_BRANCH = os.getenv('GITHUB_BRANCH', 'main')
GITHUB_PR_FLOW = os.getenv('GITHUB_PR_FLOW', '0').lower() in {'1', 'true', 'yes'}

INDEX_LOCK = threading.Lock()

app = FastAPI(title='RedNode Storage API')

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


class FaceSyncItem(BaseModel):
    id: str
    name: Optional[str] = None
    created_at: str
    metadata: dict = Field(default_factory=dict)
    storage: Optional[str] = 'local'
    source_device_id: Optional[str] = None
    image_base64: str


class LogsPayload(BaseModel):
    logs: List[dict] = Field(default_factory=list)
    source_device_id: Optional[str] = None
    captured_at: Optional[str] = None


class FaceAddResponse(BaseModel):
    face_id: str
    image_url: str
    committed_to_github: bool
    github_commit_sha: Optional[str] = None
    github_pr_url: Optional[str] = None


def ensure_dirs() -> None:
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    META_DIR.mkdir(parents=True, exist_ok=True)
    LOGS_DIR.mkdir(parents=True, exist_ok=True)


ensure_dirs()


def load_index() -> List[dict]:
    if not INDEX_PATH.exists():
        return []
    try:
        return json.loads(INDEX_PATH.read_text())
    except json.JSONDecodeError:
        return []


def save_index(index: List[dict]) -> None:
    INDEX_PATH.write_text(json.dumps(index, indent=2))


def require_auth(request: Request):
    if not ADMIN_TOKEN:
        return None
    auth = request.headers.get('Authorization', '')
    if auth.startswith('Bearer '):
        token = auth.split(' ', 1)[1]
    elif auth.startswith('Token '):
        token = auth.split(' ', 1)[1]
    else:
        token = auth

    if token != ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail='Unauthorized')
    return True


def validate_metadata(metadata: dict) -> None:
    consent = False
    if isinstance(metadata.get('metadata'), dict):
        consent = metadata['metadata'].get('consent') is True
    consent = consent or metadata.get('consent') is True
    if not consent:
        raise HTTPException(status_code=400, detail='Consent is required for server uploads.')


def validate_upload(content_type: str, data: bytes) -> None:
    if content_type not in ALLOWED_MIME:
        raise HTTPException(status_code=415, detail='Unsupported image type.')
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail='Upload exceeds size limit.')


def build_image_path(face_id: str, content_type: str) -> Path:
    ext = 'jpg'
    if content_type == 'image/png':
        ext = 'png'
    elif content_type == 'image/webp':
        ext = 'webp'
    return IMAGES_DIR / f'{face_id}.{ext}'


def github_headers() -> Dict[str, str]:
    return {
        'Authorization': f'token {GITHUB_TOKEN}',
        'Accept': 'application/vnd.github+json',
    }


def github_api(path: str) -> str:
    return f'https://api.github.com{path}'


def create_blob(content: bytes) -> str:
    response = requests.post(
        github_api(f'/repos/{GITHUB_OWNER}/{GITHUB_REPO}/git/blobs'),
        headers=github_headers(),
        json={
            'content': base64.b64encode(content).decode('utf-8'),
            'encoding': 'base64',
        },
        timeout=20,
    )
    if response.status_code >= 300:
        raise HTTPException(status_code=502, detail=f'GitHub blob error: {response.text}')
    return response.json()['sha']


def get_ref_sha(branch: str) -> str:
    response = requests.get(
        github_api(f'/repos/{GITHUB_OWNER}/{GITHUB_REPO}/git/ref/heads/{branch}'),
        headers=github_headers(),
        timeout=20,
    )
    if response.status_code >= 300:
        raise HTTPException(status_code=502, detail=f'GitHub ref error: {response.text}')
    return response.json()['object']['sha']


def get_commit_tree(sha: str) -> str:
    response = requests.get(
        github_api(f'/repos/{GITHUB_OWNER}/{GITHUB_REPO}/git/commits/{sha}'),
        headers=github_headers(),
        timeout=20,
    )
    if response.status_code >= 300:
        raise HTTPException(status_code=502, detail=f'GitHub commit error: {response.text}')
    return response.json()['tree']['sha']


def create_tree(base_tree: str, items: List[dict]) -> str:
    response = requests.post(
        github_api(f'/repos/{GITHUB_OWNER}/{GITHUB_REPO}/git/trees'),
        headers=github_headers(),
        json={
            'base_tree': base_tree,
            'tree': items,
        },
        timeout=20,
    )
    if response.status_code >= 300:
        raise HTTPException(status_code=502, detail=f'GitHub tree error: {response.text}')
    return response.json()['sha']


def create_commit(message: str, tree_sha: str, parents: List[str]) -> str:
    response = requests.post(
        github_api(f'/repos/{GITHUB_OWNER}/{GITHUB_REPO}/git/commits'),
        headers=github_headers(),
        json={
            'message': message,
            'tree': tree_sha,
            'parents': parents,
        },
        timeout=20,
    )
    if response.status_code >= 300:
        raise HTTPException(status_code=502, detail=f'GitHub commit error: {response.text}')
    return response.json()['sha']


def update_ref(branch: str, sha: str) -> None:
    response = requests.patch(
        github_api(f'/repos/{GITHUB_OWNER}/{GITHUB_REPO}/git/refs/heads/{branch}'),
        headers=github_headers(),
        json={'sha': sha, 'force': False},
        timeout=20,
    )
    if response.status_code >= 300:
        raise HTTPException(status_code=502, detail=f'GitHub update ref error: {response.text}')


def create_branch(branch_name: str, base_sha: str) -> None:
    response = requests.post(
        github_api(f'/repos/{GITHUB_OWNER}/{GITHUB_REPO}/git/refs'),
        headers=github_headers(),
        json={'ref': f'refs/heads/{branch_name}', 'sha': base_sha},
        timeout=20,
    )
    if response.status_code >= 300:
        raise HTTPException(status_code=502, detail=f'GitHub create branch error: {response.text}')


def open_pull_request(branch_name: str, title: str, body: str) -> str:
    response = requests.post(
        github_api(f'/repos/{GITHUB_OWNER}/{GITHUB_REPO}/pulls'),
        headers=github_headers(),
        json={'title': title, 'head': branch_name, 'base': GITHUB_BRANCH, 'body': body},
        timeout=20,
    )
    if response.status_code >= 300:
        raise HTTPException(status_code=502, detail=f'GitHub PR error: {response.text}')
    return response.json()['html_url']


def commit_files_to_github(files: Dict[str, bytes], message: str, branch: Optional[str] = None) -> str:
    if not GITHUB_ENABLED:
        raise HTTPException(status_code=400, detail='GitHub integration disabled.')
    if not (GITHUB_TOKEN and GITHUB_OWNER and GITHUB_REPO):
        raise HTTPException(status_code=500, detail='GitHub configuration missing.')

    branch = branch or GITHUB_BRANCH
    base_sha = get_ref_sha(branch)
    base_tree = get_commit_tree(base_sha)

    tree_items = []
    for path, content in files.items():
        blob_sha = create_blob(content)
        tree_items.append({
            'path': path,
            'mode': '100644',
            'type': 'blob',
            'sha': blob_sha,
        })

    new_tree = create_tree(base_tree, tree_items)
    commit_sha = create_commit(message, new_tree, [base_sha])
    update_ref(branch, commit_sha)
    return commit_sha


def raw_github_url(path: str, branch: Optional[str] = None) -> str:
    branch = branch or GITHUB_BRANCH
    return f'https://raw.githubusercontent.com/{GITHUB_OWNER}/{GITHUB_REPO}/{branch}/{path}'


def prepare_index_record(metadata: dict, image_path: Path, committed: bool, github_sha: Optional[str], github_url: Optional[str]) -> dict:
    return {
        'id': metadata.get('id'),
        'name': metadata.get('name'),
        'created_at': metadata.get('created_at'),
        'metadata': metadata.get('metadata', {}),
        'storage': 'server',
        'local_path': str(image_path.relative_to(DATA_DIR)),
        'server_url': f'/api/faces/image/{metadata.get("id")}',
        'committed_to_github': committed,
        'github_commit_sha': github_sha,
        'github_url': github_url,
        'source_device_id': metadata.get('source_device_id'),
    }


@app.post('/api/faces/add', response_model=FaceAddResponse)
async def add_face(
    request: Request,
    image: UploadFile = File(...),
    metadata: str = Form(...),
    _auth: bool = Depends(require_auth),
):
    ensure_dirs()
    content = await image.read()
    validate_upload(image.content_type, content)

    try:
        metadata_obj = json.loads(metadata)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail='Invalid metadata JSON.')

    validate_metadata(metadata_obj)

    face_id = metadata_obj.get('id') or str(uuid4())
    metadata_obj['id'] = face_id
    metadata_obj.setdefault('created_at', datetime.utcnow().isoformat())

    image_path = build_image_path(face_id, image.content_type)
    meta_path = META_DIR / f'{face_id}.json'

    github_commit_sha = None
    github_url = None
    github_pr_url = None
    committed_to_github = False

    with INDEX_LOCK:
        index = load_index()
        existing = next((item for item in index if item.get('id') == face_id), None)
        if existing:
            return FaceAddResponse(
                face_id=existing['id'],
                image_url=existing.get('github_url') or existing.get('server_url'),
                committed_to_github=existing.get('committed_to_github', False),
                github_commit_sha=existing.get('github_commit_sha'),
                github_pr_url=None,
            )

        image_path.write_bytes(content)
        meta_path.write_text(json.dumps(metadata_obj, indent=2))

        index_record = prepare_index_record(
            metadata_obj,
            image_path,
            committed_to_github,
            github_commit_sha,
            github_url,
        )
        index.append(index_record)
        save_index(index)

    if GITHUB_ENABLED:
        files_to_commit = {
            f'data/faces/images/{image_path.name}': content,
            f'data/faces/meta/{meta_path.name}': meta_path.read_bytes(),
            'data/faces/index.json': INDEX_PATH.read_bytes(),
        }
        message = f'Add face {face_id}'

        if GITHUB_PR_FLOW:
            branch_name = f'add-face-{face_id}'
            base_sha = get_ref_sha(GITHUB_BRANCH)
            create_branch(branch_name, base_sha)
            github_commit_sha = commit_files_to_github(files_to_commit, message, branch=branch_name)
            github_pr_url = open_pull_request(
                branch_name,
                title=f'Add face {face_id}',
                body='Automated face ingestion from RedNode sync.',
            )
            github_url = raw_github_url(f'data/faces/images/{image_path.name}', branch=branch_name)
            committed_to_github = True
        else:
            github_commit_sha = commit_files_to_github(files_to_commit, message)
            github_url = raw_github_url(f'data/faces/images/{image_path.name}')
            committed_to_github = True

        with INDEX_LOCK:
            index = load_index()
            for item in index:
                if item.get('id') == face_id:
                    item['committed_to_github'] = committed_to_github
                    item['github_commit_sha'] = github_commit_sha
                    item['github_url'] = github_url
                    save_index(index)
                    break

    return FaceAddResponse(
        face_id=face_id,
        image_url=github_url or f'/api/faces/image/{face_id}',
        committed_to_github=committed_to_github,
        github_commit_sha=github_commit_sha,
        github_pr_url=github_pr_url,
    )


@app.post('/api/faces/sync')
async def sync_faces(
    items: List[FaceSyncItem] = Body(...),
    _auth: bool = Depends(require_auth),
):
    ensure_dirs()
    results = []
    for item in items:
        image_bytes = base64.b64decode(item.image_base64.split(',')[-1])
        validate_upload('image/jpeg', image_bytes)
        metadata_obj = item.dict(exclude={'image_base64'})
        metadata_obj['storage'] = 'server'
        metadata_obj.setdefault('created_at', datetime.utcnow().isoformat())
        metadata_obj.setdefault('metadata', {})

        validate_metadata(metadata_obj)

        face_id = metadata_obj['id']
        image_path = build_image_path(face_id, 'image/jpeg')
        meta_path = META_DIR / f'{face_id}.json'

        with INDEX_LOCK:
            index = load_index()
            if any(entry.get('id') == face_id for entry in index):
                results.append({'face_id': face_id, 'status': 'exists'})
                continue
            image_path.write_bytes(image_bytes)
            meta_path.write_text(json.dumps(metadata_obj, indent=2))

            record = prepare_index_record(metadata_obj, image_path, False, None, None)
            index.append(record)
            save_index(index)
        results.append({'face_id': face_id, 'status': 'created'})

    return {'synced': results}


@app.get('/api/faces/list')
async def list_faces(_auth: bool = Depends(require_auth)):
    with INDEX_LOCK:
        index = load_index()
    return {'faces': index}


@app.get('/api/faces/image/{face_id}')
async def get_face_image(face_id: str):
    with INDEX_LOCK:
        index = load_index()
    record = next((item for item in index if item.get('id') == face_id), None)
    for ext in ('jpg', 'png', 'webp'):
        path = IMAGES_DIR / f'{face_id}.{ext}'
        if path.exists():
            return FileResponse(path)

    if record and record.get('github_url'):
        return RedirectResponse(record['github_url'])

    raise HTTPException(status_code=404, detail='Face image not found.')


@app.post('/api/logs/add')
async def add_logs(payload: LogsPayload, _auth: bool = Depends(require_auth)):
    if not payload.logs:
        raise HTTPException(status_code=400, detail='No logs provided.')

    ensure_dirs()
    date_key = datetime.utcnow().strftime('%Y-%m-%d')
    log_path = LOGS_DIR / f'{date_key}.jsonl'

    with log_path.open('a', encoding='utf-8') as handle:
        for entry in payload.logs:
            entry['source_device_id'] = payload.source_device_id
            entry['captured_at'] = payload.captured_at or datetime.utcnow().isoformat()
            handle.write(json.dumps(entry) + '\n')

    return {'status': 'ok', 'count': len(payload.logs), 'path': str(log_path.relative_to(DATA_DIR))}


@app.get('/health')
async def health():
    return {'status': 'ok'}
