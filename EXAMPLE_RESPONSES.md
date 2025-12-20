# Example API Responses

## `POST /api/faces/add`

```json
{
  "face_id": "0c4fdbed-acde-4a9e-acde-9a7e9870b19c",
  "image_url": "/api/faces/image/0c4fdbed-acde-4a9e-acde-9a7e9870b19c",
  "committed_to_github": true,
  "github_commit_sha": "1a2b3c4d5e6f",
  "github_pr_url": "https://github.com/org/repo/pull/42"
}
```

## `GET /api/faces/list`

```json
{
  "faces": [
    {
      "id": "0c4fdbed-acde-4a9e-acde-9a7e9870b19c",
      "name": "Visitor",
      "created_at": "2024-04-23T12:00:00Z",
      "metadata": {
        "consent": true,
        "consent_timestamp": "2024-04-23T12:00:05Z"
      },
      "storage": "server",
      "local_path": "faces/images/0c4fdbed-acde-4a9e-acde-9a7e9870b19c.jpg",
      "server_url": "/api/faces/image/0c4fdbed-acde-4a9e-acde-9a7e9870b19c",
      "committed_to_github": true,
      "github_commit_sha": "1a2b3c4d5e6f",
      "github_url": "https://raw.githubusercontent.com/org/repo/main/data/faces/images/0c4fdbed-acde-4a9e-acde-9a7e9870b19c.jpg",
      "source_device_id": "device-1"
    }
  ]
}
```

## GitHub PR flow response

```json
{
  "face_id": "sync-123",
  "image_url": "https://raw.githubusercontent.com/org/repo/add-face-sync-123/data/faces/images/sync-123.jpg",
  "committed_to_github": true,
  "github_commit_sha": "aa11bb22cc33",
  "github_pr_url": "https://github.com/org/repo/pull/77"
}
```
