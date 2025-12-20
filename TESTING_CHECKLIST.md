# RedNode Face Storage - Testing Checklist

## 1) Start the server

```bash
export ADMIN_TOKEN=dev-token
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

```bash
curl http://localhost:8000/healthz
```

## 2) Browser flow (Local → Cloud)

1. Open `rednode.html` in the browser.
2. Go to **Settings → Face Storage (Local | Cloud)**.
3. Select **Cloud** and enable **Auto-upload**.
4. Click **Capture & Upload Now** to capture a frame.
5. Confirm the thumbnail status transitions: `pending → uploading → uploaded → committed`.
6. Click **Sync Local → Cloud** to retry any failures.

## 3) cURL: Upload a single face

```bash
curl -X POST http://localhost:8000/api/faces/add \
  -H "Authorization: Bearer dev-token" \
  -F "image=@/path/to/face.jpg" \
  -F 'metadata={"id":"test-123","created_at":"2024-04-23T12:00:00Z","name":"Test","consent":true,"consent_timestamp":"2024-04-23T12:00:05Z","device_id":"device-1","source":"rednode_ui"}'
```

## 4) cURL: List faces

```bash
curl -H "Authorization: Bearer dev-token" \
  http://localhost:8000/api/faces/list
```

## 5) cURL: Batch sync (multipart)

```bash
curl -X POST http://localhost:8000/api/faces/sync \
  -H "Authorization: Bearer dev-token" \
  -F "images=@/path/to/face1.jpg" \
  -F "images=@/path/to/face2.jpg" \
  -F 'metadata=[
    {"id":"batch-1","created_at":"2024-04-23T12:00:00Z","name":"Batch 1","consent":true,"device_id":"device-1","source":"rednode_ui"},
    {"id":"batch-2","created_at":"2024-04-23T12:00:02Z","name":"Batch 2","consent":true,"device_id":"device-1","source":"rednode_ui"}
  ]'
```

## 6) Public ingest testing

```bash
export ALLOW_PUBLIC_INGEST=1
```

Repeat the `POST /api/faces/add` request **without** `Authorization`. Ensure metadata includes `consent: true`.

## 7) PR flow testing

```bash
export GITHUB_ENABLED=1
export GITHUB_PR_FLOW=1
```

1. Upload a face with `POST /api/faces/add`.
2. Confirm response includes `pr_url` and `github_commit_sha`.
3. Verify the branch `add-face-<uuid>-<timestamp>` and PR contents.
