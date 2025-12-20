# RedNode Storage & Sync - Testing Checklist

## Server smoke checks

```bash
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

```bash
curl http://localhost:8000/health
```

## Face upload (multipart)

```bash
curl -X POST http://localhost:8000/api/faces/add \
  -H "Authorization: Bearer dev-token" \
  -F "image=@/path/to/face.jpg" \
  -F 'metadata={"id":"test-123","created_at":"2024-04-23T12:00:00Z","name":"Test","metadata":{"consent":true},"source_device_id":"device-1"}'
```

## List faces

```bash
curl -H "Authorization: Bearer dev-token" \
  http://localhost:8000/api/faces/list
```

## Sync batch (base64)

```bash
python - <<'PY'
import base64, json, requests
with open('/path/to/face.jpg','rb') as f:
    data = base64.b64encode(f.read()).decode('utf-8')
items = [{
  "id": "sync-1",
  "created_at": "2024-04-23T12:00:00Z",
  "name": "Sync Test",
  "metadata": {"consent": True},
  "source_device_id": "device-1",
  "image_base64": data,
}]
resp = requests.post('http://localhost:8000/api/faces/sync', json=items, headers={'Authorization':'Bearer dev-token'})
print(resp.status_code, resp.text)
PY
```

## Log ingestion

```bash
curl -X POST http://localhost:8000/api/logs/add \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"logs":[{"label":"bag","status":"Picked Up","time":1713878400000}],"source_device_id":"device-1"}'
```

## GitHub PR flow simulation

1. Set `GITHUB_ENABLED=1` and `GITHUB_PR_FLOW=1`.
2. Upload a face with `POST /api/faces/add`.
3. Confirm the response contains `github_pr_url` and a commit SHA.
4. Inspect the created branch `add-face-<uuid>` and PR contents.

## Client checks

- Open `secure.html`, toggle **Use Server Database**, and upload a face with consent.
- Click **List Faces** to verify local + server records are shown.
- Click **Sync Local → Server** to migrate local-only faces.
- Click **Save Logs** after generating activity in the dashboard.
