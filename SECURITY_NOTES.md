# Security & Privacy Notes

**Production recommendations:**

- **Do not use `ALLOW_PUBLIC_INGEST=1`** on public servers. Keep it only for local testing.
- Use **JWT/session-based auth** and per-user authorization for uploads.
- Store images in **object storage (S3/GCS/Azure Blob)** and keep only metadata + index in GitHub.
- Use **PR-based ingestion** (`GITHUB_PR_FLOW=1`) to allow human review before merges.
- Add **rate limiting**, **abuse detection**, and **virus scanning** on uploaded content.
- Restrict CORS origins to trusted domains.
- Encrypt sensitive metadata and comply with local data retention policies.
- Implement robust audit logs for access to face images and commits.
