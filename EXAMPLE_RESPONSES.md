# Example API Responses

## `POST /api/faces/add`

```json
{
  "ok": true,
  "face_id": "0c4fdbed-acde-4a9e-acde-9a7e9870b19c",
  "image_path": "faces/images/0c4fdbed-acde-4a9e-acde-9a7e9870b19c.jpg",
  "image_url": "/api/faces/image/0c4fdbed-acde-4a9e-acde-9a7e9870b19c",
  "committed_to_github": true,
  "github_commit_sha": "1a2b3c4d5e6f",
  "pr_url": "https://github.com/org/repo/pull/42",
  "message": "Face stored successfully."
}
```

## `GET /api/faces/list`

```json
{
  "ok": true,
  "faces": [
    {
      "id": "0c4fdbed-acde-4a9e-acde-9a7e9870b19c",
      "name": "Visitor",
      "created_at": "2024-04-23T12:00:00Z",
      "metadata": {
        "consent": true,
        "consent_timestamp": "2024-04-23T12:00:05Z"
      },
      "consent": true,
      "consent_timestamp": "2024-04-23T12:00:05Z",
      "storage": "server",
      "local_path": "faces/images/0c4fdbed-acde-4a9e-acde-9a7e9870b19c.jpg",
      "server_url": "/api/faces/image/0c4fdbed-acde-4a9e-acde-9a7e9870b19c",
      "committed_to_github": true,
      "github_commit_sha": "1a2b3c4d5e6f",
      "github_url": "https://raw.githubusercontent.com/org/repo/main/data/faces/images/0c4fdbed-acde-4a9e-acde-9a7e9870b19c.jpg",
      "pr_url": "https://github.com/org/repo/pull/42",
      "device_id": "device-1",
      "source": "rednode_ui"
    }
  ]
}
```

## `POST /api/faces/sync`

```json
{
  "ok": true,
  "synced": [
    {
      "face_id": "batch-1",
      "status": "created",
      "committed_to_github": true,
      "github_commit_sha": "aa11bb22cc33",
      "pr_url": null
    }
  ]
}
```

## Error (missing consent)

```json
{
  "detail": "Consent is required for uploads."
}
```
