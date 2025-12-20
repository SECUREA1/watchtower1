# Security & Privacy Notes

- **Consent required**: The server rejects face uploads without explicit consent in metadata. The client prompts users before server/GitHub uploads.
- **Secrets stay server-side**: `GITHUB_TOKEN` is stored only in server environment variables; never ship it to the client.
- **Auth**: Use `ADMIN_TOKEN` for demos only. Replace with JWT/session auth in production.
- **Rate limiting**: Add IP/user-based throttling (e.g., Redis-backed limiter) to prevent abuse.
- **Storage & scalability**: For production, store images in object storage (S3/GCS/Azure Blob) and metadata in a database instead of GitHub.
- **Data retention**: Define retention policies for logs and face images; consider automatic deletion workflows.
- **Moderation**: Scan/validate uploaded content (face detection, malware scanning, image sanitization).
- **Transport security**: Use HTTPS/TLS everywhere, and set CORS to trusted origins only.
- **Auditability**: Log access to face images and record admin actions.
