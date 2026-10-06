---
name: App Storage resource limits
description: Managed object-storage setup may be blocked by workspace resource credits, affecting persistent original-media uploads.
---

For property and transaction media, use private managed object storage with provenance in the database. Do not substitute local or temporary server files while presenting them as durable.

**Why:** On 2026-10-06, the idempotent `setupObjectStorage()` request returned `permission_denied` and reported that all workspace credits were used; the setup did not confirm usable storage.

**How to apply:** Verify managed storage before claiming media upload persistence. If unavailable, keep media-upload and buyer-media release gates explicitly blocked, continue independent work, and avoid repeated setup attempts or exposing public object paths.
