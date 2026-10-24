# Privacy and safety controls

| Control | Implementation |
|---|---|
| Purpose explained before camera/location use | Capture and report screens say why location is needed; the browser permission prompt appears only on explicit tap |
| Minimum data | Anonymous public reports are allowed; contact details are optional and visible to staff only |
| Private images by default | All images are served only through HMAC-signed URLs that expire after 15 minutes (`TC_MEDIA_URL_TTL_SECONDS`) |
| Original vs display copies | The uploaded image is re-encoded (metadata, including EXIF GPS, stripped) and stored once, immutable. A face/plate-blurred copy is what users see. Only inspectors/admins receive an "original" link |
| Face and licence-plate blurring | OpenCV Haar cascades on every stored display image. **Best effort**: detection can miss faces/plates or blur other regions |
| Public status page | Reference, category, status history only: no photo, identity, or coordinates |
| Server-side authorisation | Every endpoint checks the role and, for contractors and citizens, ownership/assignment |
| Audit | Status changes, reviewer decisions, pin corrections, user/role changes, punch-list generation and handover are logged with actor and timestamp |
| Retention | `Media.retention_until` exists but **no automatic deletion job is implemented**. Define a retention period and deletion procedure before any public pilot |
| Safety messaging | AI output and route scores are labelled decision support, not certification. Handover requires an explicit engineer acknowledgement |
| Live path planner frames | Processed in memory and discarded; never written to disk or the database. Only an explicit *Save to survey* stores one annotated frame (through the normal privacy-blurred media pipeline) with the GPS position |
| GitHub Models second opinion | Off unless `TC_GITHUB_MODELS_TOKEN` is set. When used, the current frame (resized to ≤ 768 px, **not** face/plate-blurred) is sent to GitHub Models, a third-party service. Enable it only where that transfer is acceptable; the token is server-side only |
| "Ask TenjiCheck" assistant | Off unless `TC_GITHUB_MODELS_TOKEN` is set. Your questions and the records the assistant fetches with your own permissions (titles, statuses, counts, finding descriptions and staff display names; never photos, e-mail addresses or tokens) are sent to GitHub Models. Generated UI runs in an isolated sandboxed iframe with no access to your session. CopilotKit telemetry is disabled |
